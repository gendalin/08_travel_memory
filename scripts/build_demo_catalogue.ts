/**
 * The shareable prototype's catalogue: a real retrieval, frozen and photographed.
 *
 * The single-file demo plans from `data/demo_tokyo_v1/` — thirty-four places curated
 * before per-trip retrieval existed, and before photos were asked for. So the one
 * artefact a reviewer actually opens shows neither what the product retrieves nor what
 * it looks like when it does. This builds the missing set from what live runs already
 * fetched.
 *
 * Nothing is searched. Every place here comes out of `.cache/places-search`, which was
 * paid for when those searches ran, and is re-read through the SAME quality gate the
 * product uses (`mapPlacesResults`) so the demo cannot contain a place the product
 * would have rejected. What it does spend is photos: an image is a separate billable
 * request, so the run is gated behind `--confirm` and reports the bill before it.
 *
 * The output is a sibling of the bundle, never a replacement for it.
 * `data/demo_tokyo_v1/` is what the tests, the scripted scenario and the research
 * harness are built on; swapping it would break all three.
 *
 *   npm run build:demo-catalogue            # dry run: what it would do, and what it costs
 *   npm run build:demo-catalogue -- --confirm
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { roleCapacity, capacitySummary } from '../src/domain/plan/roleCapacity.ts'
import { DEFAULT_STOPS_PER_DAY } from '../src/domain/plan/dayRoles.ts'
import { mapPlacesResults, type PlacesResult } from '../src/services/places/retrieval.ts'
import type { DemoPlace } from '../src/services/places/types.ts'
import { photoIsCached, photoMedia } from '../server/places.ts'
import { BRIEFS_FILE, withBrief, type StoredBriefs } from './enrich/apply_poi_briefs.ts'

const CONFIRMED = process.argv.includes('--confirm')
const ROOT = resolve(import.meta.dirname, '..')
const CACHE = resolve(ROOT, '.cache/places-search')
const OUT = resolve(ROOT, 'data/demo_retrieved_v1/places.json')

/** The trip the prototype opens with, so the set is measured against a real shape. */
const TRIP_DAYS = 5
/** Width the itinerary asks for; the only one worth inlining. */
const PHOTO_WIDTH = 480

/**
 * Every place the cached searches ever returned, through the product's own gate.
 *
 * Duplicates across searches are dropped by the gate, so what comes back is the set a
 * trip could have been planned from.
 */
function cachedPlaces(): DemoPlace[] {
  if (!existsSync(CACHE)) return []

  const results: PlacesResult[] = []
  for (const file of readdirSync(CACHE).filter((name) => name.endsWith('.json'))) {
    try {
      const data = JSON.parse(readFileSync(join(CACHE, file), 'utf8'))
      const places = Array.isArray(data) ? data : (data.places ?? [])
      results.push(...(places as PlacesResult[]))
    } catch {
      // A half-written cache entry is not worth failing a build over.
    }
  }

  // The same place is often cached more than once, from field masks of different
  // ages — before photos were asked for, before `editorialSummary` was. The gate
  // keeps the first copy of a place, so the most complete copy goes first.
  const completeness = (result: PlacesResult) =>
    2 * Number(Boolean(result.editorialSummary?.text)) + Number((result.photos?.length ?? 0) > 0)
  results.sort((a, b) => completeness(b) - completeness(a))

  return mapPlacesResults(results).places
}

/**
 * The last live run's places, exactly as that run mapped them.
 *
 * Preferred over the cache for two reasons the cache cannot supply. It knows which
 * search found each place, so a place whose category comes only from its search —
 * an udon counter Google calls just `restaurant` — survives the gate here and is
 * rejected when its raw response is re-read without that context. And it carries
 * the traveller's words each place was found for (`foundFor`), which the app
 * re-checks against the trip's State before quoting: a trip written in other words
 * simply shows none.
 */
