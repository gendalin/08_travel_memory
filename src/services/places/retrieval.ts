/**
 * A Places API result -> a place the product can plan with (B3).
 *
 * Pure. Takes a response object and returns either a usable place or the reason it
 * was rejected, so the whole mapping is testable against recorded responses without
 * a network call or a key.
 *
 * The quality gate is the point. A retrieved place has to carry everything the rest
 * of the product assumes, and the assumptions are not negotiable:
 *
 *   - **coordinates**, or `convenience` and `routeFit` are null and it cannot be
 *     ranked against anything
 *   - **opening hours that parse**, or it cannot be scheduled — and A1 exists
 *     because a place scheduled behind a locked door was reported as a valid plan
 *   - **a category in the shared vocabulary**, or no memory subject and no day role
 *     can ever match it
 *   - **a neighbourhood**, or the product cannot say where it is; "A museum gallery
 *     in ." is worse than not offering it
 *
 * Rejections are returned rather than thrown, and counted rather than logged, so a
 * thin search reports WHY it was thin instead of just coming back short.
 */

import { categoryForGoogleType, INTEREST_CATEGORY_IDS } from '../../domain/places/taxonomy.ts'
import type { DemoPlace, PlacePhoto } from './types.ts'

/** Shape of one place in a Places API (New) `searchText` response. */
export interface PlacesResult {
  id?: string
  displayName?: { text?: string }
  primaryType?: string
  types?: string[]
  location?: { latitude?: number; longitude?: number }
  priceLevel?: string
  regularOpeningHours?: {
    periods?: Array<{
      open?: { day?: number; hour?: number; minute?: number }
      close?: { day?: number; hour?: number; minute?: number }
    }>
  }
  userRatingCount?: number
  photos?: Array<{
    name?: string
    authorAttributions?: Array<{ displayName?: string; uri?: string }>
  }>
  editorialSummary?: { text?: string }
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>
  shortFormattedAddress?: string
}

export type RejectionReason =
  /** A business that serves clients, not a place a day can be spent at. */
  | 'not_a_destination'
  | 'no_id'
  | 'no_name'
  | 'no_coordinates'
  | 'no_opening_hours'
  | 'no_category'
  | 'no_neighborhood'
  /** Farther from the lodging than the traveller's own days have ever ranged (B7). */
  | 'out_of_reach'

export type MappedPlace =
  | { ok: true; place: DemoPlace }
  | { ok: false; reason: RejectionReason; id?: string; name?: string }

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

const PRICE_LEVELS: Record<string, 0 | 1 | 2 | 3 | 4> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
}

/**
 * Google types too broad to name a category on their own.
 *
 * `restaurant` says nothing a day role can use; `sushi_restaurant` does. Skipping
 * them stops every eatery collapsing into one category.
 *
 * `japanese_restaurant` and `tourist_attraction` are here on the evidence of a live
 * run. The first appeared on 21 of 37 retrieved places — including an udon shop and a
 * curry bistro — so any category it mapped to became a bucket. The second cannot tell
 * an architecture site from a viewpoint, which are separate categories. A place
 * carrying only one of these takes the category of the search that found it, which is
 * weaker evidence but honest about being weaker.
 */
export const GENERIC_TYPES = new Set([
  'point_of_interest',
  'establishment',
  'food',
  'store',
  'restaurant',
  'japanese_restaurant',
  'tourist_attraction',
])

/**
 * Google types that mean "serves clients" or "takes private bookings".
 *
 * A place carrying ONLY these is somewhere business is done, not somewhere a
 * traveller goes: an architecture practice's office, a rentable meeting room, a
 * banquet hall. They reach the catalogue because two of the categories a day is made
 * of — `architecture_design` and `exhibition_event` — have no Google type that
 * identifies them, so places matching those searches take the category of the search
 * (see `resolveCategory`). A search for "architecture design near Kuramae" returns
 * architecture FIRMS, and Google has no type that tells a notable building from the
 * studio that designed one.
 *
 * Measured against 133 retrieved places: the rule rejects ten — four design studios,
 * four conference and rental venues, two event spaces — and keeps every place that
 * carries one of these alongside a real type, which is a brewpub, two bookshops, a
 * theatre and three homeware shops. Rejecting anything carrying `service` at all
 * would have taken those seven with it.
 *
 * A place with NO specific type is not caught here, and should not be: an udon
 * counter Google knows only as `restaurant` is still an udon counter.
 */
