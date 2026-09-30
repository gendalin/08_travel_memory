/**
 * Memory -> a search plan (B1).
 *
 * The claim worth holding: Memory steers what is RETRIEVED, not only how what was
 * retrieved is ranked. Ranking can only choose between places that were fetched, so
 * a preference that arrives after retrieval has already narrowed the field arrives
 * too late.
 */

import { describe, expect, it } from 'vitest'

import {
  buildRetrievalProfile,
  expectedUses,
  searchPlan,
  DEFAULT_STOPS_PER_DAY,
  MAX_CATEGORIES_PER_ROLE,
  OVER_FETCH,
} from '../../src/application/planning/retrievalProfile.ts'
import { createMemorySnapshot } from '../../src/domain/memory/snapshot.ts'
import type { Memory } from '../../src/domain/memory/types.ts'
import { categoriesFor, DAY_ROLES, rolesForPace } from '../../src/domain/plan/dayRoles.ts'
import type { ConsideringTag, TripState } from '../../src/domain/state/types.ts'
import { memory } from '../domain/fixtures.ts'

/** A State carrying nothing but the tags under test. */
function stateWith(tags: ConsideringTag[]): TripState {
  return {
    version: 1,
    intent: [],
    considering: tags.map((tag, index) => ({ id: `cons_${index + 1}`, text: 'as typed', tag })),
    priorities: [],
  }
}

const avoiding = (value: string): ConsideringTag => ({ kind: 'avoid', value })

function snapshotOf(memories: Memory[]) {
  return createMemorySnapshot('trip_1', memories, '2026-09-01T00:00:00.000Z')
}

const preference = (id: string, category: string, ratePerDay?: number): Memory =>
  memory({
    id,
    status: 'active',
    kind: 'preference',
    subject: { facet: 'category', value: category },
    polarity: 1,
    strength: 0.9,
    ...(ratePerDay === undefined ? {} : { scope: { ratePerDay } }),
  })

const aversion = (id: string, category: string): Memory =>
  memory({
    id,
    status: 'active',
    kind: 'aversion',
    subject: { facet: 'category', value: category },
    polarity: -1,
    strength: 0.8,
  })

const pattern = (id: string, facet: 'stops_per_day' | 'day_span_metres', value: number): Memory =>
  memory({ id, status: 'active', kind: 'pattern', subject: { facet, value }, polarity: 1 })

const lunchTarget = (snapshot?: ReturnType<typeof snapshotOf>) =>
  buildRetrievalProfile({ days: 5, snapshot }).targets.find((target) => target.role === 'lunch')!

describe('without any Memory', () => {
  const profile = buildRetrievalProfile({ days: 5 })

  it('assumes a full day rather than a short one', () => {
    expect(profile.stopsPerDay).toBe(DEFAULT_STOPS_PER_DAY)
    expect(profile.targets).toHaveLength(rolesForPace(DEFAULT_STOPS_PER_DAY).length)
  })

  it('has no radius to search within, and says so', () => {
    expect(profile.radiusMetres).toBeUndefined()
    expect(profile.gaps.map((gap) => gap.what)).toContain('how far a day ranges')
  })

  it('keeps every role in the order its own gate declares', () => {
    for (const target of profile.targets) {
      const role = DAY_ROLES.find((entry) => entry.id === target.role)!
      const declared = categoriesFor(role).slice(0, MAX_CATEGORIES_PER_ROLE)
      expect(target.categories.map((entry) => entry.category)).toEqual(declared)
    }
  })

  it('marks nothing as preferred', () => {
    for (const target of profile.targets) {
      expect(target.categories.every((entry) => !entry.preferred)).toBe(true)
    }
  })
})

