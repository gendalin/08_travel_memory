/**
 * Place facets (product_spec §12.1, §12.2).
 *
 * Every facet here is derived from data the bundle already holds. The tests that
 * matter are the ones holding that line: a facet must not be guessed at when its
 * source is absent, and the vocabulary a memory or a role points at has to mean
 * the same thing everywhere.
 */

import { describe, expect, it } from 'vitest'

import {
  facetValuesOn,
  popularity,
  priceBand,
  stayLength,
  timeBandsOn,
  TIME_BANDS,
  TIME_BAND_ORDER,
  type FacetPlace,
} from '../../src/domain/places/facets.ts'

const ALL_WEEK = (span: string) => ({
  mon: span, tue: span, wed: span, thu: span, fri: span, sat: span, sun: span,
})

function place(overrides: Partial<FacetPlace> = {}): FacetPlace {
  return { typicalDurationMin: 60, openingHours: ALL_WEEK('09:00-22:00'), ...overrides }
}

describe('timeBandsOn', () => {
  it('reports every band the opening window covers', () => {
    expect(timeBandsOn(place({ openingHours: ALL_WEEK('09:00-22:00') }), 'wed')).toEqual([
      'morning',
      'lunch',
      'afternoon',
      'evening',
      'late',
    ])
  })

  it('reports only lunch and afternoon for a lunch-through-teatime counter', () => {
    expect(timeBandsOn(place({ openingHours: ALL_WEEK('11:00-15:30') }), 'wed')).toEqual([
      'lunch',
      'afternoon',
    ])
  })

  /**
   * The real case that motivated the overlap floor: a counter open 07:30-09:45
   * serves breakfast and nothing else. Without a floor it would also "serve
   * lunch" on the strength of no overlap at all, and with a floor of zero a
   * 17:00 opening would "serve the afternoon" on thirty minutes.
   */
  it('does not count a band it barely touches', () => {
    expect(timeBandsOn(place({ openingHours: ALL_WEEK('07:30-09:45') }), 'wed')).toEqual(['morning'])
    expect(timeBandsOn(place({ openingHours: ALL_WEEK('17:00-23:00') }), 'wed')).toEqual([
      'evening',
      'late',
    ])
  })

  it('is empty on a day the place is shut', () => {
    const closedSunday = { ...ALL_WEEK('11:00-15:00'), sun: 'closed' }
    expect(timeBandsOn(place({ openingHours: closedSunday }), 'sun')).toEqual([])
    expect(timeBandsOn(place({ openingHours: closedSunday }), 'mon')).not.toEqual([])
  })

  it('is empty rather than guessed when there are no hours', () => {
    expect(timeBandsOn(place({ openingHours: undefined }), 'wed')).toEqual([])
  })

  it('returns bands in day order, so a caller can read them as a timeline', () => {
    const bands = timeBandsOn(place({ openingHours: ALL_WEEK('09:00-22:00') }), 'wed')
    expect(bands).toEqual(TIME_BAND_ORDER.filter((band) => bands.includes(band)))
  })

  it('covers the whole day with contiguous bands, so no hour belongs to none', () => {
    const ordered = TIME_BAND_ORDER.map((band) => TIME_BANDS[band])
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(ordered[i].to).toBe(ordered[i + 1].from)
    }
  })
})

describe('priceBand', () => {
  it('names each price level', () => {
    expect(priceBand(place({ priceLevel: 0 }))).toBe('free')
    expect(priceBand(place({ priceLevel: 1 }))).toBe('budget')
    expect(priceBand(place({ priceLevel: 2 }))).toBe('mid')
    expect(priceBand(place({ priceLevel: 3 }))).toBe('premium')
    expect(priceBand(place({ priceLevel: 4 }))).toBe('premium')
  })

  it('is undefined rather than guessed when the level is unknown', () => {
    expect(priceBand(place({ priceLevel: undefined }))).toBeUndefined()
  })
})

describe('stayLength', () => {
  it('buckets the duration the catalogue records', () => {
    expect(stayLength(place({ typicalDurationMin: 40 }))).toBe('short')
    expect(stayLength(place({ typicalDurationMin: 45 }))).toBe('short')
    expect(stayLength(place({ typicalDurationMin: 60 }))).toBe('medium')
    expect(stayLength(place({ typicalDurationMin: 90 }))).toBe('medium')
    expect(stayLength(place({ typicalDurationMin: 120 }))).toBe('long')
  })
})

describe('facetValuesOn', () => {
  it('gives plain words a traveller might use', () => {
    const values = facetValuesOn(
      place({ priceLevel: 1, typicalDurationMin: 45, openingHours: ALL_WEEK('11:00-15:30') }),
      'wed',
    )
    expect(values).toEqual(['lunch', 'afternoon', 'short', 'budget'])
  })

  it('omits a facet whose source is missing rather than inventing a value', () => {
    const values = facetValuesOn(
      { typicalDurationMin: 60, priceLevel: undefined, openingHours: undefined },
      'wed',
    )
    // Duration is always known; the other two are not, and stay absent.
    expect(values).toEqual(['medium'])
  })
})

describe('popularity', () => {
  /**
   * The honest version of the `crowd` facet dropped in A2. That one read words out of
   * a hand-written description and had a known false positive — a counter described
   * as "away from the Ginza crowds" read as crowded. A review count is a measurement.
   */
  it('names how well known a place is', () => {
    expect(popularity(place({ userRatingCount: 80 }))).toBe('local')
    expect(popularity(place({ userRatingCount: 2_000 }))).toBe('known')
    expect(popularity(place({ userRatingCount: 40_000 }))).toBe('landmark')
  })

  it('is undefined rather than guessed when no count was fetched', () => {
    expect(popularity(place())).toBeUndefined()
  })

  it('gives a traveller words to ask for it with', () => {
    const values = facetValuesOn(place({ userRatingCount: 80, priceLevel: 1 }), 'wed')
    expect(values).toContain('local')
  })

  it('leaves the word out when the count is missing', () => {
    const values = facetValuesOn(place({ priceLevel: 1 }), 'wed')
    expect(values).not.toContain('local')
    expect(values).not.toContain('landmark')
  })
})
