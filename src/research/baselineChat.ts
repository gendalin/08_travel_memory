/**
 * The baseline condition's change handling (product_spec §15.2).
 *
 * "Chat behaves like conventional regeneration": the request is understood, a
 * new itinerary is produced, and it becomes the itinerary. There is no
 * proposal, no diff to read, nothing to confirm, and no receipt afterwards.
 *
 * Fairness matters more here than anywhere else in the harness, so baseline is
 * given the product's OWN comprehension: the same `routeMessage` router and the
 * same deterministic transforms. A baseline that misunderstood the request would
 * make the comparison a measurement of parsing, which is not what §15.2 removes.
 *
 * What it is denied is only what §15.2 takes away, and each denial is a real
 * consequence rather than a stipulated one:
 *
 *   - **No State**, so `compressDayBefore` and `reduceStopsPerDay` run with no
 *     `protectedPlaceIds`. A must-visit is not protected because there is
 *     nowhere for a must-visit to be recorded.
 *   - **No proposal**, so the returned plan IS the committed plan.
 *   - **Stateless replacement**: with nothing holding the trip's shape, a closed
 *     place is handled by regenerating the itinerary without it. The blast
 *     radius that follows is measured, never assumed.
 *
 * Time-phase locking (§4.3) is NOT removed: it is derived from the trip frame
 * and the clock, not from State, so baseline keeps it.
 *
 * Opening hours are kept for the same reason, and it is not a courtesy. They come
 * from the catalogue, not from the State model §15.2 takes away, so a baseline that
 * scheduled a stop behind a locked door would not be a weaker condition — it would
 * be a broken one, and every closed stop it produced would flatter the full
 * condition in the comparison. It happened: pulling a day forward to beat the rain
 * moved a sushi counter to 13:45 on a day it opens at 15:00, and the harness read
 * that as baseline scheduling one stop while the place was shut.
 */

import { routeMessage } from '../application/handleChat/route.ts'
import { canScheduleWith, lockedItemIds } from '../application/planning/tripContext.ts'
import { diffPlans, type PlanDiff } from '../domain/plan/diff.ts'
import { compressDayBefore, reduceStopsPerDay } from '../domain/plan/reschedule.ts'
import type { Plan } from '../domain/plan/types.ts'
import { validatePlan } from '../domain/validation/validate.ts'
import type { ValidationResult } from '../domain/validation/types.ts'
import type { TripFrame } from '../domain/trip/types.ts'
import { toValidationPlaces } from '../services/places/catalogue.ts'
import type { PlaceCatalogue } from '../services/places/types.ts'
import { BASELINE_STATE, generateBaselinePlan } from './baselinePlan.ts'

export interface BaselineChangeResult {
  /** `applied` because there is no pending state in baseline: it just happens. */
  kind: 'applied' | 'unresolved'
  plan: Plan
  validation: ValidationResult
  diff: PlanDiff
  /** Places that fell out of the itinerary, whether or not the user meant them to. */
  droppedPlaceIds: string[]
  /** What the router understood, for the log. */
  operation: string
}

export function baselineHandleMessage(input: {
  message: string
  frame: TripFrame
  plan: Plan
  catalogue: PlaceCatalogue
  days: number
  now: Date
  /** Places already ruled out by earlier turns, since nothing else remembers them. */
  excludePlaceIds?: readonly string[]
  focusDayIndex?: number
}): BaselineChangeResult {
  const operation = routeMessage({
    message: input.message,
    plan: input.plan,
    catalogue: input.catalogue,
    focusDayIndex: input.focusDayIndex,
  })

  const unchanged = (): BaselineChangeResult => ({
    kind: 'unresolved',
    plan: input.plan,
    validation: validatePlan(input.plan, {
      frame: input.frame,
      state: BASELINE_STATE,
      places: toValidationPlaces(input.catalogue),
      now: input.now,
    }),
    diff: diffPlans(input.plan, input.plan),
    droppedPlaceIds: [],
    operation: operation.kind,
  })

  const settle = (plan: Plan, validation: ValidationResult): BaselineChangeResult => {
    const diff = diffPlans(input.plan, plan)
    const after = new Set(plan.days.flatMap((day) => day.items.map((item) => item.placeId)))
    return {
      kind: 'applied',
      plan,
      validation,
      diff,
      droppedPlaceIds: input.plan.days
        .flatMap((day) => day.items.map((item) => item.placeId))
        .filter((placeId) => !after.has(placeId)),
      operation: operation.kind,
    }
  }

  switch (operation.kind) {
    case 'replace_place': {
      // Regenerate without the ruled-out place. Nothing carries the rest of the
      // trip's shape across the regeneration, so whatever else moves, moves.
      const regenerated = generateBaselinePlan({
        frame: input.frame,
        catalogue: input.catalogue,
        days: input.days,
        now: input.now,
        excludePlaceIds: [...(input.excludePlaceIds ?? []), operation.placeId],
        version: input.plan.version + 1,
      })
      return settle(regenerated.plan, regenerated.validation)
    }

    // The baseline reads weather as the old product did: finish the day before it.
    case 'weather_after':
    case 'clear_after': {
      const result = compressDayBefore(input.plan, {
        dayIndex: operation.dayIndex,
        endBy: operation.kind === 'clear_after' ? operation.endBy : operation.from,
        lockedItemIds: lockedItemIds(input.frame, input.plan, input.now),
        // No State, so nothing is protected from being dropped to make room.
        protectedPlaceIds: [],
        // Hours are not State. Both conditions get the same doors.
        canSchedule: canScheduleWith(input.frame, input.catalogue),
      })
      if (!result.fits) return unchanged()

      const plan: Plan = { ...result.plan, version: input.plan.version + 1 }
      return settle(
        plan,
        validatePlan(plan, {
          frame: input.frame,
          state: BASELINE_STATE,
          places: toValidationPlaces(input.catalogue),
          now: input.now,
        }),
      )
    }

    case 'fewer_stops': {
      const result = reduceStopsPerDay(input.plan, {
        maxPerDay: operation.maxPerDay,
        lockedItemIds: lockedItemIds(input.frame, input.plan, input.now),
        protectedPlaceIds: [],
      })

      const plan: Plan = { ...result.plan, version: input.plan.version + 1 }
      return settle(
        plan,
        validatePlan(plan, {
          frame: input.frame,
          state: BASELINE_STATE,
          places: toValidationPlaces(input.catalogue),
          now: input.now,
        }),
      )
    }

    default:
      return unchanged()
  }
}
