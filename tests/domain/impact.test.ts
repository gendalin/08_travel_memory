/** Expected Impact (product_spec §7.5) — including the no-false-precision rule. */

import { describe, expect, it } from 'vitest'

import { diffPlans } from '../../src/domain/plan/diff.ts'
import { computeExpectedImpact, type PlaceFacts } from '../../src/domain/proposals/impact.ts'
import { basePlan, day, item, plan } from './fixtures.ts'

describe('computeExpectedImpact', () => {
  it('counts affected items', () => {
    const after = plan([day(0, [item({ id: 'a', placeId: 'place_d' }), ...basePlan().days[0].items.slice(1)])])
    const impact = computeExpectedImpact(basePlan(), after, diffPlans(basePlan(), after))
    expect(impact.itemsAffected).toBe(1)
    expect(impact.poiCountDelta).toBe(0)
  })

  it('reports a negative POI delta when an item is removed', () => {
    const after = plan([day(0, basePlan().days[0].items.slice(0, 2))])
    const impact = computeExpectedImpact(basePlan(), after, diffPlans(basePlan(), after))
    expect(impact.poiCountDelta).toBe(-1)
  })

  it('returns null distance when coordinates are unavailable', () => {
    const impact = computeExpectedImpact(basePlan(), basePlan(), diffPlans(basePlan(), basePlan()))
    expect(impact.walkingDistanceDeltaM).toBeNull()
  })

  it('returns null distance when only some places have coordinates', () => {
    const partial = new Map<string, PlaceFacts>([
      ['lodging_kuramae', { lat: 35.7, lng: 139.79 }],
      ['place_a', { lat: 35.71, lng: 139.79 }],
      ['place_b', {}],
      ['place_c', { lat: 35.72, lng: 139.8 }],
    ])
    const impact = computeExpectedImpact(basePlan(), basePlan(), diffPlans(basePlan(), basePlan()), {
      places: partial,
    })
    expect(impact.walkingDistanceDeltaM).toBeNull()
  })

  it('computes a distance delta when every place has coordinates', () => {
    const places = new Map<string, PlaceFacts>([
      ['lodging_kuramae', { lat: 35.7, lng: 139.79 }],
      ['place_a', { lat: 35.71, lng: 139.79 }],
      ['place_b', { lat: 35.72, lng: 139.79 }],
      ['place_c', { lat: 35.73, lng: 139.79 }],
      ['place_d', { lat: 35.8, lng: 139.79 }],
    ])
    const after = plan([
      day(0, [item({ id: 'a', placeId: 'place_d' }), ...basePlan().days[0].items.slice(1)]),
    ])
    const impact = computeExpectedImpact(basePlan(), after, diffPlans(basePlan(), after), { places })
    expect(impact.walkingDistanceDeltaM).not.toBeNull()
    expect(impact.walkingDistanceDeltaM).toBeGreaterThan(0)
  })

  it('never estimates travel time in the domain', () => {
    const impact = computeExpectedImpact(basePlan(), basePlan(), diffPlans(basePlan(), basePlan()))
    expect(impact.travelTimeDeltaMin).toBeNull()
  })

  it('reports free time going UP when a stop is removed', () => {
    const after = plan([day(0, basePlan().days[0].items.slice(0, 2))])
    const impact = computeExpectedImpact(basePlan(), after, diffPlans(basePlan(), after))
    // One 60-minute stop less committed is 60 minutes of the day handed back.
    expect(impact.freeTimeDeltaMin).toBe(60)
  })

  it('reports no free-time change when stops only move', () => {
    const moved = plan([
      day(0, [
        item({ id: 'a', placeId: 'place_a', startTime: '10:00', endTime: '11:00' }),
        item({ id: 'b', placeId: 'place_b', startTime: '11:30', endTime: '12:30' }),
        item({ id: 'c', placeId: 'place_c', startTime: '13:00', endTime: '14:00' }),
      ]),
    ])
    const impact = computeExpectedImpact(basePlan(), moved, diffPlans(basePlan(), moved))
    // The day is earlier, not emptier: nothing was handed back, so say nothing.
    expect(impact.freeTimeDeltaMin).toBe(0)
  })

  it('warns, without pricing, when a change pushes a stop over the budget level', () => {
    const places = new Map<string, PlaceFacts>([
      ['place_a', { priceLevel: 1 }],
      ['place_b', { priceLevel: 1 }],
      ['place_c', { priceLevel: 1 }],
      ['place_expensive', { priceLevel: 4 }],
    ])
    const after = plan([
      day(0, [
        item({ id: 'a', placeId: 'place_expensive', startTime: '10:00', endTime: '11:00' }),
        ...basePlan().days[0].items.slice(1),
      ]),
    ])
    const impact = computeExpectedImpact(basePlan(), after, diffPlans(basePlan(), after), {
      places,
      budget: { kind: 'budget', level: 'low' },
    })
    expect(impact.budgetWarning).toBe('1 more item above the low budget level')
  })

  it('stays silent about a budget problem the change did not cause', () => {
    // The over-budget stop is in both plans: it is not an impact of this change.
    const places = new Map<string, PlaceFacts>([['place_a', { priceLevel: 4 }]])
    const impact = computeExpectedImpact(basePlan(), basePlan(), diffPlans(basePlan(), basePlan()), {
      places,
      budget: { kind: 'budget', level: 'low' },
    })
    expect(impact.budgetWarning).toBeNull()
  })

  it('stays silent on budget when no constraint is set', () => {
    const impact = computeExpectedImpact(basePlan(), basePlan(), diffPlans(basePlan(), basePlan()), {
      places: new Map([['place_a', { priceLevel: 4 }]]),
    })
    expect(impact.budgetWarning).toBeNull()
  })
})
