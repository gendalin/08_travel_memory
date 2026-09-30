/**
 * Alternatives (product_spec §5.6, §7.1).
 *
 * Two rules carry the feature:
 *   - options come only from the bounded Tokyo set, never from the model
 *   - a same-slot pick is a Replace and the selection itself is the
 *     confirmation; one that moves other stops is a Reorganize and has to be
 *     previewed
 */

import { beforeEach, describe, expect, it } from 'vitest'

import {
  listAlternatives,
  proposeAlternative,
  MAX_ALTERNATIVES,
} from '../../src/application/alternatives/alternatives.ts'
import {
  allItems,
  durationMinutes,
  fromMinutes,
  toMinutes,
} from '../../src/domain/plan/types.ts'
import { isOpenFor, weekdayKey } from '../../src/domain/places/openingHours.ts'
import { dateOfDay } from '../../src/domain/trip/phase.ts'
import { catalogue, createTokyoTrip, NOW, type TokyoTrip } from './tokyoTrip.ts'

let trip: TokyoTrip

beforeEach(() => {
  trip = createTokyoTrip()
})

/** Day 2 lunch: the ramen stop the demo scenario also uses. */
function lunchItem() {
  return allItems(trip.plan).find((item) => catalogue.get(item.placeId)?.category === 'ramen')!
}

function options(itemId = lunchItem().id) {
  return listAlternatives({
    itemId,
    frame: trip.frame,
    state: trip.state,
    plan: trip.plan,
    catalogue,
    memorySnapshot: trip.trip.memorySnapshot,
  })
}

function pick(placeId: string, itemId = lunchItem().id) {
  return proposeAlternative({
    tripId: 'trip_1',
    frame: trip.frame,
    state: trip.state,
    plan: trip.plan,
    itemId,
    placeId,
    catalogue,
    now: NOW,
    proposalId: 'prop_alt',
    createdAt: NOW.toISOString(),
  })
}

describe('alternatives', () => {
  it('offers between one and five options', () => {
    const offered = options()
    expect(offered.length).toBeGreaterThan(0)
    expect(offered.length).toBeLessThanOrEqual(MAX_ALTERNATIVES)
  })

  it('only ever offers places that exist in the dataset', () => {
    const offered = options()
    for (const option of offered) expect(catalogue.has(option.place.placeId)).toBe(true)
  })

  it('never offers a place already in the trip', () => {
    const planned = new Set(allItems(trip.plan).map((item) => item.placeId))
    const offered = options()
    for (const option of offered) expect(planned.has(option.place.placeId)).toBe(false)
  })

  it('leads with the same category, and says why', () => {
    const offered = options()
    expect(offered[0].place.category).toBe('ramen')
    expect(offered[0].reason).toContain('ramen')
  })

  it('marks whether an option reshapes the day', () => {
    const offered = options()
    for (const option of offered) expect(typeof option.shiftsSchedule).toBe('boolean')
  })

  it('classifies a same-slot pick as a Replace', () => {
    const offered = options()
    const sameSlot = offered.find((option) => !option.shiftsSchedule)!

    const outcome = pick(sameSlot.place.placeId)
    expect(outcome.kind).toBe('proposal')
    if (outcome.kind !== 'proposal') return
    expect(outcome.proposal.type).toBe('replace')
  })

  it('keeps the slot times exactly, which is what makes it a Replace', () => {
    const item = lunchItem()
    const offered = options(item.id)
    const sameSlot = offered.find((option) => !option.shiftsSchedule)!

    const outcome = pick(sameSlot.place.placeId)
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')

    const change = outcome.proposal.planDiff.modified[0]
    expect(change.fields).toEqual(['placeId'])
    expect(change.after.startTime).toBe(item.startTime)
    expect(change.after.endTime).toBe(item.endTime)
  })

  it('classifies a longer option by what it pushes: nothing -> Replace, later stops -> Reorganize', () => {
    const item = lunchItem()
    const window = durationMinutes(item)
    const weekday = weekdayKey(dateOfDay(trip.frame, item.dayIndex))
    const planned = new Set(allItems(trip.plan).map((planItem) => planItem.placeId))

    // Derived, not assumed to be sushi: a longer option has to be one that is
    // genuinely OPEN for the longer window it would occupy. Once opening hours
    // were enforced, no sushi counter could take this slot and run past it —
    // they all shut by mid-afternoon — so naming a category here would pick an
    // option the product is right to refuse.
    const longer = catalogue
      .all()
      .filter((place) => place.category !== 'accommodation' && !planned.has(place.placeId))
      .find((place) => {
        const needed = Math.max(30, place.typicalDurationMin)
        if (needed <= window) return false
        const end = fromMinutes(toMinutes(item.startTime) + needed)
        return isOpenFor(place.openingHours, weekday, item.startTime, end)
      })!

    const outcome = pick(longer.placeId)
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')

    // §7.1 (2026-09-29): a stop whose end grows into free time, pushing nothing,
    // is still one stop changed — a Replace. Only when later stops had to move to
    // make room is it a Reorganize.
    const others = outcome.proposal.planDiff.modified.filter((entry) => entry.after.id !== item.id)
    expect(outcome.proposal.type).toBe(others.length === 0 ? 'replace' : 'reorganize')
    const change = outcome.proposal.planDiff.modified.find((entry) => entry.after.id === item.id)!
    expect(change.fields).toContain('placeId')
    expect(change.fields).toContain('endTime')
    expect(durationMinutes(change.after)).toBe(Math.max(30, longer.typicalDurationMin))
  })

  it('records the pick as the trigger, for the Receipt', () => {
    const offered = options()
    const outcome = pick(offered[0].place.placeId)
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')

    expect(outcome.proposal.trigger).toContain(offered[0].place.name)
    expect(outcome.proposal.initiator).toBe('user')
  })

  it('returns nothing for an item that is not in the plan', () => {
    expect(options('nope')).toEqual([])
  })

  it('refuses a place that is not in the dataset', () => {
    const outcome = pick('teamlab_planets')
    expect(outcome.kind).toBe('conflict')
  })
})

