/**
 * Comparable metrics for a condition run (product_spec Gate 7: "export
 * comparable logs", §20).
 *
 * Every number here is measured off the resulting plan and the event log. None
 * is asserted by the condition that produced it, and none is stipulated: the
 * baseline's zeros are consequences of what §15.2 removed, computed the same way
 * the full condition's are.
 *
 * Distances come from `computeExpectedImpact`, the same arithmetic the product
 * shows a user, rather than a second haversine written for the report. Measured
 * against the plan's own empty shell, its delta IS the plan's path length.
 */

import { priceCeiling } from '../domain/places/facets.ts'
import { isOpenFor, weekdayKey } from '../domain/places/openingHours.ts'
import { diffPlans } from '../domain/plan/diff.ts'
import { allItems, type Plan } from '../domain/plan/types.ts'
import { computeExpectedImpact } from '../domain/proposals/impact.ts'
import type { MemorySnapshot } from '../domain/memory/types.ts'
import { categoryPreferences, planShape } from '../domain/memory/preferences.ts'
import { toPlaceFacts } from '../services/places/catalogue.ts'
import type { PlaceCatalogue } from '../services/places/types.ts'
import { dateOfDay } from '../domain/trip/phase.ts'
import type { TripFrame } from '../domain/trip/types.ts'
import type { BriefConstraints } from './brief.ts'

export interface PlanMetrics {
  stops: number
  distinctCategories: number
  /** Straight-line metres along every day's path, lodging anchors included. */
  walkingDistanceM: number | null

  // --- theme 1: Memory -> recommendation -> rationale ------------------------
  /** Stops in a category the trip's active Memory is about. */
  memoryAlignedStops: number
  /** Stops whose rationale names the memory it came from. */
  memoryCitedStops: number
  /** Stops carrying any traceable provenance at all. */
  traceableStops: number

  // --- did the plan honour what the traveller said? -------------------------
  mustVisitsRequested: number
  mustVisitsHonoured: number
  /** Stops above the budget level the brief stated. Null when it stated none. */
  overBudgetStops: number | null
  /** Stops matching something the brief asked to avoid. */
  avoidedStops: number
  /**
   * Stops per day, so a `pattern` memory's effect on the SHAPE of a trip is
   * visible rather than inferred. Before pattern memories were typed, the pace
   * memory was discarded by preference extraction and could not move this.
   */
  stopsPerDay: number[]
  /** What the trip's Memory says a day should hold, when a pattern measured it. */
  patternStopsPerDay: number | null
  /** What it says a day should span, in metres. */
  patternDaySpanMetres: number | null
  /**
   * Stops scheduled while the place is shut.
   *
   * Zero is the only acceptable value, for either condition: opening hours are a
   * fact about the world, not part of the State model baseline gives up. This
   * exists because it was measurably NOT zero — three of fifteen in each
   * condition — while the validator reported both plans valid.
   */
  closedStops: number
}

/** The plan's own day structure with every stop removed — a zero-distance floor. */
function emptyShell(plan: Plan): Plan {
  return { ...plan, days: plan.days.map((day) => ({ ...day, items: [] })) }
}

