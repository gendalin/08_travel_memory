/**
 * Change classification (product_spec §7.1).
 *
 * Normative rule, computed from the diff and nothing else.
 *
 * Any State change is a Reframe, however little of the itinerary it moves (eval spec
 * §11-12, decided 2026-09-30). From 2026-09-29 to 2026-09-30 a State edit that swapped
 * one dinner was typed Replace and committed without a preview; the eval found that
 * this let a change of the trip's own terms through unreviewed, and recorded it on the
 * Receipt as a mere place change.
 *
 *   stateDiff non-empty                             -> Reframe
 *   planDiff empty, stateDiff empty                 -> Answer / Focus
 *   exactly one item changed identity or was removed,
 *   and no item was added, retimed or moved         -> Replace
 *   more than one item changed, across several days -> Reframe
 *   otherwise                                       -> Reorganize
 *
 * "changed" in the Replace branch means changed *identity* — swapping one place
 * for another in the same slot. A single item that was retimed or moved to
 * another day is a Reorganize.
 */

import { isPlanDiffEmpty, movedInSchedule, type PlanDiff } from '../plan/diff.ts'
import { isStateDiffEmpty, type StateDiff } from '../state/diff.ts'

export type ChangeType = 'answer' | 'replace' | 'reorganize' | 'reframe'

/** User-facing wording for a proposal heading. Internal names are never shown (§7.2–7.4). */
export const CHANGE_LABEL: Record<ChangeType, string> = {
  answer: 'Answer',
  replace: 'Change this place',
  reorganize: 'Update this part of the trip',
  reframe: 'Change the trip direction',
}

/** The same four kinds, named as past events for a Receipt (§0.4, §9). */
export const RECEIPT_LABEL: Record<ChangeType, string> = {
  answer: 'Answer',
  replace: 'Place change',
  reorganize: 'Schedule update',
  reframe: 'Direction change',
}

export function classifyChange(stateDiff: StateDiff, planDiff: PlanDiff): ChangeType {
  if (!isStateDiffEmpty(stateDiff)) return 'reframe'
  if (isPlanDiffEmpty(planDiff)) return 'answer'

  const days = new Set([
    ...planDiff.added.map((item) => item.dayIndex),
    ...planDiff.removed.map((item) => item.dayIndex),
    ...planDiff.modified.flatMap((entry) => [entry.before.dayIndex, entry.after.dayIndex]),
  ])
  const touched = planDiff.added.length + planDiff.removed.length + planDiff.modified.length
  // One stop moved to another day touches two days and is still one change.
  const scopeType: ChangeType = days.size > 1 && touched > 1 ? 'reframe' : 'reorganize'

  // An addition always restructures the schedule.
  if (planDiff.added.length > 0) return scopeType
  if (touched !== 1) return scopeType

  // The single touched item must not have moved in the schedule. A swapped stop that
  // only ends at a different time — a sushi counter needs longer than the ramen it
  // replaced, and the slot has the room — has not moved: its start and day are the
  // same and nothing else shifted.
  const moved = planDiff.modified.some(
    (entry) => movedInSchedule(entry) && (entry.fields.includes('startTime') || entry.fields.includes('dayIndex') || !entry.fields.includes('placeId')),
  )
  if (moved) return scopeType

  return 'replace'
}
