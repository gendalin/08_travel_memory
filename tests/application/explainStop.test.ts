/**
 * Why a stop is in the plan — every reason from a fact the planner used.
 *
 * The rationale this replaced was one of two sentences, and it cited every Intent
 * item and Priority on every stop. These tests hold the opposite: a reason says
 * something true of THIS stop, and a stop cites only what a reason names.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { explainStop, type ExplainStopInput } from '../../src/application/generatePlan/explainStop.ts'
import {
  loadProfileMemories,
  seedProfile,
  type BundledEvidence,
  type BundledMemory,
} from '../../src/application/manageMemory/manageMemory.ts'
import { roleById } from '../../src/domain/plan/dayRoles.ts'
import type { TripState } from '../../src/domain/state/types.ts'
import { createRepositories } from '../../src/services/persistence/inMemory.ts'
import type { DemoPlace } from '../../src/services/places/types.ts'
import { memory } from '../domain/fixtures.ts'

const bundled = JSON.parse(readFileSync('data/demo_tokyo_v1/memories.json', 'utf8')) as BundledMemory[]
const evidence = JSON.parse(readFileSync('data/demo_tokyo_v1/evidence.json', 'utf8')) as BundledEvidence[]

const DINNER = roleById('dinner')!

const STATE: TripState = {
  version: 1,
  intent: [
    { id: 'i1', text: 'Slow-paced' },
    { id: 'i2', text: 'Time in local neighbourhoods' },
  ],
  considering: [
    { id: 'c1', text: 'Moderate budget', tag: { kind: 'budget', level: 'moderate' } },
  ],
  priorities: [
    { id: 'prio_convenience', name: 'convenience', weight: 'medium' },
    { id: 'prio_cost', name: 'cost', weight: 'medium' },
    { id: 'prio_novelty', name: 'novelty', weight: 'medium' },
  ],
}

const WEIGHTS = { convenience: 1, cost: 1, novelty: 1 }

function place(overrides: Partial<DemoPlace> = {}): DemoPlace {
  return {
    placeId: 'p1',
    name: 'Counter One',
    lat: 35.7,
    lng: 139.79,
    category: 'sushi',
    neighborhood: 'Kuramae',
    priceLevel: 2,
    typicalDurationMin: 90,
    tags: [],
    shortDescription: '',
    source: 'places_api',
    ...overrides,
  }
}

const explain = (overrides: Partial<ExplainStopInput>) =>
  explainStop({
    place: place(),
    role: DINNER,
    dayIndex: 0,
    state: STATE,
    via: { kind: 'ranking' },
    weights: WEIGHTS,
    ...overrides,
  })

describe('the primary reason is what decided the stop', () => {
  it('a must-visit quotes the traveller back to themselves', () => {
    const state: TripState = {
      ...STATE,
      considering: [
        ...STATE.considering,
        { id: 'c2', text: 'Must go to Counter One', tag: { kind: 'must_visit', placeId: 'p1' } },
      ],
    }
    const { reasons, refs } = explain({ state, via: { kind: 'must_visit' } })
    expect(reasons[0]).toEqual({
      text: 'You asked for this one: “Must go to Counter One”.',
      strength: 'primary',
    })
    expect(refs.stateItemIds).toEqual(['c2'])
  })

  it('a place the traveller saved on Maps says so, ahead of the trend behind it', () => {
    const sushi = memory({ id: 'mem_sushi', examples: ['Counter One'], sourceCounts: { saved_place: 1 } })
    const { reasons, refs } = explain({ via: { kind: 'memory', memory: sushi }, memories: [sushi] })
    expect(reasons[0]).toEqual({ text: 'You saved this place on Maps yourself.', strength: 'primary' })
    expect(reasons[1].strength).toBe('secondary')
    expect(refs.memoryIds).toEqual(['mem_sushi'])
  })

  it('falls back to the part of the day only when nothing else can be said', () => {
    const { reasons, refs } = explain({})
    expect(reasons).toEqual([{ text: 'Dinner for the Kuramae part of the day.', strength: 'primary' }])
    expect(refs).toEqual({ stateItemIds: [], priorityIds: [], memoryIds: [] })
  })
})

describe('what a memory says', () => {
  it('counts the evidence by kind and names the Maps saves, never a screenshot caption', async () => {
    const repositories = createRepositories()
    const profile = await seedProfile(bundled, repositories.memories, '2026-09-28T00:00:00Z', {
      evidence,
    })
    const sushi = profile.find((entry) => entry.subject.value === 'sushi')!
    const izakaya = profile.find((entry) => entry.subject.value === 'izakaya')!

    expect(explain({ via: { kind: 'memory', memory: sushi } }).reasons[0].text).toBe(
      'Sushi keeps turning up in what you keep: 5 places saved on Maps (Sawada, Hakkoku, Kizaki…), 9 screenshots and 4 photos.',
    )
    // The izakaya evidence is screenshots and photos; their "place names" include
    // an Instagram handle, so none is named.
    expect(izakaya.examples).toBeUndefined()
    expect(explain({ via: { kind: 'memory', memory: izakaya } }).reasons[0].text).toBe(
      'Izakaya keeps turning up in what you keep: 7 screenshots and 3 photos.',
    )
  })

  it('without evidence to count, still states the size of the trend', async () => {
    const repositories = createRepositories()
    await seedProfile(bundled, repositories.memories, '2026-09-28T00:00:00Z')
    const sushi = (await loadProfileMemories(repositories.memories)).find(
      (entry) => entry.subject.value === 'sushi',
    )!
    expect(explain({ via: { kind: 'memory', memory: sushi } }).reasons[0].text).toBe(
      'Sushi turns up 18 times in your photos and saved places.',
    )
  })
})

describe('the traveller’s own words', () => {
  it('quotes the words the search was written for, if they still stand in State', () => {
    const found = place({ foundFor: ['local neighbourhoods'] })
    const { reasons, refs } = explain({ place: found })
    expect(reasons[0].text).toBe('Found for “local neighbourhoods”, from what you wrote.')
    expect(refs.stateItemIds).toEqual(['i2'])

    // The traveller has since deleted that line: it is not quoted back.
    const edited: TripState = { ...STATE, intent: [{ id: 'i1', text: 'Slow-paced' }] }
    expect(explain({ place: found, state: edited }).reasons[0].text).not.toContain('Found for')
  })
})

describe('the budget', () => {
  const runnerUp = place({ placeId: 'p2', name: 'Pricey Counter', priceLevel: 4 })
  const scored = {
    place: place(),
    total: 0.6,
    components: {
      stateMatch: 0.4, memoryMatch: 0, convenience: null, cost: 1, novelty: 0.2, routeFit: null,
    },
  }

  it('is a reason only when it decided something — the next best broke it', () => {
    const { reasons, refs } = explain({ scored, runnerUp: { place: runnerUp, lostOn: 'cost' } })
    expect(reasons.map((reason) => reason.text)).toContain(
      'Within the moderate budget you set — Pricey Counter is not.',
    )
    expect(refs.stateItemIds).toContain('c1')
    expect(refs.priorityIds).toEqual(['prio_cost'])
  })

  it('is not repeated on a stop whose runner-up was within budget too', () => {
    const cheap = place({ placeId: 'p3', name: 'Other Counter', priceLevel: 1 })
    const { reasons, refs } = explain({ scored, runnerUp: { place: cheap, lostOn: 'cost' } })
    expect(reasons.some((reason) => reason.text.includes('budget'))).toBe(false)
    expect(refs.stateItemIds).toEqual([])
  })
})

describe('what ranking measured', () => {
  it('states a short hop as a walk from where the traveller arrives', () => {
    const scored = {
      place: place(),
      total: 0.7,
      components: {
        stateMatch: 0.4, memoryMatch: 0, convenience: 0.8, cost: 0.5, novelty: 0.2, routeFit: null,
      },
    }
    const { reasons, refs } = explain({
      scored,
      // About 560 m north of the place.
      from: { name: 'Kuramae', lat: 35.705, lng: 139.79 },
    })
    expect(reasons[0].text).toBe('A 7-minute walk from Kuramae.')
    expect(refs.priorityIds).toEqual(['prio_convenience'])
  })
})

describe('a whole first plan', () => {
  it('gives every stop one primary reason, and cites only what its reasons name', async () => {
    const { confirmReview, defaultPriorities, toFrame } = await import(
      '../../src/application/createTrip/createTrip.ts'
    )
    const { generateFirstPlan } = await import('../../src/application/generatePlan/generatePlan.ts')
    const { createPlaceCatalogue } = await import('../../src/services/places/catalogue.ts')
    const { allItems } = await import('../../src/domain/plan/types.ts')

    const places = JSON.parse(readFileSync('data/demo_tokyo_v1/tokyo_places.json', 'utf8')) as DemoPlace[]
    const catalogue = createPlaceCatalogue(places)
    const repositories = createRepositories()
    const profile = await seedProfile(bundled, repositories.memories, '2026-09-28T00:00:00Z', {
      autoActivate: true,
      evidence,
    })
    const frame = toFrame({
      name: 'Tokyo', startDate: '2026-10-05', endDate: '2026-10-09',
      baseLodgingPlaceId: 'kuramae_base', baseLodgingName: 'Kuramae',
      intentText: '', consideringText: '',
    })
    const { trip, state } = confirmReview({
      tripId: 't', frame,
      draft: { intent: STATE.intent, considering: STATE.considering, priorities: defaultPriorities() },
      profileMemories: profile, catalogue, createdAt: '2026-09-28T00:00:00Z',
    })
    const { plan } = generateFirstPlan({
      frame, state, catalogue, days: 5, now: new Date('2026-09-28'), memorySnapshot: trip.memorySnapshot,
    })

    const items = allItems(plan)
    for (const item of items) {
      expect(item.reasons?.filter((reason) => reason.strength === 'primary')).toHaveLength(1)
      expect(item.rationale).toBe(item.reasons!.map((reason) => reason.text).join(' '))
      // No internal ids: memory ids, provenance strings or snake_case category ids.
      // (A place may have an underscore in its own name — "21_21 Design Sight".)
      expect(item.rationale).not.toMatch(/mem_\d+|category_trend|confidence|\b[a-z]+_[a-z]+\b/)

      // A cited Intent line is one a reason quotes.
      for (const id of item.rationaleRefs!.stateItemIds) {
        const line = [...state.intent, ...state.considering].find((entry) => entry.id === id)!
        if (state.considering.some((entry) => entry.id === id && entry.tag?.kind === 'budget')) continue
        expect(item.rationale).toContain(line.text)
      }
    }

    // The old rationale cited both Intent lines on every stop; this one does not.
    expect(items.some((item) => item.rationaleRefs!.stateItemIds.length === 0)).toBe(true)
    // A stop the traveller saved on Maps says so.
    expect(items.some((item) => item.reasons![0].text === 'You saved this place on Maps yourself.')).toBe(true)
  })
})
