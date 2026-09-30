/**
 * The day role model (B0).
 *
 * Data only — nothing generates a plan from this yet. What the tests hold is that
 * the model is internally coherent, because everything downstream reads it: the
 * query planner decides what to search for from these roles, and the generator
 * will fill them.
 */

import { describe, expect, it } from 'vitest'

import {
  categoriesFor,
  dayWindowMinutes,
  DAY_ROLES,
  halfDayMinutes,
  INTEREST_CATEGORIES,
  MEAL_CATEGORIES,
  OPTIONAL_ROLES,
  REQUIRED_ROLES,
  rolesForPace,
} from '../../src/domain/plan/dayRoles.ts'
import { TIME_BANDS } from '../../src/domain/places/facets.ts'

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

describe('the day, as roles', () => {
  it('runs to seven or eight stops: three required and five optional', () => {
    expect(REQUIRED_ROLES).toHaveLength(3)
    expect(OPTIONAL_ROLES).toHaveLength(5)
    expect(DAY_ROLES).toHaveLength(8)
  })

  it('anchors the day and both meals, and makes nothing else compulsory', () => {
    expect(REQUIRED_ROLES.map((role) => role.id)).toEqual([
      'main_destination',
      'lunch',
      'dinner',
    ])
  })

  it('is in day order', () => {
    const starts = DAY_ROLES.map((role) => toMinutes(role.window.from))
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })

  it('leaves a gap between stops for getting between them', () => {
    for (let i = 0; i < DAY_ROLES.length - 1; i++) {
      const gap = toMinutes(DAY_ROLES[i + 1].window.from) - toMinutes(DAY_ROLES[i].window.to)
      expect(gap).toBeGreaterThan(0)
    }
  })

  it('places every role inside the time band it claims', () => {
    for (const role of DAY_ROLES) {
      const band = TIME_BANDS[role.band]
      expect(toMinutes(role.window.from)).toBeGreaterThanOrEqual(band.from)
      expect(toMinutes(role.window.to)).toBeLessThanOrEqual(band.to)
    }
  })

  it('gives every role a window long enough for the stop it expects', () => {
    for (const role of DAY_ROLES) {
      const window = toMinutes(role.window.to) - toMinutes(role.window.from)
      expect(window).toBeGreaterThanOrEqual(role.typicalMinutes)
    }
  })

  it('has a unique id and a user-facing label for every role', () => {
    expect(new Set(DAY_ROLES.map((role) => role.id)).size).toBe(DAY_ROLES.length)
    for (const role of DAY_ROLES) {
      expect(role.label).toBeTruthy()
      // The internal id must never be what a screen would show.
      expect(role.label).not.toBe(role.id)
    }
  })
})

describe('what each role can be filled with', () => {
  it('only ever names categories the taxonomy has', () => {
    for (const role of DAY_ROLES) {
      for (const category of categoriesFor(role)) {
        expect(INTEREST_CATEGORIES).toContain(category)
      }
    }
  })

  it('never leaves a role with nothing eligible', () => {
    for (const role of DAY_ROLES) {
      expect(categoriesFor(role).length).toBeGreaterThan(0)
    }
  })

  /**
   * Otherwise an afternoon "on the way" stop could pick a sushi counter and the
   * day would have two lunches. A cafe or a market is a stop, not a meal, so both
   * stay eligible.
   */
  it('keeps meals out of the stops that are not meals', () => {
    const nearAnchor = DAY_ROLES.filter((role) => role.scope.kind === 'near_anchor')
    expect(nearAnchor.length).toBeGreaterThan(0)

    for (const role of nearAnchor) {
      for (const meal of MEAL_CATEGORIES) {
        expect(categoriesFor(role)).not.toContain(meal)
      }
      expect(categoriesFor(role)).toContain('cafe_kissaten')
      expect(categoriesFor(role)).toContain('grocery_market')
    }
  })

  it('gives the meals somewhere to eat and the nightcap somewhere to drink', () => {
    const lunch = DAY_ROLES.find((role) => role.id === 'lunch')!
    const dinner = DAY_ROLES.find((role) => role.id === 'dinner')!
    const nightcap = DAY_ROLES.find((role) => role.id === 'nightcap')!

    expect(categoriesFor(lunch).some((category) => MEAL_CATEGORIES.includes(category))).toBe(true)
    expect(categoriesFor(dinner).some((category) => MEAL_CATEGORIES.includes(category))).toBe(true)
    expect(categoriesFor(nightcap)).toContain('izakaya')
  })

  it('points every anchored role at a role that exists', () => {
    const ids = new Set(DAY_ROLES.map((role) => role.id))
    for (const role of DAY_ROLES) {
      if (role.scope.kind === 'near_anchor') expect(ids.has(role.scope.anchorRole)).toBe(true)
    }
  })
})

