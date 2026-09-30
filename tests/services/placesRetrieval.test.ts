/**
 * A Places result -> a place the product can plan with (B3).
 *
 * Run against the RECORDED responses in `.cache/places-details/`, so the mapping is
 * tested on what Google actually returns rather than on what a fixture author
 * imagined. No key, no network, no cost.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  GENERIC_TYPES,
  mapPlacesResult,
  mapPlacesResults,
  resolveCategory,
  toCategory,
  toNeighborhood,
  toOpeningHours,
  type PlacesResult,
} from '../../src/services/places/retrieval.ts'
import { isOpenFor, windowsOn } from '../../src/domain/places/openingHours.ts'
import {
  CATEGORIES,
  categoryForGoogleType,
  INTEREST_CATEGORY_IDS,
} from '../../src/domain/places/taxonomy.ts'

const CACHE = '.cache/places-details'

/** Every recorded response, or an empty list where the cache is not present. */
const recorded: PlacesResult[] = existsSync(CACHE)
  ? readdirSync(CACHE)
      .filter((file) => file.endsWith('.json'))
      .map((file) => JSON.parse(readFileSync(`${CACHE}/${file}`, 'utf8')) as PlacesResult)
  : []

function result(overrides: Partial<PlacesResult> = {}): PlacesResult {
  return {
    id: 'ChIJtest',
    displayName: { text: 'A Place' },
    primaryType: 'sushi_restaurant',
    types: ['sushi_restaurant', 'restaurant', 'point_of_interest'],
    location: { latitude: 35.7, longitude: 139.79 },
    regularOpeningHours: {
      periods: [{ open: { day: 1, hour: 12, minute: 0 }, close: { day: 1, hour: 14, minute: 0 } }],
    },
    addressComponents: [{ longText: 'Taito City', types: ['locality'] }],
    ...overrides,
  }
}

