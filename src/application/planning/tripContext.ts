/**
 * Small reads over State / Plan that several use cases need.
 *
 * These are the guards every candidate Plan is built under: what must stay in
 * the plan, what must not move, and what the budget warning is measured
 * against. Kept in one place so Replace, Reorganize, Reframe and a direct State
 * edit cannot drift apart on the rules.
 */

import { categoriesForTrip, DEFAULT_STOPS_PER_DAY, type DayRole } from '../../domain/plan/dayRoles.ts'
import { categoryPreferences, planShape } from '../../domain/memory/preferences.ts'
import type { MemorySnapshot } from '../../domain/memory/types.ts'
import { isOpenFor, weekdayKey } from '../../domain/places/openingHours.ts'
import { dateOfDay, isItemLocked } from '../../domain/trip/phase.ts'
import type { TripFrame } from '../../domain/trip/types.ts'
import { allItems, type Plan, type PlanItem } from '../../domain/plan/types.ts'
import type { ConsideringTag, TripState } from '../../domain/state/types.ts'
import type { PlaceCatalogue } from '../../services/places/types.ts'

/** Places pinned into the plan by a must-visit Considering item. */
export function mustVisitPlaceIds(state: TripState): string[] {
  return state.considering
    .map((item) => (item.tag?.kind === 'must_visit' ? item.tag.placeId : undefined))
    .filter((placeId): placeId is string => placeId !== undefined)
}

/** Items that already happened, and so cannot be moved or dropped (§4.3). */
export function lockedItemIds(frame: TripFrame, plan: Plan, now: Date): string[] {
  return allItems(plan)
    .filter((item) => isItemLocked(frame, item, now))
    .map((item) => item.id)
}

export function budgetOf(state: TripState): Extract<ConsideringTag, { kind: 'budget' }> | undefined {
  for (const item of state.considering) {
    if (item.tag?.kind === 'budget') return item.tag
  }
  return undefined
}

/**
 * Whether a stop may sit at a given time, for the retiming transforms.
 *
 * The transforms are pure and know nothing of the catalogue, so they take this as
 * a predicate. Without it they moved stops purely by arithmetic: a day pulled
 * forward put a bathhouse that opens at 14:00 into a 12:40 slot, and the
 * validator's refusal reached the user as "this day cannot finish by 15:00" —
 * true, and not the reason.
 */
export function canScheduleWith(
  frame: TripFrame,
  catalogue: PlaceCatalogue,
): (item: PlanItem, startTime: string, endTime: string) => boolean {
  return (item, startTime, endTime) => {
    const place = catalogue.get(item.placeId)
    if (!place) return false
    return isOpenFor(place.openingHours, weekdayKey(dateOfDay(frame, item.dayIndex)), startTime, endTime)
  }
}

/**
 * The categories a role may hold on this trip: its own, widened for the main stop by
 * any confirmed interest no role at the trip's pace could otherwise hold
 * (`categoriesForTrip`). Every place that fills or re-fills a slot reads this, so
 * generation, retrieval, Replace and State edits agree on what a slot can be.
 */
export function slotCategories(role: DayRole, snapshot: MemorySnapshot | undefined): readonly string[] {
  const pace = planShape(snapshot).stopsPerDay?.value ?? DEFAULT_STOPS_PER_DAY
  const interests = categoryPreferences(snapshot)
    .filter((preference) => preference.weight > 0)
    .map((preference) => preference.category)
  return categoriesForTrip(role, pace, interests)
}
