/**
 * Adding OR removing a State line updates the itinerary as a new, reviewable version
 * (2026-10-01).
 *
 * Before this, "go to Yokohama on last day" was read by nothing and saved with "the
 * itinerary still works as it stands", and deleting a must-visit left the place in the
 * plan. Each case now produces a previewed Reframe whose confirmation writes plan
 * v+1, and every version stays in the history so any two can be compared.
 */

import { describe, expect, it } from 'vitest'

import { confirmProposal } from '../../src/application/commitProposal/commitProposalUseCase.ts'
import { prepareStateEdit } from '../../src/application/editState/prepareStateEdit.ts'
import { proposeStateEdit, toStateDraft, type StateDraft } from '../../src/application/editState/proposeStateEdit.ts'
import { handleChatMessage } from '../../src/application/handleChat/handleChat.ts'
import { operationFromReading } from '../../src/application/handleChat/route.ts'
import { inArea } from '../../src/application/planning/areaDays.ts'
import { allItems, type Plan } from '../../src/domain/plan/types.ts'
import { createPlaceCatalogue } from '../../src/services/places/catalogue.ts'
import { createStubLlm } from '../../src/services/llm/stubLlm.ts'
import { createRepositories } from '../../src/services/persistence/inMemory.ts'
import type { PlacesResult } from '../../src/services/places/retrieval.ts'
import type { DemoPlace } from '../../src/services/places/types.ts'
import { createTokyoTrip, NOW, places, type TokyoTrip } from './tokyoTrip.ts'

const OPEN = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, '09:00-22:00']))
const YOKOHAMA = { lat: 35.4478, lng: 139.6425 }
const yokohamaPlace = (id: string, name: string, category: string, dLat: number, dLng: number): DemoPlace => ({
  placeId: id, name, category, neighborhood: 'Yokohama', lat: YOKOHAMA.lat + dLat, lng: YOKOHAMA.lng + dLng,
  typicalDurationMin: 60, tags: [], shortDescription: '', source: 'places_api', priceLevel: 2, openingHours: OPEN, userRatingCount: 800,
})
const YOKOHAMA_PLACES = [
  yokohamaPlace('y_museum', 'Yokohama Museum of Art', 'museum_gallery', 0.008, -0.006),
  yokohamaPlace('y_park', 'Yamashita Park', 'park_garden', -0.002, 0.006),
  yokohamaPlace('y_ramen', 'Yoshimuraya', 'ramen', 0.001, 0.001),
  yokohamaPlace('y_izakaya', 'Noge Izakaya', 'izakaya', 0.002, -0.01),
  yokohamaPlace('y_kissa', 'Kissa Motomachi', 'cafe_kissaten', 0, 0.002),
]
const withYokohama = createPlaceCatalogue([...places, ...YOKOHAMA_PLACES])
const bundled = createPlaceCatalogue(places)

function edit(trip: TokyoTrip, change: (draft: StateDraft) => void, catalogue = withYokohama, state = trip.state, plan: Plan = trip.plan) {
  const draft = toStateDraft(state)
  change(draft)
  return proposeStateEdit({
    tripId: 'trip_1', frame: trip.frame, state, plan, draft, catalogue,
    now: NOW, proposalId: 'p', createdAt: NOW.toISOString(), memorySnapshot: trip.trip.memorySnapshot,
  })
}

describe('adding a line', () => {
  it('"go to Yokohama on last day" re-plans Day 5 there, previewed as a Reframe', () => {
    const trip = createTokyoTrip()
    const outcome = edit(trip, (draft) => draft.considering.push({ id: 'y', text: 'go to Yokohama on last day' }))
    if (outcome.kind !== 'proposal') throw new Error(`expected a proposal, got ${outcome.kind}`)
    expect(outcome.proposal.type).toBe('reframe')
    const day = outcome.proposal.candidatePlan.days[4]
    expect(day.area?.name).toBe('Yokohama')
    expect(day.items.length).toBeGreaterThan(0)
    for (const item of day.items) expect(inArea(withYokohama.get(item.placeId)!, day.area!)).toBe(true)
    // A day out ends with dinner.
    expect(day.items.some((item) => item.role === 'nightcap')).toBe(false)
    // Nothing committed yet.
    expect(trip.plan.days[4].area).toBeUndefined()
  })

  it('without places there, is a Conflict that says so and offers other days — not a silent save', () => {
    const trip = createTokyoTrip()
    const outcome = edit(trip, (draft) => draft.considering.push({ id: 'y', text: 'go to Yokohama on last day' }), bundled)
    expect(outcome.kind).toBe('conflict')
    if (outcome.kind !== 'conflict') return
    expect(outcome.conflicts[0].message).toContain('Yokohama')
    expect(outcome.conflicts[0].options?.map((option) => option.kind)).toEqual(expect.arrayContaining(['move_day', 'remove', 'edit']))
  })
})

