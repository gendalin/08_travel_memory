/**
 * Places API (New) text search (B3).
 *
 * Runs server-side so the key never reaches the browser (§13.1), and caches every
 * response on disk so a repeated trip, a demo run and a test cost nothing. The
 * cache key is the query plus its bounds, so changing either is a new call and
 * changing neither is free.
 *
 * Nothing here decides anything. It fetches, caches and hands back raw results;
 * `src/services/places/retrieval.ts` maps and gates them, and is pure so the whole
 * mapping is testable without a key or a network.
 *
 * The field mask is the cost lever as much as the call count is. Billing takes the
 * HIGHEST tier any requested field belongs to — "if you select fields in both the
 * Essentials and the Pro SKUs, you are billed based on the Pro SKU" — so one
 * expensive field prices the whole request.
 *
 * Every field below has a consumer, and the mask reaches Enterprise + Atmosphere:
 *
 *   id                        Essentials (IDs only) — identity
 *   location, types,          Essentials — coordinates, tags for matching, and the
 *   addressComponents                      district the product needs to name a stop
 *   displayName, primaryType  Pro — the name shown, and the category
 *   regularOpeningHours       Enterprise — scheduling; nothing plans without it
 *   priceLevel                Enterprise — the budget a traveller stated
 *   userRatingCount           Enterprise — fame, which lowers novelty
 *   photos                    Pro — one thumbnail per stop in the itinerary
 *   editorialSummary          Enterprise + Atmosphere — what the place is, in a
 *                             sentence, for the stop's description
 *
 * `photos` is the one field added for looks rather than for planning, and it is here
 * because of the rule above rather than in spite of it: the mask already reaches
 * Enterprise for opening hours, so a Pro field does not move the tier. What it DOES
 * cost is separate — fetching the bytes is its own billable request per photo, which
 * is why `photoMedia` caches them on disk and the app asks for one photo per place.
 *
 * `editorialSummary` was left out once, for cost: it prices EVERY call at the top
 * tier, and all it was used for then was text matching. It is back (2026-09-28)
 * for a different consumer — a retrieved stop otherwise has no description at all,
 * and the traveller sees a name and a category and nothing about what the place
 * is. The tier change is the accepted price of that. Places does not have a
 * summary for every place, so an empty description is still an expected outcome.
 *
 * Changing the mask changes the cache key, so the first run after it re-bills
 * every search once.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { envOrThrow } from '../scripts/preprocess/env.ts'
import { REPO_ROOT } from '../scripts/preprocess/types.ts'

const CACHE_DIR = resolve(REPO_ROOT, '.cache/places-search')

/** Everything a plannable stop needs, and a sentence about what it is. */
const PLACE_FIELDS = [
  'places.id',
  'places.displayName',
  'places.primaryType',
  'places.types',
  'places.location',
  'places.priceLevel',
  'places.regularOpeningHours',
  'places.userRatingCount',
  'places.addressComponents',
  'places.photos',
  'places.editorialSummary',
].join(',')

/**
 * Just enough to put a pin on a base lodging: where it is, and an address a person
 * can check the match against.
 *
 * Both fields are Essentials, which is the cheapest billable tier and carries the
 * largest free allowance — so resolving a hotel costs a fraction of retrieving a
 * stop, and needs no second API surface. Asking for `displayName` here would move
 * the call to Pro for no gain: the traveller already typed the name.
 */
const LODGING_FIELDS = ['places.id', 'places.location', 'places.shortFormattedAddress'].join(',')

/** Places caps a text search at 20; asking for more is silently truncated. */
const MAX_PER_SEARCH = 20

export interface SearchRequest {
  textQuery: string
  /** How many to keep. Capped at what one search can return. */
  retrieve: number
  /** Bias results to this circle. Both the centre and the radius come from the trip. */
  bias?: { lat: number; lng: number; radiusMetres: number }
}

export interface SearchResponse {
  /** Raw Places results, unmapped. */
  places: unknown[]
  /** True when the response came from disk rather than the API. */
  cached: boolean
}

function cachePathFor(request: SearchRequest, fields: string): string {
  const key = createHash('sha1')
    .update(
      JSON.stringify({
        q: request.textQuery,
        n: Math.min(request.retrieve, MAX_PER_SEARCH),
        b: request.bias ?? null,
        // Part of the key: the same query asked for different fields is a different
        // response, and a different bill.
        fields,
      }),
    )
    .digest('hex')
  return join(CACHE_DIR, `${key}.json`)
}

