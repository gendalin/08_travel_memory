/**
 * Looking further, when a trip has run out of options (B8).
 *
 * The claim worth holding: a trip's set of places grows only by an ACT, and the act
 * leaves a record. Everything else about the snapshot depends on it — a Replace that
 * quietly widened the set would make two identical requests give different answers,
 * and a Receipt naming a version would name a version that had silently changed.
 */

import { describe, expect, it } from 'vitest'

import {
  widenTripCatalogue,
  WIDEN_RETRIEVE,
} from '../../src/application/catalogue/widenCatalogue.ts'
import type { PlacesSearcher } from '../../src/application/planning/retrievePlaces.ts'
import { createCatalogueSnapshot } from '../../src/domain/places/catalogueSnapshot.ts'
import type { PlacesResult } from '../../src/services/places/retrieval.ts'
import type { DemoPlace } from '../../src/services/places/types.ts'

const LODGING = { lat: 35.703164, lng: 139.790828, matchedAddress: 'Kuramae, Taito City' }

const place = (placeId: string): DemoPlace => ({
  placeId,
  name: placeId,
  lat: 35.7,
  lng: 139.79,
  category: 'izakaya',
  neighborhood: 'Kuramae',
  typicalDurationMin: 90,
  tags: [],
  shortDescription: 'A place.',
  source: 'places_api',
})

function result(id: string, overrides: Partial<PlacesResult> = {}): PlacesResult {
  return {
    id,
    displayName: { text: id },
    primaryType: 'japanese_izakaya_restaurant',
    types: ['japanese_izakaya_restaurant'],
    location: { latitude: 35.7, longitude: 139.79 },
    regularOpeningHours: {
      periods: [{ open: { day: 1, hour: 17, minute: 0 }, close: { day: 1, hour: 23, minute: 0 } }],
    },
    addressComponents: [{ longText: 'Taito City', types: ['locality'] }],
    ...overrides,
  }
}

function searcherReturning(places: PlacesResult[]): PlacesSearcher & { requests: Array<{ textQuery: string; retrieve: number }> } {
  const requests: Array<{ textQuery: string; retrieve: number }> = []
  return {
    requests,
    async search(incoming) {
      for (const request of incoming) {
        requests.push({ textQuery: request.textQuery, retrieve: request.retrieve })
      }
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

const frozen = () =>
  createCatalogueSnapshot<DemoPlace>({
    tripId: 'trip_1',
    places: [place('known')],
    provenance: {
      queries: ['izakaya near Kuramae, Tokyo'],
      rejected: {},
      lodging: LODGING,
    },
    createdAt: '2026-10-01T00:00:00.000Z',
  })

const widen = (searcher: PlacesSearcher, categories = ['izakaya']) =>
  widenTripCatalogue({
    snapshot: frozen(),
    categories,
    destination: 'Tokyo',
    lodging: LODGING,
    baseLodgingName: 'Kuramae',
    searcher,
    at: '2026-10-02T00:00:00.000Z',
  })

describe('widening a trip catalogue', () => {
  it('adds what is new as a new version, leaving the old one untouched', async () => {
    const before = frozen()
    const outcome = await widen(searcherReturning([result('found')]))

    expect(outcome.snapshot.version).toBe(2)
    expect(outcome.added.map((added) => added.placeId)).toEqual(['found'])
    expect(outcome.snapshot.places.map((entry) => entry.placeId)).toEqual(['known', 'found'])
    // The frozen set a Receipt may already name is still exactly what it was.
    expect(before.places.map((entry) => entry.placeId)).toEqual(['known'])
    expect(before.version).toBe(1)
  })

  it('records the searches that grew it, after the ones that made it', async () => {
    const outcome = await widen(searcherReturning([result('found')]))

    expect(outcome.snapshot.provenance).toHaveLength(2)
    expect(outcome.snapshot.provenance[1].queries).toEqual(['izakaya near Kuramae, Tokyo'])
    expect(outcome.snapshot.provenance[0].queries).toEqual(['izakaya near Kuramae, Tokyo'])
  })

  it('still moves to a new version when the search finds nothing new', async () => {
    // "I looked and there is nothing more" is an answer the traveller asked for, and
    // a version is how the trip remembers having looked.
    const outcome = await widen(searcherReturning([]))

    expect(outcome.snapshot.version).toBe(2)
    expect(outcome.added).toEqual([])
    expect(outcome.snapshot.places).toHaveLength(1)
  })

  it('does not add a place the trip already has', async () => {
    const outcome = await widen(searcherReturning([result('known')]))

    expect(outcome.added).toEqual([])
    expect(outcome.snapshot.places).toHaveLength(1)
  })

  it('asks for a top-up, not a second trip worth of retrieval', async () => {
    const searcher = searcherReturning([])
    await widen(searcher, ['izakaya', 'yakiniku_grill', 'izakaya'])

    // One search per distinct category, each at the top-up depth.
    expect(searcher.requests).toHaveLength(2)
    for (const request of searcher.requests) expect(request.retrieve).toBe(WIDEN_RETRIEVE)
  })

  it('keeps the trip own reach when one was measured', async () => {
    const outcome = await widenTripCatalogue({
      snapshot: frozen(),
      categories: ['izakaya'],
      destination: 'Tokyo',
      lodging: LODGING,
      baseLodgingName: 'Kuramae',
      radiusMetres: 5_578,
      // ~9km out: inside no measured reach this trip has.
      searcher: searcherReturning([result('far', { location: { latitude: 35.703, longitude: 139.89 } })]),
      at: '2026-10-02T00:00:00.000Z',
    })

    expect(outcome.added).toEqual([])
    expect(outcome.report.rejected.out_of_reach).toBe(1)
    expect(outcome.snapshot.provenance[1].radiusMetres).toBe(5_578)
  })
})
