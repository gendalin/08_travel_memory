/**
 * build_candidate_memories.ts
 *
 * Responsibilities:
 *   - derive candidate memories from evidence
 *   - never activate memory
 *   - retain sourceRefs
 *   - keep confidence separate from status
 *
 * Hard rules:
 *   - status is always "candidate"; activation is a product-runtime decision
 *   - confidence is independent from status: 0.9 is still a candidate
 *   - every memory carries provenance with at least one valid evidence id
 *   - one saved place is weak evidence; repeated categories are stronger
 *
 * Two families of memory are derived:
 *
 *   1. Behavioural — pace, start time, stop count, spatial range. From EXIF
 *      timestamps and GPS alone, over well-documented days.
 *
 *   2. Interest trends — repeated categories across photos, screenshots and
 *      saved places. A category must clear MIN_CATEGORY_SUPPORT before it
 *      counts, and only the top TOP_CATEGORIES are emitted.
 *
 *   Never infer identity of people, relationships, or sensitive traits.
 *
 * Every emitted memory carries `kind`, `subject`, `polarity` and `strength`
 * alongside `confidence`, because the two numbers answer different questions:
 *
 *   confidence — how sure are we this is true? Support count, how many
 *                independent evidence kinds agree, discounted for a weak
 *                classification route. Orders the review queue (§10.2).
 *   strength   — how much does the traveller appear to care? Support relative to
 *                their own strongest signal. This is the planning weight.
 *
 * They diverge in practice: five category trends whose confidences sit between
 * 0.56 and 0.90 have strengths between 0.17 and 1.00, because confidence
 * saturates on ten observations while strength keeps separating.
 *
 * Only `preference` and `pattern` are emitted. Nothing in a photo, a screenshot
 * or a saved place licenses inferring a dietary rule, an aversion, or who
 * someone travels with — and §10 forbids inferring sensitive traits. Those kinds
 * reach Memory by the user saying so (§6.2), not by inference here.
 */

import { recencyWeights } from './evidenceWeight.ts'
import { median } from './geo.ts'
import {
  CATEGORY_BY_ID,
  MIN_CATEGORY_SUPPORT,
  TOP_CATEGORIES,
  UNCLASSIFIED,
} from './taxonomy.ts'
import { qualifyingDays, summarizeDays, type DaySummary } from './build_user_context.ts'
import {
  makeId,
  PATHS,
  readJson,
  relPath,
  writeJson,
  type CandidateMemory,
  type EvidenceRecord,
} from './types.ts'

/** Minimum repeated observations (days) before a pattern is worth emitting at all. */
export const MIN_SUPPORT = 3

/** Before this hour, a day counts as an early start. */
const EARLY_START_HOUR = 9
/** Below this daily span, a day counts as spent in a compact area. Wording only. */
const COMPACT_SPAN_M = 2000
/** How far a day's span may sit from the median and still count as consistent. */
const SPAN_TOLERANCE = 0.5

/**
 * Confidence scales with how consistently the pattern holds and how many days
 * back it. It is capped below 1.0: a deterministic rule over a photo subset is
 * evidence, not proof. Confidence never implies activation.
 */
function confidenceFrom(consistency: number, supportingDays: number): number {
  const supportFactor = Math.min(1, supportingDays / 5)
  return Math.round(Math.min(0.9, 0.35 + 0.45 * consistency * supportFactor) * 100) / 100
}

type Derived = Omit<CandidateMemory, 'id' | 'status'>

const round2 = (value: number): number => Math.round(value * 100) / 100

