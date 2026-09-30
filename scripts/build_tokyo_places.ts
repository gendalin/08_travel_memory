/**
 * build_tokyo_places.ts
 *
 * Curates data/demo_tokyo_v1/tokyo_places.json for the Gate 3 vertical slice.
 *
 * Provenance, stated plainly:
 *   - Every place here is a REAL Tokyo location. Nothing is an invented business.
 *   - `source` records where the place came INTO the demo from:
 *       "map_source"  — the user's own Takeout saved list
 *       "screenshot"  — a business name read off the user's screenshots
 *       "manual_demo" — a well-known Tokyo place added for itinerary coverage
 *   - Coordinates, names, categories, price levels and opening hours are now
 *     sourced from the Google Places API (New).
 *   - Where Places has no opening hours for a place, the authored fallback is
 *     kept and the place is tagged `hours-authored` so it stays visible.
 *
 * Matching guard: Text Search always returns *something*, so every lookup is
 * anchored with a locationBias circle around the place's geocode and the result
 * is rejected unless it lands within MATCH_RADIUS_M of it. A mismatched
 * restaurant with plausible hours is worse than no data.
 *
 * Run: npx tsx scripts/build_tokyo_places.ts
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { requireEnv } from './preprocess/env.ts'
import { CATEGORIES } from './preprocess/taxonomy.ts'
import { PATHS, REPO_ROOT, writeJson, type DemoPlace } from './preprocess/types.ts'

const CACHE_DIR = resolve(REPO_ROOT, '.cache/geocode')
const PLACES_CACHE_DIR = resolve(REPO_ROOT, '.cache/places-details')

/** A Places hit further than this from the geocode is treated as the wrong business. */
const MATCH_RADIUS_M = 900

/** Tokyo-wide sanity box. A geocode landing outside this is rejected, not trusted. */
const TOKYO_BBOX = { minLat: 35.4, maxLat: 36.0, minLng: 139.3, maxLng: 140.0 }
/** Enoura Observatory is in Odawara and legitimately sits outside the box. */
const OUTSIDE_TOKYO_ALLOWED = new Set(['enoura_observatory'])

type Hours = Record<string, string>

const ALL_WEEK = (span: string): Hours => ({
  mon: span, tue: span, wed: span, thu: span, fri: span, sat: span, sun: span,
})
const CLOSED_ON = (hours: Hours, ...days: string[]): Hours => {
  const next = { ...hours }
  for (const day of days) next[day] = 'closed'
  return next
}

interface Seed extends Omit<DemoPlace, 'lat' | 'lng' | 'openingHours'> {
  /** Query used for geocoding. More specific than the display name. */
  query: string
  openingHours: Hours
}

