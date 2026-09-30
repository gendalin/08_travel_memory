/**
 * Integration: New Trip -> Review -> State v1 -> validated Plan v1.
 * Gate 3 steps 1-3.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  activeMemoryCount,
  buildReviewDraft,
  confirmReview,
  defaultPriorities,
  toFrame,
  tripDays,
  type StageAInput,
} from '../../src/application/createTrip/createTrip.ts'
import { generateFirstPlan } from '../../src/application/generatePlan/generatePlan.ts'
import { createPlaceCatalogue } from '../../src/services/places/catalogue.ts'
import { createStubLlm } from '../../src/services/llm/stubLlm.ts'
import { createRepositories } from '../../src/services/persistence/inMemory.ts'
import { allItems } from '../../src/domain/plan/types.ts'
import type { Memory } from '../../src/domain/memory/types.ts'
import type { DemoPlace } from '../../src/services/places/types.ts'

const places = JSON.parse(
  readFileSync('data/demo_tokyo_v1/tokyo_places.json', 'utf8'),
) as DemoPlace[]
const catalogue = createPlaceCatalogue(places)
const NOW = new Date('2026-09-21T09:00:00')

const SETUP: StageAInput = {
  name: 'Tokyo Slow Week',
  startDate: '2026-10-05',
  endDate: '2026-10-09',
  baseLodgingPlaceId: 'kuramae_base',
  baseLodgingName: 'Kuramae',
  intentText: 'Slow-paced. Time in local neighbourhoods. Not too much rushing.',
  consideringText: 'Keep the budget moderate. One proper sushi meal.',
}

function activeMemory(id: string, text: string, category = 'sushi'): Memory {
  return {
    id, text, status: 'active',
    kind: 'preference', subject: { facet: 'category', value: category },
    polarity: 1, strength: 0.8, confidence: 0.8,
    provenance: { type: 'saved_places', sourceRefs: ['ev_001'], createdAt: NOW.toISOString() },
  }
}

describe('New Trip -> first Plan', () => {
  it('decomposes free text into Intent and Considering', async () => {
    const draft = await buildReviewDraft(SETUP, createStubLlm())
    expect(draft.intent.length).toBeGreaterThan(1)
    expect(draft.considering.length).toBeGreaterThan(1)
    expect(draft.intent[0].text).toMatch(/slow/i)
  })

  it('always offers the three core Priorities at medium', async () => {
    const draft = await buildReviewDraft(SETUP, createStubLlm())
    expect(draft.priorities.map((p) => p.name)).toEqual(['convenience', 'cost', 'novelty'])
    expect(draft.priorities.every((p) => p.weight === 'medium')).toBe(true)
  })

  it('keeps an agent-proposed Priority out of State unless accepted', async () => {
    const llm = createStubLlm({
      proposedPriority: { name: 'Photographic potential', reason: 'You mention neighbourhoods.' },
    })
    const draft = await buildReviewDraft(SETUP, llm)
    expect(draft.proposedPriority?.name).toBe('Photographic potential')

    const notAccepted = confirmReview({
      tripId: 'trip_1', frame: toFrame(SETUP), draft,
      profileMemories: [],
      catalogue, createdAt: NOW.toISOString(),
    })
    expect(notAccepted.state.priorities).toHaveLength(3)

    const accepted = confirmReview({
      tripId: 'trip_1', frame: toFrame(SETUP), draft,
      acceptedPriorityName: 'Photographic potential',
      profileMemories: [],
      catalogue, createdAt: NOW.toISOString(),
    })
    expect(accepted.state.priorities).toHaveLength(4)
    expect(accepted.state.priorities[3].proposedByAgent).toBe(true)
  })

  it('creates State v1 and an immutable snapshot of active memories only', () => {
    const memories = [activeMemory('m1', 'Often saves sushi places'), {
      ...activeMemory('m2', 'candidate one'), status: 'candidate' as const,
    }]

    const { trip, state } = confirmReview({
      tripId: 'trip_1', frame: toFrame(SETUP),
      draft: { intent: [{ id: 'i1', text: 'Slow-paced' }], considering: [], priorities: defaultPriorities() },
      profileMemories: memories, catalogue, createdAt: NOW.toISOString(),
    })

    expect(state.version).toBe(1)
    expect(trip.memorySnapshot.memories.map((m) => m.id)).toEqual(['m1'])
    expect(() => {
      ;(trip.memorySnapshot.memories as unknown as unknown[]).push(activeMemory('m3', 'later'))
    }).toThrow()
  })

  it('counts active memories for the Stage A disclosure', () => {
    expect(activeMemoryCount([])).toBe(0)
    expect(activeMemoryCount([activeMemory('m1', 'one')])).toBe(1)
  })

  it('generates a valid Plan v1 covering every day', () => {
    const frame = toFrame(SETUP)
    const { state } = confirmReview({
      tripId: 'trip_1', frame,
      draft: { intent: [], considering: [], priorities: defaultPriorities() },
      profileMemories: [], catalogue, createdAt: NOW.toISOString(),
    })

    const { plan, validation } = generateFirstPlan({
      frame, state, catalogue, days: tripDays(frame.startDate, frame.endDate), now: NOW,
    })

    expect(validation.valid).toBe(true)
    expect(validation.errors).toEqual([])
    expect(plan.version).toBe(1)
    expect(plan.days).toHaveLength(5)
    expect(allItems(plan).length).toBeGreaterThan(8)
  })

  it('uses only POIs from the demo bundle', () => {
    const frame = toFrame(SETUP)
    const { state } = confirmReview({
      tripId: 'trip_1', frame,
      draft: { intent: [], considering: [], priorities: defaultPriorities() },
      profileMemories: [], catalogue, createdAt: NOW.toISOString(),
    })
    const { plan } = generateFirstPlan({ frame, state, catalogue, days: 5, now: NOW })

    for (const item of allItems(plan)) {
      expect(catalogue.has(item.placeId)).toBe(true)
    }
  })

  it('never repeats a place across the trip', () => {
    const frame = toFrame(SETUP)
    const { state } = confirmReview({
      tripId: 'trip_1', frame,
      draft: { intent: [], considering: [], priorities: defaultPriorities() },
      profileMemories: [], catalogue, createdAt: NOW.toISOString(),
    })
    const { plan } = generateFirstPlan({ frame, state, catalogue, days: 5, now: NOW })
    const ids = allItems(plan).map((item) => item.placeId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('anchors every day at the base lodging', () => {
    const frame = toFrame(SETUP)
    const { state } = confirmReview({
      tripId: 'trip_1', frame,
      draft: { intent: [], considering: [], priorities: defaultPriorities() },
      profileMemories: [], catalogue, createdAt: NOW.toISOString(),
    })
    const { plan } = generateFirstPlan({ frame, state, catalogue, days: 5, now: NOW })

    for (const day of plan.days) {
      expect(day.startsAt.placeId).toBe('kuramae_base')
      expect(day.endsAt.placeId).toBe('kuramae_base')
    }
  })

  it('honours a must-visit Considering constraint', () => {
    const frame = toFrame(SETUP)
    const state = {
      version: 1, intent: [], priorities: defaultPriorities(),
      considering: [{
        id: 'c1', text: 'Must visit the Nezu Museum',
        tag: { kind: 'must_visit' as const, placeId: 'nezu_museum' },
      }],
    }
    const { plan, validation } = generateFirstPlan({ frame, state, catalogue, days: 5, now: NOW })
    expect(allItems(plan).some((item) => item.placeId === 'nezu_museum')).toBe(true)
    expect(validation.valid).toBe(true)
  })

  it('persists trip, state and plan', async () => {
    const repositories = createRepositories()
    const frame = toFrame(SETUP)
    const { trip, state } = confirmReview({
      tripId: 'trip_1', frame,
      draft: { intent: [], considering: [], priorities: defaultPriorities() },
      profileMemories: [], catalogue, createdAt: NOW.toISOString(),
    })
    const { plan } = generateFirstPlan({ frame, state, catalogue, days: 5, now: NOW })

    await repositories.trips.save(trip)
    await repositories.states.save(trip.id, state)
    await repositories.plans.save(trip.id, plan)

    expect((await repositories.trips.get('trip_1'))?.frame.destination).toBe('Tokyo')
    expect((await repositories.states.getCurrent('trip_1'))?.version).toBe(1)
    expect((await repositories.plans.getCurrent('trip_1'))?.version).toBe(1)
  })

  it('creates no Receipt — trip creation is not a change transaction', async () => {
    const repositories = createRepositories()
    expect(await repositories.receipts.listByTrip('trip_1')).toHaveLength(0)
  })
})