function deriveMemories(days: DaySummary[]): Derived[] {
  const memories: Derived[] = []
  if (days.length < MIN_SUPPORT) return memories

  // --- start time -----------------------------------------------------------
  const earlyDays = days.filter((day) => day.startMinutes < EARLY_START_HOUR * 60)
  const medianStart = median(days.map((day) => day.startMinutes))
  if (earlyDays.length >= MIN_SUPPORT && medianStart !== null && medianStart < EARLY_START_HOUR * 60) {
    const hh = String(Math.floor(medianStart / 60)).padStart(2, '0')
    const mm = String(Math.round(medianStart % 60)).padStart(2, '0')
    memories.push({
      text: `Tends to start the day early — first photo typically around ${hh}:${mm}`,
      kind: 'pattern',
      subject: { facet: 'start_minutes', value: Math.round(medianStart) },
      polarity: 1,
      // A pattern's strength is how consistently it holds: a rhythm kept on two
      // days in three shapes a plan less than one kept every day.
      strength: round2(earlyDays.length / days.length),
      confidence: confidenceFrom(earlyDays.length / days.length, earlyDays.length),
      provenance: {
        type: 'photo_timestamps',
        sourceRefs: earlyDays.map((day) => day.firstEvidenceId),
      },
    })
  }

  // --- spatial range --------------------------------------------------------
  //
  // Emitted for ANY median span, not only a compact one. The old gate only fired
  // below two kilometres, so a traveller who ranges widely produced no spatial
  // memory at all — and the measured span is exactly the number a geographic
  // budget needs. "Compact" is a judgement; "a day spans 5.6 km" is the
  // measurement, and it is useful either way. Only the wording adapts.
  const daysWithSpan = days.filter((day) => day.spanM > 0)
  const medianSpan = median(daysWithSpan.map((day) => day.spanM))
  if (daysWithSpan.length >= MIN_SUPPORT && medianSpan !== null) {
    // Consistency is measured against the median the memory actually carries, so
    // strength says how reliably THIS span holds rather than how often some
    // separate threshold was met.
    const consistentDays = daysWithSpan.filter(
      (day) => Math.abs(day.spanM - medianSpan) <= medianSpan * SPAN_TOLERANCE,
    )
    const compact = medianSpan < COMPACT_SPAN_M

    memories.push({
      text: compact
        ? `Keeps each day within a compact area — median ${(medianSpan / 1000).toFixed(1)} km between the furthest points of a day`
        : `Ranges across the city within a day — median ${(medianSpan / 1000).toFixed(1)} km between the furthest points of a day`,
      kind: 'pattern',
      subject: { facet: 'day_span_metres', value: Math.round(medianSpan) },
      polarity: 1,
      strength: round2(consistentDays.length / daysWithSpan.length),
      confidence: confidenceFrom(consistentDays.length / daysWithSpan.length, consistentDays.length),
      provenance: {
        type: 'photo_gps',
        sourceRefs: daysWithSpan.flatMap((day) => day.evidenceIds),
      },
    })
  }

  // --- pace -----------------------------------------------------------------
  const daysWithStops = days.filter((day) => day.stops > 0)
  const medianStops = median(daysWithStops.map((day) => day.stops))
  if (daysWithStops.length >= MIN_SUPPORT && medianStops !== null) {
    const rounded = Math.round(medianStops)
    const consistency =
      daysWithStops.filter((day) => Math.abs(day.stops - medianStops) <= 1).length /
      daysWithStops.length
    memories.push({
      text: `Moves at an unhurried pace — around ${rounded} distinct stop${rounded === 1 ? '' : 's'} on a typical day`,
      kind: 'pattern',
      subject: { facet: 'stops_per_day', value: rounded },
      polarity: 1,
      strength: round2(consistency),
      confidence: confidenceFrom(consistency, daysWithStops.length),
      provenance: {
        type: 'photo_gps',
        sourceRefs: daysWithStops.map((day) => day.firstEvidenceId),
      },
    })
  }

  return memories
}

/** How the evidence behind a trend is phrased, per kind. */
const KIND_LABEL: Record<string, string> = {
  photo: 'photo',
  screenshot: 'saved screenshot',
  saved_place: 'saved place',
}

export interface CategoryTrend {
  category: string
  /** Plain count of supporting records. Gates whether the trend is emitted at all. */
  support: number
  /**
   * Support after recency weighting. This is what strength and confidence read:
   * whether a trend is worth emitting is a question about how often it was seen,
   * but how much it should matter is a question about when.
   */
  decayedSupport: number
  /** Evidence ids backing the trend, in evidence order. */
  sourceRefs: string[]
  /** Support broken down by evidence kind. */
  byKind: Record<string, number>
  /**
   * Mean per-record classification confidence, 0-1.
   *
   * Previously discarded. Every evidence record already carried one — measured
   * between 0.22 and 0.99 — so ten shaky classifications scored exactly the same
   * as ten solid ones.
   */
  classificationConfidence: number
  /**
   * Fraction of documented travel days on which this category appeared, or null
   * when no dated photo supports it.
   *
   * Photos only, and deliberately: a screenshot's timestamp is when the traveller
   * SAVED something, not a day they were out, and a saved place carries no date at
   * all. `build_user_context.ts` draws the same line for the same reason.
   */
  ratePerTravelDay: number | null
}

