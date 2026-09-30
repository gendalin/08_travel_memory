/**
 * Atomic commit (product_spec §7, §7.6, §9.1).
 *
 * State and Plan commit together or not at all. A committed transaction
 * produces exactly one Receipt. Nothing else in the domain may advance a
 * version number.
 *
 * Pure: takes the world, returns the next world. Persistence is the caller's
 * job, and is what makes atomicity real at the storage layer.
 */

import { isPlanDiffEmpty } from '../plan/diff.ts'
import type { Plan } from '../plan/types.ts'
import { isStateDiffEmpty } from '../state/diff.ts'
import type { TripState } from '../state/types.ts'
import type { Receipt } from '../receipts/types.ts'
import type { ID } from '../trip/types.ts'
import { transition } from './lifecycle.ts'
import type { Proposal } from './types.ts'

export interface CommitInput {
  proposal: Proposal
  currentState: TripState
  currentPlan: Plan
  receiptId: ID
  /** Short user-facing summary of what changed. */
  summary: string
  /** Catalogue version the choice was made from, when the trip has a snapshot. */
  catalogueVersion?: number
  timestamp: string
}

export interface CommitResult {
  proposal: Proposal
  state: TripState
  plan: Plan
  receipt: Receipt
}

export class CommitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommitError'
  }
}

/**
 * Versions advance only for the side that actually changed. A Replace bumps the
 * Plan version and leaves the State version alone, so a Receipt's
 * `resultingStateVersion` stays meaningful as a pointer to the State the trip
 * was planned against.
 */
export function commitProposal(input: CommitInput): CommitResult {
  const { proposal, currentState, currentPlan } = input

  if (proposal.status !== 'pending') {
    throw new CommitError(`Only a pending proposal can be committed (was "${proposal.status}")`)
  }

  const stateChanged = !isStateDiffEmpty(proposal.stateDiff)
  const planChanged = !isPlanDiffEmpty(proposal.planDiff)

  if (!stateChanged && !planChanged) {
    throw new CommitError('Refusing to commit a proposal with an empty diff')
  }

  const state: TripState = stateChanged
    ? { ...proposal.candidateState, version: currentState.version + 1 }
    : currentState

  const plan: Plan = planChanged
    ? { ...proposal.candidatePlan, version: currentPlan.version + 1 }
    : currentPlan

  const receipt: Receipt = {
    id: input.receiptId,
    tripId: proposal.tripId,
    proposalId: proposal.id,
    type: proposal.type,
    initiator: proposal.initiator,
    trigger: proposal.trigger,
    summary: input.summary,
    stateDiff: proposal.stateDiff,
    planDiff: proposal.planDiff,
    rationale: proposal.rationale,
    impact: proposal.impact,
    resultingStateVersion: state.version,
    resultingPlanVersion: plan.version,
    ...(input.catalogueVersion !== undefined
      ? { catalogueVersion: input.catalogueVersion }
      : {}),
    timestamp: input.timestamp,
  }

  return {
    proposal: transition(proposal, 'committed'),
    state,
    plan,
    receipt,
  }
}
