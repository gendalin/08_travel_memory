/**
 * Reading the traveller's words (2026-10-01): the model names a kind of instruction,
 * code decides the day and the place. And the rules the model falls back to.
 */

import { describe, expect, it } from 'vitest'

import {
  considerByRules,
  considerFromReading,
  describeTag,
  intentByRules,
  intentFromReading,
  interpretLines,
} from '../../src/application/decompose/interpret.ts'
import { readLineReadings, readMessageReading } from '../../src/services/llm/validate.ts'
import { createStubLlm } from '../../src/services/llm/stubLlm.ts'
import { createPlaceCatalogue } from '../../src/services/places/catalogue.ts'
import type { LineReading } from '../../src/services/llm/types.ts'
import { places } from '../scenarios/tokyoTrip.ts'

const shinYokohama = { ...places.find((place) => place.category === 'ramen')!, placeId: 'shin_yoko_ramen', name: 'Shin-Yokohama Ramen Museum' }
const catalogue = createPlaceCatalogue([...places, shinYokohama])
const context = { catalogue, days: 5 }

const reading = (overrides: Partial<LineReading>): LineReading => ({
  id: 'l1', kind: 'theme', day: null, place: null, category: null, meal: null, time: null, minutes: null,
  budget: null, avoid: null, activity: null, pace: null, characters: [], question: null, ...overrides,
})

describe('a model reading, made concrete by code', () => {
  it('a day in a town: "last" is the trip’s last day, and the town is the town', () => {
    const read = considerFromReading(reading({ kind: 'day_in_place', day: 'last', place: 'Yokohama' }), context)
    expect(read.tag).toMatchObject({ kind: 'day_in_place', dayIndex: 4, place: { name: 'Yokohama', areaId: 'yokohama' } })
    expect(read.readAs).toBe('Day 5 → a day in Yokohama')
  })

  it('never lets a shop whose name contains the town stand in for the town', () => {
    const read = considerFromReading(reading({ kind: 'day_in_place', day: 2, place: 'Yokohama' }), context)
    expect(read.tag?.kind).toBe('day_in_place')
  })

  it('pins a place the trip knows to the day named', () => {
    const read = considerFromReading(reading({ kind: 'must_visit', day: 4, place: 'Nezu Museum' }), context)
    expect(read.tag).toEqual({ kind: 'must_visit', placeId: 'nezu_museum', dayIndex: 3 })
  })

  it('keeps an unknown place unresolved rather than inventing where it is', () => {
    const read = considerFromReading(reading({ kind: 'day_in_place', day: 1, place: 'Atlantis' }), context)
    expect(read.tag).toEqual({ kind: 'day_in_place', dayIndex: 0, place: { name: 'Atlantis' } })
    expect(read.readAs).toContain('location still to find')
  })

  it('asks instead of guessing: a day the trip has not got, or no day at all', () => {
    expect(considerFromReading(reading({ kind: 'day_in_place', day: 9, place: 'Kamakura' }), context).question).toContain('5 days')
    expect(considerFromReading(reading({ kind: 'day_in_place', day: null, place: 'Kamakura' }), context).question).toContain('Which day')
    expect(considerFromReading(reading({ kind: 'unclear', question: '哪一天？' }), context).question).toBe('哪一天？')
  })

  it('turns every other kind into the tag the planner already knows', () => {
    expect(considerFromReading(reading({ kind: 'avoid', avoid: 'crowds' }), context).tag).toEqual({ kind: 'avoid', value: 'crowded tourist spots' })
    expect(considerFromReading(reading({ kind: 'slot_meal', day: 2, meal: 'dinner', category: 'sushi' }), context).tag)
      .toEqual({ kind: 'slot_category', dayIndex: 1, role: 'dinner', category: 'sushi' })
    expect(considerFromReading(reading({ kind: 'finish_by', day: 3, time: '17:00' }), context).tag).toEqual({ kind: 'fixed_time', dayIndex: 2, time: '17:00' })
    expect(considerFromReading(reading({ kind: 'pace', pace: 'slow' }), context).tag).toEqual({ kind: 'pace', style: 'slow' })
    expect(considerFromReading(reading({ kind: 'theme' }), context).tag).toBeUndefined()
  })

  it('reads an Intent line for its pace and its kinds of neighbourhood', () => {
    const read = intentFromReading(reading({ pace: 'slow', characters: ['literary', 'not_a_character'] }))
    expect(read.reading).toEqual({ pace: 'slow', characters: ['literary'] })
    expect(read.readAs).toContain('Pace: slow')
  })
})

