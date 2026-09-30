/**
 * Confirm / Keep current (product_spec §7.7, §9; Gate 3 step 8).
 *
 * Confirm goes through the Gate 2 domain commit — versions, atomicity and the
 * one-Receipt-per-transaction rule all live there, not here.
 *
 * Keep current rejects the proposal. No Receipt: only committed proposals
 * create Receipts.
 */

import { commitProposal } from '../../domain/proposals/commit.ts'
import { transition } from '../../domain/proposals/lifecycle.ts'
import type { Proposal } from '../../domain/proposals/types.ts'
import type { Plan } from '../../domain/plan/types.ts'
import type { TripState } from '../../domain/state/types.ts'
import type { Receipt } from '../../domain/receipts/types.ts'
import type { Repositories } from '../../services/persistence/types.ts'
import type { PlaceCatalogue } from '../../services/places/types.ts'

/**
 * One sentence describing what was committed, for the Receipt.
 *
 * Built from the diffs rather than from the change type, so it stays true for
 * a transaction that touches both State and Plan.
 */
function summarise(proposal: Proposal, catalogue: PlaceCatalogue): string {
  const name = (placeId: string) => catalogue.get(placeId)?.name ?? placeId
  const { planDiff, stateDiff } = proposal

  const planParts: string[] = []

  const swapped = planDiff.modified.filter((change) => change.fields.includes('placeId'))
  for (const change of swapped) {
    planParts.push(
      `${name(change.before.placeId)} to ${name(change.after.placeId)} on Day ${change.after.dayIndex + 1}`,
    )
  }

  const moved = planDiff.modified.filter(
    (change) => !change.fields.includes('placeId') && change.fields.length > 0,
  )
  if (moved.length > 0) {
    const days = [...new Set(moved.map((change) => change.after.dayIndex + 1))].sort()
    planParts.push(
      `retimed ${moved.length} stop${moved.length === 1 ? '' : 's'} on Day ${days.join(', ')}`,
    )
  }

  if (planDiff.removed.length > 0) {
    planParts.push(
      planDiff.removed.length === 1
        ? `removed ${name(planDiff.removed[0].placeId)}`
        : `removed ${planDiff.removed.length} stops`,
    )
  }

  if (planDiff.added.length > 0) {
    planParts.push(
      planDiff.added.length === 1
        ? `added ${name(planDiff.added[0].placeId)}`
        : `added ${planDiff.added.length} stops`,
    )
  }

  // Sentences lose their full stop so they read as clauses of the summary.
  const clause = (text: string) => text.replace(/[.!?]+\s*$/, '').trim()

  const stateParts: string[] = []
  for (const added of stateDiff.considering.added) stateParts.push(clause(added.text))
  for (const added of stateDiff.intent.added) stateParts.push(clause(added.text))
  for (const change of stateDiff.priorities.modified) {
    stateParts.push(`${change.after.name} now ${change.after.weight}`)
  }
  const stateEdits =
    stateDiff.intent.modified.length +
    stateDiff.considering.modified.length +
    stateDiff.intent.removed.length +
    stateDiff.considering.removed.length
  if (stateEdits > 0) {
    stateParts.push(`${stateEdits} trip-state edit${stateEdits === 1 ? '' : 's'}`)
  }

  const summary = [...stateParts, ...planParts].join(' · ')
  if (summary === '') return 'Updated the plan'
  return summary.charAt(0).toUpperCase() + summary.slice(1)
}

export async function confirmProposal(input: {
  proposal: Proposal
  state: TripState
  plan: Plan
  catalogue: PlaceCatalogue
  repositories: Repositories
  receiptId: string
  /**
   * Catalogue version the choice was made from, when the trip has a snapshot.
   *
   * Recorded on the Receipt so "why this place and not another" survives the set of
   * places growing (B4).
   */
  catalogueVersion?: number
  timestamp: string
}): Promise<{ state: TripState; plan: Plan; receipt: Receipt; proposal: Proposal }> {
  const result = commitProposal({
    proposal: input.proposal,
    currentState: input.state,
    currentPlan: input.plan,
    receiptId: input.receiptId,
    summary: summarise(input.proposal, input.catalogue),
    ...(input.catalogueVersion !== undefined
      ? { catalogueVersion: input.catalogueVersion }
      : {}),
    timestamp: input.timestamp,
  })

  await input.repositories.unitOfWork.commitTransaction({
    tripId: input.proposal.tripId,
    state: result.state,
    plan: result.plan,
    proposal: result.proposal,
    receipt: result.receipt,
  })

  return result
}

/** "Keep current" — the plan is untouched and no Receipt is written. */
export async function rejectProposal(input: {
  proposal: Proposal
  repositories: Repositories
}): Promise<Proposal> {
  const rejected = transition(input.proposal, 'rejected')
  await input.repositories.proposals.save(rejected)
  return rejected
}

/** A new change request supersedes the pending proposal (§7.7). */
export async function supersedePendingProposal(input: {
  proposal: Proposal
  repositories: Repositories
}): Promise<Proposal> {
  const superseded = transition(input.proposal, 'superseded')
  await input.repositories.proposals.save(superseded)
  return superseded
}

/** A direct State edit invalidates the pending proposal (§7.7). */
export async function invalidatePendingProposal(input: {
  proposal: Proposal
  repositories: Repositories
}): Promise<Proposal> {
  const invalidated = transition(input.proposal, 'invalidated')
  await input.repositories.proposals.save(invalidated)
  return invalidated
}
