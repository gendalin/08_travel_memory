/**
 * Pure Plan transforms behind Reorganize and Reframe (product_spec §7.3, §7.4).
 *
 * These build a *candidate* Plan. They never validate, never persist, and never
 * decide what kind of change they made — the validator and the classifier read
 * the result afterwards. Keeping them here, rather than in the application
 * layer, is what lets the reschedule rules be unit-tested on fixtures without a
 * catalogue or a model.
 *
 * Two rules constrain every transform:
 *   - a locked item (already happened, §4.3) is never moved or dropped,
 *   - a protected place (a must-visit from Considering) is never dropped.
 */

import type { ID } from '../trip/types.ts'
import { durationMinutes, fromMinutes, toMinutes, type Plan, type PlanDay, type PlanItem } from './types.ts'

/**
 * Gaps tried between stops, longest first. A day is re-packed with the most
 * generous gap that still fits; only if none fit does an item get dropped.
 */
export const GAP_LADDER_MINUTES = [30, 20, 10]

export interface RescheduleResult {
  plan: Plan
  /** Items removed to make the day fit. Empty when nothing had to go. */
  dropped: PlanItem[]
  /** False when even an empty-gap pack cannot satisfy the request. */
  fits: boolean
}

interface Guards {
  /** Items that already happened and must keep their place and time. */
  lockedItemIds?: ID[]
  /** Places a Considering must-visit pins into the plan. */
  protectedPlaceIds?: string[]
  /**
   * Whether a stop may sit at this time at all — opening hours, in practice.
   *
   * A predicate rather than the hours themselves, so the domain stays free of the
   * catalogue. Absent means no restriction, which is how the transforms behaved
   * before: retiming knew about the cut-off and about locked items and nothing
   * about doors. A day pulled forward put a bathhouse that opens at 14:00 into a
   * 12:40 slot, and the validator's refusal reached the user as "this day cannot
   * finish by 15:00" — true, but not the reason.
   */
  canSchedule?: (item: PlanItem, startTime: string, endTime: string) => boolean
}

/** Whether every packed stop may sit where it was packed. */
function allSchedulable(items: PlanItem[], guards: Guards): boolean {
  const canSchedule = guards.canSchedule
  if (!canSchedule) return true
  return items.every((item) => canSchedule(item, item.startTime, item.endTime))
}

function byStart(a: PlanItem, b: PlanItem): number {
  return a.startTime.localeCompare(b.startTime)
}

function replaceDay(plan: Plan, day: PlanDay): Plan {
  return { ...plan, days: plan.days.map((d) => (d.dayIndex === day.dayIndex ? day : d)) }
}

/**
 * Packs `movable` back-to-back from `startAt` with a fixed gap, keeping each
 * item's own duration. Returns the packed items and the minute the day ends.
 */
function pack(movable: PlanItem[], startAt: number, gap: number): { items: PlanItem[]; endsAt: number } {
  let cursor = startAt
  const items = movable.map((item) => {
    const length = durationMinutes(item)
    const packed = { ...item, startTime: fromMinutes(cursor), endTime: fromMinutes(cursor + length) }
    cursor += length + gap
    return packed
  })
  return { items, endsAt: items.length === 0 ? startAt : toMinutes(items[items.length - 1].endTime) }
}

/**
 * Pulls a day forward so it is finished by `endBy` — the shape of "it will rain
 * from 15:00" or "I have a dinner booking".
 *
 * The day keeps its original first start; later stops move earlier. Dropping is
 * the last resort, and the trailing stop goes first because the end of the day
 * is the part the cut-off actually threatens.
 */
export function compressDayBefore(
  plan: Plan,
  options: { dayIndex: number; endBy: string } & Guards,
): RescheduleResult {
  const day = plan.days.find((d) => d.dayIndex === options.dayIndex)
  if (!day || day.items.length === 0) return { plan, dropped: [], fits: true }

  const locked = new Set(options.lockedItemIds ?? [])
  const protectedPlaces = new Set(options.protectedPlaceIds ?? [])
  const deadline = toMinutes(options.endBy)

  const ordered = [...day.items].sort(byStart)
  const anchored = ordered.filter((item) => locked.has(item.id))
  let movable = ordered.filter((item) => !locked.has(item.id))

  // Movable stops start after the day's own first stop, or after the last
  // locked stop — whichever is later.
  const firstStart = toMinutes(ordered[0].startTime)
  const afterLocked = anchored.length === 0
    ? firstStart
    : Math.max(firstStart, ...anchored.map((item) => toMinutes(item.endTime) + GAP_LADDER_MINUTES[2]))

  const dropped: PlanItem[] = []

  for (;;) {
    /** Stops that no gap setting could place at an hour they are open. */
    let unschedulable: Set<ID> | undefined

    for (const gap of GAP_LADDER_MINUTES) {
      const { items, endsAt } = pack(movable, afterLocked, gap)
      if (endsAt > deadline) continue

      if (allSchedulable(items, options)) {
        const merged = [...anchored, ...items].sort(byStart)
        return { plan: replaceDay(plan, { ...day, items: merged }), dropped, fits: true }
      }

      // Record which stops the doors refuse, so the drop below can be specific.
      const refused = items.filter(
        (item) => !options.canSchedule?.(item, item.startTime, item.endTime),
      )
      unschedulable = unschedulable
        ? new Set([...unschedulable].filter((id) => refused.some((item) => item.id === id)))
        : new Set(refused.map((item) => item.id))
    }

    // Drop the stop that cannot be opened at any workable time before falling back
    // to the trailing one: naming the actual obstacle beats sacrificing the end of
    // the day to a door that was never going to open.
    const droppable = [...movable]
      .map((item, index) => ({ item, index }))
      .filter((entry) => !protectedPlaces.has(entry.item.placeId))

    const dropIndex =
      droppable.find((entry) => unschedulable?.has(entry.item.id))?.index ??
      [...droppable].reverse()[0]?.index

    if (dropIndex === undefined) break

    dropped.push(movable[dropIndex])
    movable = movable.filter((_, index) => index !== dropIndex)

    if (movable.length === 0) {
      const merged = [...anchored].sort(byStart)
      const endsAt = merged.length === 0 ? 0 : toMinutes(merged[merged.length - 1].endTime)
      return {
        plan: replaceDay(plan, { ...day, items: merged }),
        dropped,
        fits: endsAt <= deadline,
      }
    }
  }

  // Only protected or locked stops are left and they still overrun the cut-off.
  return { plan, dropped: [], fits: false }
}

