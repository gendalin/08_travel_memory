/**
 * Validation engine (product_spec §8).
 *
 * Runs before a proposal is ever displayed. An invalid itinerary is never shown
 * as a proposal — the caller retries generation at most twice, then returns a
 * Conflict or a clear error.
 *
 * Pure and synchronous: the dataset is passed in, never fetched.
 */

import { kmBetween } from '../places/geo.ts'
import { halfDayMinutes } from '../plan/dayRoles.ts'
import { describeHours, isOpenFor, weekdayKey } from '../places/openingHours.ts'
import { dateOfDay, isItemLocked } from '../trip/phase.ts'
import type { TripFrame } from '../trip/types.ts'
import { allItems, toMinutes, type Plan, type PlanItem } from '../plan/types.ts'
import type { TripState } from '../state/types.ts'
import type { ValidationError, ValidationResult } from './types.ts'

/** The subset of a demo place the validator needs. */
export interface ValidationPlace {
  placeId: string
  /** Per-weekday spans, "11:00-15:00" or "closed". */
  openingHours?: Record<string, string>
  lat?: number
  lng?: number
}

/** How far past a named place's radius a stop still counts as there, km. */
const DAY_PLACE_EDGE_KM = 0.5

export interface ValidationContext {
  frame: TripFrame
  state: TripState
  /** Every POI the product is allowed to reference, by placeId. */
  places: Map<string, ValidationPlace>
  /** The plan as last committed, used to detect locked-item mutation. */
  committedPlan?: Plan
  now: Date
  /** Half-day length cap, in minutes. */
  halfDayMinutes?: number
}

/**
 * A half day, in minutes. Exported so plan builders aim at the same target.
 *
 * Half of the day the roles describe, rather than a flat figure: at five hours — half
 * of the old three-stop day — a "half day" would now run past the evening meal.
 */
export const DEFAULT_HALF_DAY_MINUTES = halfDayMinutes()

function overlaps(a: PlanItem, b: PlanItem): boolean {
  if (a.dayIndex !== b.dayIndex) return false
  return toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime)
}