describe('the slot slate (A5)', () => {
  const ranked = () => allItems(trip.plan).find((item) => item.slate && item.slate.length > 0)!

  it('keeps runners-up on the stops that were filled by ranking', () => {
    const withSlate = allItems(trip.plan).filter((item) => item.slate)
    expect(withSlate.length).toBeGreaterThan(0)
  })

  it('never includes the stop that won its own slot', () => {
    for (const item of allItems(trip.plan)) {
      for (const entry of item.slate ?? []) expect(entry.placeId).not.toBe(item.placeId)
    }
  })

  it('orders runners-up best first, all at or below the winner', () => {
    for (const item of allItems(trip.plan)) {
      const scores = (item.slate ?? []).map((entry) => entry.score)
      expect(scores).toEqual([...scores].sort((a, b) => b - a))
    }
  })

  it('only ever names places from the catalogue', () => {
    for (const item of allItems(trip.plan)) {
      for (const entry of item.slate ?? []) expect(catalogue.has(entry.placeId)).toBe(true)
    }
  })

  it('says what each runner-up lost on', () => {
    const components = ['stateMatch', 'memoryMatch', 'convenience', 'cost', 'novelty', 'routeFit']
    const reasons = (ranked().slate ?? []).map((entry) => entry.lostOn).filter(Boolean)
    expect(reasons.length).toBeGreaterThan(0)
    for (const reason of reasons) expect(components).toContain(reason)
  })

  /**
   * The point of the slate. Alternatives used to be everything the plan had not
   * used, so for a fifteen-stop plan drawn from thirty-three places the options
   * offered were the eighteen the generator had already rejected — and a stop
   * whose category and neighbourhood held nothing spare got none at all.
   */
  it('offers options for a stop that leftovers alone could not cover', () => {
    const planned = allItems(trip.plan).map((item) => item.placeId)

    /** How many options the old leftovers-only rule would have found. */
    const leftoverCount = (placeId: string): number => {
      const current = catalogue.get(placeId)!
      const sameCategory = catalogue.candidates({
        category: current.category,
        excludePlaceIds: planned,
      })
      const sameArea = catalogue
        .candidates({ neighborhood: current.neighborhood, excludePlaceIds: planned })
        .filter((place) => place.category !== current.category)
      return sameCategory.length + sameArea.length
    }

    const starved = allItems(trip.plan).filter(
      (item) => leftoverCount(item.placeId) === 0 && item.slate,
    )
    expect(starved.length).toBeGreaterThan(0)

    const gained = starved.filter((item) => options(item.id).length > 0)
    expect(gained.length).toBeGreaterThan(0)
  })

  it('drops a runner-up that has since been scheduled elsewhere', () => {
    const planned = new Set(allItems(trip.plan).map((item) => item.placeId))
    const item = ranked()
    const stale = (item.slate ?? []).filter((entry) => planned.has(entry.placeId))
    expect(stale.length).toBeGreaterThan(0)

    const offered = options(item.id).map((option) => option.place.placeId)
    for (const entry of stale) expect(offered).not.toContain(entry.placeId)
  })

  it('drops a runner-up that would be shut for the slot it would fill', () => {
    const item = ranked()
    const weekday = weekdayKey(dateOfDay(trip.frame, item.dayIndex))

    for (const option of options(item.id)) {
      const needed = Math.max(30, option.place.typicalDurationMin)
      const end =
        needed <= durationMinutes(item)
          ? item.endTime
          : fromMinutes(toMinutes(item.startTime) + needed)
      expect(isOpenFor(option.place.openingHours, weekday, item.startTime, end)).toBe(true)
    }
  })

  it('never describes an option as being somewhere it is not', () => {
    for (const item of allItems(trip.plan)) {
      const current = catalogue.get(item.placeId)!
      for (const option of options(item.id)) {
        if (option.reason.includes(`Also in ${current.neighborhood}`)) {
          expect(option.place.neighborhood).toBe(current.neighborhood)
        }
        if (option.reason.startsWith('Another ')) {
          expect(option.place.category).toBe(current.category)
        }
      }
    }
  })
})