/**
 * Aggregates categories across all three evidence kinds.
 *
 * `context` categories (street, transit, accommodation) are excluded: they
 * describe how a day moved, not what the user likes. `unclassified` never
 * counts — that is the honest "we do not know" value, not a category.
 */
/** Distinct days on which any dated photo was taken. The denominator of a rate. */
export function travelDays(evidence: EvidenceRecord[]): Set<string> {
  return new Set(
    evidence
      .filter((record) => record.kind === 'photo' && record.observedAt)
      .map((record) => record.observedAt!.slice(0, 10)),
  )
}

export function aggregateTrends(evidence: EvidenceRecord[]): CategoryTrend[] {
  // Weights come from the WHOLE evidence set, not per bucket, so the reference
  // date and the stand-in for an undated record are the same for every trend.
  const weights = recencyWeights(evidence)
  const weightById = new Map(evidence.map((record, index) => [record.id, weights[index]]))

  const allTravelDays = travelDays(evidence)

  const buckets = new Map<string, EvidenceRecord[]>()

  for (const record of evidence) {
    const category = record.category
    if (!category || category === UNCLASSIFIED) continue
    if (!CATEGORY_BY_ID.get(category)?.interestPoint) continue

    const bucket = buckets.get(category)
    if (bucket) bucket.push(record)
    else buckets.set(category, [record])
  }

  return [...buckets.entries()]
    .map(([category, records]) => {
      const confidences = records
        .map((record) => record.categoryConfidence)
        .filter((value): value is number => typeof value === 'number')

      const daysSeen = new Set(
        records
          .filter((record) => record.kind === 'photo' && record.observedAt)
          .map((record) => record.observedAt!.slice(0, 10)),
      )

      return {
        category,
        support: records.length,
        decayedSupport:
          Math.round(
            records.reduce((sum, record) => sum + (weightById.get(record.id) ?? 1), 0) * 100,
          ) / 100,
        sourceRefs: records.map((record) => record.id),
        byKind: records.reduce<Record<string, number>>((counts, record) => {
          counts[record.kind] = (counts[record.kind] ?? 0) + 1
          return counts
        }, {}),
        // No per-record confidence at all is neither a vote of trust nor of
        // distrust, so it sits in the middle rather than being assumed good.
        classificationConfidence:
          confidences.length === 0
            ? 0.5
            : confidences.reduce((sum, value) => sum + value, 0) / confidences.length,
        ratePerTravelDay:
          allTravelDays.size === 0 || daysSeen.size === 0
            ? null
            : Math.round((daysSeen.size / allTravelDays.size) * 100) / 100,
      }
    })
    // The gate is a count question — did we see this enough times to bother? —
    // so it reads raw support. Recency decides how much it matters, not whether.
    .filter((trend) => trend.support >= MIN_CATEGORY_SUPPORT)
    .sort((a, b) => b.support - a.support || a.category.localeCompare(b.category))
    .slice(0, TOP_CATEGORIES)
}

function describeSupport(byKind: Record<string, number>): string {
  return Object.entries(byKind)
    .sort(([, a], [, b]) => b - a)
    .map(([kind, count]) => `${count} ${KIND_LABEL[kind] ?? kind}${count === 1 ? '' : 's'}`)
    .join(', ')
}

/**
 * How sure we are the trend is real.
 *
 * Rises with how much recent evidence backs it and how many independent kinds
 * agree — a category seen in photos, screenshots and saved places is a stronger
 * signal than the same count from one source — then scaled by how well those
 * records were actually classified. Capped below 1.0: a deterministic rule over a
 * subset of someone's photos is evidence, not proof. Confidence never implies
 * activation.
 *
 * The flat "came only from name lookup" discount this replaces was a crude proxy
 * for the thing `classificationConfidence` measures directly, and continuously.
 * Applying both would count the same doubt twice. The proxy was also coarse:
 * name-lookup records here average 0.78 confidence but range from 0.22 to 0.99,
 * and a 0.99 name match deserves no discount at all.
 */
