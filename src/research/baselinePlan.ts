/**
 * The baseline condition's itinerary generator (product_spec §15.2).
 *
 * This is a conventional recommender, and deliberately not a straw man. It gets
 * the same real Tokyo places with the same real opening hours, the same DAY
 * STRUCTURE — the eight roles, with their windows and their categories — and the
 * same validation engine, so a baseline itinerary is a plausible, valid itinerary
 * that a reviewer would recognise as ordinary output.
 *
 * What it does not have is the four things §15.2 removes:
 *
 *   - **no Memory**, so nothing about the traveller steers a choice — including the
 *     pace pattern, so baseline plans the DEFAULT day where the full condition plans
 *     the measured one. Same structure, same default: the difference is only that one
 *     of them measured something.
 *   - **no State**, so there are no structured constraints to respect: no
 *     must-visit to protect, no budget ceiling, no `avoid`, and no Priorities
 *     to weight anything by
 *   - **no rationale**, so items carry neither prose nor `rationaleRefs`
 *   - **no proposal model**, handled in `baselineChat.ts`
 *
 * It DOES honour opening hours. §15.2 keeps the validation engine, and a place's
 * hours are a fact about the world rather than part of the State model baseline
 * gives up — a baseline that booked closed restaurants would be losing on a
 * dimension the comparison is not about.
 *
 * Within a category it takes the first place the dataset offers. That is not a
 * handicap invented for the comparison — it is exactly what this product did
 * before the ranking layer existed, and it is what an unranked bounded
 * retrieval does anywhere: the file's own order becomes the recommendation.
 */

import {
  categoriesFor,
  DEFAULT_STOPS_PER_DAY,
  rolesForPace,
  type DayRole,
} from '../domain/plan/dayRoles.ts'
import { weekdayKey, windowCovering, type WeekdayKey } from '../domain/places/openingHours.ts'
import type { Plan, PlanDay, PlanItem } from '../domain/plan/types.ts'
import { dateOfDay } from '../domain/trip/phase.ts'
import type { TripState } from '../domain/state/types.ts'
import type { TripFrame } from '../domain/trip/types.ts'
import { validatePlan } from '../domain/validation/validate.ts'
import type { ValidationResult } from '../domain/validation/types.ts'
import { toValidationPlaces } from '../services/places/catalogue.ts'
import type { DemoPlace, PlaceCatalogue } from '../services/places/types.ts'

/**
 * The State a baseline trip has: none.
 *
 * Validation still runs — §15.2 keeps it — but with no Intent, no Considering
 * and no Priorities there is nothing structured for it to check beyond the
 * rules that hold for any plan (real POIs, no overlaps, anchored days). That
 * gap is the finding, not a gap in the harness.
 */
export const BASELINE_STATE: TripState = Object.freeze({
  version: 1,
  intent: [],
  considering: [],
  priorities: [],
}) as TripState

function addMinutes(time: string, minutes: number): string {
  const [hours, mins] = time.split(':').map(Number)
  const total = hours * 60 + mins + minutes
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const MIN_STOP_MINUTES = 30

function fromMinutes(total: number): string {
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Same rule as the product's: the role's window, and the door. */
function stopEnd(role: DayRole, place: DemoPlace, weekday: WeekdayKey): string {
  const start = role.window.from
  const closes = windowCovering(place.openingHours, weekday, start)?.closes

  const candidates = [
    addMinutes(start, Math.max(MIN_STOP_MINUTES, place.typicalDurationMin)),
    role.window.to,
  ]
  if (closes !== undefined) candidates.push(fromMinutes(closes))
  return candidates.reduce((earliest, time) => (time < earliest ? time : earliest))
}

export interface BaselinePlanResult {
  plan: Plan
  validation: ValidationResult
}

export function generateBaselinePlan(input: {
  frame: TripFrame
  catalogue: PlaceCatalogue
  days: number
  now: Date
  /** Places the brief has ruled out — a closed restaurant, say. */
  excludePlaceIds?: readonly string[]
  version?: number
}): BaselinePlanResult {
  const used = new Set<string>([
    input.frame.baseLodging.placeId,
    ...(input.excludePlaceIds ?? []),
  ])

  const days: PlanDay[] = []

  for (let dayIndex = 0; dayIndex < input.days; dayIndex++) {
    const items: PlanItem[] = []
    const weekday = weekdayKey(dateOfDay(input.frame, dayIndex))

    // Every role, in day order. With no pace memory there is nothing to shorten a
    // day by, so baseline attempts the lot.
    for (const role of rolesForPace(DEFAULT_STOPS_PER_DAY)) {
      const openAt = {
        weekday,
        startTime: role.window.from,
        endTime: addMinutes(role.window.from, MIN_STOP_MINUTES),
      }

      // The role's categories in their declared order, first with anything left.
      // Unranked on purpose: this is what an unordered bounded retrieval gives you,
      // and it is what the product did before the ranking layer.
      let chosen: DemoPlace | undefined
      for (const category of categoriesFor(role)) {
        const [candidate] = input.catalogue.candidates({
          category,
          excludePlaceIds: [...used],
          openAt,
          limit: 1,
        })
        if (candidate) {
          chosen = candidate
          break
        }
      }

      if (!chosen) continue

      used.add(chosen.placeId)
      // No rationale and no rationaleRefs: §15.2 removes rationale, and an empty
      // refs object would make the traceability metric read as "traced to nothing"
      // rather than "not traceable".
      items.push({
        id: `item_d${dayIndex}_${role.id}`,
        placeId: chosen.placeId,
        dayIndex,
        startTime: role.window.from,
        endTime: stopEnd(role, chosen, weekday),
      })
    }

    days.push({
      dayIndex,
      startsAt: input.frame.baseLodging,
      endsAt: input.frame.baseLodging,
      items,
    })
  }

  const plan: Plan = { version: input.version ?? 1, days }

  return {
    plan,
    validation: validatePlan(plan, {
      frame: input.frame,
      state: BASELINE_STATE,
      places: toValidationPlaces(input.catalogue),
      now: input.now,
    }),
  }
}
