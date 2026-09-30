/**
 * scenario_conflict_impossible_must_visit (Gate 5 demo scenario 5).
 *
 * The user pins a place the bounded Tokyo dataset does not contain. The
 * product must not quietly drop the constraint, and must not invent a POI to
 * satisfy it (§8: "no invented POI ids"). It has to come back as a Conflict
 * naming the user's own sentence.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import {
  proposeStateEdit,
  toStateDraft,
} from '../../src/application/editState/proposeStateEdit.ts'
import {
  isUnresolvedPlaceId,
  tagConsidering,
} from '../../src/application/decompose/tagConsidering.ts'
import {
  catalogue,
  createTokyoTrip,
  mustVisitSentence,
  NOW,
  placeNotInPlan,
  type TokyoTrip,
} from './tokyoTrip.ts'

const IMPOSSIBLE = 'We must visit teamLab Planets.'

let trip: TokyoTrip

beforeEach(() => {
  trip = createTokyoTrip()
})

function addConsidering(text: string) {
  const draft = toStateDraft(trip.state)
  draft.considering.push({ id: 'cons_new', text })
  return proposeStateEdit({
    tripId: 'trip_1',
    frame: trip.frame,
    state: trip.state,
    plan: trip.plan,
    draft,
    catalogue,
    now: NOW,
    proposalId: 'prop_state',
    createdAt: NOW.toISOString(),
  })
}

describe('scenario_conflict_impossible_must_visit', () => {
  it('still recognises the sentence as a must-visit', () => {
    const tag = tagConsidering(IMPOSSIBLE, catalogue)
    expect(tag?.kind).toBe('must_visit')
  })

  it('marks the place as unresolved rather than guessing at one', () => {
    const tag = tagConsidering(IMPOSSIBLE, catalogue)
    if (tag?.kind !== 'must_visit') throw new Error('expected a must-visit tag')
    expect(isUnresolvedPlaceId(tag.placeId)).toBe(true)
    expect(catalogue.has(tag.placeId)).toBe(false)
  })

  it('returns a Conflict instead of a proposal', () => {
    expect(addConsidering(IMPOSSIBLE).kind).toBe('conflict')
  })

  it('ties the Conflict to the row that caused it', () => {
    const outcome = addConsidering(IMPOSSIBLE)
    if (outcome.kind !== 'conflict') throw new Error('expected a conflict')

    expect(outcome.conflicts).toHaveLength(1)
    expect(outcome.conflicts[0].consideringId).toBe('cons_new')
  })

  it('explains it in the user’s own words, not in tag ids', () => {
    const outcome = addConsidering(IMPOSSIBLE)
    if (outcome.kind !== 'conflict') throw new Error('expected a conflict')

    expect(outcome.conflicts[0].message).toContain('teamLab Planets')
    expect(outcome.conflicts[0].message).not.toContain('unresolved:')
  })

  it('does not commit the State edit', () => {
    const before = JSON.stringify(trip.state)
    addConsidering(IMPOSSIBLE)
    expect(JSON.stringify(trip.state)).toBe(before)
  })

  it('does not touch the Plan', () => {
    const before = JSON.stringify(trip.plan)
    addConsidering(IMPOSSIBLE)
    expect(JSON.stringify(trip.plan)).toBe(before)
  })

  it('accepts the same sentence when the place IS in the dataset', () => {
    // Derived, not named: ranking decides what the first plan already holds,
    // and a must-visit that is in the plan is a no-op rather than a proposal.
    const real = placeNotInPlan(trip.plan)
    const outcome = addConsidering(mustVisitSentence(real))
    expect(outcome.kind).toBe('proposal')
  })
})
