/**
 * Profile -> searches -> a candidate set (B3).
 *
 * Offline: the searcher is injected, so the orchestration and the reporting are tested
 * without a key, a network call or a bill.
 */

import { describe, expect, it } from 'vitest'

import {
  retrievePlaces,
  DEFAULT_BIAS_RADIUS_METRES,
  type PlacesSearcher,
} from '../../src/application/planning/retrievePlaces.ts'
import type { ResolvedQuery } from '../../src/application/planning/queryPlan.ts'
import type { PlacesResult } from '../../src/services/places/retrieval.ts'
import { createCatalogueLodgingLocator } from '../../src/services/places/lodging.ts'

const LODGING = { lat: 35.703164, lng: 139.790828, matchedAddress: 'Kuramae, Taito City' }

function query(textQuery: string, retrieve = 3): ResolvedQuery {
  return { category: 'sushi', retrieve, textQuery, source: 'default', preferred: false, addedByModel: false }
}

function result(overrides: Partial<PlacesResult> = {}): PlacesResult {
  return {
    id: 'ChIJa',
    displayName: { text: 'A Place' },
    primaryType: 'sushi_restaurant',
    types: ['sushi_restaurant'],
    location: { latitude: 35.7, longitude: 139.79 },
    regularOpeningHours: {
      periods: [{ open: { day: 1, hour: 12, minute: 0 }, close: { day: 1, hour: 14, minute: 0 } }],
    },
    addressComponents: [{ longText: 'Taito City', types: ['locality'] }],
    ...overrides,
  }
}

/** Answers each request from a script keyed by query text. */
function searcherFor(
  byQuery: Record<string, PlacesResult[]>,
  meta: { calls?: number; fromCache?: number } = {},
): PlacesSearcher & { requests: unknown[] } {
  const requests: unknown[] = []
  return {
    requests,
    async search(incoming) {
      requests.push(...incoming)
      return {
        results: incoming.map((request) => ({
          textQuery: request.textQuery,
          places: byQuery[request.textQuery] ?? [],
        })),
        calls: meta.calls ?? incoming.length,
        fromCache: meta.fromCache ?? 0,
      }
    },
  }
}

describe('issuing the searches', () => {
  it('biases every search to the base lodging', async () => {
    const searcher = searcherFor({})
    await retrievePlaces({
      queries: [query('sushi near Kuramae'), query('ramen near Kuramae')],
      lodging: LODGING,
      radiusMetres: 5578,
      searcher,
    })

    expect(searcher.requests).toHaveLength(2)
    for (const request of searcher.requests as Array<{ bias: unknown }>) {
      expect(request.bias).toEqual({ lat: LODGING.lat, lng: LODGING.lng, radiusMetres: 5578 })
    }
  })

  /** The measured figure is always better; this only covers its absence. */
  it('falls back to a stated default radius when no memory measured one', async () => {
    const searcher = searcherFor({})
    await retrievePlaces({ queries: [query('sushi')], lodging: LODGING, searcher })

    const [request] = searcher.requests as Array<{ bias: { radiusMetres: number } }>
    expect(request.bias.radiusMetres).toBe(DEFAULT_BIAS_RADIUS_METRES)
  })

  /**
   * In the order B2 resolved them — preferred categories first — so a run cut short by
   * a quota spent it on what the traveller asked for.
   */
  it('keeps the query order it was given', async () => {
    const searcher = searcherFor({})
    await retrievePlaces({
      queries: [query('first'), query('second'), query('third')],
      lodging: LODGING,
      searcher,
    })

    expect((searcher.requests as Array<{ textQuery: string }>).map((r) => r.textQuery)).toEqual([
      'first',
      'second',
      'third',
    ])
  })

  it('asks for the depth each query carries', async () => {
    const searcher = searcherFor({})
    await retrievePlaces({ queries: [query('deep', 12), query('shallow', 3)], lodging: LODGING, searcher })

    expect((searcher.requests as Array<{ retrieve: number }>).map((r) => r.retrieve)).toEqual([12, 3])
  })
})