const SEEDS: Seed[] = [
  // --- base area: Kuramae / Asakusa ---------------------------------------
  { placeId: 'kuramae_base', name: 'Kuramae', query: 'Kuramae Station, Taito City, Tokyo',
    category: 'accommodation', neighborhood: 'Kuramae', typicalDurationMin: 0,
    tags: ['base'], shortDescription: 'Base lodging for the trip.',
    source: 'manual_demo', openingHours: ALL_WEEK('00:00-23:59') },
  { placeId: 'sensoji', name: 'Sensō-ji', query: 'Sensoji Temple, Asakusa, Tokyo',
    category: 'temple_shrine', neighborhood: 'Asakusa', typicalDurationMin: 60,
    tags: ['temple', 'landmark'], shortDescription: 'Tokyo’s oldest temple, busiest early and late.',
    source: 'manual_demo', priceLevel: 0, openingHours: ALL_WEEK('06:00-17:00') },
  { placeId: 'kotobuki_yu', name: 'Kotobuki-Yu', query: 'Kotobuki Yu sento, Taito City, Tokyo',
    category: 'onsen_sento', neighborhood: 'Kuramae', typicalDurationMin: 60,
    tags: ['sento', 'quiet'], shortDescription: 'Neighbourhood bathhouse a short walk from Kuramae.',
    source: 'map_source', priceLevel: 1, openingHours: CLOSED_ON(ALL_WEEK('14:00-23:00'), 'wed') },
  { placeId: 'kiyosumi_teien', name: 'Kiyosumi Garden', query: 'Kiyosumi Teien, Koto City, Tokyo',
    category: 'park_garden', neighborhood: 'Kiyosumi', typicalDurationMin: 60,
    tags: ['garden', 'walkable'], shortDescription: 'Strolling garden with stepping stones over the pond.',
    source: 'manual_demo', priceLevel: 1, openingHours: ALL_WEEK('09:00-17:00') },
  { placeId: 'blue_bottle_kiyosumi', name: 'Blue Bottle Coffee Kiyosumi', query: 'Blue Bottle Coffee Kiyosumi-Shirakawa, Tokyo',
    category: 'cafe_kissaten', neighborhood: 'Kiyosumi', typicalDurationMin: 45,
    tags: ['coffee'], shortDescription: 'Warehouse-turned-roastery cafe.',
    source: 'manual_demo', priceLevel: 2, openingHours: ALL_WEEK('08:00-19:00') },

  // --- ramen: the scenario slot plus its alternatives ----------------------
  { placeId: 'ramen_nakiryu', name: 'Nakiryu', query: 'Nakiryu ramen, Minami-Otsuka, Toshima City, Tokyo',
    category: 'ramen', neighborhood: 'Otsuka', typicalDurationMin: 45,
    tags: ['ramen', 'tantanmen'], shortDescription: 'Tantanmen specialist; queues form before opening.',
    source: 'manual_demo', priceLevel: 1, openingHours: CLOSED_ON(ALL_WEEK('11:00-15:00'), 'tue') },
  { placeId: 'ramen_fuunji', name: 'Fuunji', query: 'Fuunji ramen, Yoyogi, Shibuya City, Tokyo',
    category: 'ramen', neighborhood: 'Shinjuku', typicalDurationMin: 45,
    tags: ['ramen', 'tsukemen'], shortDescription: 'Tsukemen with a dense chicken-and-fish broth.',
    source: 'manual_demo', priceLevel: 1, openingHours: CLOSED_ON(ALL_WEEK('11:00-21:00'), 'sun') },
  { placeId: 'ramen_afuri', name: 'AFURI Ebisu', query: 'AFURI ramen Ebisu, Shibuya City, Tokyo',
    category: 'ramen', neighborhood: 'Ebisu', typicalDurationMin: 40,
    tags: ['ramen', 'yuzu', 'light'], shortDescription: 'Yuzu-shio ramen, lighter than most.',
    source: 'manual_demo', priceLevel: 1, openingHours: ALL_WEEK('11:00-23:00') },
  { placeId: 'ramen_rokurinsha', name: 'Rokurinsha', query: 'Rokurinsha Tokyo Ramen Street, Tokyo Station',
    category: 'ramen', neighborhood: 'Tokyo Station', typicalDurationMin: 40,
    tags: ['ramen', 'tsukemen'], shortDescription: 'Tsukemen inside Tokyo Station’s Ramen Street.',
    source: 'manual_demo', priceLevel: 1, openingHours: ALL_WEEK('07:30-22:00') },
  { placeId: 'ramen_ichiran_shibuya', name: 'Ichiran Shibuya', query: 'Ichiran Shibuya, Tokyo',
    category: 'ramen', neighborhood: 'Shibuya', typicalDurationMin: 40,
    tags: ['ramen', 'tonkotsu', 'solo booths'], shortDescription: 'Tonkotsu in single-seat booths, open late.',
    source: 'manual_demo', priceLevel: 1, openingHours: ALL_WEEK('00:00-23:59') },

  // --- sushi: the user's own saved list ------------------------------------
  { placeId: 'sushi_sawada', name: 'Sushi Sawada', query: 'Sushi Sawada, Ginza, Chuo City, Tokyo',
    category: 'sushi', neighborhood: 'Ginza', typicalDurationMin: 90,
    tags: ['sushi', 'counter', 'reservation'], shortDescription: 'Small Ginza counter; reservation only.',
    source: 'map_source', priceLevel: 4, openingHours: CLOSED_ON(ALL_WEEK('12:00-14:00'), 'sun', 'wed') },
  { placeId: 'sushi_hakkoku', name: 'Hakkoku', query: 'Sushi Hakkoku, Ginza, Chuo City, Tokyo',
    category: 'sushi', neighborhood: 'Ginza', typicalDurationMin: 105,
    tags: ['sushi', 'counter', 'edomae'], shortDescription: 'Edomae counter known for its rice.',
    source: 'map_source', priceLevel: 4, openingHours: CLOSED_ON(ALL_WEEK('12:00-14:00'), 'sun') },
  { placeId: 'sushi_ishiyama', name: 'Sushi Ishiyama', query: 'Sushi Ishiyama, Tokyo',
    category: 'sushi', neighborhood: 'Ningyocho', typicalDurationMin: 90,
    tags: ['sushi', 'counter'], shortDescription: 'Quiet counter away from the Ginza crowds.',
    source: 'map_source', priceLevel: 4, openingHours: CLOSED_ON(ALL_WEEK('12:00-14:00'), 'sun') },
  { placeId: 'sushi_korin', name: 'Sushi Korin', query: 'Sushi Korin, Kamiyamacho, Shibuya City, Tokyo',
    category: 'sushi', neighborhood: 'Shibuya', typicalDurationMin: 75,
    tags: ['sushi', 'uni'], shortDescription: 'Kamiyama-cho basement counter.',
    source: 'screenshot', priceLevel: 3, openingHours: CLOSED_ON(ALL_WEEK('11:30-14:00'), 'mon') },
  { placeId: 'sushi_tanimoto', name: '多仁本 神楽坂', query: 'Tanimoto sushi Kagurazaka, Shinjuku City, Tokyo',
    category: 'sushi', neighborhood: 'Kagurazaka', typicalDurationMin: 90,
    tags: ['sushi', 'counter'], shortDescription: 'Kagurazaka counter from the user’s saved list.',
    source: 'map_source', priceLevel: 4, openingHours: CLOSED_ON(ALL_WEEK('12:00-14:00'), 'sun') },
  { placeId: 'sushi_nishiazabu_noguchi', name: '西麻布 野口', query: 'Nishiazabu Noguchi, Minato City, Tokyo',
    category: 'sushi', neighborhood: 'Nishiazabu', typicalDurationMin: 90,
    tags: ['sushi', 'counter'], shortDescription: 'Nishiazabu counter from the user’s saved list.',
    source: 'map_source', priceLevel: 4, openingHours: CLOSED_ON(ALL_WEEK('18:00-22:00'), 'sun') },
  { placeId: 'sushi_ginza_inaba', name: 'Ginza Inaba', query: 'Ginza Inaba sushi, Chuo City, Tokyo',
    category: 'sushi', neighborhood: 'Ginza', typicalDurationMin: 90,
    tags: ['sushi'], shortDescription: 'Ginza sushi counter.',
    source: 'map_source', priceLevel: 4, openingHours: CLOSED_ON(ALL_WEEK('12:00-14:00'), 'sun') },

  // --- izakaya / yakiniku ---------------------------------------------------
  { placeId: 'yakitori_morimoto', name: 'Yakitori Morimoto', query: 'Yakitori Morimoto, Shibuya, Tokyo',
    category: 'izakaya', neighborhood: 'Ebisu', typicalDurationMin: 90,
    tags: ['yakitori', 'counter'], shortDescription: 'Charcoal yakitori counter.',
    source: 'screenshot', priceLevel: 2, openingHours: CLOSED_ON(ALL_WEEK('17:00-23:00'), 'sun') },
  { placeId: 'yakiniku_yoin', name: 'Yakiniku Yoin Ebisu', query: 'Yakiniku Yoin, Ebisu, Shibuya City, Tokyo',
    category: 'yakiniku_grill', neighborhood: 'Ebisu', typicalDurationMin: 100,
    tags: ['yakiniku'], shortDescription: 'Ebisu grill house.',
    source: 'map_source', priceLevel: 3, openingHours: ALL_WEEK('17:00-23:00') },
  { placeId: 'izakaya_shin_hinomoto', name: 'Shin Hinomoto', query: 'Shin Hinomoto izakaya, Yurakucho, Chiyoda City, Tokyo',
    category: 'izakaya', neighborhood: 'Yurakucho', typicalDurationMin: 90,
    tags: ['izakaya', 'under the tracks'], shortDescription: 'Izakaya under the Yurakucho railway arches.',
    source: 'manual_demo', priceLevel: 2, openingHours: CLOSED_ON(ALL_WEEK('17:00-23:00'), 'sun') },

  // --- markets / retail -----------------------------------------------------
  { placeId: 'tsukiji_outer', name: 'Tsukiji Outer Market', query: 'Tsukiji Outer Market, Chuo City, Tokyo',
    category: 'grocery_market', neighborhood: 'Tsukiji', typicalDurationMin: 75,
    tags: ['market', 'morning'], shortDescription: 'Morning market lanes; most stalls shut by early afternoon.',
    source: 'manual_demo', priceLevel: 1, openingHours: CLOSED_ON(ALL_WEEK('05:00-14:00'), 'sun') },
  { placeId: 'ameyoko', name: 'Ameyoko', query: 'Ameyoko Shopping Street, Ueno, Taito City, Tokyo',
    category: 'grocery_market', neighborhood: 'Ueno', typicalDurationMin: 60,
    tags: ['market', 'street'], shortDescription: 'Dense market street under the Yamanote tracks.',
    source: 'manual_demo', priceLevel: 1, openingHours: ALL_WEEK('10:00-20:00') },
  { placeId: 'akomeya_kagurazaka', name: 'AKOMEYA TOKYO la kagu', query: 'AKOMEYA TOKYO la kagu, Kagurazaka, Shinjuku City, Tokyo',
    category: 'lifestyle_homeware', neighborhood: 'Kagurazaka', typicalDurationMin: 45,
    tags: ['rice', 'kitchen', 'select shop'], shortDescription: 'Rice and kitchen goods in a converted warehouse.',
    source: 'map_source', priceLevel: 2, openingHours: ALL_WEEK('11:00-20:00') },
  { placeId: 'dover_street_market', name: 'Dover Street Market Ginza', query: 'Dover Street Market Ginza, Chuo City, Tokyo',
    category: 'fashion_vintage', neighborhood: 'Ginza', typicalDurationMin: 60,
    tags: ['fashion', 'design'], shortDescription: 'Seven floors of fashion as installation.',
    source: 'screenshot', priceLevel: 4, openingHours: ALL_WEEK('11:00-20:00') },
  { placeId: 'donki_ueno', name: 'Don Quijote Ueno', query: 'Don Quijote Ueno, Taito City, Tokyo',
    category: 'discount_variety', neighborhood: 'Ueno', typicalDurationMin: 45,
    tags: ['variety', 'late'], shortDescription: 'Late-opening variety store.',
    source: 'map_source', priceLevel: 1, openingHours: ALL_WEEK('00:00-23:59') },
  { placeId: 'tsutaya_daikanyama', name: 'Daikanyama T-Site', query: 'Daikanyama T-Site Tsutaya Books, Shibuya City, Tokyo',
    category: 'bookstore', neighborhood: 'Daikanyama', typicalDurationMin: 60,
    tags: ['books', 'design'], shortDescription: 'Bookshop complex with a long magazine aisle.',
    source: 'manual_demo', priceLevel: 2, openingHours: ALL_WEEK('09:00-22:00') },

  // --- culture ---------------------------------------------------------------
  { placeId: 'nezu_museum', name: 'Nezu Museum', query: 'Nezu Museum, Minami-Aoyama, Minato City, Tokyo',
    category: 'museum_gallery', neighborhood: 'Aoyama', typicalDurationMin: 90,
    tags: ['museum', 'garden', 'architecture'], shortDescription: 'Kuma-designed museum with a hillside garden.',
    source: 'manual_demo', priceLevel: 2, openingHours: CLOSED_ON(ALL_WEEK('10:00-17:00'), 'mon') },
  { placeId: 'design_sight_2121', name: '21_21 DESIGN SIGHT', query: '21_21 DESIGN SIGHT, Roppongi, Minato City, Tokyo',
    category: 'museum_gallery', neighborhood: 'Roppongi', typicalDurationMin: 75,
    tags: ['design', 'exhibition'], shortDescription: 'Ando-designed gallery, one exhibition at a time.',
    source: 'manual_demo', priceLevel: 2, openingHours: CLOSED_ON(ALL_WEEK('10:00-19:00'), 'tue') },
  { placeId: 'tokyo_national_museum', name: 'Tokyo National Museum', query: 'Tokyo National Museum, Ueno Park, Taito City, Tokyo',
    category: 'museum_gallery', neighborhood: 'Ueno', typicalDurationMin: 120,
    tags: ['museum'], shortDescription: 'The main national collection, in Ueno Park.',
    source: 'manual_demo', priceLevel: 2, openingHours: CLOSED_ON(ALL_WEEK('09:30-17:00'), 'mon') },
  { placeId: 'enoura_observatory', name: 'Enoura Observatory', query: 'Enoura Observatory, Odawara, Kanagawa',
    category: 'architecture_design', neighborhood: 'Odawara (day trip)', typicalDurationMin: 180,
    tags: ['architecture', 'sea', 'day trip'], shortDescription: 'Sugimoto’s sea-facing complex; a full day out of Tokyo.',
    source: 'map_source', priceLevel: 3, openingHours: CLOSED_ON(ALL_WEEK('10:00-16:00'), 'tue', 'wed') },

  // --- parks / baths ----------------------------------------------------------
  { placeId: 'ueno_park', name: 'Ueno Park', query: 'Ueno Park, Taito City, Tokyo',
    category: 'park_garden', neighborhood: 'Ueno', typicalDurationMin: 60,
    tags: ['park'], shortDescription: 'Wide park connecting the Ueno museums.',
    source: 'manual_demo', priceLevel: 0, openingHours: ALL_WEEK('05:00-23:00') },
  { placeId: 'hamarikyu', name: 'Hamarikyu Gardens', query: 'Hamarikyu Gardens, Chuo City, Tokyo',
    category: 'park_garden', neighborhood: 'Shiodome', typicalDurationMin: 75,
    tags: ['garden', 'tea house'], shortDescription: 'Tidal garden with a tea house on the water.',
    source: 'manual_demo', priceLevel: 1, openingHours: ALL_WEEK('09:00-17:00') },
  { placeId: 'konparu_yu', name: 'Konparu-Yu', query: 'Konparu Yu, Ginza, Chuo City, Tokyo',
    category: 'onsen_sento', neighborhood: 'Ginza', typicalDurationMin: 60,
    tags: ['sento'], shortDescription: 'Small Ginza bathhouse tucked behind the main streets.',
    source: 'map_source', priceLevel: 1, openingHours: CLOSED_ON(ALL_WEEK('14:00-22:00'), 'sun') },
  { placeId: 'koffee_mameya', name: 'Koffee Mameya', query: 'Koffee Mameya, Omotesando, Shibuya City, Tokyo',
    category: 'cafe_kissaten', neighborhood: 'Omotesando', typicalDurationMin: 40,
    tags: ['coffee', 'counter'], shortDescription: 'Counter-only coffee bar; beans chosen by conversation.',
    source: 'manual_demo', priceLevel: 2, openingHours: ALL_WEEK('10:00-18:00') },
]