/**
 * Thins every day down to at most `maxPerDay` stops — "I feel tired. Fewer
 * spots." The trailing stop of a day goes first: a shorter day is the point.
 *
 * Times are left alone. Removing the evening stop does not make the morning
 * wrong, and a smaller diff is easier for the user to check.
 */
export function reduceStopsPerDay(
  plan: Plan,
  options: {
    maxPerDay: number
    /** Items that must stay regardless — the day's meals, for a traveller who is tired. */
    keepItemIds?: ID[]
    /**
     * How much dropping this item is worth; the highest goes first. Absent: the last
     * stop of the day goes first, which is what this did before 2026-09-30 — and why
     * "I'm tired" used to cost the traveller every dinner of the trip.
     */
    dropValue?: (item: PlanItem, day: PlanItem[]) => number
    /** Only these days are thinned. Absent: every day. */
    dayIndexes?: number[]
  } & Guards,
): RescheduleResult {
  const locked = new Set(options.lockedItemIds ?? [])
  const protectedPlaces = new Set(options.protectedPlaceIds ?? [])
  const kept = new Set(options.keepItemIds ?? [])
  const dropped: PlanItem[] = []

  const days = plan.days.map((day) => {
    const keep = [...day.items].sort(byStart)
    if (options.dayIndexes && !options.dayIndexes.includes(day.dayIndex)) return { ...day, items: keep }

    while (keep.length > options.maxPerDay) {
      const droppable = keep
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => !locked.has(item.id) && !protectedPlaces.has(item.placeId) && !kept.has(item.id))
      if (droppable.length === 0) break
      const choice = options.dropValue
        ? droppable.reduce((best, entry) => (options.dropValue!(entry.item, keep) > options.dropValue!(best.item, keep) ? entry : best))
        : droppable[droppable.length - 1]
      dropped.push(choice.item)
      keep.splice(choice.index, 1)
    }

    return { ...day, items: keep }
  })

  return {
    plan: { ...plan, days },
    dropped,
    // Days that are all locked or all must-visits stay over the cap; the caller
    // decides whether that is a conflict or simply the best available.
    fits: days.every((day) => day.items.length <= options.maxPerDay || (options.dayIndexes !== undefined && !options.dayIndexes.includes(day.dayIndex))),
  }
}

/** Latest a stop may end. Past this a "day" stops being one. */
export const LATEST_END = '21:00'

/**
 * Gives one stop a longer window and pushes whatever follows it on that day,
 * keeping the running order and each stop's own length.
 *
 * This is what an Alternative that does not fit its slot costs: not a swap, but
 * a reshaped afternoon — which is why the caller has to show it as such.
 */
export function retimeAfter(
  plan: Plan,
  options: {
    itemId: ID
    /** New end time for the item itself. */
    endTime: string
    gapMinutes?: number
    latestEnd?: string
  } & Guards,
): RescheduleResult {
  const day = plan.days.find((d) => d.items.some((item) => item.id === options.itemId))
  if (!day) return { plan, dropped: [], fits: false }

  const locked = new Set(options.lockedItemIds ?? [])
  const gap = options.gapMinutes ?? GAP_LADDER_MINUTES[2]
  const latest = toMinutes(options.latestEnd ?? LATEST_END)

  const ordered = [...day.items].sort(byStart)
  const anchorIndex = ordered.findIndex((item) => item.id === options.itemId)
  if (locked.has(options.itemId)) return { plan, dropped: [], fits: false }

  const updated: PlanItem[] = ordered.map((item, index) =>
    index === anchorIndex ? { ...item, endTime: options.endTime } : item,
  )

  let cursor = toMinutes(options.endTime)
  for (let index = anchorIndex + 1; index < updated.length; index++) {
    const item = updated[index]
    if (locked.has(item.id)) return { plan, dropped: [], fits: false }

    const length = durationMinutes(item)
    const start = Math.max(toMinutes(item.startTime), cursor + gap)
    updated[index] = { ...item, startTime: fromMinutes(start), endTime: fromMinutes(start + length) }
    cursor = start + length
  }

  const endsAt = updated.length === 0 ? 0 : toMinutes(updated[updated.length - 1].endTime)
  return { plan: replaceDay(plan, { ...day, items: updated }), dropped: [], fits: endsAt <= latest }
}