describe('rolesForPace', () => {
  it('fills only the required roles at the shortest pace', () => {
    expect(rolesForPace(3).map((role) => role.id)).toEqual(['main_destination', 'lunch', 'dinner'])
  })

  it('still fills all three when the pace asks for fewer', () => {
    // A day without lunch is not a shorter day, it is a broken one.
    expect(rolesForPace(1)).toEqual(rolesForPace(3))
    expect(rolesForPace(0)).toEqual(rolesForPace(3))
  })

  it('fills every role at full pace', () => {
    expect(rolesForPace(8)).toHaveLength(DAY_ROLES.length)
    expect(rolesForPace(99)).toHaveLength(DAY_ROLES.length)
  })

  it('grows one role at a time', () => {
    for (let pace = 3; pace < DAY_ROLES.length; pace++) {
      expect(rolesForPace(pace + 1).length).toBe(rolesForPace(pace).length + 1)
    }
  })

  /**
   * The fill order is stated rather than chronological. Front-to-back would make a
   * five-stop day three afternoon stops ending at dinner and never reach a
   * nightcap — not what someone who names "somewhere after dinner" is asking for.
   */
  it('reaches the nightcap early rather than last', () => {
    expect(rolesForPace(5).map((role) => role.id)).toContain('nightcap')
  })

  it('returns roles in day order however they were filled', () => {
    for (const pace of [3, 4, 5, 6, 7, 8]) {
      const chosen = rolesForPace(pace)
      const starts = chosen.map((role) => toMinutes(role.window.from))
      expect(starts).toEqual([...starts].sort((a, b) => a - b))
    }
  })

  it('never invents a role', () => {
    for (const pace of [0, 3, 5, 8, 20]) {
      for (const role of rolesForPace(pace)) expect(DAY_ROLES).toContain(role)
    }
  })
})

describe('the figures a day is measured against (B6)', () => {
  /**
   * Derived, not stated. Both were flat numbers set when a day was three stops ending
   * at half past five — eleven hours of day and five hours of half-day. A day now runs
   * from ten in the morning to half past ten at night, and against the old figure a
   * full day would have shown NEGATIVE free time.
   */
  it('spans the day the roles actually lay out', () => {
    const starts = DAY_ROLES.map((role) => toMinutes(role.window.from))
    const ends = DAY_ROLES.map((role) => toMinutes(role.window.to))
    expect(dayWindowMinutes()).toBe(Math.max(...ends) - Math.min(...starts))
  })

  it('is long enough to hold a full day of stops', () => {
    const committed = DAY_ROLES.reduce((total, role) => total + role.typicalMinutes, 0)
    expect(dayWindowMinutes()).toBeGreaterThan(committed)
  })

  it('halves it for the half-day constraint', () => {
    expect(halfDayMinutes()).toBe(Math.round(dayWindowMinutes() / 2))
  })

  /** A half day must end before the evening meal, or it is not half a day. */
  it('ends a half day before dinner starts', () => {
    const dayStart = Math.min(...DAY_ROLES.map((role) => toMinutes(role.window.from)))
    const dinner = DAY_ROLES.find((role) => role.id === 'dinner')!
    expect(dayStart + halfDayMinutes()).toBeLessThanOrEqual(toMinutes(dinner.window.from))
  })
})