export const SERVES_CLIENTS = new Set([
  'service',
  'event_venue',
  'banquet_hall',
  'convention_center',
])

/**
 * Typical visit length per category, in minutes.
 *
 * Places does not supply one, and the rest of the product needs it to lay out a
 * day. Stated here rather than guessed per place, and deliberately coarse: these
 * are how long a visit of this KIND tends to run, not a claim about any one place.
 */
const TYPICAL_MINUTES: Record<string, number> = {
  sushi: 90,
  ramen: 45,
  soba_udon: 45,
  teishoku: 60,
  tempura_tonkatsu: 75,
  yakiniku_grill: 105,
  izakaya: 105,
  bar_cocktail: 75,
  cafe_kissaten: 45,
  bakery_sweets: 30,
  grocery_market: 60,
  bookstore: 60,
  lifestyle_homeware: 45,
  fashion_vintage: 45,
  craft_stationery: 45,
  discount_variety: 45,
  museum_gallery: 90,
  architecture_design: 60,
  temple_shrine: 60,
  exhibition_event: 90,
  park_garden: 60,
  onsen_sento: 75,
  viewpoint_scenic: 45,
}

/** Fallback when a category has no stated duration. A middling stop. */
const DEFAULT_MINUTES = 60

/**
 * Address components that name a neighbourhood, most specific first.
 *
 * Japanese addresses put the useful part in a sublocality — the ward or district a
 * person would actually name — with the city above it.
 */
const NEIGHBORHOOD_TYPES = [
  'sublocality_level_2',
  'sublocality_level_1',
  'sublocality',
  'locality',
  'administrative_area_level_2',
]

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Per-weekday spans, comma-separated where a day has more than one.
 *
 * Every period is kept. Keeping only a day's first period recorded eight of
 * twenty-nine demo places wrongly — a counter serving lunch and dinner became
 * lunch-only, and its dinner service disappeared from the product entirely.
 */
export function toOpeningHours(result: PlacesResult): Record<string, string> | null {
  const periods = result.regularOpeningHours?.periods
  if (!periods || periods.length === 0) return null

  const hours: Record<string, string> = {
    mon: 'closed', tue: 'closed', wed: 'closed', thu: 'closed',
    fri: 'closed', sat: 'closed', sun: 'closed',
  }

  for (const period of periods) {
    const open = period.open
    if (!open || open.day === undefined || open.hour === undefined) continue

    const key = DAY_KEYS[open.day]
    if (!key) continue

    const from = `${pad(open.hour)}:${pad(open.minute ?? 0)}`
    // A missing close means open around the clock; a close on the next day is
    // clamped to 23:59 so the domain's HH:MM comparisons stay within one day.
    const close = period.close
    const to =
      close && close.hour !== undefined && close.day === open.day
        ? `${pad(close.hour)}:${pad(close.minute ?? 0)}`
        : '23:59'

    const span = `${from}-${to}`
    hours[key] = hours[key] === 'closed' ? span : `${hours[key]},${span}`
  }

  return Object.values(hours).every((value) => value === 'closed') ? null : hours
}

/**
 * Our category for a result, from its most specific usable Google type.
 *
 * Only INTEREST categories count. The taxonomy also holds context ones — transit,
 * street, accommodation — which describe how a day moved rather than somewhere worth
 * going, and a recorded response really does map a subway station onto `transit`. A
 * station that passed the gate would become a stop on an itinerary.
 */
export function toCategory(result: PlacesResult): string | undefined {
  const ordered = [result.primaryType, ...(result.types ?? [])].filter(
    (type): type is string => typeof type === 'string' && !GENERIC_TYPES.has(type),
  )

  for (const type of ordered) {
    const category = categoryForGoogleType(type)
    if (category && INTEREST_CATEGORY_IDS.includes(category)) return category
  }
  return undefined
}

