/**
 * Retrieval at the moment a trip is created.
 *
 * Offline: the lodging locator and the searcher are injected, so the whole chain —
 * profile, wording, searches, quality gate, frozen snapshot — is tested without a key,
 * a network call or a bill.
 *
 * The claim worth holding is the fallback rule. A product that silently planned from
 * its seed set would look identical to one that planned for this traveller, and the
 * difference is the entire point; a product that fell back whenever anything was thin
 * would throw away real places to reach a set that is thinner still.
 */

import { describe, expect, it, vi } from 'vitest'

import { retrieveForTrip } from '../../src/application/createTrip/retrieveForTrip.ts'
import type { PlacesSearcher } from '../../src/application/planning/retrievePlaces.ts'
import { createMemorySnapshot } from '../../src/domain/memory/snapshot.ts'
import type { Memory } from '../../src/domain/memory/types.ts'
import { createFallbackLlm } from '../../src/services/llm/fallbackLlm.ts'
import { createStubLlm } from '../../src/services/llm/stubLlm.ts'
import type { LodgingLocator } from '../../src/services/places/lodging.ts'
import type { PlacesResult } from '../../src/services/places/retrieval.ts'
import { memory } from '../domain/fixtures.ts'

const KURAMAE = { lat: 35.703164, lng: 139.790828, matchedAddress: 'Kuramae, Taito City' }

const locator: LodgingLocator = { async locate() { return KURAMAE } }
const nothingFound: LodgingLocator = { async locate() { return null } }

/** Open across a window, every day, so capacity is about the catalogue not the clock. */
function hours(openHour: number, closeHour: number) {
  return {
    periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      open: { day, hour: openHour, minute: 0 },
      close: { day, hour: closeHour, minute: 0 },
    })),
  }
}

function result(input: {
  id: string
  type: string
  open: [number, number]
  lat?: number
  lng?: number
}): PlacesResult {
  return {
    id: input.id,
    displayName: { text: input.id },
    primaryType: input.type,
    types: [input.type],
    location: { latitude: input.lat ?? 35.7, longitude: input.lng ?? 139.79 },
    regularOpeningHours: hours(input.open[0], input.open[1]),
    addressComponents: [{ longText: 'Taito City', types: ['locality'] }],
  }
}

/** Enough for a two-day trip to have a main thing, a lunch and a dinner each day. */
const ENOUGH: PlacesResult[] = [
  result({ id: 'museum_a', type: 'museum', open: [10, 18] }),
  result({ id: 'museum_b', type: 'art_gallery', open: [10, 18] }),
  result({ id: 'ramen_a', type: 'ramen_restaurant', open: [11, 23] }),
  result({ id: 'ramen_b', type: 'ramen_restaurant', open: [11, 23] }),
  result({ id: 'sushi_a', type: 'sushi_restaurant', open: [11, 23] }),
  result({ id: 'sushi_b', type: 'sushi_restaurant', open: [11, 23] }),
]

/** Answers the first search with `places` and every other one with nothing. */
function searcherReturning(places: PlacesResult[]): PlacesSearcher & {
  requests: Array<{ textQuery: string }>
} {
  const requests: Array<{ textQuery: string }> = []
  return {
    requests,
    async search(incoming) {
      for (const request of incoming) requests.push({ textQuery: request.textQuery })
      return {
        results: incoming.map((request, index) => ({
          textQuery: request.textQuery,
          places: index === 0 ? places : [],
        })),
        calls: incoming.length,
        fromCache: 0,
      }
    },
  }
}

const BRIEF = {
  tripId: 'trip_1',
  days: 2,
  destination: 'Tokyo',
  baseLodgingName: 'Kuramae',
  intentText: 'Slow-paced. Time in local neighbourhoods.',
  consideringText: 'Moderate budget.',
  considering: ['Moderate budget'],
  createdAt: '2026-10-01T00:00:00.000Z',
}

const run = (overrides: Partial<Parameters<typeof retrieveForTrip>[0]> = {}) =>
  retrieveForTrip({
    ...BRIEF,
    llm: createStubLlm(),
    locator,
    searcher: searcherReturning(ENOUGH),
    ...overrides,
  })

const snapshotOf = (memories: Memory[]) =>
  createMemorySnapshot('trip_1', memories, '2026-09-01T00:00:00.000Z')