describe('reporting what came back', () => {
  it('gates results and counts the rejections', async () => {
    const searcher = searcherFor({
      good: [result({ id: 'a' })],
      bad: [result({ id: 'b', regularOpeningHours: undefined }), result({ id: 'c', addressComponents: [] })],
    })

    const report = await retrievePlaces({
      queries: [query('good'), query('bad')],
      lodging: LODGING,
      searcher,
    })

    expect(report.places.map((place) => place.placeId)).toEqual(['a'])
    expect(report.returned).toBe(3)
    expect(report.rejected).toEqual({ no_opening_hours: 1, no_neighborhood: 1 })
  })

  /** A sushi counter answers both "sushi" and "dinner near Kuramae". */
  it('keeps a place several searches found only once', async () => {
    const shared = result({ id: 'shared' })
    const searcher = searcherFor({ one: [shared], two: [shared] })

    const report = await retrievePlaces({
      queries: [query('one'), query('two')],
      lodging: LODGING,
      searcher,
    })
    expect(report.places).toHaveLength(1)
  })

  /**
   * Coming back quietly short is how the catalogue ceiling stayed invisible through
   * all of Phase A. Naming the search is what makes it actionable.
   */
  it('names a search that found nothing usable', async () => {
    const searcher = searcherFor({
      works: [result({ id: 'a' })],
      nothing: [],
      unusable: [result({ id: 'b', addressComponents: [] })],
    })

    const report = await retrievePlaces({
      queries: [query('works'), query('nothing'), query('unusable')],
      lodging: LODGING,
      searcher,
    })

    expect(report.emptySearches).toEqual(['nothing', 'unusable'])
  })

  it('reports what was billed and what came from cache', async () => {
    const searcher = searcherFor({ a: [result()] }, { calls: 1, fromCache: 4 })
    const report = await retrievePlaces({ queries: [query('a')], lodging: LODGING, searcher })

    expect(report.calls).toBe(1)
    expect(report.fromCache).toBe(4)
  })

  it('returns an empty set rather than failing when nothing is found', async () => {
    const report = await retrievePlaces({
      queries: [query('a')],
      lodging: LODGING,
      searcher: searcherFor({}),
    })
    expect(report.places).toEqual([])
    expect(report.emptySearches).toEqual(['a'])
  })
})

describe('which of the traveller words found a place', () => {
  it('records the verified words of every search that found it', async () => {
    const report = await retrievePlaces({
      queries: [
        { ...query('quiet sushi'), servesWords: ['local neighbourhoods'] },
        { ...query('slow sushi'), servesWords: ['Slow-paced', 'local neighbourhoods'] },
        query('sushi near Kuramae'),
      ],
      lodging: LODGING,
      searcher: searcherFor({
        'quiet sushi': [result()],
        'slow sushi': [result()],
        'sushi near Kuramae': [result({ id: 'ChIJb', displayName: { text: 'Plain' } })],
      }),
    })

    const found = new Map(report.places.map((place) => [place.placeId, place.foundFor]))
    expect(found.get('ChIJa')).toEqual(['local neighbourhoods', 'Slow-paced'])
    // Found only by a plainly worded search: no words to quote.
    expect(found.get('ChIJb')).toBeUndefined()
  })
})

describe('resolving the base lodging from places already in hand', () => {
  const locator = createCatalogueLodgingLocator([
    { name: 'Kuramae', lat: 35.703164, lng: 139.790828, neighborhood: 'Kuramae' },
  ])

  it('finds a lodging by name, however it was typed', async () => {
    expect(await locator.locate({ name: '  kuramae ', destination: 'Tokyo' })).toEqual({
      lat: 35.703164,
      lng: 139.790828,
      matchedAddress: 'Kuramae',
    })
  })

  /** A wrong point here is a whole trip planned around the wrong part of the city. */
  it('returns nothing rather than a guessed coordinate', async () => {
    expect(await locator.locate({ name: 'Somewhere Else', destination: 'Tokyo' })).toBeNull()
  })
})

/**
 * The measured radius is a filter, not a preference (B7).
 *
 * A locationBias asks Places to prefer a circle and does not hold it to one, so the
 * only thing that keeps a trip inside the reach its own days have ever had is a check
 * on what came back.
 */
describe('how far out a place may be', () => {
  /** ~9km east of the lodging: inside the default bias, outside a measured 5.6km. */
  const FAR = { latitude: 35.703, longitude: 139.89 }

  it('drops what lies beyond a measured radius, and counts it', async () => {
    const searcher = searcherFor({
      near: [result({ id: 'near' })],
      far: [result({ id: 'far', location: FAR })],
    })

    const report = await retrievePlaces({
      queries: [query('near'), query('far')],
      lodging: LODGING,
      radiusMetres: 5_578,
      searcher,
    })

    expect(report.places.map((place) => place.placeId)).toEqual(['near'])
    expect(report.rejected.out_of_reach).toBe(1)
  })

  it('reports a search whose every result was too far out as empty', async () => {
    const searcher = searcherFor({ far: [result({ id: 'far', location: FAR })] })

    const report = await retrievePlaces({
      queries: [query('far')],
      lodging: LODGING,
      radiusMetres: 5_578,
      searcher,
    })

    expect(report.places).toEqual([])
    expect(report.emptySearches).toEqual(['far'])
    // Still counted as returned: the search was answered, this trip cannot use it.
    expect(report.returned).toBe(1)
  })

  it('keeps everything when nothing measured a radius', async () => {
    // The fallback bias is a number picked here, not a fact about this traveller,
    // and rejecting real places over a guess is the failure this avoids.
    const searcher = searcherFor({ far: [result({ id: 'far', location: FAR })] })

    const report = await retrievePlaces({
      queries: [query('far')],
      lodging: LODGING,
      searcher,
    })

    expect(report.places.map((place) => place.placeId)).toEqual(['far'])
    expect(report.rejected.out_of_reach).toBeUndefined()
    expect(searcher.requests[0]).toMatchObject({
      bias: { radiusMetres: DEFAULT_BIAS_RADIUS_METRES },
    })
  })
})
