/**
 * A State edit touches only what it affects (product_spec §7.6).
 *
 * The rules held here are the traveller's: one slot asked for changes that one stop;
 * an avoid reaches only what it rules out; nothing the traveller chose is re-chosen
 * behind their back; and any change in a multi-stop proposal can be declined to keep
 * the original.
 */

import { describe, expect, it } from 'vitest'

import { tagConsidering } from '../../src/application/decompose/tagConsidering.ts'
import { proposeStateEdit, toStateDraft } from '../../src/application/editState/proposeStateEdit.ts'
import { rescopePlan } from '../../src/application/editState/rescope.ts'
import { applyUnits, narrowProposal } from '../../src/application/planning/narrowProposal.ts'
import { allItems, type Plan } from '../../src/domain/plan/types.ts'
import { createPlaceCatalogue } from '../../src/services/places/catalogue.ts'
import { catalogue, createTokyoTrip, NOW } from '../scenarios/tokyoTrip.ts'

function edit(trip: ReturnType<typeof createTokyoTrip>, ...lines: string[]) {
  const draft = toStateDraft(trip.state)
  lines.forEach((text, index) => draft.considering.push({ id: `c_new_${index}`, text }))
  return proposeStateEdit({
    tripId: 'trip_1', frame: trip.frame, state: trip.state, plan: trip.plan, draft, catalogue,
    now: NOW, proposalId: 'prop', createdAt: NOW.toISOString(),
  })
}

/** "day:start:place" for every stop — the whole itinerary, comparable. */
const stops = (plan: Plan) => allItems(plan).map((item) => `${item.dayIndex}:${item.startTime}:${item.placeId}`)

describe('reading a slot request', () => {
  const empty = createPlaceCatalogue([])
  it('reads the day, the part of the day, and the kind of place', () => {
    expect(tagConsidering('Day 2 dinner: sushi', empty)).toEqual({ kind: 'slot_category', dayIndex: 1, role: 'dinner', category: 'sushi' })
    expect(tagConsidering('Sushi for lunch on day 3 instead of ramen', empty)).toMatchObject({ role: 'lunch', category: 'sushi' })
    expect(tagConsidering('Day 4 after dinner: a cocktail bar', empty)).toMatchObject({ role: 'nightcap', category: 'bar_cocktail' })
  })
  it('does not guess a kind of place that was not named', () => {
    expect(tagConsidering('Day 2 dinner: something nice', empty)).toBeUndefined()
  })
})

describe('one slot asked for', () => {
  it('changes that one stop, keeps its start, and is previewed as a Reframe first', () => {
    const trip = createTokyoTrip()
    const outcome = edit(trip, 'Day 2 dinner: ramen')
    expect(outcome.kind).toBe('proposal')
    if (outcome.kind !== 'proposal') return
    expect(outcome.proposal.type).toBe('reframe')

    const before = stops(trip.plan)
    const after = stops(outcome.proposal.candidatePlan)
    const changed = after.filter((stop) => !before.includes(stop))
    expect(changed).toHaveLength(1)
    expect(changed[0].startsWith('1:18:00:')).toBe(true)
    expect(after).toHaveLength(before.length)

    const swapped = outcome.proposal.planDiff.modified[0].after
    expect(catalogue.get(swapped.placeId)?.category).toBe('ramen')
    expect(swapped.reasons?.[0]).toEqual({ text: 'You asked for ramen for Day 2 dinner.', strength: 'primary' })
    // What it replaced is offered first under "More options".
    expect(swapped.slate?.[0]).toMatchObject({ placeId: outcome.proposal.planDiff.modified[0].before.placeId, previous: true })
  })
})

describe('an avoid', () => {
  it('reaches only the stops it rules out, each as a change that can be declined', () => {
    const trip = createTokyoTrip()
    const outcome = edit(trip, 'Avoid izakaya')
    expect(outcome.kind).toBe('proposal')
    if (outcome.kind !== 'proposal') return

    const izakaya = allItems(trip.plan).filter((item) => catalogue.get(item.placeId)?.category === 'izakaya')
    const units = outcome.proposal.units ?? []
    expect(units).toHaveLength(izakaya.length)
    expect(units.every((unit) => !unit.required)).toBe(true)
    // Nothing else moved.
    const changedIds = new Set(outcome.proposal.planDiff.modified.map((entry) => entry.after.id))
    expect([...changedIds].sort()).toEqual(izakaya.map((item) => item.id).sort())
    expect(outcome.proposal.planDiff.added).toEqual([])
    expect(outcome.proposal.planDiff.removed).toEqual([])
  })

  it('never re-chooses a stop the traveller picked', () => {
    const trip = createTokyoTrip()
    const target = allItems(trip.plan).find((item) => catalogue.get(item.placeId)?.category === 'izakaya')!
    const picked: Plan = {
      ...trip.plan,
      days: trip.plan.days.map((day) => ({
        ...day,
        items: day.items.map((item) => (item.id === target.id ? { ...item, placedBy: 'user' as const } : item)),
      })),
    }
    const result = rescopePlan({
      plan: picked,
      before: trip.state,
      after: { ...trip.state, considering: [...trip.state.considering, { id: 'x', text: 'Avoid izakaya', tag: { kind: 'avoid', value: 'izakaya' } }] },
      catalogue,
      frame: trip.frame,
    })
    expect(result.units.some((unit) => unit.putItems.some((item) => item.id === target.id))).toBe(false)
  })

  it('never re-chooses a stop that has already happened', () => {
    const trip = createTokyoTrip()
    const target = allItems(trip.plan).find((item) => catalogue.get(item.placeId)?.category === 'izakaya')!
    const result = rescopePlan({
      plan: trip.plan,
      before: trip.state,
      after: { ...trip.state, considering: [...trip.state.considering, { id: 'x', text: 'Avoid izakaya', tag: { kind: 'avoid', value: 'izakaya' } }] },
      catalogue,
      frame: trip.frame,
      lockedItemIds: [target.id],
    })
    expect(result.units.some((unit) => unit.putItems.some((item) => item.id === target.id))).toBe(false)
  })
})

describe('declining a change', () => {
  it('keeps the original stop in that slot and applies the rest', () => {
    const trip = createTokyoTrip()
    const outcome = edit(trip, 'Avoid izakaya')
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')
    const [declined, ...rest] = outcome.proposal.units!

    const narrowed = narrowProposal({
      proposal: outcome.proposal,
      declinedUnitIds: [declined.id],
      currentState: trip.state,
      currentPlan: trip.plan,
      frame: trip.frame,
      catalogue,
      now: NOW,
    })
    expect(narrowed.kind).toBe('proposal')
    if (narrowed.kind !== 'proposal') return

    const keptId = declined.putItems[0].id
    const original = allItems(trip.plan).find((item) => item.id === keptId)!
    const now = allItems(narrowed.proposal.candidatePlan).find((item) => item.id === keptId)!
    expect(now.placeId).toBe(original.placeId)
    expect(narrowed.proposal.planDiff.modified).toHaveLength(rest.length)
    expect(narrowed.proposal.units).toHaveLength(rest.length)
  })

  it('applying no optional change leaves the plan exactly as it was', () => {
    const trip = createTokyoTrip()
    expect(stops(applyUnits(trip.plan, []))).toEqual(stops(trip.plan))
  })
})
