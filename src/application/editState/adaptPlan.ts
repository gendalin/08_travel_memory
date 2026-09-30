/**
 * Edited State -> candidate Plan (product_spec §7.6).
 *
 * Incremental on purpose. Regenerating the whole itinerary from the edited
 * State would be simpler, but it would silently throw away every change the
 * user already confirmed — the replaced restaurant, the day that was pulled
 * forward — and it would put a whole-trip rewrite in front of them for a
 * one-line State edit. So this applies only what the new constraints require
 * and leaves everything else exactly where it was.
 *
 * It does not validate. The caller validates the result, which is how an
 * unsatisfiable constraint (a must-visit that is not in the dataset) reaches
 * the user as a Conflict instead of being quietly dropped here.
 */

import { isOpenFor, weekdayKey, windowOn } from '../../domain/places/openingHours.ts'
import { compressDayBefore, LATEST_END } from '../../domain/plan/reschedule.ts'
import { fromMinutes, toMinutes, type Plan, type PlanItem } from '../../domain/plan/types.ts'
import type { ConsideringTag, TripState } from '../../domain/state/types.ts'
import { dateOfDay } from '../../domain/trip/phase.ts'
import type { TripFrame } from '../../domain/trip/types.ts'
import { DEFAULT_HALF_DAY_MINUTES } from '../../domain/validation/validate.ts'
import type { PlaceCatalogue } from '../../services/places/types.ts'
import { canScheduleWith } from '../planning/tripContext.ts'
import { priorityWeights } from '../planning/rankCandidates.ts'
import { explainStop, rationaleText } from '../generatePlan/explainStop.ts'

/** Gap left before an inserted stop. */
const INSERT_GAP_MINUTES = 30
/** Where a day starts when it has nothing in it yet. */
const DAY_START = '10:00'

function tagsOf(state: TripState): ConsideringTag[] {
  return state.considering
    .map((item) => item.tag)
    .filter((tag): tag is ConsideringTag => tag !== undefined)
}

/** Tags present in `after` but not in `before`, compared by value. */
function addedTags(before: TripState, after: TripState): ConsideringTag[] {
  const existing = new Set(tagsOf(before).map((tag) => JSON.stringify(tag)))
  return tagsOf(after).filter((tag) => !existing.has(JSON.stringify(tag)))
}

/**
 * Fits a stop into the emptiest day that can still hold it. Emptiest first
 * because a must-visit should land where there is room, not where it happens
 * to be alphabetically convenient.
 *
 * Every gap in the day is tried, earliest first — before the first stop, between
 * each pair, and after the last — with travel time kept on both sides of the new
 * stop. It used to try two positions only: after the day's last stop, and the
 * place's own opening time. That was enough for a three-stop day, which was mostly
 * gap; against the eight-role day it fails every time, because the end of the day
 * is past the last hour a stop may start and the opening time collides with the
 * morning anchor. The afternoon it should have used was never looked at, and asking
 * for a garden by name came back as "I couldn't fit it".
 *
 * A pinned place that genuinely fits nowhere is still reported as unsatisfied,
 * which the caller turns into a Conflict against the user's own sentence — better
 * than appending blindly, which once put a lunch-only ramen counter at six in the
 * evening and called the plan satisfied.
 */
function insertPlace(
  plan: Plan,
  placeId: string,
  catalogue: PlaceCatalogue,
  frame: TripFrame,
  /** The day the traveller named, when they named one. Only that day is tried. */
  onlyDay?: number,
): Plan | undefined {
  const place = catalogue.get(placeId)
  if (!place) return undefined

  const needed = Math.max(30, place.typicalDurationMin)
  const byRoom = [...plan.days]
    .filter((day) => onlyDay === undefined || day.dayIndex === onlyDay)
    .sort((a, b) => a.items.length - b.items.length)

  for (const day of byRoom) {
    const weekday = weekdayKey(dateOfDay(frame, day.dayIndex))
    const window = windowOn(place.openingHours, weekday)
    if (!window) continue

    const ordered = [...day.items].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))

    /** Room a new stop could take, with travel time already deducted at both ends. */
    const gaps: Array<{ from: number; to: number }> = []
    let cursor = toMinutes(DAY_START)
    for (const item of ordered) {
      gaps.push({ from: cursor, to: toMinutes(item.startTime) - INSERT_GAP_MINUTES })
      cursor = toMinutes(item.endTime) + INSERT_GAP_MINUTES
    }
    gaps.push({ from: cursor, to: toMinutes(LATEST_END) })

    const free = (start: number): boolean =>
      day.items.every(
        (item) => start >= toMinutes(item.endTime) || start + needed <= toMinutes(item.startTime),
      )

    // A gap that opens before the place does starts when the place does.
    const start = gaps
      .map((gap) => ({ at: Math.max(gap.from, window.opens), until: gap.to }))
      .filter((slot) => slot.at + needed <= Math.min(slot.until, toMinutes(LATEST_END)))
      .map((slot) => slot.at)
      .find(
        (candidate) =>
          isOpenFor(place.openingHours, weekday, fromMinutes(candidate), fromMinutes(candidate + needed)) &&
          free(candidate),
      )
    if (start === undefined) continue

    const item: PlanItem = {
      // Deterministic and unique: one place can appear on a day only once.
      id: `item_d${day.dayIndex}_${placeId}`,
      placeId,
      dayIndex: day.dayIndex,
      startTime: fromMinutes(start),
      endTime: fromMinutes(start + needed),
      rationale: `${place.shortDescription} You asked for this one by name.`,
      placedBy: 'must_visit',
    }

    return {
      ...plan,
      days: plan.days.map((d) =>
        d.dayIndex === day.dayIndex ? { ...d, items: [...d.items, item] } : d,
      ),
    }
  }

  // No day has room while the place is open; the caller turns this into a Conflict.
  return undefined
}

