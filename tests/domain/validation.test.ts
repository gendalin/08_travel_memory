/** Validation engine (product_spec §8). */

import { describe, expect, it } from 'vitest'

import { validatePlan, type ValidationContext } from '../../src/domain/validation/validate.ts'
import { DEFAULT_PLACES, FRAME, basePlan, day, emptyState, item, plan, placeMap, state } from './fixtures.ts'

const NOW = new Date('2026-09-01T09:00:00')

function context(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return { frame: FRAME, state: emptyState(), places: DEFAULT_PLACES, now: NOW, ...overrides }
}

function codes(result: ReturnType<typeof validatePlan>) {
  return result.errors.map((error) => error.code)
}

describe('validatePlan', () => {
  it('accepts a well-formed plan', () => {
    expect(validatePlan(basePlan(), context()).valid).toBe(true)
  })

  it('rejects an invented POI id', () => {
    const invalid = plan([day(0, [item({ id: 'a', placeId: 'place_does_not_exist' })])])
    expect(codes(validatePlan(invalid, context()))).toContain('unknown_poi')
  })

  it('rejects a POI with no opening-hours data', () => {
    const places = new Map(DEFAULT_PLACES)
    places.set('place_a', { placeId: 'place_a' })
    expect(codes(validatePlan(basePlan(), context({ places })))).toContain('missing_opening_hours')
  })

  it('rejects overlapping items', () => {
    const overlapping = plan([
      day(0, [
        item({ id: 'a', placeId: 'place_a', startTime: '10:00', endTime: '12:00' }),
        item({ id: 'b', placeId: 'place_b', startTime: '11:00', endTime: '13:00' }),
      ]),
    ])
    expect(codes(validatePlan(overlapping, context()))).toContain('overlapping_items')
  })

  it('allows items that merely touch at the boundary', () => {
    const touching = plan([
      day(0, [
        item({ id: 'a', placeId: 'place_a', startTime: '10:00', endTime: '11:00' }),
        item({ id: 'b', placeId: 'place_b', startTime: '11:00', endTime: '12:00' }),
      ]),
    ])
    expect(validatePlan(touching, context()).valid).toBe(true)
  })

  it('requires each day to start and end at base lodging', () => {
    const adrift = plan([
      { dayIndex: 0, startsAt: { placeId: 'place_a', name: 'Somewhere else' }, endsAt: FRAME.baseLodging, items: [] },
    ])
    expect(codes(validatePlan(adrift, context()))).toContain('day_not_anchored_at_lodging')
  })

  it('rejects a change to a locked item', () => {
    const inTrip = new Date('2026-10-05T14:00:00')
    const committed = basePlan()
    const proposed = plan([
      day(0, [
        item({ id: 'a', placeId: 'place_d', startTime: '10:00', endTime: '11:00' }),
        ...basePlan().days[0].items.slice(1),
      ]),
    ])
    const result = validatePlan(proposed, context({ committedPlan: committed, now: inTrip }))
    expect(codes(result)).toContain('locked_item_changed')
  })

  it('allows changing an item that has not started yet', () => {
    const inTrip = new Date('2026-10-05T11:30:00')
    const proposed = plan([
      day(0, [
        ...basePlan().days[0].items.slice(0, 2),
        item({ id: 'c', placeId: 'place_d', startTime: '16:00', endTime: '17:00' }),
      ]),
    ])
    const result = validatePlan(proposed, context({ committedPlan: basePlan(), now: inTrip }))
    expect(codes(result)).not.toContain('locked_item_changed')
  })

  it('enforces a must-visit constraint', () => {
    const withMustVisit = state({
      considering: [{ id: 'c1', text: 'Must visit Nezu Museum', tag: { kind: 'must_visit', placeId: 'place_d' } }],
    })
    expect(codes(validatePlan(basePlan(), context({ state: withMustVisit })))).toContain('must_visit_missing')
  })

  it('enforces a fixed-time constraint', () => {
    const airport = state({
      considering: [{ id: 'c1', text: 'Reach Haneda by 15:00', tag: { kind: 'fixed_time', dayIndex: 0, time: '15:00' } }],
    })
    expect(codes(validatePlan(basePlan(), context({ state: airport })))).toContain('fixed_time_violated')
  })

  it('enforces a required free time block', () => {
    const laptopWork = state({
      considering: [{ id: 'c1', text: 'Two hours for laptop work', tag: { kind: 'time_block', dayIndex: 0, minutes: 300 } }],
    })
    expect(codes(validatePlan(basePlan(), context({ state: laptopWork })))).toContain('time_block_missing')
  })

  it('enforces a half day', () => {
    const halfDay = state({
      considering: [{ id: 'c1', text: 'Day 1 is a half day', tag: { kind: 'half_day', dayIndex: 0 } }],
    })
    expect(codes(validatePlan(basePlan(), context({ state: halfDay, halfDayMinutes: 240 })))).toContain('half_day_exceeded')
  })

  it('does not invalidate a plan for a soft budget constraint', () => {
    const budget = state({
      considering: [{ id: 'c1', text: 'Keep budget moderate', tag: { kind: 'budget', level: 'low' } }],
    })
    expect(validatePlan(basePlan(), context({ state: budget })).valid).toBe(true)
  })

  it('reports every failure at once rather than stopping at the first', () => {
    const broken = plan([
      { dayIndex: 0, startsAt: { placeId: 'nope', name: 'Nope' }, endsAt: FRAME.baseLodging, items: [
        item({ id: 'a', placeId: 'ghost', startTime: '10:00', endTime: '12:00' }),
        item({ id: 'b', placeId: 'ghost2', startTime: '11:00', endTime: '13:00' }),
      ] },
    ])
    const result = validatePlan(broken, context({ places: placeMap([]) }))
    expect(new Set(codes(result))).toEqual(new Set(['unknown_poi', 'overlapping_items', 'day_not_anchored_at_lodging']))
  })
})