describe('removing a line', () => {
  it('a removed must-visit leaves the plan, as a change the traveller confirms', () => {
    const trip = createTokyoTrip(['We must visit Nezu Museum.'])
    expect(allItems(trip.plan).some((item) => item.placeId === 'nezu_museum')).toBe(true)
    const outcome = edit(trip, (draft) => { draft.considering = [] }, bundled)
    if (outcome.kind !== 'proposal') throw new Error(`expected a proposal, got ${outcome.kind}`)
    expect(outcome.proposal.type).toBe('reframe')
    expect(allItems(outcome.proposal.candidatePlan).some((item) => item.placeId === 'nezu_museum')).toBe(false)
  })

  it('a removed day in a town turns the day back into an ordinary one', async () => {
    const trip = createTokyoTrip()
    const add = edit(trip, (draft) => draft.considering.push({ id: 'y', text: 'go to Yokohama on last day' }))
    if (add.kind !== 'proposal') throw new Error('expected a proposal')
    const committed = await confirmProposal({ proposal: add.proposal, state: trip.state, plan: trip.plan, catalogue: withYokohama, repositories: createRepositories(), receiptId: 'r1', timestamp: NOW.toISOString() })

    const back = edit(trip, (draft) => { draft.considering = draft.considering.filter((item) => item.id !== 'y') }, withYokohama, committed.state, committed.plan)
    if (back.kind !== 'proposal') throw new Error(`expected a proposal, got ${back.kind}`)
    const day = back.proposal.candidatePlan.days[4]
    expect(day.area).toBeUndefined()
    expect(day.items.every((item) => !inArea(withYokohama.get(item.placeId)!, { center: YOKOHAMA, radiusKm: 2.2 }))).toBe(true)
  })
})

describe('versions', () => {
  it('every confirmed change is a new version, and every version is kept', async () => {
    const trip = createTokyoTrip()
    const repositories = createRepositories()
    await repositories.plans.save('trip_1', trip.plan)

    const add = edit(trip, (draft) => draft.considering.push({ id: 'y', text: 'go to Yokohama on last day' }))
    if (add.kind !== 'proposal') throw new Error('expected a proposal')
    const v2 = await confirmProposal({ proposal: add.proposal, state: trip.state, plan: trip.plan, catalogue: withYokohama, repositories, receiptId: 'r1', timestamp: NOW.toISOString() })

    const remove = edit(trip, (draft) => { draft.considering = [] }, withYokohama, v2.state, v2.plan)
    if (remove.kind !== 'proposal') throw new Error('expected a proposal')
    await confirmProposal({ proposal: remove.proposal, state: v2.state, plan: v2.plan, catalogue: withYokohama, repositories, receiptId: 'r2', timestamp: NOW.toISOString() })

    const history = await repositories.plans.history('trip_1')
    expect(history.map((plan) => plan.version)).toEqual([1, 2, 3])
    expect(history[1].days[4].area?.name).toBe('Yokohama')
    expect(await repositories.receipts.listByTrip('trip_1')).toHaveLength(2)
  })
})