/** One text search against Places, cached on disk by query, bounds and field mask. */
async function search(request: SearchRequest, fields: string): Promise<SearchResponse> {
  mkdirSync(CACHE_DIR, { recursive: true })
  const cachePath = cachePathFor(request, fields)

  if (existsSync(cachePath)) {
    return { places: JSON.parse(readFileSync(cachePath, 'utf8')), cached: true }
  }

  const apiKey = envOrThrow('GOOGLE_MAPS_API_KEY', 'retrieving places for a trip')

  const body: Record<string, unknown> = {
    textQuery: request.textQuery,
    languageCode: 'en',
    maxResultCount: Math.min(Math.max(1, request.retrieve), MAX_PER_SEARCH),
  }
  if (request.bias) {
    body.locationBias = {
      circle: {
        center: { latitude: request.bias.lat, longitude: request.bias.lng },
        radius: request.bias.radiusMetres,
      },
    }
  }

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fields,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    console.error('[places]', res.status, (await res.text()).slice(0, 300))
    return { places: [], cached: false }
  }

  const payload = (await res.json()) as { places?: unknown[] }
  const places = payload.places ?? []

  // Cached even when empty: a query that finds nothing will find nothing again, and
  // paying twice to learn that is the easiest bill to avoid.
  writeFileSync(cachePath, JSON.stringify(places, null, 2), 'utf8')
  return { places, cached: false }
}

/**
 * One text search, from cache when it has been asked before.
 *
 * A failure returns no places rather than throwing: a thin candidate set is a
 * degraded trip, and an exception here would be a failed one. The caller counts
 * what came back and can say so.
 */
export async function searchPlaces(request: SearchRequest): Promise<SearchResponse> {
  return search(request, PLACE_FIELDS)
}

/**
 * Resolves a base lodging the traveller typed into a point on the map.
 *
 * Returns the address Places matched alongside the coordinates, so the traveller can
 * see WHICH place was found — "Kuramae" is a station, a district and any number of
 * hotels, and silently planning a whole trip around the wrong one is the failure to
 * avoid. Nothing is guessed: no match means no coordinates.
 */
export async function geocodeLodging(input: {
  name: string
  destination: string
}): Promise<{ lat: number; lng: number; matchedAddress: string; cached: boolean } | null> {
  const result = await search(
    { textQuery: `${input.name}, ${input.destination}`, retrieve: 1 },
    LODGING_FIELDS,
  )

  const first = result.places[0] as
    | { location?: { latitude?: number; longitude?: number }; shortFormattedAddress?: string }
    | undefined

  const lat = first?.location?.latitude
  const lng = first?.location?.longitude
  if (typeof lat !== 'number' || typeof lng !== 'number') return null

  return {
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    matchedAddress: first?.shortFormattedAddress ?? '',
    cached: result.cached,
  }
}

/** Google types that make a place somewhere an event is held. */
const VENUE_TYPES = new Set([
  'stadium', 'sports_complex', 'arena', 'event_venue', 'performing_arts_theater', 'concert_hall',
  'amphitheatre', 'opera_house', 'cultural_center', 'convention_center', 'shinto_shrine',
  'buddhist_temple', 'park',
])

const VENUE_FIELDS = ['places.id', 'places.displayName', 'places.location', 'places.types', 'places.shortFormattedAddress'].join(',')

/**
 * An event venue on the map — and only if Places says it IS a venue.
 *
 * A name alone is not enough: "楽天モバイル" (a ballpark in Sendai) resolved against
 * Tokyo to a telecom office, and would have put a game there. The first result must
 * carry a venue type, or nothing is returned.
 */
export async function findVenue(input: {
  name: string
  destination: string
}): Promise<{ lat: number; lng: number; name: string; address: string } | null> {
  const result = await search({ textQuery: `${input.name}, ${input.destination}`, retrieve: 1 }, VENUE_FIELDS)
  const first = result.places[0] as
    | {
        displayName?: { text?: string }
        location?: { latitude?: number; longitude?: number }
        types?: string[]
        shortFormattedAddress?: string
      }
    | undefined
  const lat = first?.location?.latitude
  const lng = first?.location?.longitude
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!(first?.types ?? []).some((type) => VENUE_TYPES.has(type))) return null
  return {
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
    name: first?.displayName?.text ?? input.name,
    address: first?.shortFormattedAddress ?? '',
  }
}

/**
 * Several searches, in sequence so a burst cannot trip a rate limit.
 *
 * Results stay grouped BY SEARCH rather than being flattened, so a caller can say
 * which query came back empty. A flat list can only report that the set was thin; it
 * cannot say whether to reword a search or accept the gap.
 */
export async function searchMany(requests: readonly SearchRequest[]): Promise<{
  results: Array<{ textQuery: string; places: unknown[]; cached: boolean }>
  calls: number
  fromCache: number
}> {
  const results: Array<{ textQuery: string; places: unknown[]; cached: boolean }> = []
  let calls = 0
  let fromCache = 0

  for (const request of requests) {
    const result = await searchPlaces(request)
    if (result.cached) fromCache++
    else calls++
    results.push({ textQuery: request.textQuery, places: result.places, cached: result.cached })
  }

  return { results, calls, fromCache }
}

