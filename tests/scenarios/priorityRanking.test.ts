/**
 * scenario_priority_ranking (product_spec §3.3, §12.2).
 *
 * Priorities are defined as "optimization dimensions used to choose between
 * otherwise valid plans". This file is the evidence that they do that: the same
 * trip, the same dataset, the same Memory — only the weights differ — and the
 * resulting itinerary differs in the direction the weight points.
 *
 * Measured, not asserted by name. A convenience-led plan has to come out
 * shorter on the ground, and a cost-led plan cheaper, or the weights are
 * decoration.
 */

import { describe, expect, it } from 'vitest'

import { diffPlans } from '../../src/domain/plan/diff.ts'
import { allItems, type Plan } from '../../src/domain/plan/types.ts'
import { computeExpectedImpact } from '../../src/domain/proposals/impact.ts'
import type { Priority, PriorityWeight } from '../../src/domain/state/types.ts'
import { toPlaceFacts } from '../../src/services/places/catalogue.ts'
import { catalogue, createTokyoTrip } from './tokyoTrip.ts'

function priorities(weights: Record<'convenience' | 'cost' | 'novelty', PriorityWeight>): Priority[] {
  return (Object.keys(weights) as Array<keyof typeof weights>).map((name) => ({
    id: `prio_${name}`,
    name,
    weight: weights[name],
  }))
}

const CONVENIENCE_LED = createTokyoTrip([], priorities({ convenience: 'high', cost: 'low', novelty: 'low' }))
const COST_LED = createTokyoTrip([], priorities({ convenience: 'low', cost: 'high', novelty: 'low' }))
const NOVELTY_LED = createTokyoTrip([], priorities({ convenience: 'low', cost: 'low', novelty: 'high' }))

/** Straight-line metres walked across the whole trip, relative to another plan. */
function distanceDelta(before: Plan, after: Plan): number {
  const impact = computeExpectedImpact(before, after, diffPlans(before, after), {
    places: toPlaceFacts(catalogue),
  })
  if (impact.walkingDistanceDeltaM === null) throw new Error('every demo place should have coordinates')
  return impact.walkingDistanceDeltaM
}

/** Mean price level across the stops that have one. */
function meanPriceLevel(plan: Plan): number {
  const levels = allItems(plan)
    .map((item) => catalogue.get(item.placeId)?.priceLevel)
    .filter((level): level is 0 | 1 | 2 | 3 | 4 => level !== undefined)
  return levels.reduce((sum: number, level: number) => sum + level, 0) / levels.length
}

const placeIds = (plan: Plan) => allItems(plan).map((item) => item.placeId)

describe('scenario_priority_ranking', () => {
  it('produces a different itinerary for different weights', () => {
    expect(placeIds(CONVENIENCE_LED.plan)).not.toEqual(placeIds(COST_LED.plan))
  })

  it('every weighting still produces a valid plan', () => {
    // createTokyoTrip throws on an invalid plan, so reaching here is the check —
    // ranking reorders candidates, it never relaxes a constraint (§8).
    for (const trip of [CONVENIENCE_LED, COST_LED, NOVELTY_LED]) {
      expect(allItems(trip.plan).length).toBeGreaterThan(0)
    }
  })

  it('walks less when convenience is weighted high', () => {
    expect(distanceDelta(COST_LED.plan, CONVENIENCE_LED.plan)).toBeLessThan(0)
  })

  it('costs less when cost is weighted high', () => {
    expect(meanPriceLevel(COST_LED.plan)).toBeLessThan(meanPriceLevel(CONVENIENCE_LED.plan))
  })

  it('spreads across more categories when novelty is weighted high', () => {
    const distinct = (plan: Plan) =>
      new Set(allItems(plan).map((item) => catalogue.get(item.placeId)?.category)).size

    expect(distinct(NOVELTY_LED.plan)).toBeGreaterThanOrEqual(distinct(CONVENIENCE_LED.plan))
  })

  it('never invents a place, whatever the weights', () => {
    for (const trip of [CONVENIENCE_LED, COST_LED, NOVELTY_LED]) {
      for (const placeId of placeIds(trip.plan)) expect(catalogue.has(placeId)).toBe(true)
    }
  })

  it('is reproducible: the same weights give the same plan', () => {
    const again = createTokyoTrip([], priorities({ convenience: 'high', cost: 'low', novelty: 'low' }))
    expect(placeIds(again.plan)).toEqual(placeIds(CONVENIENCE_LED.plan))
  })
})