describe('preparing an edit that names a day somewhere', () => {
  it('locates the place and fetches places there when the trip has none', async () => {
    const trip = createTokyoTrip()
    const draft = toStateDraft(trip.state)
    draft.considering.push({ id: 'z', text: 'Day 3: Somewhere Unmapped' })
    const results: PlacesResult[] = YOKOHAMA_PLACES.map((place) => ({
      id: place.placeId, displayName: { text: place.name }, location: { latitude: place.lat, longitude: place.lng },
      primaryType: place.category === 'museum_gallery' ? 'museum' : place.category === 'park_garden' ? 'park' : place.category === 'ramen' ? 'ramen_restaurant' : place.category === 'izakaya' ? 'bar' : 'cafe',
      types: ['point_of_interest'],
      regularOpeningHours: { periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, hour: 9, minute: 0 }, close: { day, hour: 22, minute: 0 } })) },
      userRatingCount: 800, priceLevel: 'PRICE_LEVEL_MODERATE',
      addressComponents: [{ longText: 'Naka Ward', types: ['sublocality_level_1'] }],
    }) as PlacesResult)
    const prepared = await prepareStateEdit({
      llm: createStubLlm(), draft, state: trip.state, trip: trip.trip, frame: trip.frame, catalogue: bundled, days: 5,
      retrieval: {
        locator: { locate: async () => ({ ...YOKOHAMA, matchedAddress: 'Somewhere Unmapped' }) },
        searcher: { search: async (requests) => ({ results: requests.map((request) => ({ textQuery: request.textQuery, places: results })), calls: requests.length, fromCache: 0 }) },
      },
      at: NOW.toISOString(),
    })
    const read = prepared.interpretations.get('considering:Day 3: Somewhere Unmapped')
    expect(read).toMatchObject({ tag: { kind: 'day_in_place', dayIndex: 2, place: { name: 'Somewhere Unmapped', center: YOKOHAMA } } })
    expect(prepared.snapshot).toBeDefined()
    expect(prepared.catalogue.all().length).toBeGreaterThan(bundled.all().length)
    expect(prepared.notes.join(' ')).toContain('Found')
  })
})

describe('chat, read by the model', () => {
  it('maps a reading onto an operation the product already runs', () => {
    const trip = createTokyoTrip()
    const lunch = allItems(trip.plan).find((item) => item.role === 'lunch' && item.dayIndex === 1)!
    expect(operationFromReading({
      reading: { action: 'replace_stop', day: 2, stop: 'lunch', time: null, polarity: null, stateLine: null, section: null, question: null },
      message: '禮拜二的午餐那家好像沒開', plan: trip.plan, catalogue: bundled,
    })).toEqual({ kind: 'replace_place', itemId: lunch.id, placeId: lunch.placeId })
    expect(operationFromReading({
      reading: { action: 'lighter', day: 'today', stop: null, time: null, polarity: null, stateLine: null, section: null, question: null },
      message: '今天腳好痠', plan: trip.plan, catalogue: bundled, todayIndex: 2,
    })).toMatchObject({ kind: 'fewer_stops', dayIndex: 2 })
  })

  it('"lighter" for one day thins only that day', async () => {
    const trip = createTokyoTrip()
    const message = '今天腳好痠，下午想輕鬆點'
    const outcome = await handleChatMessage({
      message, tripId: 'trip_1', frame: trip.frame, state: trip.state, plan: trip.plan, catalogue: bundled,
      llm: createStubLlm(), now: NOW, proposalId: 'p', createdAt: NOW.toISOString(), focusDayIndex: 2,
      reading: { action: 'lighter', day: 3, stop: null, time: null, polarity: null, stateLine: null, section: null, question: null },
    })
    if (outcome.kind !== 'proposal') throw new Error(`expected a proposal, got ${outcome.kind}`)
    expect(new Set(outcome.proposal.planDiff.removed.map((item) => item.dayIndex))).toEqual(new Set([2]))
  })

  it('falls back to the rules when there is no reading', async () => {
    const trip = createTokyoTrip()
    const outcome = await handleChatMessage({
      message: 'I feel tired. Fewer spots.', tripId: 'trip_1', frame: trip.frame, state: trip.state, plan: trip.plan, catalogue: bundled,
      llm: createStubLlm(), now: NOW, proposalId: 'p', createdAt: NOW.toISOString(), reading: null,
    })
    expect(outcome.kind).toBe('proposal')
  })
})
