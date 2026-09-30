/**
 * Recency weighting for evidence (A4).
 *
 * Travel taste moves. Before this, a saved screenshot from thirteen months ago
 * counted exactly as much as one from last month, so a category the traveller has
 * drifted away from kept its full pull on every future trip.
 *
 * Two decisions here matter more than the curve itself.
 *
 * **The reference point is the newest evidence, not the wall clock.** Preprocessing
 * has to be reproducible: with `Date.now()` as the reference, `memories.json`
 * would change every day it was rebuilt, every strength and confidence with it,
 * and any test reading the bundle would rot on a calendar rather than on a code
 * change. Anchoring to the data makes a re-run bit-identical.
 *
 * **Undated evidence counts as typical-aged, not as fresh.** All fourteen saved
 * places carry no timestamp — a Takeout export does not say when a place was
 * saved — and so do two photos. Weighting them 1.0 would quietly treat every
 * undated record as though it happened today, which favours whichever category
 * happens to hold the most saved places (here, sushi, with five of its eighteen).
 * Weighting them at the mean decay of everything datable leaves them neutral:
 * present, but neither boosted nor buried by a date we do not have.
 */

/**
 * Days after which a piece of evidence counts half as much.
 *
 * A calibration choice, not a measured fact — stated here so it can be argued
 * with. A year is chosen because travel taste is slow: a place saved last season
 * still says something, and one saved two years ago says noticeably less.
 */
export const RECENCY_HALF_LIFE_DAYS = 365

const MS_PER_DAY = 86_400_000

/** Local calendar day, ignoring any time part. The bundle's dates carry no zone. */
function toDay(iso: string): number {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(year, month - 1, day) / MS_PER_DAY
}

export interface DatedRecord {
  observedAt?: string | null
}

/** The newest date any record carries, or null when none is datable. */
export function newestObservedAt(records: readonly DatedRecord[]): string | null {
  const dates = records
    .map((record) => record.observedAt)
    .filter((value): value is string => typeof value === 'string' && value.length >= 10)
  if (dates.length === 0) return null
  return dates.reduce((newest, value) => (value > newest ? value : newest))
}

/**
 * Recency weights for a set of records, keyed by position.
 *
 * Returned together rather than one at a time because the weight for an undated
 * record depends on the whole set: it is the mean of the dated ones.
 */
export function recencyWeights(records: readonly DatedRecord[]): number[] {
  const reference = newestObservedAt(records)
  if (reference === null) return records.map(() => 1)

  const referenceDay = toDay(reference)
  const decayOf = (observedAt: string): number =>
    0.5 ** Math.max(0, (referenceDay - toDay(observedAt)) / RECENCY_HALF_LIFE_DAYS)

  const dated = records
    .map((record) => record.observedAt)
    .filter((value): value is string => typeof value === 'string' && value.length >= 10)
    .map(decayOf)

  const undatedWeight =
    dated.length === 0 ? 1 : dated.reduce((sum, weight) => sum + weight, 0) / dated.length

  return records.map((record) =>
    typeof record.observedAt === 'string' && record.observedAt.length >= 10
      ? decayOf(record.observedAt)
      : undatedWeight,
  )
}
