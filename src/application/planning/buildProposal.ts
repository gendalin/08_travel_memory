/**
 * Candidate State / Plan -> validated, diffed, classified Proposal (§7).
 *
 * Every surface that can change a trip — chat, an Alternative pick, a direct
 * State edit — goes through this one function. That is what makes the change
 * model a property of the system rather than of each screen: none of them can
 * skip validation, and none of them can name their own change type.
 */

import { diffPlans } from '../../domain/plan/diff.ts'
import type { Plan } from '../../domain/plan/types.ts'
import { diffStates } from '../../domain/state/diff.ts'
import type { TripState } from '../../domain/state/types.ts'
import { classifyChange } from '../../domain/proposals/classify.ts'
import { computeExpectedImpact } from '../../domain/proposals/impact.ts'
import type { Initiator, Proposal } from '../../domain/proposals/types.ts'
import type { TripFrame } from '../../domain/trip/types.ts'
import { validatePlan } from '../../domain/validation/validate.ts'
import type { ValidationResult } from '../../domain/validation/types.ts'
import { toPlaceFacts, toValidationPlaces } from '../../services/places/catalogue.ts'
import type { PlaceCatalogue } from '../../services/places/types.ts'
import { budgetOf } from './tripContext.ts'

export type BuildProposalOutcome =
  | { kind: 'proposal'; proposal: Proposal }
  | { kind: 'conflict'; reason: string; validation: ValidationResult }

export function buildProposal(input: {
  tripId: string
  frame: TripFrame
  catalogue: PlaceCatalogue
  now: Date
  proposalId: string
  createdAt: string
  initiator: Initiator
  /** What prompted it, in the user's words where there are any. */
  trigger: string
  rationale: string
  currentState: TripState
  currentPlan: Plan
  candidateState: TripState
  candidatePlan: Plan
}): BuildProposalOutcome {
  const validation = validatePlan(input.candidatePlan, {
    frame: input.frame,
    state: input.candidateState,
    places: toValidationPlaces(input.catalogue),
    committedPlan: input.currentPlan,
    now: input.now,
  })

  // Never display an invalid itinerary as a proposal (§8).
  if (!validation.valid) {
    return {
      kind: 'conflict',
      reason: validation.errors[0]?.message ?? 'That change does not fit the rest of the trip.',
      validation,
    }
  }

  const planDiff = diffPlans(input.currentPlan, input.candidatePlan)
  const stateDiff = diffStates(input.currentState, input.candidateState)

  return {
    kind: 'proposal',
    proposal: {
      id: input.proposalId,
      tripId: input.tripId,
      status: 'pending',
      type: classifyChange(stateDiff, planDiff),
      initiator: input.initiator,
      trigger: input.trigger,
      candidateState: input.candidateState,
      candidatePlan: input.candidatePlan,
      stateDiff,
      planDiff,
      impact: computeExpectedImpact(input.currentPlan, input.candidatePlan, planDiff, {
        places: toPlaceFacts(input.catalogue),
        budget: budgetOf(input.candidateState),
      }),
      rationale: input.rationale,
      createdAt: input.createdAt,
    },
  }
}
