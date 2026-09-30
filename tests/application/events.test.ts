/**
 * Live events (product_spec §7.8): found and checked by code, planned without
 * disturbing more than they must.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { tagConsidering } from '../../src/application/decompose/tagConsidering.ts'
import { rescopePlan } from '../../src/application/editState/rescope.ts'
import { allItems } from '../../src/domain/plan/types.ts'
import type { TripEvent, TripState } from '../../src/domain/state/types.ts'
import { createRecordedEventFinder, type EventRecording } from '../../src/services/events/recordedEvents.ts'
import { createPlaceCatalogue } from '../../src/services/places/catalogue.ts'
import { eventPlaceId, withEventPlaces } from '../../src/services/places/eventPlaces.ts'
import { verifiedOnPage } from '../../server/events.ts'
import { catalogue, createTokyoTrip } from '../scenarios/tokyoTrip.ts'

const recording = JSON.parse(readFileSync('data/demo_events/tokyo_baseball.json', 'utf8')) as EventRecording

describe('asking for an event', () => {
  const empty = createPlaceCatalogue([])
  it('is read as a request that needs a live search', () => {
    expect(tagConsidering('At least one baseball game', empty)).toEqual({ kind: 'event_request', activity: 'baseball' })
    expect(tagConsidering('至少一場棒球', empty)).toEqual({ kind: 'event_request', activity: 'baseball' })
  })
  it('an avoid is not a request', () => {
    expect(tagConsidering('Avoid festivals', empty)?.kind).toBe('avoid')
  })
})

describe('what code checks on a fetched page', () => {
  const page = '9/29（火） 巨人 - 広島 東京ドーム 18:00 先発：戸郷\n9/30（水） 阪神 - ヤクルト 甲子園 18:00'
  const range = { startDate: '2026-09-29', endDate: '2026-10-31' }
  const event = { date: '2026-09-29', start: '18:00', title: '巨人 - 広島', venue: '東京ドーム', quote: '9/29（火） 巨人 - 広島 東京ドーム 18:00' }

  it('keeps an event whose quote, date, time and venue are all on the page', () => {
    expect(verifiedOnPage(event, page, range)).toBe(true)
  })
  it('drops an event whose quote is not on the page — the model inventing a game', () => {
    expect(verifiedOnPage({ ...event, title: 'Giants vs Tigers', quote: '9/29 Giants vs Tigers Tokyo Dome 18:00' }, page, range)).toBe(false)
  })
  it('drops an event put on a date its line does not show', () => {
    expect(verifiedOnPage({ ...event, date: '2026-09-30' }, page, range)).toBe(false)
  })
  it('drops an event outside the trip, or with no time', () => {
    expect(verifiedOnPage(event, page, { startDate: '2026-10-01', endDate: '2026-10-31' })).toBe(false)
    expect(verifiedOnPage({ ...event, start: '' }, page, range)).toBe(false)
  })
  it('drops a reserve date that may never be played', () => {
    const reserve = '9月27日(日) T－D予備 （甲子園） 18:00'
    expect(verifiedOnPage({ date: '2026-09-27', start: '18:00', title: 'T－D予備', venue: '甲子園', quote: reserve }, reserve, { startDate: '2026-09-01', endDate: '2026-09-30' })).toBe(false)
  })
})

describe('the recorded search the prototype carries', () => {
  const finder = createRecordedEventFinder([recording])
  it('offers what was recorded for the dates, labelled as recorded', async () => {
    const result = await finder.find({ activity: 'baseball', destination: 'Tokyo', startDate: '2026-10-05', endDate: '2026-10-09' })
    expect(result.recorded).toBe(true)
    expect(result.events.length).toBeGreaterThan(0)
    expect(result.events.every((event) => event.date >= '2026-10-05' && event.date <= '2026-10-09')).toBe(true)
    expect(result.events.every((event) => event.sourceUrl.includes('npb.jp'))).toBe(true)
  })
  it('says so when the dates are outside what was recorded', async () => {
    const result = await finder.find({ activity: 'baseball', destination: 'Tokyo', startDate: '2027-05-01', endDate: '2027-05-05' })
    expect(result.events).toEqual([])
    expect(result.note).toContain('outside')
  })
})

describe('planning a picked event', () => {
  const trip = createTokyoTrip()
  const event: TripEvent = {
    id: 'test_game',
    title: '巨人 - 広島',
    activity: 'baseball',
    dayIndex: 0,
    date: trip.frame.startDate,
    start: '18:00',
    end: '21:30',
    endEstimated: true,
    venue: { name: 'Tokyo Dome', lat: 35.70564, lng: 139.751891, neighborhood: 'Bunkyo' },
    sourceUrl: 'https://npb.jp/games/2026/schedule_09_detail.html',
    fetchedAt: '2026-09-29T14:20:16.137Z',
    recorded: true,
  }
  const after: TripState = {
    ...trip.state,
    considering: [...trip.state.considering, { id: 'c_game', text: 'At least one baseball game', tag: { kind: 'event', event } }],
  }
  const places = withEventPlaces(catalogue, after)
  const result = rescopePlan({ plan: trip.plan, before: trip.state, after, catalogue: places, frame: trip.frame })

  it('adds the event, and takes out only what overlaps it — as the required part', () => {
    const required = result.units.filter((unit) => unit.required)
    expect(required).toHaveLength(1)
    expect(required[0].putItems[0]).toMatchObject({ placeId: eventPlaceId(event), startTime: '18:00', endTime: '21:30', placedBy: 'event' })
    const removed = allItems(trip.plan).filter((item) => required[0].removeItemIds.includes(item.id))
    for (const item of removed) {
      expect(item.dayIndex).toBe(0)
      expect(item.startTime < '22:00' && item.endTime > '17:30').toBe(true)
    }
  })

  it('leaves every other day exactly as it was', () => {
    const others = (plan: typeof trip.plan) =>
      allItems(plan).filter((item) => item.dayIndex !== 0).map((item) => `${item.dayIndex}:${item.startTime}:${item.placeId}`)
    expect(others(result.plan)).toEqual(others(trip.plan))
  })

  it('says where the event came from and when it was checked', () => {
    const item = result.units[0].putItems[0]
    expect(item.reasons?.[0].text).toBe('You asked for baseball: 巨人 - 広島, 18:00 at Tokyo Dome.')
    expect(item.reasons?.[1].text).toContain('npb.jp')
    expect(item.reasons?.[1].text).toContain('recorded for this demo')
  })

  it('offers anything else — a meal moved around it — as a change that can be declined', () => {
    expect(result.units.filter((unit) => !unit.required).every((unit) => unit.putItems.length > 0)).toBe(true)
  })
})