describe('when the search answers', () => {
  it('freezes what it found onto the trip, with the searches that found it', async () => {
    const outcome = await run()

    expect(outcome.kind).toBe('retrieved')
    if (outcome.kind !== 'retrieved') return

    expect(outcome.snapshot.version).toBe(1)
    expect(outcome.snapshot.tripId).toBe('trip_1')
    expect(outcome.snapshot.places.map((place) => place.placeId).sort()).toEqual([
      'museum_a', 'museum_b', 'ramen_a', 'ramen_b', 'sushi_a', 'sushi_b',
    ])

    // Provenance is what makes "why this place and not another" answerable later.
    const [provenance] = outcome.snapshot.provenance
    expect(provenance.queries.length).toBeGreaterThan(0)
    expect(provenance.lodging.matchedAddress).toBe('Kuramae, Taito City')
  })

  it('uses the wording the model wrote', async () => {
    const searcher = searcherReturning(ENOUGH)
    await run({ searcher })

    // The stub works the traveller's first words into the query, which is how a
    // model-written search is told apart from the one the application writes.
    expect(searcher.requests.some((request) => /slow|paced|local/i.test(request.textQuery))).toBe(true)
  })

  it('searches in plain terms when the model does not answer', async () => {
    // Phase C2 through this path: `planQueries` returning nothing is not a failure,
    // it is the caller writing its own wording — and labelling it as its own.
    const searcher = searcherReturning(ENOUGH)
    await run({ searcher, llm: createFallbackLlm() })

    expect(searcher.requests.length).toBeGreaterThan(0)
    for (const request of searcher.requests) {
      expect(request.textQuery).toContain('near Kuramae')
    }
  })

  it('does not search a kind of place the traveller asked to avoid (B7)', async () => {
    const searcher = searcherReturning(ENOUGH)
    await run({ searcher, considering: ['Avoid izakaya'] })

    for (const request of searcher.requests) {
      expect(request.textQuery).not.toMatch(/izakaya/i)
    }
  })

  it('keeps the trip to the reach a memory measured, and records it', async () => {
    const searcher = searcherReturning([
      ...ENOUGH,
      // ~9km east: inside no reach this traveller has ever had.
      result({ id: 'far_away', type: 'museum', open: [10, 18], lat: 35.703, lng: 139.89 }),
    ])

    const outcome = await run({
      searcher,
      memorySnapshot: snapshotOf([
        memory({
          id: 'mem_span',
          status: 'active',
          kind: 'pattern',
          subject: { facet: 'day_span_metres', value: 5_578 },
        }),
      ]),
    })

    expect(outcome.kind).toBe('retrieved')
    if (outcome.kind !== 'retrieved') return

    expect(outcome.snapshot.places.map((place) => place.placeId)).not.toContain('far_away')
    expect(outcome.report.rejected.out_of_reach).toBe(1)
    expect(outcome.snapshot.provenance[0].radiusMetres).toBe(5_578)
  })

  it('reports progress, so the wait says what it is waiting for (§3.6.7)', async () => {
    const onProgress = vi.fn()
    await run({ onProgress })

    const said = onProgress.mock.calls.map(([message]) => message as string).join(' | ')
    expect(said).toMatch(/Finding Kuramae/)
    expect(said).toMatch(/Looking for places near Kuramae, Taito City/)
  })
})

describe('when it cannot', () => {
  it('falls back when the lodging cannot be found, without searching', async () => {
    const searcher = searcherReturning(ENOUGH)
    const outcome = await run({ locator: nothingFound, searcher })

    expect(outcome.kind).toBe('fell_back')
    if (outcome.kind !== 'fell_back') return
    expect(outcome.because).toContain('Kuramae')
    // No centre to search around means no searches at all: nothing is billed to
    // find out what we already know.
    expect(searcher.requests).toEqual([])
  })

  it('falls back when the search service cannot be reached', async () => {
    const outcome = await run({
      searcher: {
        async search() {
          throw new Error('503')
        },
      },
    })

    expect(outcome.kind).toBe('fell_back')
    if (outcome.kind !== 'fell_back') return
    expect(outcome.because).toMatch(/could not reach the place search/i)
    // Whatever the service said stays out of the traveller's way.
    expect(outcome.because).not.toMatch(/503/)
  })

  it('falls back when a day could not have a lunch', async () => {
    // A day without lunch is broken rather than shorter (B0), so this is the one
    // kind of thinness worth abandoning real places over.
    const outcome = await run({
      searcher: searcherReturning([
        result({ id: 'museum_a', type: 'museum', open: [10, 18] }),
        result({ id: 'museum_b', type: 'art_gallery', open: [10, 18] }),
      ]),
    })

    expect(outcome.kind).toBe('fell_back')
    if (outcome.kind !== 'fell_back') return
    expect(outcome.because).toMatch(/lunch|dinner/i)
    // The searches did run, so the report is there to explain what came back.
    expect(outcome.report?.places).toHaveLength(2)
  })

  it('does NOT fall back when only an optional part of the day is thin', async () => {
    // Nothing here can be a nightcap. That is a day the generator reports a gap in,
    // not a reason to plan the whole trip from the seed set instead.
    const outcome = await run({ searcher: searcherReturning(ENOUGH) })
    expect(outcome.kind).toBe('retrieved')
  })
})