function trendConfidence(trend: CategoryTrend): number {
  const supportFactor = Math.min(1, trend.decayedSupport / 10)
  const diversityFactor = Object.keys(trend.byKind).length / 3
  const raw = 0.4 + 0.35 * supportFactor + 0.15 * diversityFactor
  return round2(Math.min(0.9, raw * trend.classificationConfidence))
}

/**
 * How much the traveller appears to care, as distinct from how sure we are.
 *
 * Recency-weighted support relative to their OWN strongest signal, so the scale is
 * personal: the thing they come back to most sits at 1.0 and everything else is
 * read against it. Confidence cannot do this job — it saturates near ten
 * observations, so eighteen sushi items and ten izakaya items look almost alike
 * at 0.90 and 0.85, while strength keeps separating them.
 *
 * Reading decayed rather than raw support is what lets a drifting taste fade:
 * izakaya's evidence is older than sushi's, so it loses more to decay than the
 * raw counts alone would suggest.
 */
function trendStrength(trend: CategoryTrend, strongestSupport: number): number {
  return round2(trend.decayedSupport / strongestSupport)
}

function deriveTrendMemories(evidence: EvidenceRecord[]): Derived[] {
  const trends = aggregateTrends(evidence)
  // Sorted by raw support, so the strongest DECAYED support has to be taken
  // across the set rather than read off the first entry.
  const strongestSupport = Math.max(1, ...trends.map((trend) => trend.decayedSupport))

  return trends.map((trend) => {
    const label = CATEGORY_BY_ID.get(trend.category)?.labelEn ?? trend.category
    return {
      text: `Repeatedly drawn to ${label.toLowerCase()} — ${trend.support} items (${describeSupport(trend.byKind)})`,
      kind: 'preference' as const,
      subject: { facet: 'category' as const, value: trend.category },
      polarity: 1 as const,
      strength: trendStrength(trend, strongestSupport),
      confidence: trendConfidence(trend),
      // How often the traveller actually did this, per documented travel day.
      // Absent when no dated photo backs the trend, in which case the planner
      // falls back to its heuristic rather than inventing a rate.
      ...(trend.ratePerTravelDay === null
        ? {}
        : { scope: { ratePerDay: trend.ratePerTravelDay } }),
      provenance: {
        type: `category_trend:${trend.category}`,
        sourceRefs: trend.sourceRefs,
      },
    }
  })
}

export function buildCandidateMemories(evidence: EvidenceRecord[]): CandidateMemory[] {
  // Sparse days are excluded for the same reason as in user context: they would
  // shift every figure without describing any actual travel behaviour.
  const days = qualifyingDays(summarizeDays(evidence))

  // Interest trends first: they are the stronger, more actionable signal.
  return [...deriveTrendMemories(evidence), ...deriveMemories(days)].map((memory, index) => ({
    ...memory,
    id: makeId('mem', index + 1),
    status: 'candidate',
  }))
}

/** Guards the invariants the validator also enforces, so a bad run fails early. */
export function assertMemoryInvariants(
  memories: CandidateMemory[],
  evidence: EvidenceRecord[],
): void {
  const evidenceIds = new Set(evidence.map((record) => record.id))
  for (const memory of memories) {
    if (memory.status !== 'candidate') {
      throw new Error(`${memory.id}: preprocessing may only emit status "candidate"`)
    }
    if (!memory.provenance || memory.provenance.sourceRefs.length === 0) {
      throw new Error(`${memory.id}: missing provenance sourceRefs`)
    }
    for (const ref of memory.provenance.sourceRefs) {
      if (!evidenceIds.has(ref)) {
        throw new Error(`${memory.id}: sourceRef "${ref}" does not exist in evidence.json`)
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const evidence = readJson<EvidenceRecord[]>(PATHS.out.evidence)
  const memories = buildCandidateMemories(evidence)
  assertMemoryInvariants(memories, evidence)
  writeJson(PATHS.out.memories, memories)
  console.log(`candidate memories: ${memories.length} -> ${relPath(PATHS.out.memories)}`)
}