describe('Memory steers what is searched for', () => {
  /**
   * The category is sixth in the lunch role's own list, so if it leads the search
   * that can only be the memory's doing.
   */
  it('lifts a remembered category to the front of the search, wherever the gate put it', () => {
    const declared = categoriesFor(DAY_ROLES.find((role) => role.id === 'lunch')!)
    expect(declared.indexOf('cafe_kissaten')).toBeGreaterThan(0)

    const target = lunchTarget(snapshotOf([preference('m1', 'cafe_kissaten')]))
    expect(target.categories[0].category).toBe('cafe_kissaten')
    expect(target.categories[0].preferred).toBe(true)
  })

  it('searches a remembered category deeper than the rest', () => {
    const target = lunchTarget(snapshotOf([preference('m1', 'sushi', 0.4)]))
    const sushi = target.categories.find((entry) => entry.category === 'sushi')!
    const other = target.categories.find((entry) => !entry.preferred)!

    expect(sushi.retrieve).toBeGreaterThan(other.retrieve)
  })

  /**
   * Proportionate depth. A category returned to twice in five days should not be
   * searched as though it were wanted every day.
   */
  it('sizes depth from the memory own rate', () => {
    const twice = lunchTarget(snapshotOf([preference('m1', 'sushi', 0.4)]))
    const daily = lunchTarget(snapshotOf([preference('m1', 'sushi', 1)]))

    const depthOf = (target: ReturnType<typeof lunchTarget>) =>
      target.categories.find((entry) => entry.category === 'sushi')!.retrieve

    expect(depthOf(twice)).toBeLessThan(depthOf(daily))
    expect(depthOf(twice)).toBe(2 * OVER_FETCH)
  })

  it('does not search for a category an aversion rules out', () => {
    const target = lunchTarget(snapshotOf([aversion('m1', 'ramen')]))

    expect(target.excluded).toContain('ramen')
    expect(target.categories.map((entry) => entry.category)).not.toContain('ramen')
  })

  it('bounds how many categories a role searches', () => {
    for (const target of buildRetrievalProfile({ days: 5 }).targets) {
      expect(target.categories.length).toBeLessThanOrEqual(MAX_CATEGORIES_PER_ROLE)
    }
  })

  it('never searches a category the role does not accept', () => {
    // A memory about a category this role has no use for must not widen its gate.
    const target = lunchTarget(snapshotOf([preference('m1', 'onsen_sento')]))
    const lunch = DAY_ROLES.find((role) => role.id === 'lunch')!

    for (const entry of target.categories) {
      expect(categoriesFor(lunch)).toContain(entry.category)
    }
  })
})

describe('pattern memories shape the search', () => {
  it('shortens it to the roles a slower pace reaches', () => {
    const profile = buildRetrievalProfile({
      days: 5,
      snapshot: snapshotOf([pattern('pace', 'stops_per_day', 3)]),
    })
    expect(profile.stopsPerDay).toBe(3)
    expect(profile.targets.map((target) => target.role)).toEqual([
      'main_destination',
      'lunch',
      'dinner',
    ])
  })

  it('bounds it to how far the traveller own days range', () => {
    const profile = buildRetrievalProfile({
      days: 5,
      snapshot: snapshotOf([pattern('span', 'day_span_metres', 5578)]),
    })
    expect(profile.radiusMetres).toBe(5578)
    expect(profile.gaps.map((gap) => gap.what)).not.toContain('how far a day ranges')
  })
})

describe('what the profile cannot carry', () => {
  /**
   * Stated rather than silently missing: a search that ignores the traveller's
   * price bracket looks exactly like one that never knew it.
   */
  it('records a gap for every thing no memory supplies', () => {
    const gaps = buildRetrievalProfile({ days: 5 }).gaps
    expect(gaps.map((gap) => gap.what)).toContain('price bracket')
    for (const gap of gaps) expect(gap.because.length).toBeGreaterThan(20)
  })

  it('traces the whole profile back to the memories behind it', () => {
    const snapshot = snapshotOf([preference('m1', 'sushi'), pattern('pace', 'stops_per_day', 5)])
    expect(buildRetrievalProfile({ days: 5, snapshot }).memoryIds.sort()).toEqual(['m1', 'pace'])
  })
})

