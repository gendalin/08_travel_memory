/**
 * Place facets — the controlled vocabulary a place can be described by
 * (product_spec §12.1 "category relevance", §12.2 "stateMatch").
 *
 * Why this exists: a place currently carries a category, a neighbourhood, two or
 * three hand-written tags and one hand-written sentence. That is all the surface
 * a traveller's own words have to match against, and measurement showed it is not
 * enough — the demo Intent "Slow-paced. Time in local neighbourhoods." matched
 * ZERO of thirty-three places, so `stateMatch` sat at its no-match floor for
 * every stop in every plan. Facets give places attributes drawn from a fixed
 * vocabulary that memory subjects and retrieval filters can both point at.
 *
 * Every facet here is DERIVED from data the bundle already holds. None is
 * authored per place, so none goes stale against the catalogue, and a live
 * place retrieved from the Places API gets the same treatment as a fixture one —
 * which is what per-trip retrieval will need.
 *
 * Three candidate facets were dropped rather than shipped weak, because a facet
 * that is usually absent is worse than no facet: a filter on it silently throws
 * away most of the catalogue.
 *
 *   - `booking` (walk-in vs reservation): one place in thirty-three carries the
 *     `reservation` tag. Inferring it from price and category would be inventing
 *     a fact about the world, not deriving one. Places API exposes `reservable`;
 *     fetching that is the honest fix.
 *   - `crowd` (quiet / busy / queues): three places mention it in prose, and one
 *     of those three is a false positive — Sushi Ishiyama is described as "away
 *     from the Ginza crowds", which a substring match reads as crowded.
 *     `userRatingCount` is the real signal and is not fetched yet.
 *   - `venue_form` (counter / hall / garden): from tags it covers about half the
 *     catalogue; from category it is a rename of category and carries no new
 *     information.
 *
 * `openingHours` is per weekday, so time bands are asked for a given day rather
 * than held as a static property.
 */

import { windowsOn, type OpeningHours, type WeekdayKey } from './openingHours.ts'

/** When a place can serve a part of the day. Derived from opening hours. */
export type TimeBand = 'morning' | 'lunch' | 'afternoon' | 'evening' | 'late'

/** What a stop costs, as a word. Derived from price level. */
export type PriceBand = 'free' | 'budget' | 'mid' | 'premium'

/** How long a stop takes, as a word. Derived from typical duration. */
export type StayLength = 'short' | 'medium' | 'long'

/** How well known a place is, as a word. Derived from its review count. */
export type Popularity = 'local' | 'known' | 'landmark'

/** The subset of a place the facet derivation reads. */
export interface FacetPlace {
  priceLevel?: 0 | 1 | 2 | 3 | 4
  typicalDurationMin: number
  openingHours?: OpeningHours
  /** Reviews the place has. Absent for a place retrieved before this was fetched. */
  userRatingCount?: number
}

/**
 * The day, in bands. These are the bands a day's ROLES are expressed in — lunch,
 * dinner, a late izakaya — so they are stated once, here, rather than repeated
 * wherever a role is defined.
 */
export const TIME_BANDS: Record<TimeBand, { from: number; to: number }> = {
  morning: { from: 8 * 60, to: 11 * 60 + 30 },
  lunch: { from: 11 * 60 + 30, to: 14 * 60 },
  afternoon: { from: 14 * 60, to: 17 * 60 + 30 },
  evening: { from: 17 * 60 + 30, to: 21 * 60 },
  late: { from: 21 * 60, to: 24 * 60 },
}

export const TIME_BAND_ORDER: readonly TimeBand[] = [
  'morning',
  'lunch',
  'afternoon',
  'evening',
  'late',
]

/**
 * Minimum overlap before a place counts as serving a band.
 *
 * Without a floor, a counter open from 17:00 would "serve the afternoon" on the
 * strength of thirty minutes, which is not long enough to be anywhere. An hour
 * is the shortest window a real stop plus arriving fits into.
 */
const MIN_BAND_OVERLAP_MINUTES = 60

/**
 * Bands this place can actually serve on the given weekday.
 *
 * Any of the day's windows will do. A counter open 12:00-14:00 and 18:00-20:30
 * serves lunch AND evening; reading only the first window recorded it as lunch-only
 * and its dinner service disappeared.
 */
export function timeBandsOn(place: FacetPlace, weekday: WeekdayKey): TimeBand[] {
  const windows = windowsOn(place.openingHours, weekday)
  if (windows.length === 0) return []

  return TIME_BAND_ORDER.filter((band) => {
    const { from, to } = TIME_BANDS[band]
    return windows.some(
      (open) => Math.min(open.closes, to) - Math.max(open.opens, from) >= MIN_BAND_OVERLAP_MINUTES,
    )
  })
}

export function priceBand(place: FacetPlace): PriceBand | undefined {
  switch (place.priceLevel) {
    case 0:
      return 'free'
    case 1:
      return 'budget'
    case 2:
      return 'mid'
    case 3:
    case 4:
      return 'premium'
    default:
      return undefined
  }
}

/**
 * Duration, bucketed. Honestly named: this is what the catalogue records about
 * how long a visit takes, not a claim about whether you sit down.
 */
export function stayLength(place: FacetPlace): StayLength {
  const minutes = place.typicalDurationMin
  if (minutes <= 45) return 'short'
  if (minutes <= 90) return 'medium'
  return 'long'
}

/**
 * How well known a place is.
 *
 * The honest version of the `crowd` facet dropped in A2: that one read words out of
 * a hand-written description and had a known false positive — a counter described
 * as "away from the Ginza crowds" read as crowded. A review count is a measurement.
 *
 * Undefined rather than guessed when the count is missing, which it is for every
 * place in the catalogue that predates fetching it.
 */
export function popularity(place: FacetPlace): Popularity | undefined {
  const reviews = place.userRatingCount
  if (reviews === undefined) return undefined
  if (reviews < 500) return 'local'
  if (reviews < 5_000) return 'known'
  return 'landmark'
}

/**
 * Every facet value for a place on a day, as plain words.
 *
 * This is what `stateMatch` matches a traveller's own words against, alongside
 * the category, neighbourhood, tags and description it already used.
 */
export function facetValuesOn(place: FacetPlace, weekday: WeekdayKey): string[] {
  const band = priceBand(place)
  const fame = popularity(place)
  return [
    ...timeBandsOn(place, weekday),
    stayLength(place),
    ...(band ? [band] : []),
    ...(fame ? [fame] : []),
  ]
}

/**
 * Highest price level a stated budget tolerates.
 *
 * One definition, shared by ranking, Expected Impact and the plan's own budget
 * tension. It was written out three times, which is three chances for a plan to
 * be ranked against one ceiling and warned against another.
 */
export function priceCeiling(level: 'low' | 'moderate' | 'high'): 0 | 1 | 2 | 3 | 4 {
  switch (level) {
    case 'low':
      return 1
    case 'moderate':
      return 2
    case 'high':
      return 4
  }
}

/** Whether a place sits above the ceiling a stated budget sets. */
export function overBudget(place: FacetPlace, level: 'low' | 'moderate' | 'high'): boolean {
  return place.priceLevel !== undefined && place.priceLevel > priceCeiling(level)
}
