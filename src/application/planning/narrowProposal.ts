/**
 * A proposal with some of its changes declined (product_spec §7.6).
 *
 * The traveller can accept a multi-stop proposal change by change. Declining one
 * keeps the original stop in that slot; the rest still apply. Required changes — the
 * request itself — always apply.
 *
 * The narrowed plan is built from the COMMITTED plan plus the accepted changes, then
 * goes back through `buildProposal`, so it is validated, diffed and classified like
 * any other candidate. Accepting part of a proposal can never commit a plan the
 * validator has not seen.
 */

import { toMinutes, type Plan, type PlanItem } from '../../domain/plan/types.ts'
import type { ChangeUnit, Proposal } from '../../domain/proposals/types.ts'
import type { TripState } from '../../domain/state/types.ts'
import type { TripFrame } from '../../domain/trip/types.ts'
import type { PlaceCatalogue } from '../../services/places/types.ts'
import { buildProposal, type BuildProposalOutcome } from './buildProposal.ts'

/** The committed plan with these changes applied, and only these. */
export function applyUnits(plan: Plan, units: readonly ChangeUnit[]): Plan {
  const removed = new Set(units.flatMap((unit) => unit.removeItemIds))
  const put = new Map<string, PlanItem>(units.flatMap((unit) => unit.putItems.map((item) => [item.id, item])))

  return {
    ...plan,
    days: plan.days.map((day) => {
      const kept = day.items
        .filter((item) => !removed.has(item.id))
        // An item moved to another day leaves this one.
        .filter((item) => !put.has(item.id) || put.get(item.id)!.dayIndex === day.dayIndex)
        .map((item) => put.get(item.id) ?? item)
      const arriving = [...put.values()].filter(
        (item) => item.dayIndex === day.dayIndex && !kept.some((existing) => existing.id === item.id),
      )
      return {
        ...day,
        items: [...kept, ...arriving].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime)),
      }
    }),
  }
}

export function narrowProposal(input: {
  proposal: Proposal
  declinedUnitIds: readonly string[]
  currentState: TripState
  currentPlan: Plan
  frame: TripFrame
  catalogue: PlaceCatalogue
  now: Date
}): BuildProposalOutcome {
  const declined = new Set(input.declinedUnitIds)
  const accepted = (input.proposal.units ?? []).filter((unit) => unit.required || !declined.has(unit.id))

  const built = buildProposal({
    tripId: input.proposal.tripId,
    frame: input.frame,
    catalogue: input.catalogue,
    now: input.now,
    proposalId: input.proposal.id,
    createdAt: input.proposal.createdAt,
    initiator: input.proposal.initiator,
    trigger: input.proposal.trigger,
    rationale: input.proposal.rationale,
    currentState: input.currentState,
    currentPlan: input.currentPlan,
    candidateState: input.proposal.candidateState,
    candidatePlan: applyUnits(input.currentPlan, accepted),
  })

  return built.kind === 'proposal' ? { kind: 'proposal', proposal: { ...built.proposal, units: accepted } } : built
}