export function planMetrics(input: {
  plan: Plan
  catalogue: PlaceCatalogue
  constraints: BriefConstraints
  /** Needed to know which weekday each day index falls on. */
  frame: TripFrame
  /** Absent for baseline, which has no Memory by construction (§15.2). */
  memorySnapshot?: MemorySnapshot
}): PlanMetrics {
  const items = allItems(input.plan)
  const places = items.map((item) => input.catalogue.get(item.placeId))

  const memoryCategories = new Set(
    categoryPreferences(input.memorySnapshot).map((preference) => preference.category),
  )

  const shell = emptyShell(input.plan)
  const distance = computeExpectedImpact(shell, input.plan, diffPlans(shell, input.plan), {
    places: toPlaceFacts(input.catalogue),
  }).walkingDistanceDeltaM

  const ceiling = input.constraints.budgetLevel
    ? priceCeiling(input.constraints.budgetLevel)
    : undefined

  const haystackOf = (index: number): string =>
    [
      places[index]?.category.replace(/_/g, ' ') ?? '',
      places[index]?.neighborhood ?? '',
      ...(places[index]?.tags ?? []),
      places[index]?.shortDescription ?? '',
    ]
      .join(' ')
      .toLowerCase()

  const plannedPlaceIds = new Set(items.map((item) => item.placeId))

  const shape = planShape(input.memorySnapshot)

  return {
    stops: items.length,
    distinctCategories: new Set(places.map((place) => place?.category)).size,
    walkingDistanceM: distance,
    stopsPerDay: input.plan.days.map((day) => day.items.length),
    patternStopsPerDay: shape.stopsPerDay?.value ?? null,
    patternDaySpanMetres: shape.daySpanMetres?.value ?? null,

    memoryAlignedStops: places.filter((place) => place && memoryCategories.has(place.category))
      .length,
    memoryCitedStops: items.filter((item) => (item.rationaleRefs?.memoryIds.length ?? 0) > 0)
      .length,
    traceableStops: items.filter((item) => {
      const refs = item.rationaleRefs
      if (!refs) return false
      return (
        refs.memoryIds.length > 0 || refs.stateItemIds.length > 0 || refs.priorityIds.length > 0
      )
    }).length,

    mustVisitsRequested: input.constraints.mustVisitPlaceIds.length,
    mustVisitsHonoured: input.constraints.mustVisitPlaceIds.filter((placeId) =>
      plannedPlaceIds.has(placeId),
    ).length,
    overBudgetStops:
      ceiling === undefined
        ? null
        : places.filter((place) => place?.priceLevel !== undefined && place.priceLevel > ceiling)
            .length,
    avoidedStops: items.filter((_item, index) =>
      input.constraints.avoid.some(
        (value) => value.length >= 3 && haystackOf(index).includes(value.toLowerCase()),
      ),
    ).length,
    closedStops: items.filter((item, index) => {
      const weekday = weekdayKey(dateOfDay(input.frame, item.dayIndex))
      return !isOpenFor(places[index]?.openingHours, weekday, item.startTime, item.endTime)
    }).length,
  }
}

export interface ChangeMetrics {
  request: string
  /** What the router understood. Identical across conditions by design. */
  operation: string
  /** Items the change touched — the blast radius of one request. */
  itemsAffected: number
  /** True when the user saw the change before it happened (§7). */
  previewed: boolean
  /** True when nothing moved until the user said so. */
  confirmed: boolean
  /** Receipts this change left behind (§9). */
  receipts: number
  /**
   * Stops that left the itinerary. Not necessarily unwanted — for "fewer spots"
   * that IS the request — so read it next to `mustVisitsLost`, which is.
   */
  stopsDropped: number
  /** Stops the brief pinned that this change removed. */
  mustVisitsLost: number
  /** True when the request could not be honoured and was reported as such. */
  reportedConflict: boolean
}

export interface ConditionTotals {
  /** Times the itinerary changed with no confirmation step (§20, theme 2). */
  mutationsWithoutConfirmation: number
  receipts: number
  itemsAffected: number
  stopsDropped: number
  mustVisitsLost: number
  /** True when every change was previewed before it took effect. */
  everyChangePreviewed: boolean
}

export function totalsOf(changes: readonly ChangeMetrics[]): ConditionTotals {
  const applied = changes.filter((change) => !change.reportedConflict)

  return {
    mutationsWithoutConfirmation: applied.filter((change) => !change.confirmed).length,
    receipts: changes.reduce((sum, change) => sum + change.receipts, 0),
    itemsAffected: changes.reduce((sum, change) => sum + change.itemsAffected, 0),
    stopsDropped: changes.reduce((sum, change) => sum + change.stopsDropped, 0),
    mustVisitsLost: changes.reduce((sum, change) => sum + change.mustVisitsLost, 0),
    everyChangePreviewed: applied.every((change) => change.previewed),
  }
}
