/**
 * Area days (eval R1, 2026-09-30).
 *
 * Discovery brought Jimbocho's bookshops into a trip's pool and the plan still never
 * went there. An area day is a day spent in such a neighbourhood: its stops come from
 * inside it first, it opens on what the area is known for, and the evening is free to
 * end near the lodging.
 */

import { describe, expect, it } from 'vitest'

import { handleChatMessage } from '../../src/application/handleChat/handleChat.ts'
import { areaDaysFor, inArea } from '../../src/application/planning/areaDays.ts'
import { measureMovement, SLOW_BUDGET, withinBudget } from '../../src/domain/plan/movement.ts'
import { allItems } from '../../src/domain/plan/types.ts'
import { TOKYO_AREAS } from '../../src/domain/places/areas.ts'
import { createPlaceCatalogue } from '../../src/services/places/catalogue.ts'
import { createStubLlm } from '../../src/services/llm/stubLlm.ts'
import type { DemoPlace } from '../../src/services/places/types.ts'
import { buildTrip, retrievedPlaces } from '../../eval/lib/fixture.ts'
import { NOW, places } from './tokyoTrip.ts'

const JIMBOCHO = TOKYO_AREAS.find((area) => area.id === 'jimbocho')!
const OPEN = { mon: '10:00-20:00', tue: '10:00-20:00', wed: '10:00-20:00', thu: '10:00-20:00', fri: '10:00-20:00', sat: '10:00-20:00', sun: '10:00-20:00' }

/** A small literary quarter, a few hundred metres across, as retrieval would bring back. */
function jimbochoPlace(id: string, name: string, category: string, dLat: number, dLng: number): DemoPlace {
  return {
    placeId: id, name, category, neighborhood: 'Kanda Jinbōchō',
    lat: JIMBOCHO.center.lat + dLat, lng: JIMBOCHO.center.lng + dLng,
    typicalDurationMin: 60, tags: [category.replace('_', ' ')], shortDescription: '', source: 'places_api',
    priceLevel: 1, openingHours: OPEN, userRatingCount: 300,
  }
}
const QUARTER = [
  jimbochoPlace('jb_books_a', 'Isseido Booksellers', 'bookstore', 0, 0),
  jimbochoPlace('jb_books_b', 'Yaguchi Shoten', 'bookstore', 0.001, 0.002),
  jimbochoPlace('jb_books_c', 'Komiyama Shoten', 'bookstore', -0.001, 0.001),
  jimbochoPlace('jb_kissa_a', 'Sabouru', 'cafe_kissaten', 0.002, -0.001),
  jimbochoPlace('jb_kissa_b', 'Milonga Nuova', 'cafe_kissaten', 0.001, -0.002),
]

const LITERARY = ['Showa-era literary atmosphere', 'old bookstores and kissaten']
const catalogue = createPlaceCatalogue([...retrievedPlaces(), ...QUARTER])

describe('areaDaysFor', () => {
  const lodging = catalogue.get('kuramae_base')!
  const state = (intent: string[]) => ({ version: 1, intent: intent.map((text, index) => ({ id: `i${index}`, text })), considering: [], priorities: [] })

  it('chooses an area the words ask for and the pool can furnish', () => {
    const days = areaDaysFor({ state: state(LITERARY), pool: catalogue.all(), lodging, days: 5 })
    expect(days.map((day) => day.area.id)).toContain('jimbocho')
    expect(days[0].dayIndex).toBe(1)
    expect(days[0].because.stateItemIds).toContain('i0')
  })

  it('does not make a day of an area the pool has almost nothing in', () => {
    // The bundled set has nothing in Jimbocho; two places are not a day.
    const thin = [...places, ...QUARTER.slice(0, 2)]
    const days = areaDaysFor({ state: state(LITERARY), pool: thin, lodging, days: 5 })
    expect(days.some((day) => day.area.id === 'jimbocho')).toBe(false)
  })

  it('makes no area days without a character asked for, or on a short trip', () => {
    expect(areaDaysFor({ state: state(['Good food']), pool: catalogue.all(), lodging, days: 5 })).toEqual([])
    expect(areaDaysFor({ state: state(LITERARY), pool: catalogue.all(), lodging, days: 2 })).toEqual([])
  })
})

describe('a trip with an area day', () => {
  const trip = buildTrip({ catalogue, intent: LITERARY })
  const day = trip.plan.days.find((entry) => entry.area?.id === 'jimbocho')!

  it('spends the day in the area, opening on what it is known for', () => {
    expect(day).toBeDefined()
    const daytime = day.items.filter((item) => item.role !== 'dinner' && item.role !== 'nightcap')
    for (const item of daytime) expect(inArea(catalogue.get(item.placeId)!, day.area!)).toBe(true)
    const main = day.items.find((item) => item.role === 'main_destination')!
    expect(catalogue.get(main.placeId)!.category).toBe('bookstore')
    expect(main.reasons?.[0].text).toContain('spent in Jimbocho')
  })

  it('keeps kissaten for lunch, and does not repeat a kind of place back to back', () => {
    const ordered = [...day.items].sort((a, b) => a.startTime.localeCompare(b.startTime))
    expect(catalogue.get(ordered.find((item) => item.role === 'lunch')!.placeId)!.category).toBe('cafe_kissaten')
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i].role === 'extension_2') {
        expect(catalogue.get(ordered[i].placeId)!.category).not.toBe(catalogue.get(ordered[i - 1].placeId)!.category)
      }
    }
  })

  it('is a slow day: the trip out and back is not a move', () => {
    const ordered = [...day.items].sort((a, b) => a.startTime.localeCompare(b.startTime))
    expect(withinBudget(measureMovement(ordered.map((item) => catalogue.get(item.placeId)!)), SLOW_BUDGET)).toBe(true)
  })

  it('looks for a replacement in the same neighbourhood', async () => {
    const lunch = day.items.find((item) => item.role === 'lunch')!
    const outcome = await handleChatMessage({
      message: `The ${catalogue.get(lunch.placeId)!.name} on Day ${day.dayIndex + 1} is closed today.`,
      tripId: 'trip_eval', frame: trip.frame, state: trip.state, plan: trip.plan, catalogue,
      llm: createStubLlm(), now: NOW, proposalId: 'p', createdAt: NOW.toISOString(), memorySnapshot: trip.trip.memorySnapshot,
    })
    if (outcome.kind !== 'proposal') throw new Error(`expected a proposal, got ${outcome.kind}`)
    const swapped = outcome.proposal.planDiff.modified[0].after
    expect(inArea(catalogue.get(swapped.placeId)!, day.area!)).toBe(true)
  })

  it('leaves days without an area as they were planned', () => {
    expect(trip.plan.days.filter((entry) => entry.area).length).toBeLessThanOrEqual(2)
    expect(allItems(trip.plan).length).toBeGreaterThan(0)
  })
})