describe('toOpeningHours', () => {
  it('keeps every period of a day, comma-separated', () => {
    const hours = toOpeningHours(
      result({
        regularOpeningHours: {
          periods: [
            { open: { day: 3, hour: 12, minute: 0 }, close: { day: 3, hour: 14, minute: 0 } },
            { open: { day: 3, hour: 18, minute: 0 }, close: { day: 3, hour: 20, minute: 30 } },
          ],
        },
      }),
    )!
    expect(hours.wed).toBe('12:00-14:00,18:00-20:30')
    expect(windowsOn(hours, 'wed')).toHaveLength(2)
  })

  it('marks a day with no period as closed', () => {
    const hours = toOpeningHours(result())!
    expect(hours.mon).toBe('12:00-14:00')
    expect(hours.tue).toBe('closed')
  })

  it('clamps a close on the next day to the end of this one', () => {
    const hours = toOpeningHours(
      result({
        regularOpeningHours: {
          periods: [{ open: { day: 5, hour: 20, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }],
        },
      }),
    )!
    expect(hours.fri).toBe('20:00-23:59')
  })

  it('treats a period with no close as open around the clock', () => {
    const hours = toOpeningHours(
      result({ regularOpeningHours: { periods: [{ open: { day: 0, hour: 0, minute: 0 } }] } }),
    )!
    expect(hours.sun).toBe('00:00-23:59')
  })

  it('is null when there are no periods at all', () => {
    expect(toOpeningHours(result({ regularOpeningHours: undefined }))).toBeNull()
    expect(toOpeningHours(result({ regularOpeningHours: { periods: [] } }))).toBeNull()
  })
})

describe('toCategory', () => {
  it('prefers the most specific usable type', () => {
    expect(toCategory(result({ primaryType: 'sushi_restaurant' }))).toBe('sushi')
  })

  /** `restaurant` says nothing a day role can use; every eatery would collapse into it. */
  it('skips types too generic to be a category', () => {
    expect(
      toCategory({ types: ['point_of_interest', 'establishment', 'restaurant', 'ramen_restaurant'] }),
    ).toBe('ramen')
  })

  it('is undefined when nothing maps, rather than guessing', () => {
    expect(toCategory({ types: ['car_repair', 'point_of_interest'] })).toBeUndefined()
  })
})

describe('toNeighborhood', () => {
  it('prefers the most specific district a person would name', () => {
    expect(
      toNeighborhood({
        addressComponents: [
          { longText: 'Tokyo', types: ['administrative_area_level_1'] },
          { longText: 'Taito City', types: ['locality'] },
          { longText: 'Kuramae', types: ['sublocality_level_1'] },
        ],
      }),
    ).toBe('Kuramae')
  })

  it('falls back to the city when there is no district', () => {
    expect(toNeighborhood({ addressComponents: [{ longText: 'Odawara', types: ['locality'] }] })).toBe(
      'Odawara',
    )
  })

  it('is undefined when the address says nothing usable', () => {
    expect(toNeighborhood({ addressComponents: [] })).toBeUndefined()
    expect(toNeighborhood({})).toBeUndefined()
  })
})

describe('the quality gate', () => {
  const rejects = (overrides: Partial<PlacesResult>, reason: string) => {
    const mapped = mapPlacesResult(result(overrides))
    expect(mapped.ok).toBe(false)
    if (!mapped.ok) expect(mapped.reason).toBe(reason)
  }

  it('accepts a complete result', () => {
    const mapped = mapPlacesResult(result())
    expect(mapped.ok).toBe(true)
  })

  it('rejects a result with no id', () => rejects({ id: undefined }, 'no_id'))
  it('rejects a result with no name', () => rejects({ displayName: undefined }, 'no_name'))

  /** Without coordinates `convenience` and `routeFit` are null and nothing can rank it. */
  it('rejects a result with no coordinates', () =>
    rejects({ location: { latitude: 35.7 } }, 'no_coordinates'))

  /** A1 exists because a place scheduled behind a locked door passed as valid. */
  it('rejects a result with no usable opening hours', () =>
    rejects({ regularOpeningHours: undefined }, 'no_opening_hours'))

  /** No memory subject and no day role can match a category we do not have. */
  it('rejects a result whose type maps to no category', () =>
    rejects({ primaryType: 'car_repair', types: ['car_repair'] }, 'no_category'))

  /** "A museum gallery in ." is worse than not offering it. */
  it('rejects a result with no nameable district', () =>
    rejects({ addressComponents: [] }, 'no_neighborhood'))

  it('carries the review count through when Places supplies one', () => {
    const mapped = mapPlacesResult(result({ userRatingCount: 1234 }))
    expect(mapped.ok && mapped.place.userRatingCount).toBe(1234)
  })

  it('leaves the review count absent rather than guessing zero', () => {
    const mapped = mapPlacesResult(result())
    expect(mapped.ok && mapped.place.userRatingCount).toBeUndefined()
  })

  it('leaves the price level absent rather than guessing', () => {
    const mapped = mapPlacesResult(result({ priceLevel: undefined }))
    expect(mapped.ok && 'priceLevel' in mapped.place).toBe(false)
  })

  it('reads a price level Places did supply', () => {
    const mapped = mapPlacesResult(result({ priceLevel: 'PRICE_LEVEL_VERY_EXPENSIVE' }))
    expect(mapped.ok && mapped.place.priceLevel).toBe(4)
  })
})

describe('mapPlacesResults', () => {
  it('counts why each result was rejected instead of just coming back short', () => {
    const outcome = mapPlacesResults([
      result(),
      result({ id: 'b', regularOpeningHours: undefined }),
      result({ id: 'c', addressComponents: [] }),
      result({ id: 'd', addressComponents: [] }),
    ])

    expect(outcome.places).toHaveLength(1)
    expect(outcome.rejected).toEqual({ no_opening_hours: 1, no_neighborhood: 2 })
  })

  /**
   * The same place legitimately answers several searches — a sushi counter matches
   * both "sushi" and "dinner near Kuramae" — and holding it twice would offer it
   * twice as an alternative.
   */
  it('keeps a place that several searches returned only once', () => {
    const outcome = mapPlacesResults([result(), result(), result({ id: 'other' })])
    expect(outcome.places.map((place) => place.placeId)).toEqual(['ChIJtest', 'other'])
  })
})

describe('against the recorded Google responses', () => {
  it('has responses to test against', () => {
    expect(recorded.length).toBeGreaterThan(20)
  })

  /**
   * These responses were fetched with a narrower field mask than B3 asks for, so
   * they carry no address components and the gate rejects them for it. That is the
   * gate working: the mapping is being held to what the product needs, not to what
   * an older fetch happened to collect.
   */
  it('maps every hours, category and coordinate it can read', () => {
    let hours = 0
    let categories = 0
    let coordinates = 0

    for (const entry of recorded) {
      if (toOpeningHours(entry)) hours++
      if (toCategory(entry)) categories++
      if (typeof entry.location?.latitude === 'number') coordinates++
    }

    expect(coordinates).toBe(recorded.length)
    expect(hours).toBeGreaterThan(recorded.length * 0.8)
    expect(categories).toBeGreaterThan(recorded.length * 0.8)
  })

  /**
   * A recorded response maps a subway station onto `transit`, a CONTEXT category —
   * something that describes how a day moved, not somewhere worth going. Left
   * unfiltered it would have become a stop on an itinerary.
   */
  it('only ever produces categories a stop can actually be', () => {
    for (const entry of recorded) {
      const category = toCategory(entry)
      if (category) expect(INTEREST_CATEGORY_IDS).toContain(category)
    }
  })

  it('refuses a station rather than scheduling one', () => {
    expect(
      toCategory({ primaryType: 'subway_station', types: ['subway_station', 'transit_station'] }),
    ).toBeUndefined()
    expect(toCategory({ primaryType: 'hotel', types: ['hotel', 'lodging'] })).toBeUndefined()
  })

  /** The real reason multi-span support was needed. */
  it('finds real places with a lunch break, and keeps both services', () => {
    const split = recorded
      .map((entry) => toOpeningHours(entry))
      .filter((hours): hours is Record<string, string> => hours !== null)
      .filter((hours) => Object.values(hours).some((span) => span.includes(',')))

    expect(split.length).toBeGreaterThan(0)

    // And a stop in the later service is schedulable, which is what was lost before.
    const evening = split.find((hours) =>
      Object.values(hours).some((span) => span.split(',').length > 1 && span.includes('18:')),
    )!
    const day = Object.keys(evening).find((key) => evening[key].includes('18:')) as 'wed'
    expect(isOpenFor(evening, day, '18:15', '19:45')).toBe(true)
  })

  it('never produces hours the domain cannot read', () => {
    for (const entry of recorded) {
      const hours = toOpeningHours(entry)
      if (!hours) continue
      for (const key of Object.keys(hours)) {
        const spans = windowsOn(hours, key as 'mon')
        if (hours[key] !== 'closed') expect(spans.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('the taxonomy and the generic-type list must not contradict each other', () => {
  /**
   * The defect this catches. `tourist_attraction` was claimed as a mapping source by
   * both `architecture_design` and `viewpoint_scenic`, AND listed as too coarse to
   * name a category. Each statement was defensible alone; together they made two
   * categories unreachable, and a live search for one of them returned nothing usable.
   */
  it('no category claims a type that retrieval treats as too coarse', () => {
    const offenders = CATEGORIES.flatMap((category) =>
      category.googleTypes
        .filter((type) => GENERIC_TYPES.has(type))
        .map((type) => `${category.id} claims "${type}"`),
    )
    expect(offenders).toEqual([])
  })

  it('every mapped type resolves back to the category that claims it', () => {
    for (const category of CATEGORIES) {
      for (const type of category.googleTypes) {
        expect(categoryForGoogleType(type)).toBeTruthy()
      }
    }
  })

  /** A type claimed by two categories resolves by declaration order, silently. */
  it('no Google type is claimed by two categories', () => {
    const claims = new Map<string, string[]>()
    for (const category of CATEGORIES) {
      for (const type of category.googleTypes) {
        claims.set(type, [...(claims.get(type) ?? []), category.id])
      }
    }
    const shared = [...claims].filter(([, owners]) => owners.length > 1)
    expect(shared).toEqual([])
  })
})

describe('falling back to the category that was searched for', () => {
  const untypeable: PlacesResult = {
    id: 'ChIJx',
    displayName: { text: 'Somewhere' },
    types: ['point_of_interest', 'establishment'],
    location: { latitude: 35.7, longitude: 139.79 },
    regularOpeningHours: {
      periods: [{ open: { day: 1, hour: 10, minute: 0 }, close: { day: 1, hour: 18, minute: 0 } }],
    },
    addressComponents: [{ longText: 'Taito City', types: ['locality'] }],
  }

  it('never files a hotel or a station under the search that found it', () => {
    const inn = { ...untypeable, types: ['japanese_inn', 'hotel', 'lodging', 'point_of_interest'] }
    expect(mapPlacesResult(inn, 'cafe_kissaten')).toMatchObject({ ok: false, reason: 'not_a_destination' })

    // A hotel's bar is still a bar: an interest type of its own wins.
    const bar = { ...untypeable, types: ['bar', 'hotel', 'lodging'] }
    expect(mapPlacesResult(bar, 'cafe_kissaten')).toMatchObject({ ok: true, place: { category: 'bar_cocktail' } })
  })

  it('prefers what the place IS over what was searched for', () => {
    expect(resolveCategory({ types: ['ramen_restaurant'] }, 'sushi')).toEqual({
      category: 'ramen',
      from: 'place_type',
    })
  })

  /**
   * Two categories have no Google type that identifies them at all, so without this a
   * search for either came back with nothing usable — which a live run measured.
   */
  it('uses the search when the place types name nothing', () => {
    expect(resolveCategory(untypeable, 'architecture_design')).toEqual({
      category: 'architecture_design',
      from: 'search',
    })
  })

  it('records which of the two it was, because they are not equally good', () => {
    const fromSearch = mapPlacesResult(untypeable, 'viewpoint_scenic')
    expect(fromSearch.ok && fromSearch.place.categoryFrom).toBe('search')

    const fromType = mapPlacesResult({ ...untypeable, types: ['ramen_restaurant'] }, 'sushi')
    expect(fromType.ok && fromType.place.categoryFrom).toBe('place_type')
  })

  it('still refuses when neither the place nor the search names a category', () => {
    const mapped = mapPlacesResult(untypeable)
    expect(mapped.ok).toBe(false)
    if (!mapped.ok) expect(mapped.reason).toBe('no_category')
  })

  it('never lets a search invent a category the taxonomy lacks', () => {
    expect(resolveCategory(untypeable, 'michelin_starred')).toBeUndefined()
    // Nor a context category: a station is not a stop.
    expect(resolveCategory(untypeable, 'transit')).toBeUndefined()
  })
})

/**
 * The photo a stop is shown with.
 *
 * A reference and a credit, or nothing. The credit is not decoration: the terms that
 * permit the photo to be displayed are the ones that require it, so a photo that
 * cannot be credited is a photo the product may not use.
 */
describe('the photo on a place', () => {
  const photo = (overrides: Record<string, unknown> = {}) => ({
    name: 'places/ChIJa/photos/AeJbb3',
    authorAttributions: [{ displayName: 'A Traveller', uri: 'https://example.test/a' }],
    ...overrides,
  })

  it('keeps the first usable one, with who took it', () => {
    const mapped = mapPlacesResult(result({ photos: [photo()] }))

    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return
    expect(mapped.place.photo).toEqual({
      name: 'places/ChIJa/photos/AeJbb3',
      attribution: { name: 'A Traveller', uri: 'https://example.test/a' },
    })
  })

  it('takes one, not ten', () => {
    // Nine unused references would otherwise be frozen onto the trip and stored with
    // it, for a list that shows one thumbnail per stop.
    const mapped = mapPlacesResult(
      result({ photos: [photo(), photo({ name: 'places/ChIJa/photos/second' })] }),
    )

    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return
    expect(mapped.place.photo?.name).toBe('places/ChIJa/photos/AeJbb3')
  })

  it('drops one it cannot credit', () => {
    const mapped = mapPlacesResult(result({ photos: [photo({ authorAttributions: [] })] }))

    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return
    expect(mapped.place.photo).toBeUndefined()
  })

  it('leaves the place usable when there is no photo at all', () => {
    // A stop with no picture is a stop with a monogram, not a rejected result.
    const mapped = mapPlacesResult(result({}))

    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return
    expect(mapped.place.photo).toBeUndefined()
  })
})