interface GeocodeResult {
  lat: number
  lng: number
  formatted: string
}

async function geocode(query: string, apiKey: string): Promise<GeocodeResult | null> {
  mkdirSync(CACHE_DIR, { recursive: true })
  const key = createHash('sha1').update(query).digest('hex')
  const cachePath = join(CACHE_DIR, `${key}.json`)
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, 'utf8'))

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  url.searchParams.set('address', query)
  url.searchParams.set('key', apiKey)
  url.searchParams.set('language', 'en')

  const res = await fetch(url)
  const body = (await res.json()) as {
    status: string
    results?: Array<{ geometry: { location: { lat: number; lng: number } }; formatted_address: string }>
  }

  if (body.status !== 'OK' || !body.results?.length) return null

  const top = body.results[0]
  const result: GeocodeResult = {
    lat: top.geometry.location.lat,
    lng: top.geometry.location.lng,
    formatted: top.formatted_address,
  }
  writeFileSync(cachePath, JSON.stringify(result, null, 2), 'utf8')
  return result
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const PRICE_LEVELS: Record<string, 0 | 1 | 2 | 3 | 4> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
}

interface PlacesHit {
  id: string
  displayName?: { text: string }
  primaryType?: string
  types?: string[]
  location?: { latitude: number; longitude: number }
  priceLevel?: string
  regularOpeningHours?: {
    periods?: Array<{
      open?: { day: number; hour: number; minute: number }
      close?: { day: number; hour: number; minute: number }
    }>
  }
}