describe('poi_closed_at_time (§8)', () => {
  /**
   * The gap this closes: `missing_opening_hours` only ever checked that the
   * field existed. Three of fifteen stops in the default demo trip sat outside
   * opening hours — a ramen counter nearly four hours after it shut, an izakaya
   * before it opened, a market as it packed up — and the plan came back valid.
   */
  const LUNCH_ONLY = {
    mon: '11:00-15:30', tue: '11:00-15:30', wed: '11:00-15:30', thu: '11:00-15:30',
    fri: '11:00-15:30', sat: '11:00-15:30', sun: 'closed',
  }

  /** FRAME starts 2026-10-05, a Monday, so day index 0 is a Monday. */
  function lunchPlaces() {
    const places = new Map(DEFAULT_PLACES)
    places.set('place_a', { placeId: 'place_a', openingHours: LUNCH_ONLY })
    return places
  }

  function stopAt(startTime: string, endTime: string, dayIndex = 0) {
    return plan([day(dayIndex, [item({ id: 'a', placeId: 'place_a', dayIndex, startTime, endTime })])])
  }

  it('accepts a stop inside the window', () => {
    expect(validatePlan(stopAt('12:00', '13:00'), context({ places: lunchPlaces() })).valid).toBe(true)
  })

  it('accepts a stop that exactly fills the window', () => {
    expect(validatePlan(stopAt('11:00', '15:30'), context({ places: lunchPlaces() })).valid).toBe(true)
  })

  it('rejects a stop after closing', () => {
    expect(codes(validatePlan(stopAt('16:00', '17:00'), context({ places: lunchPlaces() }))))
      .toContain('poi_closed_at_time')
  })

  it('rejects a stop before opening', () => {
    expect(codes(validatePlan(stopAt('10:00', '10:45'), context({ places: lunchPlaces() }))))
      .toContain('poi_closed_at_time')
  })

  /** The whole visit has to fit: leaving after closing is the same failure. */
  it('rejects a stop that starts inside the window but runs past closing', () => {
    expect(codes(validatePlan(stopAt('15:00', '16:00'), context({ places: lunchPlaces() }))))
      .toContain('poi_closed_at_time')
  })

  it('rejects a stop on a day the place is shut', () => {
    // Day index 6 is the Sunday after a Monday start.
    expect(codes(validatePlan(stopAt('12:00', '13:00', 6), context({ places: lunchPlaces() }))))
      .toContain('poi_closed_at_time')
  })

  it('names the day and the hours, so a Conflict can say why', () => {
    const [error] = validatePlan(stopAt('16:00', '17:00'), context({ places: lunchPlaces() }))
      .errors.filter((entry) => entry.code === 'poi_closed_at_time')

    expect(error.message).toContain('11:00-15:30')
    expect(error.dayIndex).toBe(0)
    expect(error.itemIds).toEqual(['a'])
  })

  it('reports missing hours instead, never both for one stop', () => {
    const places = new Map(DEFAULT_PLACES)
    places.set('place_a', { placeId: 'place_a' })
    const reported = codes(validatePlan(stopAt('12:00', '13:00'), context({ places })))

    expect(reported).toContain('missing_opening_hours')
    expect(reported).not.toContain('poi_closed_at_time')
  })
})