export function validatePlan(plan: Plan, context: ValidationContext): ValidationResult {
  const errors: ValidationError[] = []
  const items = allItems(plan)

  // --- POIs must exist in the dataset; no invented ids ----------------------
  //
  // And, having established the place is real and its hours are known, the stop
  // has to actually fall inside them. Checking only that the FIELD exists let
  // three of fifteen stops in the default demo trip sit outside opening hours
  // while the plan reported valid — a ramen counter hours after it shut, an
  // izakaya before it opened, a market as it packed up.
  for (const item of items) {
    const place = context.places.get(item.placeId)

    if (!place) {
      errors.push({
        code: 'unknown_poi',
        message: `Plan references POI "${item.placeId}", which is not in the dataset`,
        itemIds: [item.id],
      })
      continue
    }

    if (!place.openingHours) {
      errors.push({
        code: 'missing_opening_hours',
        message: `POI "${item.placeId}" has no opening-hours data`,
        itemIds: [item.id],
      })
      continue
    }

    const weekday = weekdayKey(dateOfDay(context.frame, item.dayIndex))
    if (!isOpenFor(place.openingHours, weekday, item.startTime, item.endTime)) {
      errors.push({
        code: 'poi_closed_at_time',
        message:
          `POI "${item.placeId}" is not open for ${item.startTime}-${item.endTime} on day ` +
          `${item.dayIndex + 1} (${weekday}: ${describeHours(place.openingHours, weekday)})`,
        itemIds: [item.id],
        dayIndex: item.dayIndex,
      })
    }
  }

  // --- no overlapping items -------------------------------------------------
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (overlaps(items[i], items[j])) {
        errors.push({
          code: 'overlapping_items',
          message: `Items overlap on day ${items[i].dayIndex + 1}`,
          itemIds: [items[i].id, items[j].id],
          dayIndex: items[i].dayIndex,
        })
      }
    }
  }

  // --- each day starts and ends at base lodging -----------------------------
  const lodgingId = context.frame.baseLodging.placeId
  for (const day of plan.days) {
    if (day.startsAt.placeId !== lodgingId || day.endsAt.placeId !== lodgingId) {
      errors.push({
        code: 'day_not_anchored_at_lodging',
        message: `Day ${day.dayIndex + 1} must start and end at ${context.frame.baseLodging.name}`,
        dayIndex: day.dayIndex,
      })
    }
  }

  // --- locked items unchanged ----------------------------------------------
  if (context.committedPlan) {
    for (const committed of allItems(context.committedPlan)) {
      if (!isItemLocked(context.frame, committed, context.now)) continue

      const proposed = items.find((item) => item.id === committed.id)
      const changed =
        !proposed ||
        proposed.placeId !== committed.placeId ||
        proposed.dayIndex !== committed.dayIndex ||
        proposed.startTime !== committed.startTime ||
        proposed.endTime !== committed.endTime

      if (changed) {
        errors.push({
          code: 'locked_item_changed',
          message: `Locked item "${committed.id}" cannot be changed`,
          itemIds: [committed.id],
          dayIndex: committed.dayIndex,
        })
      }
    }
  }

  // --- structured Considering constraints -----------------------------------
  for (const considering of context.state.considering) {
    const tag = considering.tag
    if (!tag) continue

    switch (tag.kind) {
      case 'must_visit': {
        if (!items.some((item) => item.placeId === tag.placeId)) {
          errors.push({
            code: 'must_visit_missing',
            message: `Must-visit "${tag.placeId}" is not in the plan`,
            ...(tag.dayIndex !== undefined ? { dayIndex: tag.dayIndex } : {}),
            consideringId: considering.id,
          })
        } else if (
          tag.dayIndex !== undefined &&
          !items.some((item) => item.placeId === tag.placeId && item.dayIndex === tag.dayIndex)
        ) {
          // A pin to a day is a pin to that day. Satisfying it anywhere else is the
          // constraint quietly weakened, which is worse than reporting it.
          errors.push({
            code: 'must_visit_wrong_day',
            message: `Must-visit "${tag.placeId}" is not on Day ${tag.dayIndex + 1}`,
            dayIndex: tag.dayIndex,
            consideringId: considering.id,
          })
        }
        break
      }
      case 'fixed_time': {
        const onDay = items.filter((item) => item.dayIndex === tag.dayIndex)
        const blocked = onDay.some(
          (item) => toMinutes(item.endTime) > toMinutes(tag.time),
        )
        if (blocked) {
          errors.push({
            code: 'fixed_time_violated',
            message: `Day ${tag.dayIndex + 1} must be clear by ${tag.time}`,
            dayIndex: tag.dayIndex,
            consideringId: considering.id,
          })
        }
        break
      }
      case 'time_block': {
        const onDay = items.filter((item) => item.dayIndex === tag.dayIndex)
        if (onDay.length > 0) {
          const starts = onDay.map((item) => toMinutes(item.startTime))
          const ends = onDay.map((item) => toMinutes(item.endTime))
          const committed = onDay.reduce(
            (sum, item) => sum + (toMinutes(item.endTime) - toMinutes(item.startTime)),
            0,
          )
          const gap = Math.max(...ends) - Math.min(...starts) - committed
          if (gap < tag.minutes) {
            errors.push({
              code: 'time_block_missing',
              message: `Day ${tag.dayIndex + 1} needs ${tag.minutes} free minutes; largest available is ${gap}`,
              dayIndex: tag.dayIndex,
              consideringId: considering.id,
            })
          }
        }
        break
      }
      case 'half_day': {
        const onDay = items.filter((item) => item.dayIndex === tag.dayIndex)
        if (onDay.length > 0) {
          const span =
            Math.max(...onDay.map((item) => toMinutes(item.endTime))) -
            Math.min(...onDay.map((item) => toMinutes(item.startTime)))
          const cap = context.halfDayMinutes ?? DEFAULT_HALF_DAY_MINUTES
          if (span > cap) {
            errors.push({
              code: 'half_day_exceeded',
              message: `Day ${tag.dayIndex + 1} is a half day but spans ${span} minutes`,
              dayIndex: tag.dayIndex,
              consideringId: considering.id,
            })
          }
        }
        break
      }
      case 'day_in_place': {
        // "Go to Yokohama on the last day" is kept when at least one stop that day is
        // there. A place never located is its own failure: nothing could satisfy it.
        const center = tag.place.center
        const there = center
          ? items.filter((item) => {
              if (item.dayIndex !== tag.dayIndex) return false
              const place = context.places.get(item.placeId)
              return place?.lat !== undefined && place.lng !== undefined &&
                kmBetween(center, { lat: place.lat, lng: place.lng }) <= (tag.place.radiusKm ?? 1.5) + DAY_PLACE_EDGE_KM
            })
          : []
        if (there.length === 0) {
          errors.push({
            code: center ? 'day_in_place_missing' : 'day_in_place_unknown',
            message: center
              ? `Day ${tag.dayIndex + 1} has no stop in ${tag.place.name}`
              : `Could not locate ${tag.place.name}`,
            dayIndex: tag.dayIndex,
            consideringId: considering.id,
          })
        }
        break
      }
      case 'budget':
      case 'avoid':
        // Soft constraints: handled by ranking and Expected Impact warnings,
        // not by hard validation. A plan is not invalid for being pricey.
        break
    }
  }

  return { valid: errors.length === 0, errors }
}