/**
 * Reasons for a stop placed by name, in the same form as every other stop's: the
 * traveller's own sentence first, then how far it is from the stop before.
 */
function explainInserted(
  plan: Plan,
  placeId: string,
  input: { after: TripState; catalogue: PlaceCatalogue; frame: TripFrame },
): Plan {
  const place = input.catalogue.get(placeId)
  if (!place) return plan
  return {
    ...plan,
    days: plan.days.map((day) => {
      const inserted = day.items.find((item) => item.placeId === placeId && item.placedBy === 'must_visit')
      if (!inserted) return day
      const before = day.items
        .filter((item) => item.id !== inserted.id && toMinutes(item.endTime) <= toMinutes(inserted.startTime))
        .sort((a, b) => toMinutes(b.endTime) - toMinutes(a.endTime))[0]
      const fromPlace = before ? input.catalogue.get(before.placeId) : input.catalogue.get(input.frame.baseLodging.placeId)
      const fromName = before ? fromPlace?.name : input.frame.baseLodging.name
      const explanation = explainStop({
        place,
        dayIndex: day.dayIndex,
        state: input.after,
        via: { kind: 'must_visit' },
        ...(fromName ? { from: { name: fromName, lat: fromPlace?.lat, lng: fromPlace?.lng } } : {}),
        weights: priorityWeights(input.after),
      })
      const explained: PlanItem = {
        ...inserted,
        rationale: rationaleText(explanation.reasons),
        reasons: explanation.reasons,
        rationaleRefs: explanation.refs,
      }
      return { ...day, items: day.items.map((item) => (item.id === inserted.id ? explained : item)) }
    }),
  }
}

/** A pinned place the plan could not be made to hold, and why. */
export interface UnsatisfiedPin {
  placeId: string
  /** The day it was pinned to, when it was pinned to one. */
  dayIndex?: number
  because: 'closed_that_day' | 'no_room' | 'locked'
}

export interface AdaptResult {
  plan: Plan
  /** Constraints the plan could not be made to satisfy. */
  unsatisfied: UnsatisfiedPin[]
}

export function adaptPlanToState(input: {
  plan: Plan
  before: TripState
  after: TripState
  catalogue: PlaceCatalogue
  /** Needed to know which weekday a day index falls on. */
  frame: TripFrame
  lockedItemIds?: string[]
}): AdaptResult {
  const locked = new Set(input.lockedItemIds ?? [])
  const protectedPlaceIds = input.after.considering
    .map((item) => (item.tag?.kind === 'must_visit' ? item.tag.placeId : undefined))
    .filter((placeId): placeId is string => placeId !== undefined)

  const canSchedule = canScheduleWith(input.frame, input.catalogue)

  let plan = input.plan
  const unsatisfied: UnsatisfiedPin[] = []

  for (const tag of addedTags(input.before, input.after)) {
    switch (tag.kind) {
      case 'must_visit': {
        const existing = plan.days.flatMap((day) => day.items).find((item) => item.placeId === tag.placeId)
        if (existing && (tag.dayIndex === undefined || existing.dayIndex === tag.dayIndex)) break

        // Already planned, but on another day than the one named: moved, unless it
        // is locked where it is.
        if (existing) {
          if (locked.has(existing.id)) {
            unsatisfied.push({ placeId: tag.placeId, dayIndex: tag.dayIndex, because: 'locked' })
            break
          }
          plan = {
            ...plan,
            days: plan.days.map((day) => ({ ...day, items: day.items.filter((item) => item.id !== existing.id) })),
          }
        }

        const inserted = insertPlace(plan, tag.placeId, input.catalogue, input.frame, tag.dayIndex)
        if (inserted) {
          plan = explainInserted(inserted, tag.placeId, input)
        } else {
          const place = input.catalogue.get(tag.placeId)
          const closed =
            tag.dayIndex !== undefined &&
            windowOn(place?.openingHours, weekdayKey(dateOfDay(input.frame, tag.dayIndex))) === null
          unsatisfied.push({ placeId: tag.placeId, dayIndex: tag.dayIndex, because: closed ? 'closed_that_day' : 'no_room' })
        }
        break
      }

      case 'fixed_time': {
        const result = compressDayBefore(plan, {
          dayIndex: tag.dayIndex,
          endBy: tag.time,
          lockedItemIds: [...locked],
          protectedPlaceIds,
          canSchedule,
        })
        if (result.fits) plan = result.plan
        break
      }

      case 'half_day': {
        const day = plan.days.find((d) => d.dayIndex === tag.dayIndex)
        if (!day || day.items.length === 0) break
        const firstStart = Math.min(...day.items.map((item) => toMinutes(item.startTime)))
        const result = compressDayBefore(plan, {
          dayIndex: tag.dayIndex,
          endBy: fromMinutes(firstStart + DEFAULT_HALF_DAY_MINUTES),
          lockedItemIds: [...locked],
          protectedPlaceIds,
          canSchedule,
        })
        if (result.fits) plan = result.plan
        break
      }

      case 'time_block':
      case 'budget':
      case 'avoid':
        // Ranking and warnings, not schedule surgery (§7.5, §8).
        break
    }
  }

  return { plan, unsatisfied }
}
