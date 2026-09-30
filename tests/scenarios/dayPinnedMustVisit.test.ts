/**
 * A must-visit pinned to a day (eval H5, 2026-09-30).
 *
 * "Must visit Nezu Museum on Day 4." used to lose "on Day 4" in tagging, so the
 * museum was scheduled on whichever day had room and the plan reported valid even
 * when Day 4 was the one day it was closed. The day is part of the constraint.
 */

import { describe, expect, it } from 'vitest'

import { confirmReview, defaultPriorities, toFrame } from '../../src/application/createTrip/createTrip.ts'
import { tagConsidering } from '../../src/application/decompose/tagConsidering.ts'
import { proposeStateEdit, toStateDraft } from '../../src/application/editState/proposeStateEdit.ts'
import { generateFirstPlan } from '../../src/application/generatePlan/generatePlan.ts'
import { explainValidationError } from '../../src/application/planning/conflicts.ts'
import { allItems } from '../../src/domain/plan/types.ts'
import { validatePlan } from '../../src/domain/validation/validate.ts'
import { createPlaceCatalogue, toValidationPlaces } from '../../src/services/places/catalogue.ts'
import { NOW, pacePattern, places, SETUP } from './tokyoTrip.ts'

/** Nezu open Tue-Sun in the bundle; Day 4 of the fixture trip is Thursday 2026-10-08. */
const closedThursday = createPlaceCatalogue(
  places.map((place) => (place.placeId === 'nezu_museum' ? { ...place, openingHours: { ...place.openingHours!, thu: 'closed' } } : place)),
)
const bundled = createPlaceCatalogue(places)

function create(sentence: string, catalogue = bundled) {
  const frame = toFrame(SETUP)
  const { trip, state } = confirmReview({
    tripId: 'trip_pin', frame,
    draft: { intent: [{ id: 'intent_1', text: 'Slow-paced' }], considering: [{ id: 'cons_1', text: sentence }], priorities: defaultPriorities() },
    profileMemories: [pacePattern()], catalogue, createdAt: NOW.toISOString(),
  })
  const result = generateFirstPlan({ frame, state, catalogue, days: 5, now: NOW, memorySnapshot: trip.memorySnapshot })
  return { frame, state, trip, ...result }
}

describe('a must-visit pinned to a day', () => {
  it('keeps the day in the tag', () => {
    expect(tagConsidering('Must visit Nezu Museum on Day 4.', bundled)).toEqual({ kind: 'must_visit', placeId: 'nezu_museum', dayIndex: 3 })
    expect(tagConsidering('Must visit Nezu Museum.', bundled)).toEqual({ kind: 'must_visit', placeId: 'nezu_museum' })
  })

  it('is planned on that day when it is open', () => {
    const { plan, validation } = create('Must visit Nezu Museum on Day 4.')
    expect(validation.valid).toBe(true)
    expect(allItems(plan).find((item) => item.placeId === 'nezu_museum')?.dayIndex).toBe(3)
  })

  it('makes the first plan invalid, not silently moved, when that day is closed', () => {
    const { plan, validation } = create('Must visit Nezu Museum on Day 4.', closedThursday)
    expect(validation.valid).toBe(false)
    expect(allItems(plan).some((item) => item.placeId === 'nezu_museum')).toBe(false)
    expect(validation.errors.map((error) => error.code)).toContain('must_visit_missing')
  })

  it('explains the Conflict concretely and offers the days it is open', () => {
    const { validation, state, frame } = create('Must visit Nezu Museum on Day 4.', closedThursday)
    const error = validation.errors.find((entry) => entry.code === 'must_visit_missing')!
    const conflict = explainValidationError(error, state, frame, closedThursday)

    expect(conflict.message).toBe('Nezu Museum is closed on Thursdays, so it can\'t be on Day 4.')
    // Monday (Day 1) is a real closing day, so it is not offered.
    expect(conflict.options?.filter((option) => option.kind === 'move_day').map((option) => option.label)).toEqual(['Move to Day 2', 'Move to Day 3', 'Move to Day 5'])
    expect(conflict.options?.find((option) => option.kind === 'move_day')).toMatchObject({ text: 'Must visit Nezu Museum on Day 2.' })
    expect(conflict.options?.map((option) => option.kind)).toEqual(expect.arrayContaining(['remove', 'edit']))
  })

  it('reports a pin satisfied on the wrong day', () => {
    const { plan, state, frame } = create('Must visit Nezu Museum on Day 4.')
    const moved = {
      ...plan,
      days: plan.days.map((day) => ({ ...day, items: day.items.map((item) => (item.placeId === 'nezu_museum' ? { ...item, dayIndex: 1 } : item)) })),
    }
    const result = validatePlan(moved, { frame, state, places: toValidationPlaces(bundled), now: NOW })
    expect(result.errors.map((error) => error.code)).toContain('must_visit_wrong_day')
  })

  it('moves an already-planned place to the named day on a State edit', () => {
    const base = create('Must visit Nezu Museum.')
    const plannedOn = allItems(base.plan).find((item) => item.placeId === 'nezu_museum')!.dayIndex
    const target = plannedOn === 3 ? 2 : 3
    const draft = toStateDraft(base.state)
    draft.considering[0].text = `Must visit Nezu Museum on Day ${target + 1}.`

    const outcome = proposeStateEdit({
      tripId: 'trip_pin', frame: base.frame, state: base.state, plan: base.plan, draft, catalogue: bundled,
      now: NOW, proposalId: 'prop_pin', createdAt: NOW.toISOString(), memorySnapshot: base.trip.memorySnapshot,
    })
    expect(outcome.kind).toBe('proposal')
    if (outcome.kind !== 'proposal') return
    expect(outcome.proposal.type).toBe('reframe')
    const nezu = allItems(outcome.proposal.candidatePlan).filter((item) => item.placeId === 'nezu_museum')
    expect(nezu).toHaveLength(1)
    expect(nezu[0].dayIndex).toBe(target)
  })

  it('returns a Conflict with options on a State edit to a closed day', () => {
    const base = create('Slow mornings.', closedThursday)
    const draft = toStateDraft(base.state)
    draft.considering.push({ id: 'cons_nezu', text: 'Must visit Nezu Museum on Day 4.' })
    const outcome = proposeStateEdit({
      tripId: 'trip_pin', frame: base.frame, state: base.state, plan: base.plan, draft, catalogue: closedThursday,
      now: NOW, proposalId: 'prop_pin', createdAt: NOW.toISOString(), memorySnapshot: base.trip.memorySnapshot,
    })
    expect(outcome.kind).toBe('conflict')
    if (outcome.kind !== 'conflict') return
    expect(outcome.conflicts[0].message).toContain('closed on Thursdays')
    expect(outcome.conflicts[0].consideringId).toBe('cons_nezu')
    expect(outcome.conflicts[0].options?.length).toBeGreaterThan(2)
  })
})
