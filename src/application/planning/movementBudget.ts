/**
 * The movement budget State asks for, and whether a candidate keeps a day inside it
 * (decided 2026-09-30; see domain/plan/movement.ts).
 *
 * Read from the traveller's own words — Intent or Considering — so it is visible and
 * editable where they wrote it: "Slow-paced", "take it easy", "慢慢逛". It is stated,
 * so it outranks inferred Memory and the default (§0.2): planning keeps to it
 * whenever any candidate can, and says so when none can.
 */

import { measureMovement, SLOW_BUDGET, withinBudget, type MovementBudget } from '../../domain/plan/movement.ts'
import type { TripState } from '../../domain/state/types.ts'
import type { Coordinates } from '../../domain/places/geo.ts'

const SLOW_WORDS =
  /\b(slow|slowly|slower|slow-paced|unhurried|leisurely|relaxed|take it easy|no rush|easy pace|at our own pace)\b|慢慢|悠閒|悠哉|ゆっくり|のんびり/i

export interface StatedMovement {
  budget: MovementBudget
  /** The State line that asked for it, for the reason a stop cites. */
  source: { id: string; text: string }
}

export function movementBudgetOf(state: TripState): StatedMovement | undefined {
  // The line's reading first (a model understands "悠哉地晃" as slow), then its words.
  const line =
    state.considering.find((item) => item.tag?.kind === 'pace' && item.tag.style === 'slow') ??
    state.intent.find((item) => item.reading?.pace === 'slow') ??
    [...state.intent, ...state.considering].find((item) => SLOW_WORDS.test(item.text))
  return line ? { budget: SLOW_BUDGET, source: { id: line.id, text: line.text } } : undefined
}

/** A stop on a day, with where and when it is. */
export interface TimedPoint extends Coordinates {
  startTime: string
}

/** Whether adding `candidate` keeps the day's stops inside the budget. */
export function keepsPace(day: readonly TimedPoint[], candidate: TimedPoint, budget: MovementBudget): boolean {
  const ordered = [...day, candidate].sort((a, b) => a.startTime.localeCompare(b.startTime))
  return withinBudget(measureMovement(ordered), budget)
}

/**
 * The candidates that keep the day in budget, or all of them when none do.
 *
 * `yielded` is true in the second case: the budget gave way because nothing open
 * could honour it, which the caller reports rather than hides.
 */
export function preferWithinPace<T extends Coordinates>(
  candidates: readonly T[],
  day: readonly TimedPoint[],
  startTime: string,
  budget: MovementBudget | undefined,
): { candidates: T[]; filtered: boolean; yielded: boolean } {
  if (!budget) return { candidates: [...candidates], filtered: false, yielded: false }
  const keeping = candidates.filter((place) => keepsPace(day, { lat: place.lat, lng: place.lng, startTime }, budget))
  if (keeping.length === 0) return { candidates: [...candidates], filtered: false, yielded: candidates.length > 0 }
  return { candidates: keeping, filtered: keeping.length < candidates.length, yielded: false }
}