/**
 * The category to file a result under, preferring what the place IS over what was
 * searched for.
 *
 * The fallback is real information rather than a guess: this result came back from a
 * search issued for that category, so Google matched our words for it. It is weaker
 * evidence than the place's own type, which is why it is only ever second — but a
 * live run showed the alternative is worse. Two categories have no Google type that
 * identifies them at all, and without this a search for either returned nothing
 * usable at all.
 */
export function resolveCategory(
  result: PlacesResult,
  searchedFor?: string,
): { category: string; from: 'place_type' | 'search' | 'name' } | undefined {
  // A name that says outright what the place is beats a type that disagrees:
  // "Soba Udon Monju" was filed as a bar and planned as a nightcap (eval R1).
  const named = categoryNamedIn(result.displayName?.text ?? '')
  if (named) return { category: named, from: 'name' }

  const own = toCategory(result)
  if (own) return { category: own, from: 'place_type' }

  if (searchedFor && INTEREST_CATEGORY_IDS.includes(searchedFor)) {
    return { category: searchedFor, from: 'search' }
  }
  return undefined
}

/** Names that say what a place is. Only unambiguous food and shop words. */
const NAME_SAYS: ReadonlyArray<[RegExp, string]> = [
  // `(?![\p{L}])` rather than a trailing \b: \b does not see "ō" as a letter, so
  // "Shobō" never matched.
  [/\b(soba|udon)(?![\p{L}])|蕎麦|そば|うどん/iu, 'soba_udon'],
  [/\bramen(?![\p{L}])|ラーメン|らーめん/iu, 'ramen'],
  [/\bsushi(?![\p{L}])|寿司|鮨/iu, 'sushi'],
  [/\b(coffee|cafe|café|kissa|kissaten)(?![\p{L}])|珈琲|喫茶|カフェ/iu, 'cafe_kissaten'],
  [/\b(bar|pub)(?![\p{L}])|バー/iu, 'bar_cocktail'],
  [/\b(books?|bookstore|shob[oō])(?![\p{L}])|書店|書房|古書/iu, 'bookstore'],
]

/**
 * The category a place's own name states, when it states exactly one. "Cafe & Bar"
 * names two and decides nothing; "Soba Udon Monju" names one.
 */
export function categoryNamedIn(name: string): string | undefined {
  const named = [...new Set(NAME_SAYS.filter(([pattern]) => pattern.test(name)).map(([, category]) => category))]
  return named.length === 1 ? named[0] : undefined
}

/** A Google type that names a context category — accommodation, transit — rather than an interest. */
function isContextOnly(type: string): boolean {
  const category = categoryForGoogleType(type)
  return category !== undefined && !INTEREST_CATEGORY_IDS.includes(category)
}

export function toNeighborhood(result: PlacesResult): string | undefined {
  for (const wanted of NEIGHBORHOOD_TYPES) {
    const match = result.addressComponents?.find((component) =>
      component.types?.includes(wanted),
    )
    const name = match?.longText ?? match?.shortText
    if (name) return name
  }
  return undefined
}

/**
 * Google `types` worth keeping as tags.
 *
 * Tags are part of what a traveller's own words are matched against, so a place
 * that Google calls a `tea_house` gains a word the category alone does not carry.
 */
function toTags(result: PlacesResult): string[] {
  return [...new Set((result.types ?? []).filter((type) => !GENERIC_TYPES.has(type)))]
    .slice(0, 6)
    .map((type) => type.replace(/_/g, ' '))
}

/**
 * The first photo, with whoever took it.
 *
 * One, not all: the itinerary shows a thumbnail per stop, and a place carrying ten
 * photos would otherwise put nine unused references into the trip's frozen snapshot
 * and into everything that stores it.
 *
 * A photo with no attribution is dropped rather than shown anonymously — the terms
 * that let the photo be displayed are the ones that require the credit.
 */
function toPhoto(result: PlacesResult): PlacePhoto | undefined {
  const photo = result.photos?.find((candidate) => candidate.name)
  if (!photo?.name) return undefined

  const author = photo.authorAttributions?.find((entry) => entry.displayName)
  if (!author?.displayName) return undefined

  return {
    name: photo.name,
    attribution: { name: author.displayName, ...(author.uri ? { uri: author.uri } : {}) },
  }
}

