/**
 * The enrichment report (spec §18): coverage, confidence, sources, and every
 * low-confidence or failed POI with its reasons — written to be read by a person.
 *
 * `includeBriefs` adds each brief in full, which is what a pilot needs for judging
 * quality; the full-dataset report leaves them out.
 */

import { writeFileSync } from 'node:fs'

import type { ValidationIssue } from '../../src/services/places/poiBrief.ts'
import type { EnrichmentResult } from './result.ts'

function count<T>(items: readonly T[], test: (item: T) => boolean): number {
  return items.filter(test).length
}

function briefSection(result: EnrichmentResult, issues: ValidationIssue[]): string[] {
  const brief = result.brief
  const lines = [`### ${result.name}`, '', `\`${result.placeId}\` · ${result.category.replace(/_/g, ' ')}`, '']
  if (!brief) {
    lines.push(`**Failed:** ${result.failure ?? 'no brief'}`, '')
  } else {
    lines.push(
      `**Short:** ${result.shortDescription}`,
      '',
      `**Overview:** ${brief.overview}`,
      '',
      `- atmosphere: ${brief.atmosphere.join(', ') || '—'}`,
      `- knownFor: ${brief.knownFor.join('; ') || '—'}`,
      `- goodFor: ${brief.goodFor.join('; ') || '—'}`,
      `- cultural: ${brief.decisionSignals.cultural.join(', ') || '—'}`,
      `- experience: ${brief.decisionSignals.experience.join(', ') || '—'}`,
      `- setting: ${brief.decisionSignals.setting.join(', ') || '—'}`,
      `- mainstreamness: ${brief.decisionSignals.mainstreamness ?? '—'}`,
      `- confidence: **${brief.descriptionConfidence}** (model said ${result.modelConfidence})`,
      '',
      'Sources:',
      ...brief.descriptionSources.map((source) => `- ${source.type}: ${source.url}${source.title ? ` — ${source.title}` : ''}`),
      '',
    )
  }
  if ((result.offeredNotCited ?? []).length > 0) {
    lines.push('Given to the model, not cited:', ...(result.offeredNotCited ?? []).map((url) => `- ${url}`), '')
  }
  if (result.skipped.length > 0) {
    lines.push('Not used:', ...result.skipped.map((entry) => `- ${entry.url} — ${entry.reason}`), '')
  }
  if (issues.length > 0) {
    lines.push('Validation:', ...issues.map((issue) => `- ${issue.level}: ${issue.message}`), '')
  }
  return lines
}

export function enrichmentReport(input: {
  title: string
  results: readonly EnrichmentResult[]
  issues: readonly ValidationIssue[]
  includeBriefs?: boolean
}): string {
  const { results, issues } = input
  const enriched = results.filter((result) => result.status === 'enriched')
  const sources = enriched.flatMap((result) => result.brief?.descriptionSources ?? [])
  const confidence = (level: string) => count(enriched, (result) => result.brief?.descriptionConfidence === level)
  const issuesFor = (placeId: string) => issues.filter((issue) => issue.poiId === placeId)

  const lines = [
    `# ${input.title}`,
    '',
    `Total POIs: ${results.length}`,
    '',
    `Enriched: ${enriched.length}`,
    `High confidence: ${confidence('high')}`,
    `Medium confidence: ${confidence('medium')}`,
    `Low confidence: ${confidence('low')}`,
    `Failed: ${results.length - enriched.length}`,
    `Validation errors: ${count(issues, (issue) => issue.level === 'error')}`,
    '',
    `Official website found: ${count(enriched, (result) => (result.brief?.descriptionSources ?? []).some((source) => source.type === 'official_website'))}`,
    `Official tourism / institutional source: ${count(enriched, (result) => (result.brief?.descriptionSources ?? []).some((source) => source.type === 'official_tourism' || source.type === 'institutional'))}`,
    `Editorial source used: ${count(enriched, (result) => (result.brief?.descriptionSources ?? []).some((source) => source.type === 'editorial'))}`,
    `Sources in total: ${sources.length}`,
    '',
  ]

  const low = enriched.filter((result) => result.brief?.descriptionConfidence === 'low')
  if (low.length > 0) {
    lines.push('## Low-confidence POIs', '')
    for (const result of low) lines.push(...briefSection(result, issuesFor(result.placeId)))
  }
  const failed = results.filter((result) => result.status === 'failed')
  if (failed.length > 0) {
    lines.push('## Failed POIs', '')
    for (const result of failed) lines.push(...briefSection(result, issuesFor(result.placeId)))
  }
  if (input.includeBriefs) {
    lines.push('## Briefs', '')
    for (const result of enriched) lines.push(...briefSection(result, issuesFor(result.placeId)))
  }
  return lines.join('\n')
}

export function writeEnrichmentReport(path: string, report: string): void {
  writeFileSync(path, report, 'utf8')
}
