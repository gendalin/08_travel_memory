/**
 * "Slow" is movement and neighbourhoods, not a stop count (decided 2026-09-30).
 *
 *   six stops inside one kilometre           → slow
 *   five stops each two kilometres apart     → too much
 */

import { describe, expect, it } from 'vitest'

import { confirmReview, defaultPriorities, toFrame } from '../../src/application/createTrip/createTrip.ts'
import { proposeStateEdit, toStateDraft } from '../../src/application/editState/proposeStateEdit.ts'
import { generateFirstPlan } from '../../src/application/generatePlan/generatePlan.ts'
import { movementBudgetOf } from '../../src/application/planning/movementBudget.ts'
import { measureMovement, SLOW_BUDGET, withinBudget } from '../../src/domain/plan/movement.ts'
import type { Plan } from '../../src/domain/plan/types.ts'
import type { TripState } from '../../src/domain/state/types.ts'
import { createPlaceCatalogue } from '../../src/services/places/catalogue.ts'
import type { PlaceCatalogue } from '../../src/services/places/types.ts'
import { retrievedPlaces } from '../../eval/lib/fixture.ts'
import { NOW, SETUP } from '../scenarios/tokyoTrip.ts'

/** A point `km` east of Kuramae along the same latitude. */
const east = (km: number) => ({ lat: 35.703, lng: 139.79 + km / 90.4 })

describe('measureMovement', () => {
  it('six stops inside one kilometre: no moves, one area — slow', () => {
    const day = [0, 0.15, 0.3, 0.45, 0.6, 0.75].map(east)
    const movement = measureMovement(day)
    expect(movement).toMatchObject({ moves: 0, areas: 1 })
    expect(withinBudget(movement, SLOW_BUDGET)).toBe(true)
  })

  it('five stops each over two kilometres apart: four moves, five areas — too much', () => {
    const day = [0, 2.2, 4.4, 6.6, 8.8].map(east)
    const movement = measureMovement(day)
    expect(movement).toMatchObject({ moves: 4, areas: 5 })
    expect(withinBudget(movement, SLOW_BUDGET)).toBe(false)
  })

  it('one move between two walkable neighbourhoods is still slow', () => {
    const day = [0, 0.3, 0.6, 3, 3.3].map(east)
    expect(measureMovement(day)).toMatchObject({ moves: 1, areas: 2 })
    expect(withinBudget(measureMovement(day), SLOW_BUDGET)).toBe(true)
  })
})

describe('movementBudgetOf', () => {
  const state = (intent: string, considering: string[] = []): TripState => ({
    version: 1,
    intent: [{ id: 'i1', text: intent }],
    considering: considering.map((text, index) => ({ id: `c${index}`, text })),
    priorities: defaultPriorities(),
  })
  it('reads a slow pace from the traveller’s own words', () => {
    expect(movementBudgetOf(state('slow neighborhood exploration'))?.source.id).toBe('i1')
    expect(movementBudgetOf(state('Food trip', ['想慢慢逛']))?.source.id).toBe('c0')
    expect(movementBudgetOf(state('See as much as possible'))).toBeUndefined()
  })
})

function plan(catalogue: PlaceCatalogue, intent: string): { plan: Plan; state: TripState; frame: ReturnType<typeof toFrame>; tensions: unknown[] } {
  const frame = toFrame(SETUP)
  const { trip, state } = confirmReview({
    tripId: 't', frame,
    draft: { intent: [{ id: 'intent_1', text: intent }], considering: [], priorities: defaultPriorities() },
    profileMemories: [], catalogue, createdAt: NOW.toISOString(),
  })
  const result = generateFirstPlan({ frame, state, catalogue, days: 5, now: NOW, memorySnapshot: trip.memorySnapshot })
  return { plan: result.plan, state, frame, tensions: result.tensions }
}

function dayMovements(catalogue: PlaceCatalogue, source: Plan) {
  return source.days.map((day) =>
    measureMovement([...day.items].sort((a, b) => a.startTime.localeCompare(b.startTime)).map((item) => catalogue.get(item.placeId)!)),
  )
}

describe('a slow trip', () => {
  const catalogue = createPlaceCatalogue(retrievedPlaces())

  it('keeps every day within one move and two neighbourhoods, without cutting stops', () => {
    const slow = plan(catalogue, 'Slow neighborhood exploration')
    const busy = plan(catalogue, 'Neighborhood exploration')
    for (const movement of dayMovements(catalogue, slow.plan)) expect(withinBudget(movement, SLOW_BUDGET)).toBe(true)
    // Same number of stops: slow is not fewer.
    expect(slow.plan.days.map((day) => day.items.length)).toEqual(busy.plan.days.map((day) => day.items.length))
  })

  it('brings an existing trip back to a walk when "slow" is added to State', () => {
    const busy = plan(catalogue, 'Neighborhood exploration')
    const before = dayMovements(catalogue, busy.plan)
    const draft = toStateDraft(busy.state)
    draft.intent.push({ id: 'intent_slow', text: 'Take it slow' })
    const outcome = proposeStateEdit({
      tripId: 't', frame: busy.frame, state: busy.state, plan: busy.plan, draft, catalogue,
      now: NOW, proposalId: 'p', createdAt: NOW.toISOString(),
    })
    if (before.every((movement) => withinBudget(movement, SLOW_BUDGET))) {
      expect(outcome.kind).toBe('commit_now')
      return
    }
    expect(outcome.kind).toBe('proposal')
    if (outcome.kind !== 'proposal') return
    expect(outcome.proposal.type).toBe('reframe')
    const after = dayMovements(catalogue, outcome.proposal.candidatePlan)
    expect(after.filter((movement) => !withinBudget(movement, SLOW_BUDGET)).length).toBeLessThan(
      before.filter((movement) => !withinBudget(movement, SLOW_BUDGET)).length,
    )
    // Stops are re-chosen in place, never dropped.
    expect(outcome.proposal.planDiff.removed).toEqual([])
  })
})