/**
 * One result -> a usable place, or the reason it cannot be used.
 *
 * `searchedFor` is the category the search was issued for, used only when the
 * place's own types name none.
 */
export function mapPlacesResult(result: PlacesResult, searchedFor?: string): MappedPlace {
  const id = result.id
  if (!id) return { ok: false, reason: 'no_id' }

  const name = result.displayName?.text
  if (!name) return { ok: false, reason: 'no_name', id }

  const own = [...new Set([result.primaryType, ...(result.types ?? [])])].filter(
    (type): type is string => typeof type === 'string' && !GENERIC_TYPES.has(type),
  )
  if (own.length > 0 && own.every((type) => SERVES_CLIENTS.has(type))) {
    return { ok: false, reason: 'not_a_destination', id, name }
  }

  // A place that IS a hotel or a station, and nothing more, is where a day starts or
  // passes through, not somewhere to spend it. Without this it fell through to the
  // category of the search that found it: a three-room guesthouse, typed only
  // `japanese_inn`/`hotel`/`lodging`, was planned as a day's main stop because a
  // café search had returned it.
  if (!toCategory(result) && own.some((type) => isContextOnly(type))) {
    return { ok: false, reason: 'not_a_destination', id, name }
  }

  const lat = result.location?.latitude
  const lng = result.location?.longitude
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return { ok: false, reason: 'no_coordinates', id, name }
  }

  const openingHours = toOpeningHours(result)
  if (!openingHours) return { ok: false, reason: 'no_opening_hours', id, name }

  const resolved = resolveCategory(result, searchedFor)
  if (!resolved) return { ok: false, reason: 'no_category', id, name }
  const category = resolved.category

  const neighborhood = toNeighborhood(result)
  if (!neighborhood) return { ok: false, reason: 'no_neighborhood', id, name }

  const priceLevel = result.priceLevel ? PRICE_LEVELS[result.priceLevel] : undefined

  return {
    ok: true,
    place: {
      placeId: id,
      name,
      // Rounded to about a metre: Places returns more decimals than a building has.
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      category,
      neighborhood,
      ...(priceLevel !== undefined ? { priceLevel } : {}),
      openingHours,
      typicalDurationMin: TYPICAL_MINUTES[category] ?? DEFAULT_MINUTES,
      tags: toTags(result),
      shortDescription: result.editorialSummary?.text ?? '',
      source: 'places_api',
      categoryFrom: resolved.from,
      ...(typeof result.userRatingCount === 'number'
        ? { userRatingCount: result.userRatingCount }
        : {}),
      ...(toPhoto(result) ? { photo: toPhoto(result) } : {}),
    },
  }
}

export interface RetrievalOutcome {
  places: DemoPlace[]
  /** How many results each rejection reason accounted for. */
  rejected: Partial<Record<RejectionReason, number>>
}

/**
 * Maps a whole response, keeping the usable places and counting the rest.
 *
 * Duplicates are dropped: the same place legitimately answers several searches —
 * a sushi counter matches both "sushi" and "dinner near Kuramae" — and a catalogue
 * holding it twice would offer it twice as an alternative.
 */
export function mapPlacesResults(
  results: ReadonlyArray<PlacesResult | { result: PlacesResult; searchedFor?: string }>,
): RetrievalOutcome {
  const places: DemoPlace[] = []
  const seen = new Set<string>()
  const rejected: Partial<Record<RejectionReason, number>> = {}

  for (const entry of results) {
    const { result, searchedFor } =
      'result' in entry ? entry : { result: entry as PlacesResult, searchedFor: undefined }
    const mapped = mapPlacesResult(result, searchedFor)
    if (!mapped.ok) {
      rejected[mapped.reason] = (rejected[mapped.reason] ?? 0) + 1
      continue
    }
    if (seen.has(mapped.place.placeId)) continue
    seen.add(mapped.place.placeId)
    places.push(mapped.place)
  }

  return { places, rejected }
}
