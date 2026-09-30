/**
 * Opening hours as a rule (product_spec §8).
 *
 * The bug this replaces: the validator checked that the opening-hours FIELD
 * existed and never compared it to the time a stop was scheduled for. A measured
 * run of the default demo trip put three of fifteen stops outside opening hours
 * and reported the plan valid.
 */

import { describe, expect, it } from 'vitest'

import {
  describeHours,
  isClosedOn,
  isOpenFor,
  weekdayKey,
  windowCovering,
  windowOn,
  windowsOn,
  type OpeningHours,
} from '../../src/domain/places/openingHours.ts'

const LUNCH_ONLY: OpeningHours = {
  mon: '11:00-15:30',
  tue: '11:00-15:30',
  wed: '11:00-15:30',
  thu: '11:00-15:30',
  fri: '11:00-15:30',
  sat: '11:00-15:30',
  sun: 'closed',
}

describe('weekdayKey', () => {
  it('matches Date.getDay(), Sunday first', () => {
    // 2026-10-05 is a Monday.
    expect(weekdayKey(new Date(2026, 9, 5))).toBe('mon')
    expect(weekdayKey(new Date(2026, 9, 11))).toBe('sun')
  })
})

describe('windowOn', () => {
  it('reads a span into minutes since midnight', () => {
    expect(windowOn(LUNCH_ONLY, 'mon')).toEqual({ opens: 11 * 60, closes: 15 * 60 + 30 })
  })

  it('is null on a closed day', () => {
    expect(windowOn(LUNCH_ONLY, 'sun')).toBeNull()
  })

  it('is null when there are no hours at all', () => {
    expect(windowOn(undefined, 'mon')).toBeNull()
  })

  /**
   * Unreadable hours read as "not open", never as "unknown, allow it". The
   * failure that matters is a traveller standing outside a locked door, so the
   * safe direction is to exclude.
   */
  it('treats unreadable or inverted spans as closed rather than unknown', () => {
    expect(windowOn({ mon: 'sometimes' }, 'mon')).toBeNull()
    expect(windowOn({ mon: '18:00-09:00' }, 'mon')).toBeNull()
    expect(windowOn({ mon: '11:00' }, 'mon')).toBeNull()
  })
})

describe('isOpenFor', () => {
  it('accepts a visit wholly inside the window', () => {
    expect(isOpenFor(LUNCH_ONLY, 'mon', '13:00', '14:00')).toBe(true)
  })

  it('accepts a visit that exactly fills the window', () => {
    expect(isOpenFor(LUNCH_ONLY, 'mon', '11:00', '15:30')).toBe(true)
  })

  it('rejects arriving before opening', () => {
    expect(isOpenFor(LUNCH_ONLY, 'mon', '10:30', '11:30')).toBe(false)
  })

  /** The whole visit has to fit: leaving after closing is the same failure. */
  it('rejects a visit that runs past closing', () => {
    expect(isOpenFor(LUNCH_ONLY, 'mon', '15:00', '16:00')).toBe(false)
  })

  it('rejects any visit on a closed day', () => {
    expect(isOpenFor(LUNCH_ONLY, 'sun', '13:00', '14:00')).toBe(false)
  })
})

describe('isClosedOn and describeHours', () => {
  it('reports a closed day', () => {
    expect(isClosedOn(LUNCH_ONLY, 'sun')).toBe(true)
    expect(isClosedOn(LUNCH_ONLY, 'mon')).toBe(false)
  })

  it('describes the day for user-facing conflict copy', () => {
    expect(describeHours(LUNCH_ONLY, 'mon')).toBe('11:00-15:30')
    expect(describeHours(LUNCH_ONLY, 'sun')).toBe('closed')
    expect(describeHours(undefined, 'mon')).toBe('closed')
  })
})

describe('a day with more than one opening span', () => {
  /**
   * The bug this covers: the catalogue builder kept only a day's FIRST opening
   * period, so a sushi counter serving 12:00-14:00 and 18:00-20:30 was recorded as
   * lunch-only and a ramen shop open 07:30-09:45 and 10:00-23:00 was recorded as a
   * breakfast place. Eight of twenty-nine places in the demo catalogue were wrong.
   */
  const BOTH_SERVICES = '12:00-14:00,18:00-20:30'
  const SPLIT: OpeningHours = {
    mon: BOTH_SERVICES, tue: BOTH_SERVICES, wed: BOTH_SERVICES, thu: BOTH_SERVICES,
    fri: BOTH_SERVICES, sat: BOTH_SERVICES, sun: 'closed',
  }

  it('reads every span, earliest first', () => {
    expect(windowsOn(SPLIT, 'mon')).toEqual([
      { opens: 12 * 60, closes: 14 * 60 },
      { opens: 18 * 60, closes: 20 * 60 + 30 },
    ])
  })

  it('sorts spans given out of order', () => {
    expect(windowsOn({ mon: '18:00-20:30,12:00-14:00' }, 'mon').map((w) => w.opens)).toEqual([
      12 * 60,
      18 * 60,
    ])
  })

  it('is open for a visit inside either span', () => {
    expect(isOpenFor(SPLIT, 'mon', '12:30', '13:30')).toBe(true)
    expect(isOpenFor(SPLIT, 'mon', '18:30', '20:00')).toBe(true)
  })

  /** Sitting through the break would mean an hour in a shut restaurant. */
  it('is not open for a visit that spans the break', () => {
    expect(isOpenFor(SPLIT, 'mon', '13:30', '18:30')).toBe(false)
    expect(isOpenFor(SPLIT, 'mon', '15:00', '16:00')).toBe(false)
  })

  it('reports the span a visit would fall in', () => {
    expect(windowCovering(SPLIT, 'mon', '19:00')?.closes).toBe(20 * 60 + 30)
    expect(windowCovering(SPLIT, 'mon', '12:30')?.closes).toBe(14 * 60)
    expect(windowCovering(SPLIT, 'mon', '16:00')).toBeNull()
  })

  it('still reports the day closed when every span is', () => {
    expect(isClosedOn(SPLIT, 'sun')).toBe(true)
    expect(isClosedOn(SPLIT, 'mon')).toBe(false)
  })

  it('drops an unreadable span without losing the readable one', () => {
    expect(windowsOn({ mon: 'sometimes,18:00-20:30' }, 'mon')).toEqual([
      { opens: 18 * 60, closes: 20 * 60 + 30 },
    ])
  })

  it('describes both spans for a conflict message', () => {
    expect(describeHours(SPLIT, 'mon')).toBe('12:00-14:00 and 18:00-20:30')
    expect(describeHours(SPLIT, 'sun')).toBe('closed')
  })

  it('keeps windowOn meaning the first span, for callers that only need opening', () => {
    expect(windowOn(SPLIT, 'mon')).toEqual({ opens: 12 * 60, closes: 14 * 60 })
  })
})