function metersBetween(a: GeocodeResult, b: { latitude: number; longitude: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.latitude - a.lat)
  const dLng = toRad(b.longitude - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

/** Google periods -> { mon: "11:00-15:30", ... }. Days with no period are closed. */
function toOpeningHours(hit: PlacesHit): Hours | null {
  const periods = hit.regularOpeningHours?.periods
  if (!periods || periods.length === 0) return null

  const hours: Hours = {
    mon: 'closed', tue: 'closed', wed: 'closed', thu: 'closed',
    fri: 'closed', sat: 'closed', sun: 'closed',
  }
  const pad = (value: number) => String(value).padStart(2, '0')

  // EVERY period, not just the day's first. Most counters here shut between lunch
  // and dinner, and keeping only the first span recorded a sushi bar serving both
  // services as lunch-only and a ramen shop open 10:00-23:00 as a breakfast place.
  // Eight of twenty-nine places were affected. The domain reads several spans a
  // day, comma-separated.
  for (const period of periods) {
    if (!period.open) continue
    const key = DAY_KEYS[period.open.day]
    if (!key) continue
    const open = `${pad(period.open.hour)}:${pad(period.open.minute)}`
    // A missing close means open 24h; a close past midnight is clamped to 23:59
    // so the domain's HH:MM comparisons stay monotonic within a day.
    const close = period.close
      ? period.close.day === period.open.day
        ? `${pad(period.close.hour)}:${pad(period.close.minute)}`
        : '23:59'
      : '23:59'
    const span = `${open}-${close}`
    hours[key] = hours[key] === 'closed' ? span : `${hours[key]},${span}`
  }

  return Object.values(hours).every((value) => value === 'closed') ? null : hours
}

/**
 * Google types that are COARSER than the authored category rather than in
 * conflict with it. "japanese_restaurant" does not contradict "sushi" — it is
 * the same fact at lower resolution — so letting it win silently reclassified
 * three sushi counters as teishoku, which would have left the sushi trend
 * memory pointing at no POI in the catalogue.
 *
 * A generic type never overrides. Only a specific one does.
 */
const GENERIC_GOOGLE_TYPES = new Set([
  'restaurant', 'food', 'store', 'establishment', 'point_of_interest', 'premise',
  'japanese_restaurant', 'tourist_attraction', 'place_of_worship', 'lodging', 'spa',
])

/**
 * Maps a Google type onto the project taxonomy, preferring primaryType.
 * Returns the matched type too, so the build log can say what actually decided.
 */
function categoryFromTypes(
  hit: PlacesHit,
  fallback: string,
): { category: string; via?: string } {
  const ordered = [hit.primaryType, ...(hit.types ?? [])]
    .filter((type): type is string => typeof type === 'string')
    .filter((type) => !GENERIC_GOOGLE_TYPES.has(type))

  for (const type of ordered) {
    const match = CATEGORIES.find((category) => category.googleTypes.includes(type))
    if (match) return { category: match.id, via: type }
  }
  return { category: fallback }
}

async function lookupPlace(
  seed: Seed,
  anchor: GeocodeResult,
  apiKey: string,
): Promise<PlacesHit | null> {
  mkdirSync(PLACES_CACHE_DIR, { recursive: true })
  const cachePath = join(PLACES_CACHE_DIR, `${seed.placeId}.json`)
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, 'utf8'))

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.primaryType,places.types,places.location,places.priceLevel,places.regularOpeningHours',
    },
    body: JSON.stringify({
      textQuery: seed.query,
      languageCode: 'en',
      maxResultCount: 3,
      locationBias: {
        circle: { center: { latitude: anchor.lat, longitude: anchor.lng }, radius: 2000 },
      },
    }),
  })

  if (!res.ok) return null
  const body = (await res.json()) as { places?: PlacesHit[] }

  // Nearest hit within the guard radius wins; anything further is the wrong business.
  const hit = (body.places ?? [])
    .filter((candidate) => candidate.location)
    .map((candidate) => ({ candidate, distance: metersBetween(anchor, candidate.location!) }))
    .sort((a, b) => a.distance - b.distance)
    .find((entry) => entry.distance <= MATCH_RADIUS_M)?.candidate

  if (!hit) return null
  writeFileSync(cachePath, JSON.stringify(hit, null, 2), 'utf8')
  return hit
}

