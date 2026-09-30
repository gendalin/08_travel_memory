/** Atomic State / Plan commit and Receipts (product_spec §7.6, §9). */

import { describe, expect, it } from 'vitest'

import { diffPlans } from '../../src/domain/plan/diff.ts'
import { diffStates } from '../../src/domain/state/diff.ts'
import { computeExpectedImpact } from '../../src/domain/proposals/impact.ts'
import { CommitError, commitProposal } from '../../src/domain/proposals/commit.ts'
import type { Proposal } from '../../src/domain/proposals/types.ts'
import { createRepositories, createStore } from '../../src/services/persistence/inMemory.ts'
import { basePlan, day, emptyState, item, plan, state } from './fixtures.ts'

const AT = '2026-09-21T10:00:00.000Z'

/**
 * Builds a proposal whose planDiff and impact are always derived from the
 * candidate plan, so a test cannot accidentally assert against a stale impact.
 */
function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  const before = basePlan()
  const after =
    overrides.candidatePlan ??
    plan([day(0, [item({ id: 'a', placeId: 'place_d' }), ...before.days[0].items.slice(1)])])
  const planDiff = overrides.planDiff ?? diffPlans(before, after)

  return {
    id: 'prop_1',
    tripId: 'trip_1',
    status: 'pending',
    type: 'replace',
    initiator: 'user',
    trigger: 'The ramen place is closed today.',
    candidateState: emptyState(),
    stateDiff: diffStates(emptyState(), emptyState()),
    rationale: 'Swapped for a nearby alternative in the same slot.',
    createdAt: AT,
    ...overrides,
    // Derived last so it always matches the candidate plan actually being committed.
    candidatePlan: after,
    planDiff,
    impact: overrides.impact ?? computeExpectedImpact(before, after, planDiff),
  }
}

function commit(proposal = makeProposal()) {
  return commitProposal({
    proposal,
    currentState: emptyState(1),
    currentPlan: basePlan(),
    receiptId: 'rcpt_1',
    summary: 'Changed one place',
    timestamp: AT,
  })
}

describe('commitProposal', () => {
  it('bumps only the plan version for a plan-only change', () => {
    const result = commit()
    expect(result.plan.version).toBe(2)
    expect(result.state.version).toBe(1)
  })

  it('bumps both versions for a Reframe', () => {
    const nextState = state({ version: 1, intent: [{ id: 'i1', text: 'Slow-paced' }] })
    const proposal = makeProposal({
      type: 'reframe',
      candidateState: nextState,
      stateDiff: diffStates(emptyState(1), nextState),
    })
    const result = commit(proposal)
    expect(result.state.version).toBe(2)
    expect(result.plan.version).toBe(2)
  })

  it('commits State alone when the plan diff is empty', () => {
    const nextState = state({ version: 1, intent: [{ id: 'i1', text: 'Slow-paced' }] })
    const proposal = makeProposal({
      type: 'reframe',
      candidateState: nextState,
      candidatePlan: basePlan(),
      stateDiff: diffStates(emptyState(1), nextState),
      planDiff: diffPlans(basePlan(), basePlan()),
    })
    const result = commit(proposal)
    expect(result.state.version).toBe(2)
    expect(result.plan.version).toBe(1)
  })

  it('produces exactly one receipt per transaction, not one per POI', () => {
    const after = plan([
      day(0, [
        item({ id: 'a', placeId: 'place_d', startTime: '09:00', endTime: '10:00' }),
        item({ id: 'b', placeId: 'place_a', startTime: '12:00', endTime: '13:00' }),
        item({ id: 'c', placeId: 'place_b', startTime: '15:00', endTime: '16:00' }),
      ]),
    ])
    const result = commit(makeProposal({ type: 'reorganize', candidatePlan: after }))

    expect(result.receipt.impact.itemsAffected).toBe(3)
    expect(result.receipt.id).toBe('rcpt_1')
  })

  it('records the resulting versions on the receipt', () => {
    const result = commit()
    expect(result.receipt.resultingPlanVersion).toBe(result.plan.version)
    expect(result.receipt.resultingStateVersion).toBe(result.state.version)
  })

  it('carries trigger, initiator and rationale onto the receipt', () => {
    const result = commit()
    expect(result.receipt.trigger).toBe('The ramen place is closed today.')
    expect(result.receipt.initiator).toBe('user')
    expect(result.receipt.rationale).toContain('same slot')
  })

  it('marks the proposal committed', () => {
    expect(commit().proposal.status).toBe('committed')
  })

  it('refuses to commit anything but a pending proposal', () => {
    for (const status of ['generating', 'committed', 'rejected', 'superseded', 'invalidated'] as const) {
      expect(() => commit(makeProposal({ status }))).toThrow(CommitError)
    }
  })

  it('refuses to commit an empty diff', () => {
    const proposal = makeProposal({
      candidatePlan: basePlan(),
      planDiff: diffPlans(basePlan(), basePlan()),
    })
    expect(() => commit(proposal)).toThrow(CommitError)
  })
})

describe('atomic persistence', () => {
  it('persists state, plan, proposal and receipt together', async () => {
    const repos = createRepositories()
    const result = commit()

    await repos.unitOfWork.commitTransaction({
      tripId: 'trip_1',
      state: result.state,
      plan: result.plan,
      proposal: result.proposal,
      receipt: result.receipt,
    })

    expect((await repos.states.getCurrent('trip_1'))?.version).toBe(1)
    expect((await repos.plans.getCurrent('trip_1'))?.version).toBe(2)
    expect((await repos.proposals.get('prop_1'))?.status).toBe('committed')
    expect(await repos.receipts.listByTrip('trip_1')).toHaveLength(1)
  })

  it('writes nothing at all when the transaction fails partway', async () => {
    const store = createStore()
    const repos = createRepositories(store, { failCommitAt: 'receipt' })
    const result = commit()

    await expect(
      repos.unitOfWork.commitTransaction({
        tripId: 'trip_1',
        state: result.state,
        plan: result.plan,
        proposal: result.proposal,
        receipt: result.receipt,
      }),
    ).rejects.toThrow('injected failure: receipt')

    // The whole point of atomicity: no half-applied trip.
    expect(store.states.size).toBe(0)
    expect(store.plans.size).toBe(0)
    expect(store.proposals.size).toBe(0)
    expect(store.receipts).toHaveLength(0)
  })

  it('leaves no plan behind when the state write fails', async () => {
    const store = createStore()
    const repos = createRepositories(store, { failCommitAt: 'state' })
    const result = commit()

    await expect(
      repos.unitOfWork.commitTransaction({
        tripId: 'trip_1',
        state: result.state,
        plan: result.plan,
        proposal: result.proposal,
        receipt: result.receipt,
      }),
    ).rejects.toThrow()
    expect(store.plans.size).toBe(0)
  })
})

describe('the catalogue version a decision was made from (B4)', () => {
  /**
   * Without it, "why this place and not another" stops being answerable the moment the
   * set of places grows: a Replace chosen from forty options reads afterwards as
   * though it had been chosen from sixty.
   */
  it('records the version on the Receipt', () => {
    const result = commitProposal({
      proposal: makeProposal(),
      currentState: emptyState(1),
      currentPlan: basePlan(),
      receiptId: 'rcpt_1',
      summary: 'Changed one place',
      catalogueVersion: 2,
      timestamp: AT,
    })
    expect(result.receipt.catalogueVersion).toBe(2)
  })

  it('leaves it absent for a trip planned against a pre-loaded catalogue', () => {
    expect(commit().receipt.catalogueVersion).toBeUndefined()
  })
})
