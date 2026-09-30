/**
 * scenario_state_edit (§17.3, Gate 5 demo scenario 4).
 *
 * A direct State edit is a Reframe by definition (§7.1), and it must not
 * mutate the Plan on the spot (§7.6). Two branches matter:
 *
 *   - the edit changes the itinerary -> proposal, then an atomic commit
 *   - the edit leaves the itinerary alone -> State may commit immediately,
 *     still writing exactly one Receipt
 */

import { beforeEach, describe, expect, it } from 'vitest'

import {
  proposeStateEdit,
  toStateDraft,
} from '../../src/application/editState/proposeStateEdit.ts'
import { confirmProposal } from '../../src/application/commitProposal/commitProposalUseCase.ts'
import { createRepositories } from '../../src/services/persistence/inMemory.ts'
import { allItems } from '../../src/domain/plan/types.ts'
import {
  catalogue,
  createTokyoTrip,
  mustVisitSentence,
  NOW,
  placeNotInPlan,
  type TokyoTrip,
} from './tokyoTrip.ts'

let trip: TokyoTrip
/** A place the first plan did not already schedule, so adding it is a change. */
let unplanned: ReturnType<typeof placeNotInPlan>

beforeEach(() => {
  trip = createTokyoTrip()
  unplanned = placeNotInPlan(trip.plan)
})

function edit(mutate: (draft: ReturnType<typeof toStateDraft>) => void) {
  const draft = toStateDraft(trip.state)
  mutate(draft)
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

describe('scenario_state_edit', () => {
  it('reports no change when nothing was edited', () => {
    expect(edit(() => {}).kind).toBe('unchanged')
  })

  it('classifies an edited Intent line as a Reframe', () => {
    const outcome = edit((draft) => {
      draft.intent[0].text = 'Slow-paced, and mostly on foot'
    })

    expect(outcome.kind).toBe('commit_now')
    if (outcome.kind !== 'commit_now') return
    expect(outcome.proposal.type).toBe('reframe')
  })

  it('commits a plan-neutral edit immediately, with one Receipt (§7.6)', async () => {
    const outcome = edit((draft) => {
      draft.priorities[0].weight = 'high'
    })
    if (outcome.kind !== 'commit_now') throw new Error('expected an immediate commit')

    expect(outcome.proposal.planDiff.added).toEqual([])
    expect(outcome.proposal.planDiff.removed).toEqual([])
    expect(outcome.proposal.planDiff.modified).toEqual([])

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
    // The itinerary did not change, so its version must not move.
    expect(result.plan.version).toBe(trip.plan.version)
    expect(await repositories.receipts.listByTrip('trip_1')).toHaveLength(1)
  })

  it('previews a proposal when the edit changes the itinerary', () => {
    const outcome = edit((draft) => {
      draft.considering.push({ id: 'cons_new', text: mustVisitSentence(unplanned) })
    })

    expect(outcome.kind).toBe('proposal')
    if (outcome.kind !== 'proposal') return
    // A State edit, so a Reframe however small the plan change (§7.1, 2026-09-30).
    expect(outcome.proposal.type).toBe('reframe')
    expect(outcome.proposal.planDiff.added).toHaveLength(1)
  })

  it('puts the named place into the plan and nowhere else', () => {
    const outcome = edit((draft) => {
      draft.considering.push({ id: 'cons_new', text: mustVisitSentence(unplanned) })
    })
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')

    const added = outcome.proposal.planDiff.added[0]
    expect(added.placeId).toBe(unplanned.placeId)
    expect(outcome.proposal.planDiff.removed).toEqual([])
    expect(outcome.proposal.planDiff.modified).toEqual([])
  })

  it('leaves the committed Plan untouched until the proposal is confirmed', () => {
    const before = JSON.stringify(trip.plan)
    edit((draft) => {
      draft.considering.push({ id: 'cons_new', text: mustVisitSentence(unplanned) })
    })
    expect(JSON.stringify(trip.plan)).toBe(before)
  })

  it('commits State and Plan together', async () => {
    const outcome = edit((draft) => {
      draft.considering.push({ id: 'cons_new', text: mustVisitSentence(unplanned) })
    })
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
    expect(allItems(result.plan).map((item) => item.placeId)).toContain(
      outcome.proposal.planDiff.added[0].placeId,
    )
    expect(await repositories.receipts.listByTrip('trip_1')).toHaveLength(1)
  })

  it('pulls a day forward when the user adds a hard finish time', () => {
    const outcome = edit((draft) => {
      draft.considering.push({ id: 'cons_new', text: 'Day 2 needs to be done by 15:00.' })
    })
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')

    const dayTwo = allItems(outcome.proposal.candidatePlan).filter((item) => item.dayIndex === 1)
    for (const item of dayTwo) expect(item.endTime <= '15:00').toBe(true)
  })

  it('drops a removed Intent line without touching the itinerary', () => {
    const outcome = edit((draft) => {
      draft.intent.splice(0, 1)
    })

    expect(outcome.kind).toBe('commit_now')
    if (outcome.kind !== 'commit_now') return
    expect(outcome.proposal.stateDiff.intent.removed).toHaveLength(1)
  })
})
