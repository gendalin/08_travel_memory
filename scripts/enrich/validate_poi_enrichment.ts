/**
 * Validates enriched POIs (spec §16). Exits non-zero on any error.
 *
 *   npm run validate:poi-enrichment                  # every cached result
 *   npm run validate:poi-enrichment -- --only "a|b"  # by placeId or name, | between
 *
 * The rules themselves live with the type (`validatePoiEnrichment`), so the dataset,
 * this script and the tests all check the same thing. Length targets (§7) are
 * warnings: a 20-word description is not wrong, it is long.
 */

import {
  duplicatePlaceIds,
  validatePoiEnrichment,
  type ValidationIssue,
} from '../../src/services/places/poiBrief.ts'
import { allResults, type EnrichmentResult } from './result.ts'

function words(text: string | undefined): number {
  return (text ?? '').split(/\s+/).filter(Boolean).length
}

export function validateResult(result: EnrichmentResult): ValidationIssue[] {
  if (result.status === 'failed') {
    return [{ poiId: result.placeId, level: 'error', message: `enrichment failed: ${result.failure}` }]
  }
  const issues = validatePoiEnrichment({
    placeId: result.placeId,
    shortDescription: result.shortDescription,
    brief: result.brief,
    evidence: result.evidence,
  })
  const short = words(result.shortDescription)
  if (short > 0 && (short < 8 || short > 18)) {
    issues.push({ poiId: result.placeId, level: 'warning', message: `shortDescription is ${short} words (target 8-18)` })
  }
  const overview = words(result.brief?.overview)
  if (overview > 0 && (overview < 40 || overview > 80)) {
    issues.push({ poiId: result.placeId, level: 'warning', message: `overview is ${overview} words (target 40-80)` })
  }
  if ((result.ungroundedNumbers ?? []).length > 0) {
    issues.push({
      poiId: result.placeId,
      level: 'warning',
      message: `numbers not found in any cited source: ${result.ungroundedNumbers!.join(', ')}`,
    })
  }
  if ((result.brief?.goodFor ?? []).length === 0) {
    issues.push({ poiId: result.placeId, level: 'warning', message: 'no goodFor' })
  }
  return issues
}

export function validateAll(results: readonly EnrichmentResult[]): ValidationIssue[] {
  const issues = results.flatMap(validateResult)
  for (const id of duplicatePlaceIds(results.map((result) => result.placeId))) {
    issues.push({ poiId: id, level: 'error', message: 'duplicate placeId' })
  }
  return issues
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const onlyArg = process.argv.indexOf('--only')
  const only = onlyArg > -1 ? process.argv[onlyArg + 1].split('|').map((entry) => entry.trim().toLowerCase()) : undefined
  const results = allResults().filter(
    (result) => !only || only.includes(result.placeId.toLowerCase()) || only.includes(result.name.toLowerCase()),
  )

  const issues = validateAll(results)
  const errors = issues.filter((issue) => issue.level === 'error')
  const nameOf = new Map(results.map((result) => [result.placeId, result.name]))

  console.log(`\nPOI enrichment validation — ${results.length} POIs\n`)
  for (const issue of issues) {
    console.log(`  ${issue.level === 'error' ? 'ERROR' : 'warn '}  ${nameOf.get(issue.poiId) ?? issue.poiId}: ${issue.message}`)
  }
  console.log(`\n  ${errors.length} errors, ${issues.length - errors.length} warnings\n`)
  process.exit(errors.length > 0 ? 1 : 0)
}
