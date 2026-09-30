/**
 * scenario_reframe_tired (§17.3, Gate 5 demo scenario 3).
 *
 * Scripted input from demo_scenario.json:
 *   "I feel tired. Fewer spots."
 *
 * "Fewer spots" is not a comment about one stop — it changes what the agent is
 * planning against. So the candidate carries a State change as well as a Plan
 * change, and the classifier returns Reframe because the State diff is not
 * empty. Reframe is all-or-nothing in MVP: State and Plan commit together.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { handleChatMessage, PACE_CONSIDERING_ID } from '../../src/application/handleChat/handleChat.ts'
import { routeMessage } from '../../src/application/handleChat/route.ts'
import { confirmProposal } from '../../src/application/commitProposal/commitProposalUseCase.ts'
import { createStubLlm } from '../../src/services/llm/stubLlm.ts'
import { createRepositories } from '../../src/services/persistence/inMemory.ts'
import { allItems } from '../../src/domain/plan/types.ts'
import { catalogue, createTokyoTrip, eventText, NOW, type TokyoTrip } from './tokyoTrip.ts'

const MESSAGE = eventText('evt_tired')

let trip: TokyoTrip

beforeEach(() => {
  trip = createTokyoTrip()
})

function propose(over: Partial<TokyoTrip> = {}) {
  const current = { ...trip, ...over }
  return handleChatMessage({
    message: MESSAGE,
    tripId: 'trip_1',
    frame: current.frame,
    state: current.state,
    plan: current.plan,
    catalogue,
    llm: createStubLlm(),
    now: NOW,
    proposalId: 'prop_tired',
    createdAt: NOW.toISOString(),
  })
}

describe('scenario_reframe_tired', () => {
  it('routes to a pace change, one stop below the busiest day', () => {
    expect(routeMessage({ message: MESSAGE, plan: trip.plan, catalogue })).toEqual({
      kind: 'fewer_stops',
      maxPerDay: 2,
    })
  })

  it('classifies as a Reframe', async () => {
    const outcome = await propose()
    expect(outcome.kind).toBe('proposal')
    if (outcome.kind !== 'proposal') return
    expect(outcome.proposal.type).toBe('reframe')
  })

  it('is a Reframe because State changed, not because the plan shrank', async () => {
    const outcome = await propose()
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')

    const added = outcome.proposal.stateDiff.considering.added
    expect(added).toHaveLength(1)
    expect(added[0].id).toBe(PACE_CONSIDERING_ID)
    expect(added[0].text).toContain('Fewer stops')
  })

  it('cuts every day to the new cap', async () => {
    const outcome = await propose()
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')

    for (const day of outcome.proposal.candidatePlan.days) {
      expect(day.items.length).toBeLessThanOrEqual(2)
    }
  })

  it('keeps every meal and drops a non-meal stop instead (2026-09-30)', async () => {
    const outcome = await propose()
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')

    expect(outcome.proposal.planDiff.removed.length).toBeGreaterThan(0)
    for (const removed of outcome.proposal.planDiff.removed) {
      expect(['lunch', 'dinner']).not.toContain(removed.role)
    }
  })

  it('offers each day’s cut as its own change, so it can mean today only', async () => {
    const outcome = await propose()
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')
    const units = outcome.proposal.units ?? []
    expect(units).toHaveLength(outcome.proposal.planDiff.removed.length)
    expect(units.every((unit) => !unit.required)).toBe(true)
  })

  it('reports the freed time as Expected Impact', async () => {
    const outcome = await propose()
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')

    expect(outcome.proposal.impact.poiCountDelta).toBeLessThan(0)
    expect(outcome.proposal.impact.itemsAffected).toBe(
      outcome.proposal.planDiff.removed.length,
    )
  })

  it('keeps a must-visit and drops the stop before it instead', async () => {
    const withMustVisit = createTokyoTrip(['We must visit Sensō-ji.'])
    const outcome = await propose(withMustVisit)
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')

    const kept = allItems(outcome.proposal.candidatePlan).map((item) => item.placeId)
    const mustVisit = withMustVisit.state.considering[0].tag
    expect(mustVisit?.kind).toBe('must_visit')
    if (mustVisit?.kind === 'must_visit') expect(kept).toContain(mustVisit.placeId)
  })

  it('commits State and Plan together, with one Receipt', async () => {
    const outcome = await propose()
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')

    const repositories = createRepositories()
    const result = await confirmProposal({
      proposal: outcome.proposal,
      state: trip.state,
      plan: trip.plan,
      catalogue,
      repositories,
      receiptId: 'rcpt_1',
      timestamp: NOW.toISOString(),
    })

    expect(result.state.version).toBe(trip.state.version + 1)
    expect(result.plan.version).toBe(trip.plan.version + 1)
    expect(result.receipt.type).toBe('reframe')
    expect(await repositories.receipts.listByTrip('trip_1')).toHaveLength(1)
  })

  it('answers rather than cutting meals when the user asks a second time', async () => {
    const first = await propose()
    if (first.kind !== 'proposal') throw new Error('expected a proposal')

    const repositories = createRepositories()
    const committed = await confirmProposal({
      proposal: first.proposal,
      state: trip.state,
      plan: trip.plan,
      catalogue,
      repositories,
      receiptId: 'rcpt_1',
      timestamp: NOW.toISOString(),
    })

    const again = await propose({ state: committed.state, plan: committed.plan })
    // The fixture day is three stops — main, lunch, dinner — so after one cut only
    // the meals are left, and they stay.
    expect(again.kind).toBe('answer')
    for (const day of committed.plan.days) {
      expect(day.items.every((item) => item.role === 'lunch' || item.role === 'dinner')).toBe(true)
    }
  })

  it('answers rather than re-proposing when nothing more can be cut', async () => {
    // Same pace already in State, and a plan the transform cannot thin further.
    const stuck = {
      ...trip.state,
      considering: [
        ...trip.state.considering,
        { id: PACE_CONSIDERING_ID, text: 'Fewer stops each day — at most 2.' },
      ],
    }

    const outcome = await propose({ state: stuck })
    expect(outcome.kind).toBe('answer')
  })
})
