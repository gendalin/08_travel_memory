/**
 * POI enrichment for the Tokyo demo catalogue (poi_enrichment_spec).
 *
 *   existing POI -> Google identity + website -> web sources -> evidence
 *                -> OpenAI structured brief -> validate -> cached result
 *
 * THIS SPENDS MONEY per POI: one Place Details call (Enterprise), one web search, one
 * model call. Every step is cached, so a re-run — or a resumed run — pays only for
 * what it has not done. A POI already enriched from the same inputs is skipped
 * unless `--force`.
 *
 *   npm run enrich:pois -- --dry-run                  # what it would do, no calls
 *   npm run enrich:pois -- --only "21_21 Design Sight|KONCENT"   # names or ids, | between
 *   npm run enrich:pois -- --limit 5 --report research-out/poi_pilot_report.md
 *
 * Writes results to .cache/poi_enrichment/results and, with `--report`, a report.
 * It does not write the dataset: folding briefs into places.json is a separate,
 * later step (spec Task 6).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { DemoPlace } from '../../src/services/places/types.ts'
import { REPO_ROOT } from '../preprocess/types.ts'
import { cacheKey } from './cache.ts'
import { discoverSources } from './discover_poi_sources.ts'
import { fetchEvidence } from './fetch_poi_evidence.ts'
import { fetchPlaceDetails } from './fetch_place_details.ts'
import { generateBrief } from './generate_poi_brief.ts'
import { readResult, writeResult, type EnrichmentResult } from './result.ts'
import { validateAll, validateResult } from './validate_poi_enrichment.ts'
import { enrichmentReport, writeEnrichmentReport } from './write_enrichment_report.ts'

const DATASET = resolve(REPO_ROOT, 'data/demo_retrieved_v1/places.json')

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index > -1 ? process.argv[index + 1] : undefined
}

const DRY_RUN = process.argv.includes('--dry-run')
const FORCE = process.argv.includes('--force')
const only = argValue('--only')?.split('|').map((entry) => entry.trim().toLowerCase()).filter(Boolean)
const limit = argValue('--limit') ? Number(argValue('--limit')) : undefined
const reportPath = argValue('--report')

const places = JSON.parse(readFileSync(DATASET, 'utf8')) as DemoPlace[]

let selected = only
  ? places.filter((place) => only.includes(place.placeId.toLowerCase()) || only.includes(place.name.toLowerCase()))
  : places
if (only && selected.length !== only.length) {
  const found = new Set(selected.flatMap((place) => [place.placeId.toLowerCase(), place.name.toLowerCase()]))
  console.error(`  not in the dataset: ${only.filter((entry) => !found.has(entry)).join(', ')}`)
  process.exit(1)
}
if (limit !== undefined) selected = selected.slice(0, limit)

/** What a result depends on. The model and prompt are covered by `--force`. */
function inputsKeyOf(place: DemoPlace): string {
  return cacheKey({ id: place.placeId, name: place.name, category: place.category, neighborhood: place.neighborhood })
}

console.log(`\nPOI enrichment — ${selected.length} of ${places.length} POIs from data/demo_retrieved_v1/places.json\n`)

if (DRY_RUN) {
  const todo = selected.filter((place) => FORCE || readResult(place.placeId)?.inputsKey !== inputsKeyOf(place))
  console.log(`  already enriched from the same inputs : ${selected.length - todo.length}`)
  console.log(`  to enrich                             : ${todo.length}`)
  console.log('  per POI, at most: 1 Place Details call (Enterprise), 1 web search, 1 model call')
  console.log('  (each is cached; a repeat costs nothing)\n  DRY RUN — nothing was called.\n')
  process.exit(0)
}