// --- photos ------------------------------------------------------------------

const PHOTO_CACHE_DIR = resolve(REPO_ROOT, '.cache/place-photos')

/**
 * A photo resource name, as Places writes them: `places/<id>/photos/<reference>`.
 *
 * Checked because the name arrives from the browser. Without this the route is an
 * open proxy: anything after `/v1/` would be fetched with this server's key and
 * handed back, which is a way to spend someone else's quota on someone else's data.
 */
const PHOTO_NAME = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/

/** Widths the app may ask for. A bounded set keeps the cache small and the bill flat. */
const PHOTO_WIDTHS = new Set([160, 480])

const CONTENT_TYPE_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** Identity and pictures only: Pro tier, the cheapest mask that carries photos. */
const PHOTO_LOOKUP_FIELDS = ['places.id', 'places.displayName', 'places.location', 'places.photos'].join(',')

/**
 * Candidates for a known place's photo: a text search by its name, biased to where we
 * already know it is. Returns raw results; the caller decides which one, if any, is
 * the same place — a name search alone is not proof of identity.
 *
 * For the curated bundle, whose thirty-four places predate photos. Cached like every
 * other search, so it is paid for once.
 */
export async function lookupPlacePhotos(input: {
  name: string
  near: { lat: number; lng: number }
}): Promise<SearchResponse> {
  return search(
    { textQuery: input.name, retrieve: 3, bias: { lat: input.near.lat, lng: input.near.lng, radiusMetres: 500 } },
    PHOTO_LOOKUP_FIELDS,
  )
}

export interface PhotoResponse {
  body: Buffer
  contentType: string
  cached: boolean
}

/** Where a photo would be cached, if it has been fetched. */
function photoCachePath(name: string, maxWidthPx: number, extension: string): string {
  const key = createHash('sha1').update(`${name}@${maxWidthPx}`).digest('hex')
  return join(PHOTO_CACHE_DIR, `${key}.${extension}`)
}

/**
 * Whether the bytes are already on disk — a question that costs nothing to ask.
 *
 * Exists so a caller can count what a run WOULD spend without spending it. Asking
 * `photoMedia` instead would fetch the very photos it was counting.
 */
export function photoIsCached(name: string, maxWidthPx: number): boolean {
  return Object.values(CONTENT_TYPE_EXTENSION).some((extension) =>
    existsSync(photoCachePath(name, maxWidthPx, extension)),
  )
}

/**
 * The bytes of one place photo, cached on disk.
 *
 * Proxied rather than redirected to. Places can hand back a temporary
 * googleusercontent URL instead of the image, which would save this server the
 * bytes — but that URL expires, and a trip is meant to look the same next week as it
 * does today (B4). Caching the image itself is also what lets the scripted demo run
 * without a network, which is the property Gate 8 is about.
 *
 * Returns null for a name that is not a photo resource, or a fetch the API refused.
 * The caller answers 404 and the UI falls back to the monogram: a missing picture is
 * not a broken itinerary.
 */
export async function photoMedia(input: {
  name: string
  maxWidthPx: number
}): Promise<PhotoResponse | null> {
  if (!PHOTO_NAME.test(input.name)) return null
  if (!PHOTO_WIDTHS.has(input.maxWidthPx)) return null

  mkdirSync(PHOTO_CACHE_DIR, { recursive: true })

  for (const [contentType, extension] of Object.entries(CONTENT_TYPE_EXTENSION)) {
    const cached = photoCachePath(input.name, input.maxWidthPx, extension)
    if (existsSync(cached)) {
      return { body: readFileSync(cached), contentType, cached: true }
    }
  }

  // Offline (the E2E server): what is cached is served, nothing new is bought. A test
  // run must not spend money or depend on the network for a picture.
  if (process.env.PHOTOS_OFFLINE === '1') return null

  const apiKey = envOrThrow('GOOGLE_MAPS_API_KEY', 'place photos')
  const url =
    `https://places.googleapis.com/v1/${input.name}/media` +
    `?maxWidthPx=${input.maxWidthPx}&key=${apiKey}`

  // `fetch` follows the redirect Places answers with, so what arrives is the image.
  const res = await fetch(url)
  if (!res.ok) {
    console.error('[places:photo]', res.status, (await res.text()).slice(0, 200))
    return null
  }

  const contentType = res.headers.get('content-type')?.split(';')[0] ?? ''
  const extension = CONTENT_TYPE_EXTENSION[contentType]
  if (!extension) return null

  const body = Buffer.from(await res.arrayBuffer())
  writeFileSync(photoCachePath(input.name, input.maxWidthPx, extension), body)
  return { body, contentType, cached: false }
}
