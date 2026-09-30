/**
 * Folds validated POI Briefs into the demo catalogue.
 *
 *   npm run apply:poi-briefs
 *
 * Reads the cached enrichment results, keeps only those that pass validation with no
 * errors, and writes:
 *
 *   data/demo_retrieved_v1/poi_briefs.json               placeId -> { shortDescription, poiBrief }
 *   data/demo_retrieved_v1/poi_enrichment_evidence.json  the compact evidence behind them
 *
 * then applies the briefs to data/demo_retrieved_v1/places.json. `poi_briefs.json` is
 * the durable store: `build_demo_catalogue` re-applies it whenever it rebuilds
 * places.json, so a rebuild never throws enrichment away.
 *
 * Nothing is called; no cost.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { PoiBrief, PoiEnrichmentEvidence } from '../../src/services/places/poiBrief.ts'
import type { DemoPlace } from '../../src/services/places/types.ts'
import { REPO_ROOT } from '../preprocess/types.ts'
import { allResults } from './result.ts'
import { validateResult } from './validate_poi_enrichment.ts'

export const BRIEFS_FILE = resolve(REPO_ROOT, 'data/demo_retrieved_v1/poi_briefs.json')
const EVIDENCE_FILE = resolve(REPO_ROOT, 'data/demo_retrieved_v1/poi_enrichment_evidence.json')
const PLACES_FILE = resolve(REPO_ROOT, 'data/demo_retrieved_v1/places.json')

export type StoredBriefs = Record<string, { shortDescription: string; poiBrief: PoiBrief }>

/** A place with its brief applied, when the store has one. */
export function withBrief(place: DemoPlace, briefs: StoredBriefs): DemoPlace {
  const stored = briefs[place.placeId]
  return stored ? { ...place, shortDescription: stored.shortDescription, poiBrief: stored.poiBrief } : place
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const usable = allResults().filter(
    (result) =>
      result.status === 'enriched' &&
      result.brief &&
      result.shortDescription &&
      !validateResult(result).some((issue) => issue.level === 'error'),
  )

  const briefs: StoredBriefs = Object.fromEntries(
    usable
      .sort((a, b) => a.placeId.localeCompare(b.placeId))
      .map((result) => [result.placeId, { shortDescription: result.shortDescription!, poiBrief: result.brief! }]),
  )
  const evidence: PoiEnrichmentEvidence[] = usable.flatMap((result) => result.evidence)

  writeFileSync(BRIEFS_FILE, JSON.stringify(briefs, null, 2))
  writeFileSync(EVIDENCE_FILE, JSON.stringify(evidence, null, 2))

  const places = JSON.parse(readFileSync(PLACES_FILE, 'utf8')) as DemoPlace[]
  const applied = places.filter((place) => briefs[place.placeId]).length
  writeFileSync(PLACES_FILE, JSON.stringify(places.map((place) => withBrief(place, briefs)), null, 2))

  console.log(`\n  ${usable.length} validated briefs -> data/demo_retrieved_v1/poi_briefs.json`)
  console.log(`  ${evidence.length} evidence records -> data/demo_retrieved_v1/poi_enrichment_evidence.json`)
  console.log(`  applied to ${applied} of ${places.length} places in data/demo_retrieved_v1/places.json\n`)
}