function lastRunPlaces(): DemoPlace[] {
  const file = resolve(ROOT, 'research-out/retrieved_places.json')
  if (!existsSync(file)) return []
  return JSON.parse(readFileSync(file, 'utf8')) as DemoPlace[]
}

const lastRun = lastRunPlaces()
const lastRunIds = new Set(lastRun.map((place) => place.placeId))
const all = [...lastRun, ...cachedPlaces().filter((place) => !lastRunIds.has(place.placeId))]
const photographed = all.filter((place) => place.photo)

console.log('\nDemo catalogue, from what live runs already fetched\n')
console.log(`  places in the cache      : ${all.length}`)
console.log(`  of those, with a photo   : ${photographed.length}`)
console.log(`  with a Places summary    : ${photographed.filter((place) => place.shortDescription).length}`)
console.log(`  with the traveller words : ${photographed.filter((place) => place.foundFor).length}`)

const capacities = roleCapacity({
  places: photographed,
  days: TRIP_DAYS,
  stopsPerDay: DEFAULT_STOPS_PER_DAY,
})
const summary = capacitySummary(capacities, photographed.length)

console.log(`  a ${DEFAULT_STOPS_PER_DAY}-stop, ${TRIP_DAYS}-day trip needs ${summary.needed} distinct places`)
for (const capacity of capacities) {
  const mark = capacity.short > 0 ? `SHORT ${capacity.short}` : 'ok'
  console.log(`    ${capacity.role.id.padEnd(18)} ${String(capacity.available).padStart(3)} available   ${mark}`)
}

/**
 * Photos already on disk cost nothing; the rest are a billable request each.
 *
 * Asked of the cache, never of `photoMedia` — which would fetch the very photos it
 * was being asked to count, turning the dry run into the bill it exists to preview.
 */
const already = photographed.filter((place) => photoIsCached(place.photo!.name, PHOTO_WIDTH))
const toFetch = photographed.filter((place) => !photoIsCached(place.photo!.name, PHOTO_WIDTH))

console.log(`\n  photos already on disk   : ${already.length}`)
console.log(`  photos still to fetch    : ${toFetch.length}  <- billable, one request each`)

if (!CONFIRMED) {
  console.log('\n  DRY RUN — nothing was fetched and nothing was written.')
  console.log('  Add --confirm to build it.\n')
  process.exit(0)
}

// --- building it -------------------------------------------------------------
console.log('\n  fetching…')
const out: DemoPlace[] = []
let fetched = 0
let missing = 0

for (const place of photographed) {
  const photo = await photoMedia({ name: place.photo!.name, maxWidthPx: PHOTO_WIDTH }).catch(() => null)
  if (!photo) {
    // A reference Places will not serve. The place keeps its monogram rather than
    // being dropped — it is still a real, plannable stop.
    missing++
    out.push({ ...place, photo: undefined })
    continue
  }
  if (!photo.cached) fetched++

  out.push({
    ...place,
    photo: {
      ...place.photo!,
      // Inlined, because the prototype is one file with no server to ask.
      src: `data:${photo.contentType};base64,${photo.body.toString('base64')}`,
    },
  })
}

// Enrichment lives in its own store and is re-applied here, so rebuilding the
// catalogue never throws a POI Brief away.
const briefs: StoredBriefs = existsSync(BRIEFS_FILE) ? JSON.parse(readFileSync(BRIEFS_FILE, 'utf8')) : {}
const enriched = out.map((place) => withBrief(place, briefs))

mkdirSync(resolve(OUT, '..'), { recursive: true })
writeFileSync(OUT, JSON.stringify(enriched, null, 2))

const bytes = Buffer.byteLength(JSON.stringify(enriched))
console.log(`\n  ${fetched} photos fetched, ${missing} references Places would not serve`)
console.log(`  wrote data/demo_retrieved_v1/places.json  ${(bytes / 1024 / 1024).toFixed(1)} MB`)
console.log(`  ${out.length} places, ${out.filter((place) => place.photo).length} photographed\n`)
