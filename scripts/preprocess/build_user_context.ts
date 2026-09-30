/**
 * build_user_context.ts
 *
 * Responsibilities: derive a compact behavior summary —
 *   - typical start time
 *   - average daily stops
 *   - walking tolerance
 *   - compact vs broad area pattern
 *
 * user_context.json is summarized behavioral context, not active Memory.
 * These values must never be promoted into Memory automatically.
 *
 * Only photo evidence is used: it is the only kind carrying timestamps and
 * coordinates. Screenshots are interest signals, not behavior, and saved places
 * say nothing about how a day was actually spent.
 *
 * A field stays null when the evidence cannot support it. Nothing is guessed.
 */

import { clusterPoints, maxSpanMeters, median } from './geo.ts'
import {
  PATHS,
  readJson,
  relPath,
  writeJson,
  type EvidenceRecord,
  type GeoPoint,
  type UserContext,
} from './types.ts'

export const EMPTY_USER_CONTEXT: UserContext = {
  typicalStartTime: null,
  avgDailyStops: null,
  walkingTolerance: null,
  preferredAreaPattern: null,
  notes: [],
}

/** Fewer days than this and a "typical" figure would be an anecdote, not a pattern. */
export const MIN_DAYS = 3

/**
 * A day only describes travel behaviour if it was actually documented. One
 * incidental photo at 21:21 is not a day that "started at 21:21", and a day
 * with no movement between photos says nothing about pace or range — counting
 * either would drag every median toward whichever days happen to be sparse.
 */
export const MIN_PHOTOS_PER_DAY = 3
export const MIN_STOPS_PER_DAY = 2

export interface DaySummary {
  /** Local calendar date, YYYY-MM-DD. */
  date: string
  /** Local time of the first photo that day, HH:MM. */
  startTime: string
  startMinutes: number
  /** Distinct location clusters, used as a proxy for stops. */
  stops: number
  /** Greatest distance between any two photos that day, in metres. */
  spanM: number
  evidenceIds: string[]
  firstEvidenceId: string
  /** Whether this day is well-documented enough to describe behaviour. */
  qualifies: boolean
}

/** Days well-documented enough to contribute to behavioural figures. */
export function qualifyingDays(days: DaySummary[]): DaySummary[] {
  return days.filter((day) => day.qualifies)
}

/** Groups photo evidence into local calendar days, chronologically ordered. */
export function summarizeDays(evidence: EvidenceRecord[]): DaySummary[] {
  const photos = evidence
    .filter((record) => record.kind === 'photo' && record.observedAt)
    .sort((a, b) => (a.observedAt as string).localeCompare(b.observedAt as string))

  const byDate = new Map<string, EvidenceRecord[]>()
  for (const photo of photos) {
    const date = (photo.observedAt as string).slice(0, 10)
    const bucket = byDate.get(date)
    if (bucket) bucket.push(photo)
    else byDate.set(date, [photo])
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, records]) => {
      const time = (records[0].observedAt as string).slice(11, 16)
      const [hours, minutes] = time.split(':').map(Number)
      const points = records
        .map((record) => record.location)
        .filter((point): point is GeoPoint => Boolean(point))

      const stops = points.length > 0 ? clusterPoints(points).length : 0

      return {
        date,
        startTime: time,
        startMinutes: hours * 60 + minutes,
        stops,
        spanM: maxSpanMeters(points),
        evidenceIds: records.map((record) => record.id),
        firstEvidenceId: records[0].id,
        qualifies: records.length >= MIN_PHOTOS_PER_DAY && stops >= MIN_STOPS_PER_DAY,
      }
    })
}

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = Math.round(totalMinutes % 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function buildUserContext(evidence: EvidenceRecord[]): UserContext {
  const allDays = summarizeDays(evidence)
  const days = qualifyingDays(allDays)
  const skipped = allDays.length - days.length

  if (days.length < MIN_DAYS) {
    return {
      ...EMPTY_USER_CONTEXT,
      notes: [
        `Insufficient evidence: ${days.length} well-documented day(s) out of ${allDays.length} with timestamped photos, ${MIN_DAYS} required.`,
        `A day qualifies with at least ${MIN_PHOTOS_PER_DAY} photos and ${MIN_STOPS_PER_DAY} distinct stops.`,
      ],
    }
  }

  const medianStart = median(days.map((day) => day.startMinutes))
  const meanStops = days.reduce((sum, day) => sum + day.stops, 0) / days.length
  const medianSpanM = median(days.filter((day) => day.spanM > 0).map((day) => day.spanM))

  // Thresholds are demo-calibration choices, not measured facts. They are stated
  // here rather than buried so they can be argued with and tuned.
  const walkingTolerance =
    medianSpanM === null ? null : medianSpanM < 2000 ? 'low' : medianSpanM < 6000 ? 'moderate' : 'high'
  const preferredAreaPattern = medianSpanM === null ? null : medianSpanM < 2000 ? 'compact' : 'broad'

  const spanKm = medianSpanM === null ? null : (medianSpanM / 1000).toFixed(1)

  return {
    typicalStartTime: medianStart === null ? null : formatMinutes(medianStart),
    avgDailyStops: Math.round(meanStops * 10) / 10,
    walkingTolerance,
    preferredAreaPattern,
    notes: [
      `Derived from ${days.length} well-documented day(s) between ${days[0].date} and ${days[days.length - 1].date}.`,
      `${skipped} further day(s) with photos were excluded as too sparse (under ${MIN_PHOTOS_PER_DAY} photos or ${MIN_STOPS_PER_DAY} stops).`,
      `Start time is the median of each day's first photo; it marks first photo, not waking.`,
      `Stops are GPS clusters within 250m, a proxy for places visited.`,
      spanKm === null
        ? 'No GPS available, so area pattern could not be derived.'
        : `Median daily span between furthest photos: ${spanKm} km.`,
      'Summary only. Not Memory, and not to be promoted to Memory automatically.',
    ],
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const evidence = readJson<EvidenceRecord[]>(PATHS.out.evidence)
  const context = buildUserContext(evidence)
  writeJson(PATHS.out.userContext, context)
  console.log(`user context -> ${relPath(PATHS.out.userContext)}`)
  console.log(JSON.stringify(context, null, 2))
}
