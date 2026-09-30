/**
 * Deterministic fixtures for domain tests.
 *
 * No demo bundle, no UI, no LLM — Gate 2 requires the domain to be provable on
 * its own.
 */

import type { Plan, PlanDay, PlanItem } from '../../src/domain/plan/types.ts'
import type { ValidationPlace } from '../../src/domain/validation/validate.ts'
import type { TripState } from '../../src/domain/state/types.ts'
import type { PlaceRef, TripFrame } from '../../src/domain/trip/types.ts'
import type { Memory } from '../../src/domain/memory/types.ts'

export const LODGING: PlaceRef = { placeId: 'lodging_kuramae', name: 'Kuramae' }

export const FRAME: TripFrame = {
  name: 'Tokyo Slow Week',
  destination: 'Tokyo',
  startDate: '2026-10-05',
  endDate: '2026-10-09',
  baseLodging: LODGING,
}

export function item(overrides: Partial<PlanItem> & Pick<PlanItem, 'id'>): PlanItem {
  return {
    placeId: `place_${overrides.id}`,
    dayIndex: 0,
    startTime: '10:00',
    endTime: '11:00',
    ...overrides,
  }
}

export function day(dayIndex: number, items: PlanItem[]): PlanDay {
  return { dayIndex, startsAt: LODGING, endsAt: LODGING, items }
}

export function plan(days: PlanDay[], version = 1): Plan {
  return { version, days }
}

/** Day 0: three items, 10:00 / 13:00 / 16:00. */
export function basePlan(): Plan {
  return plan([
    day(0, [
      item({ id: 'a', placeId: 'place_a', startTime: '10:00', endTime: '11:00' }),
      item({ id: 'b', placeId: 'place_b', startTime: '13:00', endTime: '14:00' }),
      item({ id: 'c', placeId: 'place_c', startTime: '16:00', endTime: '17:00' }),
    ]),
  ])
}

export function emptyState(version = 1): TripState {
  return { version, intent: [], considering: [], priorities: [] }
}

export function state(overrides: Partial<TripState> = {}): TripState {
  return { ...emptyState(), ...overrides }
}

/** Places with opening hours, so validation passes unless a test removes them. */
export function placeMap(ids: string[]): Map<string, ValidationPlace> {
  return new Map(
    ids.map((placeId) => [placeId, { placeId, openingHours: { mon: '09:00-18:00' } }]),
  )
}

export const DEFAULT_PLACES = placeMap([
  'lodging_kuramae',
  'place_a',
  'place_b',
  'place_c',
  'place_d',
])

/** A category preference by default; override `kind`/`subject` for other kinds. */
export function memory(overrides: Partial<Memory> & Pick<Memory, 'id'>): Memory {
  return {
    text: 'Repeatedly drawn to sushi',
    status: 'candidate',
    kind: 'preference',
    subject: { facet: 'category', value: 'sushi' },
    polarity: 1,
    strength: 0.7,
    confidence: 0.7,
    provenance: {
      type: 'historical_behavior',
      sourceRefs: ['ev_001'],
      createdAt: '2026-09-01T00:00:00.000Z',
    },
    ...overrides,
  }
}