async function main(): Promise<void> {
  const apiKey = requireEnv('GOOGLE_MAPS_API_KEY', 'building demo POIs')
  console.log(`Curating ${SEEDS.length} Tokyo POIs\n`)

  const places: DemoPlace[] = []
  const failures: string[] = []
  const notes: string[] = []
  let enriched = 0
  let authoredHours = 0
  let renamed = 0
  let recategorised = 0

  for (const seed of SEEDS) {
    const hit = await geocode(seed.query, apiKey)
    if (!hit) {
      failures.push(`${seed.placeId}: no geocode result for "${seed.query}"`)
      continue
    }

    const inBox =
      hit.lat >= TOKYO_BBOX.minLat && hit.lat <= TOKYO_BBOX.maxLat &&
      hit.lng >= TOKYO_BBOX.minLng && hit.lng <= TOKYO_BBOX.maxLng

    if (!inBox && !OUTSIDE_TOKYO_ALLOWED.has(seed.placeId)) {
      failures.push(`${seed.placeId}: geocoded outside Tokyo (${hit.lat.toFixed(3)}, ${hit.lng.toFixed(3)}) — rejected`)
      continue
    }

    const { query, ...rest } = seed
    const details = await lookupPlace(seed, hit, apiKey)

    // Every field prefers live Places data and falls back to the authored seed.
    // The lodging anchor keeps its authored name: Google calls it "Kuramae
    // Station", which is accurate but wrong for the place the trip is based at.
    const name =
      seed.category === 'accommodation' ? seed.name : (details?.displayName?.text ?? seed.name)
    // The lodging anchor is a trip fixture, not a POI to reclassify — Google
    // calls it a subway station, which is true and useless here.
    const classified =
      details && seed.category !== 'accommodation'
        ? categoryFromTypes(details, seed.category)
        : { category: seed.category, via: undefined }
    const category = classified.category
    const liveHours = details ? toOpeningHours(details) : null
    const priceLevel = details?.priceLevel ? PRICE_LEVELS[details.priceLevel] : seed.priceLevel
    const lat = details?.location?.latitude ?? hit.lat
    const lng = details?.location?.longitude ?? hit.lng

    if (details) enriched++
    if (!liveHours) authoredHours++
    if (name !== seed.name) renamed++
    if (category !== seed.category) recategorised++

    if (!details) notes.push(`${seed.placeId}: no Places match within ${MATCH_RADIUS_M}m — authored data kept`)
    else if (!liveHours) notes.push(`${seed.placeId}: Places has no opening hours — authored hours kept`)
    if (category !== seed.category) {
      notes.push(`${seed.placeId}: category ${seed.category} -> ${category} (Google type "${classified.via}")`)
    }

    places.push({
      ...rest,
      name,
      category,
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      ...(priceLevel !== undefined ? { priceLevel } : {}),
      openingHours: liveHours ?? seed.openingHours,
      tags: liveHours ? seed.tags : [...seed.tags, 'hours-authored'],
    })

    console.log(
      `  ${seed.placeId.padEnd(26)} ${details ? '●' : '○'} ${name.slice(0, 30).padEnd(31)}` +
        `${category.padEnd(20)}${liveHours ? 'hours:places' : 'hours:authored'}`,
    )
  }

  writeJson(PATHS.out.places, places)

  console.log(`\n${places.length} places -> data/demo_tokyo_v1/tokyo_places.json`)
  console.log(`  enriched from Places : ${enriched}/${places.length}`)
  console.log(`  real opening hours   : ${places.length - authoredHours}/${places.length}`)
  console.log(`  renamed by Google    : ${renamed}`)
  console.log(`  recategorised        : ${recategorised}`)

  if (notes.length > 0) {
    console.log(`\nNotes:`)
    for (const note of notes) console.log(`  - ${note}`)
  }
  if (failures.length > 0) {
    console.log(`\n${failures.length} rejected:`)
    for (const failure of failures) console.log(`  ! ${failure}`)
  }
}

await main()
