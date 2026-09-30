/** Proposal lifecycle (product_spec §7.7). */

import { describe, expect, it } from 'vitest'

import { diffPlans } from '../../src/domain/plan/diff.ts'
import { diffStates } from '../../src/domain/state/diff.ts'
import { computeExpectedImpact } from '../../src/domain/proposals/impact.ts'
import {
  ProposalTransitionError,
  canTransition,
  findPending,
  invalidateOnLockedConflict,
  invalidateOnStateEdit,
  isOpen,
  isTerminal,
  supersedePending,
  transition,
} from '../../src/domain/proposals/lifecycle.ts'
import type { Proposal, ProposalStatus } from '../../src/domain/proposals/types.ts'
import { basePlan, day, emptyState, item, plan } from './fixtures.ts'

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  const before = basePlan()
  const after = plan([day(0, [item({ id: 'a', placeId: 'place_d' }), ...before.days[0].items.slice(1)])])
  const planDiff = diffPlans(before, after)
  const stateDiff = diffStates(emptyState(), emptyState())

  return {
    id: 'prop_1',
    tripId: 'trip_1',
    status: 'pending',
    type: 'replace',
    initiator: 'user',
    trigger: 'The ramen place is closed today.',
    candidateState: emptyState(),
    candidatePlan: after,
    stateDiff,
    planDiff,
    impact: computeExpectedImpact(before, after, planDiff),
    rationale: 'Swapped for a nearby alternative in the same slot.',
    createdAt: '2026-09-21T10:00:00.000Z',
    ...overrides,
  }
}

describe('transitions', () => {
  it('allows the documented paths', () => {
    expect(canTransition('generating', 'pending')).toBe(true)
    expect(canTransition('generating', 'failed')).toBe(true)
    expect(canTransition('pending', 'committed')).toBe(true)
    expect(canTransition('pending', 'rejected')).toBe(true)
    expect(canTransition('pending', 'superseded')).toBe(true)
    expect(canTransition('pending', 'invalidated')).toBe(true)
  })

  it('rejects skipping generating -> committed', () => {
    expect(canTransition('generating', 'committed')).toBe(false)
    expect(() => transition(proposal({ status: 'generating' }), 'committed')).toThrow(
      ProposalTransitionError,
    )
  })

  it('treats every end state as terminal', () => {
    const terminal: ProposalStatus[] = ['committed', 'rejected', 'superseded', 'invalidated', 'failed']
    for (const status of terminal) {
      expect(isTerminal(status)).toBe(true)
      expect(() => transition(proposal({ status }), 'pending')).toThrow(ProposalTransitionError)
    }
  })

  it('cannot revive a committed proposal', () => {
    expect(() => transition(proposal({ status: 'committed' }), 'rejected')).toThrow()
  })

  it('isOpen covers generating and pending only', () => {
    expect(isOpen(proposal({ status: 'generating' }))).toBe(true)
    expect(isOpen(proposal({ status: 'pending' }))).toBe(true)
    expect(isOpen(proposal({ status: 'rejected' }))).toBe(false)
  })
})

describe('one pending proposal per trip', () => {
  it('supersedes the existing pending proposal when a new request arrives', () => {
    const existing = [proposal({ id: 'prop_1', status: 'pending' })]
    const after = supersedePending(existing, 'trip_1')
    expect(after[0].status).toBe('superseded')
    expect(findPending(after, 'trip_1')).toBeUndefined()
  })

  it('leaves other trips alone', () => {
    const existing = [proposal({ id: 'prop_1', tripId: 'trip_2', status: 'pending' })]
    expect(supersedePending(existing, 'trip_1')[0].status).toBe('pending')
  })

  it('never leaves two pending proposals for one trip', () => {
    let proposals = [proposal({ id: 'prop_1', status: 'pending' })]
    proposals = [...supersedePending(proposals, 'trip_1'), proposal({ id: 'prop_2', status: 'pending' })]
    expect(proposals.filter((p) => p.tripId === 'trip_1' && p.status === 'pending')).toHaveLength(1)
  })
})

describe('invalidation', () => {
  it('a user State edit invalidates a pending proposal', () => {
    const after = invalidateOnStateEdit([proposal({ status: 'pending' })], 'trip_1')
    expect(after[0].status).toBe('invalidated')
  })

  it('a State edit does not disturb an already-committed proposal', () => {
    const after = invalidateOnStateEdit([proposal({ status: 'committed' })], 'trip_1')
    expect(after[0].status).toBe('committed')
  })

  it('a locked-item conflict invalidates the proposal', () => {
    expect(invalidateOnLockedConflict(proposal({ status: 'pending' })).status).toBe('invalidated')
  })
})
