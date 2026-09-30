/**
 * Plan reschedule transforms (product_spec §7.3, §7.4).
 *
 * Pure domain: no catalogue, no model, no I/O. These are the rules Reorganize
 * and Reframe are built on, so they are proved on fixtures rather than through
 * the application layer.
 */

import { describe, expect, it } from 'vitest'

import {
  compressDayBefore,
  reduceStopsPerDay,
  retimeAfter,
} from '../../src/domain/plan/reschedule.ts'
import { allItems, fromMinutes, toMinutes, type PlanItem } from '../../src/domain/plan/types.ts'
import { basePlan, day, item, plan } from './fixtures.ts'

describe('fromMinutes', () => {
  it('round-trips with toMinutes', () => {
    for (const time of ['00:00', '09:05', '13:30', '21:00', '23:59']) {
      expect(fromMinutes(toMinutes(time))).toBe(time)
    }
  })
})

describe('compressDayBefore', () => {
  it('pulls later stops earlier so the day ends before the cut-off', () => {
    const result = compressDayBefore(basePlan(), { dayIndex: 0, endBy: '15:00' })

    expect(result.fits).toBe(true)
    expect(result.dropped).toEqual([])

    const items = allItems(result.plan)
    expect(items.map((entry) => entry.startTime)).toEqual(['10:00', '11:30', '13:00'])
    expect(items[items.length - 1].endTime <= '15:00').toBe(true)
  })

  it('keeps the day starting when it already started', () => {
    const result = compressDayBefore(basePlan(), { dayIndex: 0, endBy: '15:00' })
    expect(allItems(result.plan)[0].startTime).toBe('10:00')
  })

  it('keeps the running order', () => {
    const result = compressDayBefore(basePlan(), { dayIndex: 0, endBy: '15:00' })
    expect(allItems(result.plan).map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
  })

  it('narrows the gaps before it drops anything', () => {
    // Three 60-minute stops need 180 + gaps; 10:00 -> 13:20 fits only at 10.
    const result = compressDayBefore(basePlan(), { dayIndex: 0, endBy: '13:20' })

    expect(result.fits).toBe(true)
    expect(result.dropped).toEqual([])
    expect(allItems(result.plan).map((entry) => entry.startTime)).toEqual([
      '10:00', '11:10', '12:20',
    ])
  })

  it('drops the trailing stop only when no gap fits', () => {
    const result = compressDayBefore(basePlan(), { dayIndex: 0, endBy: '12:30' })

    expect(result.fits).toBe(true)
    expect(result.dropped.map((entry) => entry.id)).toEqual(['c'])
    expect(allItems(result.plan).map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('never drops a must-visit', () => {
    const result = compressDayBefore(basePlan(), {
      dayIndex: 0,
      endBy: '12:30',
      protectedPlaceIds: ['place_c'],
    })

    expect(result.dropped.map((entry) => entry.id)).toEqual(['b'])
    expect(allItems(result.plan).map((entry) => entry.id)).toEqual(['a', 'c'])
  })

  it('reports no fit when only protected stops are left and they overrun', () => {
    const result = compressDayBefore(basePlan(), {
      dayIndex: 0,
      endBy: '10:30',
      protectedPlaceIds: ['place_a', 'place_b', 'place_c'],
    })

    expect(result.fits).toBe(false)
    expect(result.plan).toEqual(basePlan())
  })

  it('leaves a locked stop exactly where it is', () => {
    const result = compressDayBefore(basePlan(), {
      dayIndex: 0,
      endBy: '15:00',
      lockedItemIds: ['a'],
    })

    const locked = allItems(result.plan).find((entry) => entry.id === 'a')
    expect(locked?.startTime).toBe('10:00')
    expect(locked?.endTime).toBe('11:00')
  })

  it('leaves other days untouched', () => {
    const two = plan([
      day(0, [item({ id: 'a', startTime: '10:00', endTime: '11:00' })]),
      day(1, [item({ id: 'b', dayIndex: 1, startTime: '16:00', endTime: '17:00' })]),
    ])
    const result = compressDayBefore(two, { dayIndex: 0, endBy: '12:00' })
    expect(result.plan.days[1]).toEqual(two.days[1])
  })
})

describe('reduceStopsPerDay', () => {
  it('thins each day from the end', () => {
    const result = reduceStopsPerDay(basePlan(), { maxPerDay: 2 })

    expect(result.fits).toBe(true)
    expect(result.dropped.map((entry) => entry.id)).toEqual(['c'])
    expect(allItems(result.plan).map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it('leaves the times of what remains alone', () => {
    const result = reduceStopsPerDay(basePlan(), { maxPerDay: 2 })
    expect(allItems(result.plan).map((entry) => entry.startTime)).toEqual(['10:00', '13:00'])
  })

  it('skips must-visits and drops the next one up instead', () => {
    const result = reduceStopsPerDay(basePlan(), { maxPerDay: 2, protectedPlaceIds: ['place_c'] })
    expect(result.dropped.map((entry) => entry.id)).toEqual(['b'])
  })

  it('skips locked stops', () => {
    const result = reduceStopsPerDay(basePlan(), { maxPerDay: 2, lockedItemIds: ['c'] })
    expect(result.dropped.map((entry) => entry.id)).toEqual(['b'])
  })

  it('reports no fit when every stop is protected', () => {
    const result = reduceStopsPerDay(basePlan(), {
      maxPerDay: 1,
      protectedPlaceIds: ['place_a', 'place_b', 'place_c'],
    })
    expect(result.fits).toBe(false)
    expect(result.dropped).toEqual([])
  })

  it('is a no-op for a day already under the cap', () => {
    const single = plan([day(0, [item({ id: 'a' })])])
    expect(reduceStopsPerDay(single, { maxPerDay: 3 }).plan).toEqual(single)
  })
})

describe('retimeAfter', () => {
  it('extends one stop and pushes what follows it', () => {
    const result = retimeAfter(basePlan(), { itemId: 'a', endTime: '13:30' })

    expect(result.fits).toBe(true)
    const items = allItems(result.plan)
    expect(items[0].endTime).toBe('13:30')
    expect(items[1].startTime).toBe('13:40')
    expect(items[2].startTime).toBe('16:00')
  })

  it('leaves earlier stops alone', () => {
    const result = retimeAfter(basePlan(), { itemId: 'b', endTime: '15:00' })
    expect(allItems(result.plan)[0]).toEqual(allItems(basePlan())[0])
  })

  it('refuses to move a locked stop out of the way', () => {
    const result = retimeAfter(basePlan(), {
      itemId: 'a',
      endTime: '13:30',
      lockedItemIds: ['b'],
    })
    expect(result.fits).toBe(false)
  })

  it('reports no fit when the day would run past the evening', () => {
    const result = retimeAfter(basePlan(), { itemId: 'a', endTime: '20:30' })
    expect(result.fits).toBe(false)
  })
})

describe('compressing a day respects opening hours', () => {
  /**
   * The gap this closes. Pulling a day forward moved stops purely by arithmetic, so
   * a bathhouse that opens at 14:00 landed in a 12:40 slot. The validator refused
   * the plan, and its refusal reached the user as "this day cannot finish by 15:00"
   * — true, and not the reason.
   */
  const dayOf = (items: PlanItem[]) => plan([day(0, items)])

  const late = item({ id: 'late', placeId: 'place_late', startTime: '16:30', endTime: '17:30' })
  const early = item({ id: 'early', placeId: 'place_early', startTime: '10:00', endTime: '11:00' })
  const middle = item({ id: 'middle', placeId: 'place_middle', startTime: '13:30', endTime: '14:30' })

  /** Only `place_late` is fussy: it cannot start before 14:00. */
  const canSchedule = (moved: PlanItem, startTime: string) =>
    moved.placeId !== 'place_late' || startTime >= '14:00'

  it('drops the stop the doors refuse rather than the last one', () => {
    const result = compressDayBefore(dayOf([early, middle, late]), {
      dayIndex: 0,
      endBy: '15:00',
      canSchedule,
    })

    expect(result.fits).toBe(true)
    expect(result.dropped.map((entry) => entry.id)).toEqual(['late'])
    // The middle stop survives, because nothing was wrong with it.
    const kept = result.plan.days[0].items.map((entry) => entry.id)
    expect(kept).toContain('middle')
  })

  it('never leaves a stop at a time the predicate refuses', () => {
    const result = compressDayBefore(dayOf([early, middle, late]), {
      dayIndex: 0,
      endBy: '15:00',
      canSchedule,
    })

    for (const entry of result.plan.days[0].items) {
      expect(canSchedule(entry, entry.startTime)).toBe(true)
    }
  })

  it('behaves as before when nothing is fussy', () => {
    const withPredicate = compressDayBefore(dayOf([early, middle, late]), {
      dayIndex: 0,
      endBy: '15:00',
      canSchedule: () => true,
    })
    const without = compressDayBefore(dayOf([early, middle, late]), { dayIndex: 0, endBy: '15:00' })

    expect(JSON.stringify(withPredicate)).toBe(JSON.stringify(without))
  })

  it('keeps a protected stop even when the doors refuse it, and reports no fit', () => {
    const result = compressDayBefore(dayOf([early, late]), {
      dayIndex: 0,
      endBy: '15:00',
      protectedPlaceIds: ['place_late', 'place_early'],
      canSchedule,
    })

    expect(result.fits).toBe(false)
    expect(result.dropped).toEqual([])
  })
})
