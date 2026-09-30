/**
 * Role capacity (B0).
 *
 * "Too few places" is not actionable. This turns the wall Phase A kept hitting
 * into a number per part of a day, which is the shopping list per-trip retrieval
 * has to satisfy.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { DAY_ROLES, rolesForPace } from '../../src/domain/plan/dayRoles.ts'
import {
  capacitySummary,
  roleCapacity,
  type CapacityPlace,
} from '../../src/domain/plan/roleCapacity.ts'

const places = (
  JSON.parse(readFileSync('data/demo_tokyo_v1/tokyo_places.json', 'utf8')) as CapacityPlace[]
).filter((place) => place.category !== 'accommodation')

const ALL_WEEK = (span: string) => ({
  mon: span, tue: span, wed: span, thu: span, fri: span, sat: span, sun: span,
})

describe('roleCapacity over the demo catalogue', () => {
  const capacities = roleCapacity({ places, days: 5, stopsPerDay: 8 })

  it('reports one row per role the pace reaches', () => {
    expect(capacities).toHaveLength(rolesForPace(8).length)
    expect(new Set(capacities.map((entry) => entry.role.id)).size).toBe(capacities.length)
  })

  it('leaves out roles a shorter pace never reaches', () => {
    const short = roleCapacity({ places, days: 5, stopsPerDay: 3 })
    expect(short).toHaveLength(3)
    expect(short.map((entry) => entry.role.id).sort()).toEqual([
      'dinner',
      'lunch',
      'main_destination',
    ])
  })

  it('puts the worst shortfall first', () => {
    const shortfalls = capacities.map((entry) => entry.short)
    expect(shortfalls).toEqual([...shortfalls].sort((a, b) => b - a))
  })

  it('finds the nightcap short, which is what the catalogue is thinnest on', () => {
    const nightcap = capacities.find((entry) => entry.role.id === 'nightcap')!
    expect(nightcap.short).toBeGreaterThan(0)
  })

  /**
   * The figure that actually binds. Per-role counts overlap — dinner and the
   * nightcap both accept izakaya — and a plan never uses a place twice, so the
   * whole trip needs as many distinct places as it has stops.
   */
  it('reports the whole-trip shortfall, which per-role counts hide', () => {
    const summary = capacitySummary(capacities, places.length)

    expect(summary.needed).toBe(8 * 5)
    expect(summary.available).toBe(places.length)
    expect(summary.short).toBe(summary.needed - places.length)
    // The per-role total understates it, which is exactly why both are reported.
    expect(summary.shortByRole).toBeLessThan(summary.short)
  })
})

describe('roleCapacity counting rules', () => {
  const lunchPlace = (placeId: string): CapacityPlace => ({
    placeId,
    category: 'ramen',
    openingHours: ALL_WEEK('11:00-15:00'),
  })

  it('counts a place only for roles its hours overlap', () => {
    const capacities = roleCapacity({ places: [lunchPlace('a')], days: 1, stopsPerDay: 8 })
    const byRole = new Map(capacities.map((entry) => [entry.role.id, entry.available]))

    expect(byRole.get('lunch')).toBe(1)
    // A place that shuts at three in the afternoon cannot be dinner or a nightcap.
    expect(byRole.get('dinner')).toBe(0)
    expect(byRole.get('nightcap')).toBe(0)
  })

  it('counts a place open on only one day of the week', () => {
    const sundayOnly: CapacityPlace = {
      placeId: 'sunday',
      category: 'izakaya',
      openingHours: { ...ALL_WEEK('closed'), sun: '18:00-23:00' },
    }
    const byRole = new Map(
      roleCapacity({ places: [sundayOnly], days: 1, stopsPerDay: 8 }).map((entry) => [
        entry.role.id,
        entry.available,
      ]),
    )
    expect(byRole.get('dinner')).toBe(1)
  })

  it('never counts a place with no hours at all', () => {
    const unhoured: CapacityPlace = { placeId: 'unknown', category: 'ramen' }
    for (const entry of roleCapacity({ places: [unhoured], days: 1, stopsPerDay: 8 })) {
      expect(entry.available).toBe(0)
    }
  })

  it('never counts a place whose category the role does not accept', () => {
    const museum: CapacityPlace = {
      placeId: 'museum',
      category: 'museum_gallery',
      openingHours: ALL_WEEK('09:00-23:00'),
    }
    const byRole = new Map(
      roleCapacity({ places: [museum], days: 1, stopsPerDay: 8 }).map((entry) => [
        entry.role.id,
        entry.available,
      ]),
    )
    expect(byRole.get('main_destination')).toBe(1)
    expect(byRole.get('lunch')).toBe(0)
    expect(byRole.get('dinner')).toBe(0)
  })

  it('needs one place per day per role, because a plan never repeats one', () => {
    for (const entry of roleCapacity({ places, days: 7, stopsPerDay: 8 })) {
      expect(entry.needed).toBe(7)
    }
  })

  it('is short of nothing when the catalogue is deep enough', () => {
    const deep: CapacityPlace[] = DAY_ROLES.flatMap((role) =>
      [1, 2, 3].map((n) => ({
        placeId: `${role.id}_${n}`,
        category:
          role.scope.kind === 'categories' ? role.scope.categories[0] : 'cafe_kissaten',
        openingHours: ALL_WEEK('00:00-23:59'),
      })),
    )
    const capacities = roleCapacity({ places: deep, days: 2, stopsPerDay: 8 })
    expect(capacities.every((entry) => entry.short === 0)).toBe(true)
  })
})
