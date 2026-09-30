/**
 * Time phases and item locking (product_spec §4.3).
 *
 *   pre_trip  : now < startDate            — nothing locked
 *   in_trip   : startDate <= now <= endDate — items already started are locked
 *   post_trip : now > endDate              — itinerary read-only
 */

import type { PlanItem } from '../plan/types.ts'
import type { TimePhase, TripFrame } from './types.ts'

/** Local calendar comparison: the frame's dates carry no timezone. */
function toDayNumber(date: Date): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()
}

function parseDayNumber(yyyyMmDd: string): number {
  return Number(yyyyMmDd.replace(/-/g, ''))
}

export function timePhase(frame: TripFrame, now: Date): TimePhase {
  const today = toDayNumber(now)
  if (today < parseDayNumber(frame.startDate)) return 'pre_trip'
  if (today > parseDayNumber(frame.endDate)) return 'post_trip'
  return 'in_trip'
}

/** Calendar date of a zero-based day index within the trip. */
export function dateOfDay(frame: TripFrame, dayIndex: number): Date {
  const [year, month, day] = frame.startDate.split('-').map(Number)
  return new Date(year, month - 1, day + dayIndex)
}

/**
 * An item is locked when the trip is in progress and the item's start time has
 * already passed. Before and after the trip nothing is locked — a finished trip
 * is read-only as a whole, which is a separate rule.
 */
export function isItemLocked(frame: TripFrame, item: PlanItem, now: Date): boolean {
  if (timePhase(frame, now) !== 'in_trip') return false

  const itemDate = dateOfDay(frame, item.dayIndex)
  const [hours, minutes] = item.startTime.split(':').map(Number)
  itemDate.setHours(hours, minutes, 0, 0)
  return itemDate.getTime() < now.getTime()
}

export function isReadOnly(frame: TripFrame, now: Date): boolean {
  return timePhase(frame, now) === 'post_trip'
}
