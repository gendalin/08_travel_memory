/**
 * Photos for the curated bundle (data/demo_tokyo_v1/tokyo_places.json).
 *
 * The thirty-four bundled places were curated before photos existed, so any trip
 * planned from them — a stubbed run, the E2E suite, and every live run that falls
 * back to the bundle — showed a monogram for every stop. Retrieved places carry a
 * photo reference from their own search; these never had one.
 *
 * For each place this searches its name near the coordinates we already hold, and
 * takes a result's first credited photo ONLY when that result is the same place:
 * within MATCH_METRES of our coordinates and sharing a word of its name (or within
 * CLOSE_METRES, where a name written differently — "Sensō-ji" / "Senso-ji Temple" —
 * is still the same door). A name search alone is not identity, and a photo of the
 * wrong restaurant is worse than a monogram.
 *
 * Writes only `photo: { name, attribution }` — the reference and the credit the terms
 * require. The image itself is fetched on demand through /api/photo and cached.
 *
 *   npx tsx scripts/enrich/fetch_bundle_photos.ts            # dry run, no calls
 *   npx tsx scripts/enrich/fetch_bundle_photos.ts --confirm  # one Pro search per place
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { lookupPlacePhotos } from '../../server/places.ts'
import { metresBetween } from '../../src/domain/places/geo.ts'
import type { DemoPlace } from '../../src/services/places/types.ts'
import { REPO_ROOT } from '../preprocess/types.ts'

const CONFIRMED = process.argv.includes('--confirm')
const FILE = resolve(REPO_ROOT, 'data/demo_tokyo_v1/tokyo_places.json')
const MATCH_METRES = 300
const CLOSE_METRES = 80

interface RawResult {
  displayName?: { text?: string }
  location?: { latitude?: number; longitude?: number }
  photos?: Array<{ name?: string; authorAttributions?: Array<{ displayName?: string; uri?: string }> }>
}

const words = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !['the', 'tokyo', 'and', 'cafe', 'shop'].includes(word))

function samePlace(ours: DemoPlace, result: RawResult): number | undefined {
  const lat = result.location?.latitude
  const lng = result.location?.longitude
  if (typeof lat !== 'number' || typeof lng !== 'number') return undefined
  const metres = metresBetween(ours, { lat, lng })
  const shared = words(ours.name).some((word) => words(result.displayName?.text ?? '').includes(word))
  if (metres <= CLOSE_METRES || (metres <= MATCH_METRES && shared)) return metres
  return undefined
}

function creditedPhoto(result: RawResult): DemoPlace['photo'] | undefined {
  for (const photo of result.photos ?? []) {
    const author = photo.authorAttributions?.find((entry) => entry.displayName)
    if (photo.name && author?.displayName) {
      return { name: photo.name, attribution: { name: author.displayName, ...(author.uri ? { uri: author.uri } : {}) } }
    }
  }
  return undefined
}

async function main() {
  const places = JSON.parse(readFileSync(FILE, 'utf8')) as DemoPlace[]
  const wanted = places.filter((place) => place.category !== 'accommodation' && !place.photo)

  console.log(`\nBundle photos: ${wanted.length} of ${places.length} places have none.`)
  console.log(`Bills at: up to ${wanted.length} Text Search (Pro) calls — cached, so a re-run is free.`)
  console.log('Images are fetched later, on demand, one billable request each, then cached.\n')
  if (!CONFIRMED) {
    for (const place of wanted) console.log(`  ${place.placeId.padEnd(26)} "${place.name}" near ${place.lat}, ${place.lng}`)
    console.log('\nDRY RUN — nothing was called. Add --confirm to look these up.\n')
    return
  }

  let found = 0
  let billed = 0
  const missed: string[] = []
  for (const place of wanted) {
    const response = await lookupPlacePhotos({ name: `${place.name}, ${place.neighborhood}`, near: place })
    if (!response.cached) billed++
    const match = (response.places as RawResult[])
      .map((result) => ({ result, metres: samePlace(place, result) }))
      .filter((entry) => entry.metres !== undefined)
      .sort((a, b) => a.metres! - b.metres!)[0]
    const photo = match ? creditedPhoto(match.result) : undefined
    if (photo) {
      place.photo = photo
      found++
      console.log(`  ✓ ${place.name} ← "${match!.result.displayName?.text}" (${Math.round(match!.metres!)} m)`)
    } else {
      missed.push(place.name)
      const nearest = (response.places as RawResult[])[0]
      console.log(`  ✗ ${place.name} — ${match ? 'matched, but no credited photo' : `no same-place match (first: "${nearest?.displayName?.text ?? 'none'}")`}`)
    }
  }

  writeFileSync(FILE, JSON.stringify(places, null, 2) + '\n')
  console.log(`\n${found}/${wanted.length} photographed; ${billed} billed searches.`)
  if (missed.length > 0) console.log(`No photo (monogram stays): ${missed.join(', ')}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
