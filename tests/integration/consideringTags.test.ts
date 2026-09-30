/**
 * Free text -> structured constraint -> validator (§3.2, §8).
 *
 * The user only ever sees their own sentence; the tag exists so the validator
 * has something to check. What matters here is that the mapping is
 * deterministic, conservative, and never invents a POI id.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  isUnresolvedPlaceId,
  resolvePlaceByName,
  tagAll,
  tagConsidering,
} from '../../src/application/decompose/tagConsidering.ts'
import { routeMessage } from '../../src/application/handleChat/route.ts'
import { createPlaceCatalogue } from '../../src/services/places/catalogue.ts'
import type { DemoPlace } from '../../src/services/places/types.ts'
import { basePlan } from '../domain/fixtures.ts'

const places = JSON.parse(readFileSync('data/demo_tokyo_v1/tokyo_places.json', 'utf8')) as DemoPlace[]
const catalogue = createPlaceCatalogue(places)

describe('tagConsidering', () => {
  it('leaves an ordinary preference untagged', () => {
    expect(tagConsidering('One proper sushi meal.', catalogue)).toBeUndefined()
    expect(tagConsidering('Time in local neighbourhoods.', catalogue)).toBeUndefined()
  })

  it('reads a must-visit and resolves the place', () => {
    expect(tagConsidering('We must visit Ueno Park.', catalogue)).toEqual({
      kind: 'must_visit',
      placeId: places.find((place) => place.name === 'Ueno Park')!.placeId,
    })
  })

  it('accepts the other ways of saying it', () => {
    for (const text of [
      'I have to see Ueno Park.',
      'We need to go to Ueno Park at some point.',
      'Must visit the Ueno Park on Day 2.',
    ]) {
      expect(tagConsidering(text, catalogue)?.kind).toBe('must_visit')
    }
  })

  it('marks a place outside the dataset as unresolved rather than guessing', () => {
    const tag = tagConsidering('We must visit teamLab Planets.', catalogue)
    if (tag?.kind !== 'must_visit') throw new Error('expected a must-visit')
    expect(isUnresolvedPlaceId(tag.placeId)).toBe(true)
  })

  it('reads a hard finish time', () => {
    expect(tagConsidering('Day 3 needs to be done by 6pm.', catalogue)).toEqual({
      kind: 'fixed_time',
      dayIndex: 2,
      time: '18:00',
    })
  })

  it('ignores a finish time with no day attached', () => {
    expect(tagConsidering('Be done by 6pm.', catalogue)).toBeUndefined()
  })

  it('reads a budget level', () => {
    expect(tagConsidering('Keep the budget moderate.', catalogue)).toEqual({
      kind: 'budget',
      level: 'moderate',
    })
    expect(tagConsidering('Budget is tight.', catalogue)).toEqual({ kind: 'budget', level: 'low' })
  })

  it('reads a half day and a free block', () => {
    expect(tagConsidering('Day 4 should be a half day.', catalogue)).toEqual({
      kind: 'half_day',
      dayIndex: 3,
    })
    expect(tagConsidering('Leave 3 hours free on Day 2.', catalogue)).toEqual({
      kind: 'time_block',
      dayIndex: 1,
      minutes: 180,
    })
  })

  it('reads an avoid', () => {
    expect(tagConsidering('Avoid crowded tourist spots.', catalogue)).toEqual({
      kind: 'avoid',
      value: 'crowded tourist spots',
    })
  })

  it('never rewrites the sentence it tagged', () => {
    const items = [{ id: 'c1', text: 'We must visit Ueno Park.' }]
    expect(tagAll(items, catalogue)[0].text).toBe('We must visit Ueno Park.')
  })
})

describe('resolvePlaceByName', () => {
  it('matches on a partial name', () => {
    expect(resolvePlaceByName('Tsukiji market', catalogue)).toBe(
      places.find((place) => place.name.includes('Tsukiji'))!.placeId,
    )
  })

  it('never resolves to the lodging', () => {
    expect(resolvePlaceByName('Kuramae', catalogue)).toBeUndefined()
  })

  it('refuses a phrase too short to mean anything', () => {
    expect(resolvePlaceByName('a', catalogue)).toBeUndefined()
  })

  it('refuses a phrase made only of generic words', () => {
    expect(resolvePlaceByName('the park', catalogue)).toBeUndefined()
    expect(resolvePlaceByName('a museum', catalogue)).toBeUndefined()
  })
})

describe('routeMessage', () => {
  const plan = basePlan()
  const thin = createPlaceCatalogue([
    { ...places[1], placeId: 'place_a', name: 'Somewhere', category: 'ramen', tags: ['ramen'] },
  ])

  it('routes a pace complaint to fewer stops, whatever else it mentions', () => {
    expect(routeMessage({ message: 'I feel tired. Fewer spots.', plan, catalogue: thin })).toEqual({
      kind: 'fewer_stops',
      maxPerDay: 2,
    })
  })

  it('needs a reason as well as a time before it clears a day', () => {
    expect(
      routeMessage({ message: 'We arrive after 3pm on Day 1.', plan, catalogue: thin }).kind,
    ).not.toBe('clear_after')
  })

  it('falls back to the day the user is looking at', () => {
    expect(
      routeMessage({ message: 'Rain from 4pm.', plan, catalogue: thin, focusDayIndex: 0 }),
    ).toMatchObject({ kind: 'weather_after', dayIndex: 0, from: '16:00' })
  })

  it('ignores a focus day the plan does not have', () => {
    expect(
      routeMessage({ message: 'Rain from 4pm.', plan, catalogue: thin, focusDayIndex: 9 }).kind,
    ).toBe('unresolved')
  })

  it('asks rather than guessing when nothing matches', () => {
    expect(routeMessage({ message: 'What do you think?', plan, catalogue: thin }).kind).toBe(
      'unresolved',
    )
  })
})

describe('candidate retrieval honours opening hours (§12.1)', () => {
  /**
   * Filtering at retrieval rather than only validating afterwards is the
   * difference between never offering a closed door and offering one and then
   * rejecting the plan that took it. Both layers call the same rule module so
   * they cannot drift apart.
   */
  const LUNCH_ONLY: DemoPlace = {
    placeId: 'lunch_only',
    name: 'Lunch Only',
    lat: 35.7,
    lng: 139.79,
    category: 'ramen',
    neighborhood: 'Kuramae',
    typicalDurationMin: 45,
    tags: [],
    shortDescription: 'Open for lunch and nothing else.',
    source: 'manual_demo',
    openingHours: { mon: '11:00-15:00', tue: 'closed', wed: '11:00-15:00',
      thu: '11:00-15:00', fri: '11:00-15:00', sat: '11:00-15:00', sun: '11:00-15:00' },
  }

  const ALL_DAY: DemoPlace = {
    ...LUNCH_ONLY,
    placeId: 'all_day',
    name: 'All Day',
    openingHours: { mon: '09:00-23:00', tue: '09:00-23:00', wed: '09:00-23:00',
      thu: '09:00-23:00', fri: '09:00-23:00', sat: '09:00-23:00', sun: '09:00-23:00' },
  }

  const NO_HOURS: DemoPlace = { ...LUNCH_ONLY, placeId: 'no_hours', name: 'No Hours' }
  delete (NO_HOURS as { openingHours?: unknown }).openingHours

  const small = createPlaceCatalogue([LUNCH_ONLY, ALL_DAY, NO_HOURS])
  const offered = (weekday: 'mon' | 'tue', startTime: string, endTime: string) =>
    small.candidates({ openAt: { weekday, startTime, endTime } }).map((place) => place.placeId)

  it('offers a place for a window it is open for', () => {
    expect(offered('mon', '13:00', '13:45')).toContain('lunch_only')
  })

  it('excludes a place that has not opened yet', () => {
    expect(offered('mon', '10:00', '10:45')).not.toContain('lunch_only')
  })

  it('excludes a place that would still be occupied past closing', () => {
    expect(offered('mon', '14:30', '15:30')).not.toContain('lunch_only')
  })

  it('excludes a place on a day it is shut', () => {
    expect(offered('tue', '13:00', '13:45')).not.toContain('lunch_only')
    expect(offered('tue', '13:00', '13:45')).toContain('all_day')
  })

  it('excludes a place with no hours at all rather than assuming it is open', () => {
    expect(offered('mon', '13:00', '13:45')).not.toContain('no_hours')
  })

  it('leaves retrieval unfiltered when no window is asked for', () => {
    expect(small.candidates({}).map((place) => place.placeId)).toEqual([
      'lunch_only',
      'all_day',
      'no_hours',
    ])
  })
})
