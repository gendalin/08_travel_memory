/** Time phases and locking (product_spec §4.3). */

import { describe, expect, it } from 'vitest'

import { dateOfDay, isItemLocked, isReadOnly, timePhase } from '../../src/domain/trip/phase.ts'
import { FRAME, item } from './fixtures.ts'

describe('timePhase', () => {
  it('is pre_trip before the start date', () => {
    expect(timePhase(FRAME, new Date('2026-10-04T23:00:00'))).toBe('pre_trip')
  })

  it('is in_trip on the first and last day', () => {
    expect(timePhase(FRAME, new Date('2026-10-05T00:01:00'))).toBe('in_trip')
    expect(timePhase(FRAME, new Date('2026-10-09T23:59:00'))).toBe('in_trip')
  })

  it('is post_trip after the end date', () => {
    expect(timePhase(FRAME, new Date('2026-10-10T00:01:00'))).toBe('post_trip')
  })
})

describe('dateOfDay', () => {
  it('maps day index onto calendar dates', () => {
    expect(dateOfDay(FRAME, 0).getDate()).toBe(5)
    expect(dateOfDay(FRAME, 4).getDate()).toBe(9)
  })
})

describe('isItemLocked', () => {
  const morning = item({ id: 'a', dayIndex: 0, startTime: '10:00', endTime: '11:00' })

  it('locks nothing before the trip starts', () => {
    expect(isItemLocked(FRAME, morning, new Date('2026-10-01T12:00:00'))).toBe(false)
  })

  it('locks an item whose start time has passed', () => {
    expect(isItemLocked(FRAME, morning, new Date('2026-10-05T10:30:00'))).toBe(true)
  })

  it('does not lock an item that has not started', () => {
    expect(isItemLocked(FRAME, morning, new Date('2026-10-05T09:30:00'))).toBe(false)
  })

  it('does not lock a later day while an earlier day is in progress', () => {
    const laterDay = item({ id: 'b', dayIndex: 2, startTime: '10:00', endTime: '11:00' })
    expect(isItemLocked(FRAME, laterDay, new Date('2026-10-05T14:00:00'))).toBe(false)
  })

  it('locks nothing once the trip is over — read-only is a separate rule', () => {
    expect(isItemLocked(FRAME, morning, new Date('2026-10-20T10:00:00'))).toBe(false)
    expect(isReadOnly(FRAME, new Date('2026-10-20T10:00:00'))).toBe(true)
  })
})