describe('searchPlan', () => {
  const profile = buildRetrievalProfile({ days: 5 })
  const plan = searchPlan(profile)

  /**
   * The four "on the way" roles have identical scopes and lunch and dinner share
   * most of their categories, so one search per role would repeat the same query
   * four times over.
   */
  it('issues each category once, not once per role', () => {
    const pairs = profile.targets.reduce((sum, target) => sum + target.categories.length, 0)
    expect(plan.length).toBeLessThan(pairs)
    expect(new Set(plan.map((entry) => entry.category)).size).toBe(plan.length)
  })

  it('asks for the depth the hungriest role needs, not the sum', () => {
    for (const entry of plan) {
      const wanted = profile.targets
        .flatMap((target) => target.categories)
        .filter((target) => target.category === entry.category)
        .map((target) => target.retrieve)

      expect(entry.retrieve).toBe(Math.max(...wanted))
      expect(entry.retrieve).toBeLessThanOrEqual(wanted.reduce((sum, value) => sum + value, 0))
    }
  })

  it('records which roles will draw on each search', () => {
    for (const entry of plan) {
      expect(entry.roles.length).toBeGreaterThan(0)
      for (const role of entry.roles) {
        expect(profile.targets.map((target) => target.role)).toContain(role)
      }
    }
  })

  it('puts what the traveller asked for first', () => {
    const withMemory = searchPlan(
      buildRetrievalProfile({ days: 5, snapshot: snapshotOf([preference('m1', 'grocery_market')]) }),
    )
    expect(withMemory[0].category).toBe('grocery_market')
    expect(withMemory[0].preferred).toBe(true)
  })

  it('never asks for zero of anything', () => {
    for (const entry of plan) expect(entry.retrieve).toBeGreaterThan(0)
  })
})

describe('expectedUses', () => {
  it('is zero for a category no memory prefers', () => {
    expect(expectedUses({ category: 'sushi', days: 5 })).toBe(0)
  })

  it('follows the memory own rate', () => {
    const snapshot = snapshotOf([preference('m1', 'sushi', 0.4)])
    expect(expectedUses({ category: 'sushi', days: 5, snapshot })).toBe(2)
    expect(expectedUses({ category: 'sushi', days: 10, snapshot })).toBe(4)
  })

  it('is zero for a category an aversion rules out', () => {
    const snapshot = snapshotOf([aversion('m1', 'ramen')])
    expect(expectedUses({ category: 'ramen', days: 5, snapshot })).toBe(0)
  })
})

/**
 * Trip State -> the search plan (B7).
 *
 * The claim: what the traveller SAID about this trip narrows what is fetched, not
 * only what wins once it has been. An avoid that arrives after retrieval has already
 * filled the candidate set with the thing they asked to skip arrives too late — the
 * plan then either uses it or comes back a stop short.
 */
describe('what the trip State says', () => {
  it('does not search a category the traveller asked to avoid', () => {
    const state = stateWith([avoiding('izakaya')])
    const dinner = buildRetrievalProfile({ days: 5, state }).targets.find(
      (target) => target.role === 'dinner',
    )!

    expect(dinner.excluded).toContain('izakaya')
    expect(dinner.categories.map((entry) => entry.category)).not.toContain('izakaya')
  })

  it('reads the avoid in the traveller own words, not as a category id', () => {
    const state = stateWith([avoiding('yakiniku')])
    const dinner = buildRetrievalProfile({ days: 5, state }).targets.find(
      (target) => target.role === 'dinner',
    )!

    expect(dinner.excluded).toContain('yakiniku_grill')
  })

  it('leaves everything searchable when the avoid names no kind of place', () => {
    const state = stateWith([avoiding('queues')])
    const profile = buildRetrievalProfile({ days: 5, state })

    for (const target of profile.targets) expect(target.excluded).toEqual([])
    expect(profile.avoid).toEqual(['queues'])
  })

  it('carries the avoid values, so a thin search can say what narrowed it', () => {
    const state = stateWith([avoiding('izakaya'), avoiding('queues')])
    expect(buildRetrievalProfile({ days: 5, state }).avoid).toEqual(['izakaya', 'queues'])
  })

  it('still searches a role whose every category was avoided', () => {
    // A part of the day with nothing to search is a day that cannot be filled.
    // Ranking pushes an avoided place to the bottom; retrieval refusing to look at
    // all leaves a gap instead.
    const nightcap = DAY_ROLES.find((role) => role.id === 'nightcap')!
    const state = stateWith(categoriesFor(nightcap).map((category) => avoiding(category)))

    const target = buildRetrievalProfile({ days: 5, state }).targets.find(
      (entry) => entry.role === 'nightcap',
    )

    expect(target).toBeDefined()
    expect(target!.categories.map((entry) => entry.category)).toEqual([
      ...categoriesFor(nightcap),
    ])
    expect(target!.excluded).toEqual([])
  })

  it('adds nothing when the State states nothing structurally', () => {
    const plain = buildRetrievalProfile({ days: 5 })
    const stated = buildRetrievalProfile({ days: 5, state: stateWith([]) })
    expect(stated.targets).toEqual(plain.targets)
    expect(stated.avoid).toEqual([])
  })
})