async function enrichOne(place: DemoPlace): Promise<EnrichmentResult> {
  const base = {
    placeId: place.placeId,
    name: place.name,
    category: place.category,
    inputsKey: inputsKeyOf(place),
    enrichedAt: new Date().toISOString(),
  }

  try {
    const details = await fetchPlaceDetails(place.placeId)
    const { query, candidates } = await discoverSources(place, details)
    const { evidence, skipped } = await fetchEvidence({ place, details, candidates, now: base.enrichedAt })
    const common = {
      ...base,
      skipped,
      searchQuery: query,
      ...(details.websiteUri ? { officialWebsite: details.websiteUri } : {}),
    }

    if (evidence.length === 0) {
      return { ...common, status: 'failed', failure: 'no usable source could be tied to this place', evidence: [] }
    }

    const generated = await generateBrief({
      place: { ...place, userRatingCount: place.userRatingCount ?? details.userRatingCount },
      ...(details.nameJa ? { nameJa: details.nameJa } : {}),
      ...(details.address ? { address: details.address } : {}),
      evidence,
    })
    return {
      ...common,
      status: 'enriched',
      shortDescription: generated.shortDescription,
      brief: generated.brief,
      modelConfidence: generated.modelConfidence,
      evidence: generated.evidence,
      ungroundedNumbers: generated.ungroundedNumbers,
      offeredNotCited: evidence
        .map((entry) => entry.record.sourceUrl)
        .filter((url) => !generated.evidence.some((record) => record.sourceUrl === url)),
    }
  } catch (error) {
    return {
      ...base,
      status: 'failed',
      failure: error instanceof Error ? error.message : String(error),
      evidence: [],
      skipped: [],
    }
  }
}

function print(result: EnrichmentResult): void {
  console.log(`\n=== ${result.name}  [${result.category}]  ${result.status.toUpperCase()}`)
  if (result.officialWebsite) console.log(`  official site (Places): ${result.officialWebsite}`)
  if (result.status === 'failed') console.log(`  failure: ${result.failure}`)
  if (result.brief) {
    const brief = result.brief
    console.log(`  short     : ${result.shortDescription}`)
    console.log(`  overview  : ${brief.overview}`)
    console.log(`  atmosphere: ${brief.atmosphere.join(', ')}`)
    console.log(`  knownFor  : ${brief.knownFor.join('; ')}`)
    console.log(`  goodFor   : ${brief.goodFor.join('; ')}`)
    console.log(`  signals   : cultural=[${brief.decisionSignals.cultural}] experience=[${brief.decisionSignals.experience}] setting=[${brief.decisionSignals.setting}] mainstreamness=${brief.decisionSignals.mainstreamness ?? '-'}`)
    console.log(`  confidence: ${brief.descriptionConfidence} (model said ${result.modelConfidence})`)
    for (const source of brief.descriptionSources) console.log(`  source    : ${source.type.padEnd(16)} ${source.url}`)
  }
  for (const url of result.offeredNotCited ?? []) console.log(`  not cited : ${url} — given to the model, not drawn on`)
  for (const entry of result.skipped) console.log(`  not used  : ${entry.url} — ${entry.reason}`)
  for (const issue of validateResult(result)) console.log(`  ${issue.level === 'error' ? 'ERROR' : 'warn '}     : ${issue.message}`)
}

const results: EnrichmentResult[] = []
for (const place of selected) {
  const previous = readResult(place.placeId)
  if (!FORCE && previous && previous.status === 'enriched' && previous.inputsKey === inputsKeyOf(place)) {
    results.push(previous)
    print(previous)
    continue
  }
  const result = await enrichOne(place)
  writeResult(result)
  results.push(result)
  print(result)
}

const issues = validateAll(results)
const errors = issues.filter((issue) => issue.level === 'error').length
console.log(`\n  ${results.filter((result) => result.status === 'enriched').length} enriched, ${results.filter((result) => result.status === 'failed').length} failed · ${errors} validation errors, ${issues.length - errors} warnings`)

if (reportPath) {
  writeEnrichmentReport(
    resolve(REPO_ROOT, reportPath),
    enrichmentReport({ title: 'Tokyo POI Enrichment — pilot', results, issues, includeBriefs: true }),
  )
  console.log(`  report -> ${reportPath}`)
}
console.log('')
