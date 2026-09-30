/**
 * Proposal lifecycle (product_spec §7.7).
 *
 *   generating -> pending -> committed
 *   pending    -> rejected | superseded | invalidated
 *   generating -> failed
 *
 * Rules enforced here:
 *   - at most one pending proposal per trip
 *   - a new change request supersedes a pending proposal
 *   - a user State edit invalidates a pending proposal
 *   - a locked-item conflict invalidates a proposal
 *   - only committed proposals create Receipts
 */

import type { Proposal, ProposalStatus } from './types.ts'

const ALLOWED_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  generating: ['pending', 'failed'],
  pending: ['committed', 'rejected', 'superseded', 'invalidated'],
  committed: [],
  rejected: [],
  superseded: [],
  invalidated: [],
  failed: [],
}

export function canTransition(from: ProposalStatus, to: ProposalStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

export class ProposalTransitionError extends Error {
  constructor(from: ProposalStatus, to: ProposalStatus) {
    super(`Illegal proposal transition: ${from} -> ${to}`)
    this.name = 'ProposalTransitionError'
  }
}

export function transition(proposal: Proposal, to: ProposalStatus): Proposal {
  if (!canTransition(proposal.status, to)) {
    throw new ProposalTransitionError(proposal.status, to)
  }
  return { ...proposal, status: to }
}

export function isTerminal(status: ProposalStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0
}

/** A proposal awaiting the user's decision. */
export function isOpen(proposal: Proposal): boolean {
  return proposal.status === 'generating' || proposal.status === 'pending'
}

export function findPending(proposals: Proposal[], tripId: string): Proposal | undefined {
  return proposals.find(
    (proposal) => proposal.tripId === tripId && proposal.status === 'pending',
  )
}

/**
 * Enforces "at most one pending proposal per trip" at the point a new one is
 * opened. The existing pending proposal is superseded, not silently dropped.
 */
export function supersedePending(proposals: Proposal[], tripId: string): Proposal[] {
  return proposals.map((proposal) =>
    proposal.tripId === tripId && proposal.status === 'pending'
      ? { ...proposal, status: 'superseded' as const }
      : proposal,
  )
}

/** A direct user State edit invalidates any pending proposal (§7.7). */
export function invalidateOnStateEdit(proposals: Proposal[], tripId: string): Proposal[] {
  return proposals.map((proposal) =>
    proposal.tripId === tripId && proposal.status === 'pending'
      ? { ...proposal, status: 'invalidated' as const }
      : proposal,
  )
}

/** A locked-item conflict invalidates the proposal (§7.7). */
export function invalidateOnLockedConflict(proposal: Proposal): Proposal {
  return transition(proposal, 'invalidated')
}
