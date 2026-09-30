/**
 * The POI Brief: what a place IS, from sources outside the product (poi_enrichment_spec).
 *
 * Kept apart from recommendation rationale on purpose. A brief answers "what is this
 * place?" and is the same for every trip; why a place suits THIS trip is worked out at
 * plan time from State, Memory and the day (`explainStop`), and never stored here.
 *
 *   Google Places identifies the place. Web research explains it. The model
 *   structures the explanation — from the supplied evidence only.
 *
 * Source URLs and source types come from code, never from the model: the model is
 * given evidence and returns prose and tags, and the sources are attached afterwards
 * from the evidence it was given.
 */

export type PoiSourceType =
  | 'official_website'
  | 'official_tourism'
  | 'institutional'
  | 'editorial'
  | 'other_trusted'

export const POI_SOURCE_TYPES: readonly PoiSourceType[] = [
  'official_website',
  'official_tourism',
  'institutional',
  'editorial',
  'other_trusted',
]

export type DescriptionConfidence = 'low' | 'medium' | 'high'
export type Mainstreamness = 'low' | 'medium' | 'high'

export interface PoiDescriptionSource {
  url: string
  type: PoiSourceType
  title?: string
}

export interface PoiDecisionSignals {
  cultural: string[]
  experience: string[]
  setting: string[]
  /** From review volume, measured — not a judgement the model makes. */
  mainstreamness?: Mainstreamness
}

/** Stored on a place as `poiBrief`. The one-line summary lives in `shortDescription`. */
export interface PoiBrief {
  overview: string
  atmosphere: string[]
  knownFor: string[]
  goodFor: string[]
  decisionSignals: PoiDecisionSignals
  descriptionSources: PoiDescriptionSource[]
  descriptionConfidence: DescriptionConfidence
}

/** One piece of evidence a brief was written from. Compact: never a page copy. */
export interface PoiEnrichmentEvidence {
  poiId: string
  sourceUrl: string
  sourceType: PoiSourceType
  title?: string
  /** A short excerpt of what the page says, for inspection. */
  extractedSummary: string
  fetchedAt: string
  /**
   * How the page was tied to this place. A page that cannot be tied to it is not
   * evidence for it, and validation fails a brief that cites one.
   */
  identity: 'official_website' | 'name_on_page'
}

export interface ValidationIssue {
  poiId: string
  level: 'error' | 'warning'
  message: string
}

const CONFIDENCE = new Set<string>(['low', 'medium', 'high'])

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Checks one enriched place (poi_enrichment_spec §16).
 *
 * Errors make a brief unusable; warnings are reported and kept. `evidence` is what
 * the brief's sources must be backed by — a cited URL with no identity-checked
 * evidence behind it for this place is "a source assigned to the wrong POI".
 */
export function validatePoiEnrichment(input: {
  placeId: string | undefined
  shortDescription: string | undefined
  brief: PoiBrief | undefined
  evidence: readonly PoiEnrichmentEvidence[]
}): ValidationIssue[] {
  const poiId = input.placeId ?? '(missing)'
  const issues: ValidationIssue[] = []
  const error = (message: string) => issues.push({ poiId, level: 'error', message })
  const warn = (message: string) => issues.push({ poiId, level: 'warning', message })

  if (!input.placeId) error('missing placeId')
  if (!input.shortDescription?.trim()) error('empty shortDescription')

  const brief = input.brief
  if (!brief) {
    error('no brief')
    return issues
  }

  if (!brief.overview?.trim()) error('empty overview')
  if (!CONFIDENCE.has(brief.descriptionConfidence)) error('missing confidence')
  const mainstreamness = brief.decisionSignals?.mainstreamness
  if (mainstreamness !== undefined && !CONFIDENCE.has(mainstreamness)) {
    error(`invalid mainstreamness "${mainstreamness}"`)
  }

  const sources = brief.descriptionSources ?? []
  if (sources.length === 0) error('missing descriptionSources')
  for (const source of sources) {
    if (!isHttpUrl(source.url)) error(`invalid source URL "${source.url}"`)
    if (!POI_SOURCE_TYPES.includes(source.type)) error(`unsupported source type "${source.type}"`)
    const backing = input.evidence.find(
      (entry) => entry.sourceUrl === source.url && entry.poiId === input.placeId,
    )
    if (!backing) error(`source not backed by evidence for this POI: ${source.url}`)
  }

  const strong = sources.filter((source) => source.type !== 'other_trusted')
  if (sources.length === 1 && strong.length === 0) warn('only one weak source')
  if (brief.descriptionConfidence === 'low') warn('descriptionConfidence = low')
  if (!sources.some((source) => source.type === 'official_website')) warn('no official website')
  if ((brief.knownFor ?? []).length === 0) warn('no knownFor')
  const signals = brief.decisionSignals
  if (
    !signals ||
    signals.cultural.length + signals.experience.length + signals.setting.length === 0
  ) {
    warn('no decisionSignals')
  }

  return issues
}

/** Duplicate placeIds across a dataset (§16). */
export function duplicatePlaceIds(placeIds: readonly string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const id of placeIds) {
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }
  return [...duplicates]
}
