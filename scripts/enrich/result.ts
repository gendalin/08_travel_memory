/** One place's enrichment outcome, as the pipeline caches it (resumable, §21 Task 6). */

import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import type { DescriptionConfidence, PoiBrief, PoiEnrichmentEvidence } from '../../src/services/places/poiBrief.ts'
import { ENRICH_CACHE, fileSafe, readCache, writeCache } from './cache.ts'

export interface EnrichmentResult {
  placeId: string
  name: string
  category: string
  /** What the result was computed from. A change means it is stale. */
  inputsKey: string
  status: 'enriched' | 'failed'
  failure?: string
  shortDescription?: string
  brief?: PoiBrief
  modelConfidence?: DescriptionConfidence
  evidence: PoiEnrichmentEvidence[]
  /** Numbers in the description no cited page contains. */
  ungroundedNumbers?: string[]
  /** Pages given to the model that it did not cite. */
  offeredNotCited?: string[]
  /** Candidates not used, and why — for the report. */
  skipped: Array<{ url: string; reason: string }>
  officialWebsite?: string
  searchQuery?: string
  enrichedAt: string
}

export function readResult(placeId: string): EnrichmentResult | undefined {
  return readCache<EnrichmentResult>('results', fileSafe(placeId))
}

export function writeResult(result: EnrichmentResult): void {
  writeCache('results', fileSafe(result.placeId), result)
}

export function allResults(): EnrichmentResult[] {
  const dir = join(ENRICH_CACHE, 'results')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => readCache<EnrichmentResult>('results', file.replace(/\.json$/, '')))
    .filter((result): result is EnrichmentResult => result !== undefined)
}