describe('the rules, when no model answers', () => {
  it.each([
    ['go to Yokohama on last day', 4],
    ['Go to Kamakura on Day 2', 1],
    ['Day 3: Kawagoe', 2],
    ['最後一天去橫濱', 4],
    ['第2天去鎌倉', 1],
  ])('reads “%s” as a day in a town', (text, dayIndex) => {
    const read = considerByRules(text, context)
    expect(read.tag).toMatchObject({ kind: 'day_in_place', dayIndex })
    expect(read.readBy).toBe('rules')
  })

  it('still reads the sentences it always read', () => {
    expect(considerByRules('Day 2 dinner: sushi', context).tag).toMatchObject({ kind: 'slot_category' })
    expect(considerByRules('We must visit Nezu Museum on Day 4.', context).tag).toEqual({ kind: 'must_visit', placeId: 'nezu_museum', dayIndex: 3 })
    expect(intentByRules('Slow neighbourhood walks, old bookstores').reading).toMatchObject({ pace: 'slow' })
  })

  it('says every tag back in words', () => {
    expect(describeTag(undefined, catalogue)).toContain('general wish')
    expect(describeTag({ kind: 'transport', avoid: 'taxi' }, catalogue)).toBe('No taxis')
  })
})

describe('interpretLines', () => {
  it('uses the model’s reading where there is one, and the rules for the rest', async () => {
    const llm = createStubLlm({ lineReadings: { 'Spend Friday somewhere by the sea': { ...reading({ kind: 'day_in_place', day: 'last', place: 'Kamakura' }) } } })
    const read = await interpretLines({
      llm,
      lines: [
        { text: 'Spend Friday somewhere by the sea', section: 'considering' },
        { text: 'Avoid izakaya', section: 'considering' },
      ],
      destination: 'Tokyo', startDate: '2026-10-05', context,
    })
    expect(read.get('considering:Spend Friday somewhere by the sea')).toMatchObject({ readBy: 'model', tag: { kind: 'day_in_place', dayIndex: 4 } })
    expect(read.get('considering:Avoid izakaya')).toMatchObject({ readBy: 'rules', tag: { kind: 'avoid', value: 'izakaya' } })
  })

  it('falls back to the rules entirely when the model fails', async () => {
    const failing = { ...createStubLlm(), interpretLines: async () => { throw new Error('down') } }
    const read = await interpretLines({ llm: failing, lines: [{ text: 'go to Yokohama on last day', section: 'considering' }], destination: 'Tokyo', startDate: '2026-10-05', context })
    expect(read.get('considering:go to Yokohama on last day')).toMatchObject({ readBy: 'rules', tag: { kind: 'day_in_place' } })
  })
})

describe('reading what the model sent back', () => {
  it('keeps well-formed readings and drops the rest', () => {
    const out = readLineReadings({ readings: [
      { id: 'a', kind: 'day_in_place', day: 'last', place: 'Yokohama', characters: [] },
      { id: 'b', kind: 'teleport' },
      { kind: 'avoid' },
    ] })
    expect(out.readings.map((entry) => entry.id)).toEqual(['a'])
    expect(out.readings[0]).toMatchObject({ day: 'last', place: 'Yokohama', time: null })
  })

  it('reads a message reading, and null as "let the rules route it"', () => {
    expect(readMessageReading({ reading: null })).toBeNull()
    expect(readMessageReading({ reading: { action: 'weather', day: 2, time: '15:00' } })).toMatchObject({ action: 'weather', day: 2, time: '15:00' })
    expect(() => readMessageReading({ reading: { action: 'dance' } })).toThrow()
  })
})
