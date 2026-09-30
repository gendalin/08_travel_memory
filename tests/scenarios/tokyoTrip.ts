/**
 * Shared deterministic Tokyo trip for the Gate 5 scenarios (§17.3).
 *
 * Same bundle, same dates, same stub model as the demo — so a scenario failure
 * is a change in behaviour, not a change in setup.
 */

import { readFileSync } from 'node:fs'

import {
  confirmReview,
  defaultPriorities,
  toFrame,
  type StageAInput,
} from '../../src/application/createTrip/createTrip.ts'
import { tagConsidering } from '../../src/application/decompose/tagConsidering.ts'
import { generateFirstPlan } from '../../src/application/generatePlan/generatePlan.ts'
import { createPlaceCatalogue } from '../../src/services/places/catalogue.ts'
import { allItems, type Plan } from '../../src/domain/plan/types.ts'
import type { Memory } from '../../src/domain/memory/types.ts'
import type { Priority, TripState } from '../../src/domain/state/types.ts'
import type { Trip } from '../../src/domain/trip/types.ts'
import type { DemoPlace } from '../../src/services/places/types.ts'

export const places = JSON.parse(
  readFileSync('data/demo_tokyo_v1/tokyo_places.json', 'utf8'),
) as DemoPlace[]

export const bundledMemories = JSON.parse(
  readFileSync('data/demo_tokyo_v1/memories.json', 'utf8'),
) as Array<{
  id: string
  text: string
  strength: number
  confidence: number
  subject: { facet: string; value: string | number }
  provenance: { sourceRefs: string[] }
}>

export const scenario = JSON.parse(
  readFileSync('data/demo_tokyo_v1/demo_scenario.json', 'utf8'),
) as { events: Array<{ id: string; day: number; text: string; placeId?: string }> }

export const catalogue = createPlaceCatalogue(places)

/** Before the trip starts, so nothing is locked (§4.3). */
export const NOW = new Date('2026-09-21T09:00:00')

export const SETUP: StageAInput = {
  name: 'Tokyo Slow Week',
  startDate: '2026-10-05',
  endDate: '2026-10-09',
  baseLodgingPlaceId: places.find((place) => place.category === 'accommodation')!.placeId,
  baseLodgingName: 'Kuramae',
  intentText: 'Slow-paced.',
  consideringText: 'Moderate budget.',
}

export function eventText(id: string): string {
  const found = scenario.events.find((event) => event.id === id)
  if (!found) throw new Error(`demo_scenario.json has no event "${id}"`)
  return found.text
}

export interface TokyoTrip {
  trip: Trip
  frame: ReturnType<typeof toFrame>
  state: TripState
  plan: Plan
}

/**
 * The traveller's own measured pace, as an active memory.
 *
 * Read from the bundle rather than written here, and active by default because it is
 * what the evidence says: three stops on a typical day. Without it every fixture trip
 * would attempt all eight roles, which this thirty-three-place catalogue cannot fill —
 * so the fixture would be exercising the catalogue ceiling rather than the behaviour
 * each test is about.
 */
export function pacePattern(): Memory {
  const measured = bundledMemories.find((entry) => entry.subject.facet === 'stops_per_day')!
  return {
    id: measured.id,
    text: measured.text,
    status: 'active',
    kind: 'pattern',
    subject: { facet: 'stops_per_day', value: Number(measured.subject.value) },
    polarity: 1,
    strength: measured.strength,
    confidence: measured.confidence,
    provenance: {
      type: 'historical_behavior',
      sourceRefs: measured.provenance.sourceRefs,
      createdAt: NOW.toISOString(),
    },
  }
}

export function createTokyoTrip(
  considering: string[] = [],
  /** Overrides the default medium weights, for tests about ranking (§3.3). */
  priorities: Priority[] = defaultPriorities(),
  /** Extra active memories, on top of the traveller's measured pace. */
  memories: Memory[] = [],
): TokyoTrip {
  const frame = toFrame(SETUP)
  const { trip, state } = confirmReview({
    tripId: 'trip_1',
    frame,
    draft: {
      intent: [{ id: 'intent_1', text: 'Slow-paced' }],
      considering: considering.map((text, index) => ({ id: `cons_${index + 1}`, text })),
      priorities,
    },
    profileMemories: [pacePattern(), ...memories],
    catalogue,
    createdAt: NOW.toISOString(),
  })

  const { plan, validation } = generateFirstPlan({
    frame,
    state,
    catalogue,
    days: 5,
    now: NOW,
    // The trip's own snapshot, so the fixture exercises the same path the product
    // does. It was omitted, which meant no memory reached the generator at all.
    memorySnapshot: trip.memorySnapshot,
  })
  if (!validation.valid) {
    throw new Error(`fixture plan is invalid: ${JSON.stringify(validation.errors)}`)
  }

  return { trip, frame, state, plan }
}

/**
 * A real catalogue place the given plan does NOT already contain, and whose
 * name a must-visit sentence actually resolves to.
 *
 * Both halves are derived rather than named. Which places the first plan holds
 * is decided by ranking (§12.2), so a hardcoded "somewhere that isn't in the
 * plan" goes stale the moment the scorer changes — and the round-trip through
 * `tagConsidering` is what stops a test passing on a place whose name happens
 * to resolve to a different one.
 */
export function placeNotInPlan(plan: Plan): DemoPlace {
  const used = new Set(allItems(plan).map((item) => item.placeId))

  const found = places.find((place) => {
    if (place.category === 'accommodation' || used.has(place.placeId)) return false
    const tag = tagConsidering(mustVisitSentence(place), catalogue)
    return tag?.kind === 'must_visit' && tag.placeId === place.placeId
  })

  if (!found) throw new Error('every resolvable place in the catalogue is already in the plan')
  return found
}

/** The sentence a test should use to pin `place`, matching `placeNotInPlan`. */
export function mustVisitSentence(place: DemoPlace): string {
  return `We must visit ${place.name}.`
}
