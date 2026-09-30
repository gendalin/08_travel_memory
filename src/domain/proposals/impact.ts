/**
 * Expected Impact (product_spec §7.5).
 *
 * Computed by code, never by the model.
 *
 * "Do not display false precision" is enforced structurally: a metric whose
 * backing data is unavailable is `null`, not an estimate.
 *
 * Walking distance IS computed when every place has coordinates — straight-line
 * distance is pure arithmetic the domain can own without I/O. Travel time is
 * always null here: it needs a routing engine, and the domain does no I/O.
 */

import { priceCeiling } from '../places/facets.ts'
import { metresBetween } from '../places/geo.ts'
import { dayWindowMinutes } from '../plan/dayRoles.ts'
import { allItems, durationMinutes, toMinutes, type Plan } from '../plan/types.ts'
import type { PlanDiff } from '../plan/diff.ts'
import { affectedItemIds } from '../plan/diff.ts'
import type { ConsideringItem } from '../state/types.ts'

export interface ExpectedImpact {
  itemsAffected: number
  poiCountDelta: number
  /**
   * Straight-line day-path distance delta, metres. Null when any place lacks
   * coordinates. Straight-line under-reads real walking distance, so treat it
   * as a comparison between two plans, not a promise about the street.
   */
  walkingDistanceDeltaM: number | null
  /** Always null in the domain: routing is an adapter concern. */
  travelTimeDeltaMin: number | null
  freeTimeDeltaMin: number | null
  /** Warning text only — no day cost ranges (§7.5). */
  budgetWarning: string | null
}

export interface PlaceFacts {
  lat?: number
  lng?: number
  priceLevel?: 0 | 1 | 2 | 3 | 4
}

export interface ImpactContext {
  /** Place facts by placeId. Missing entries make dependent metrics null. */
  places?: Map<string, PlaceFacts>
  /** Budget constraint from Considering, when present. */
  budget?: Extract<ConsideringItem['tag'], { kind: 'budget' }>
}

/**
 * Sum of straight-line hops along each day's path, including the base-lodging
 * anchors at both ends. Returns null if any place is missing coordinates —
 * a partial sum would be misleading rather than merely imprecise.
 */
function pathDistanceMeters(plan: Plan, places: Map<string, PlaceFacts> | undefined): number | null {
  if (!places) return null

  let total = 0
  for (const day of plan.days) {
    const sequence = [
      day.startsAt.placeId,
      ...[...day.items]
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
        .map((item) => item.placeId),
      day.endsAt.placeId,
    ]

    for (let i = 0; i < sequence.length - 1; i++) {
      const from = places.get(sequence[i])
      const to = places.get(sequence[i + 1])
      if (from?.lat === undefined || from.lng === undefined) return null
      if (to?.lat === undefined || to.lng === undefined) return null
      total += metresBetween(
        { lat: from.lat, lng: from.lng },
        { lat: to.lat, lng: to.lng },
      )
    }
  }
  return Math.round(total)
}

/** Total minutes committed to items, summed across the plan. */
function committedMinutes(plan: Plan): number {
  return allItems(plan).reduce((total, item) => total + durationMinutes(item), 0)
}

/**
 * A planning day, for the purpose of measuring free time: roughly when a
 * traveller is out and about.
 *
 * Derived from the day roles rather than chosen, so it cannot drift from the day the
 * product actually lays out. It was a flat eleven hours, set when a day was three
 * stops ending at half past five; a day now runs from ten in the morning to half past
 * ten at night, and against the old figure a full day would have shown NEGATIVE free
 * time.
 */
const DAY_WINDOW_MINUTES = dayWindowMinutes()

/**
 * Minutes of the day not committed to a stop, summed over days that have any.
 *
 * Measured against a FIXED window rather than the day's own first-to-last span.
 * Against the span, pulling a day forward "loses" free time — the gaps between
 * stops shrink — which is the opposite of what the user just gained, and
 * exactly the kind of figure they would be right not to trust.
 */
function freeMinutes(plan: Plan): number {
  return plan.days.reduce((total, day) => {
    if (day.items.length === 0) return total
    const committed = day.items.reduce((sum, item) => sum + durationMinutes(item), 0)
    return total + Math.max(0, DAY_WINDOW_MINUTES - committed)
  }, 0)
}

/**
 * Warns only when THIS change pushes more of the trip above the budget level.
 *
 * A standing budget problem is not an impact of the change being proposed, and
 * repeating it on every unrelated proposal trains the user to ignore it.
 */
function budgetWarning(before: Plan, after: Plan, context: ImpactContext): string | null {
  if (!context.budget || !context.places) return null

  const ceiling = priceCeiling(context.budget.level)
  const overBudget = (plan: Plan) =>
    allItems(plan).filter((item) => {
      const price = context.places?.get(item.placeId)?.priceLevel
      return price !== undefined && price > ceiling
    }).length

  const added = overBudget(after) - overBudget(before)
  if (added <= 0) return null
  return `${added} more item${added === 1 ? '' : 's'} above the ${context.budget.level} budget level`
}

export function computeExpectedImpact(
  before: Plan,
  after: Plan,
  diff: PlanDiff,
  context: ImpactContext = {},
): ExpectedImpact {
  const beforeCount = allItems(before).length
  const afterCount = allItems(after).length

  const beforeDistance = pathDistanceMeters(before, context.places)
  const afterDistance = pathDistanceMeters(after, context.places)

  return {
    itemsAffected: new Set(affectedItemIds(diff)).size,
    poiCountDelta: afterCount - beforeCount,
    walkingDistanceDeltaM:
      beforeDistance === null || afterDistance === null ? null : afterDistance - beforeDistance,
    // Routing is an adapter concern; the domain does no I/O.
    travelTimeDeltaMin: null,
    freeTimeDeltaMin: freeMinutes(after) - freeMinutes(before),
    budgetWarning: budgetWarning(before, after, context),
  }
}

/** True when committed time went up — useful for "fewer spots" style requests. */
export function committedMinutesDelta(before: Plan, after: Plan): number {
  return committedMinutes(after) - committedMinutes(before)
}
