/**
 * H1-H5 — Human–Agent Collaboration (eval spec §9-§13).
 *
 * Every scenario runs through the product's own use cases: handleChatMessage /
 * proposeStateEdit → confirmProposal / rejectProposal against in-memory
 * repositories. Nothing here re-implements classification or commit.
 */

import { handleChatMessage } from '../../src/application/handleChat/handleChat.ts'
import { confirmProposal, rejectProposal } from '../../src/application/commitProposal/commitProposalUseCase.ts'
import { proposeStateEdit, toStateDraft } from '../../src/application/editState/proposeStateEdit.ts'
import { tagConsidering } from '../../src/application/decompose/tagConsidering.ts'
import { generateFirstPlan } from '../../src/application/generatePlan/generatePlan.ts'
import { confirmReview, defaultPriorities, toFrame } from '../../src/application/createTrip/createTrip.ts'
import { isStateDiffEmpty } from '../../src/domain/state/diff.ts'
import { allItems, type Plan } from '../../src/domain/plan/types.ts'
import { validatePlan } from '../../src/domain/validation/validate.ts'
import { isOutdoor } from '../../src/domain/places/outdoor.ts'
import { createPlaceCatalogue, toValidationPlaces } from '../../src/services/places/catalogue.ts'
import { createStubLlm } from '../../src/services/llm/stubLlm.ts'
import { createRepositories, createStore } from '../../src/services/persistence/inMemory.ts'
import type { Proposal } from '../../src/domain/proposals/types.ts'
import type { PlaceCatalogue } from '../../src/services/places/types.ts'
import { catalogue as bundledCatalogue, createTokyoTrip, eventText, places, scenario, pacePattern, SETUP } from '../../tests/scenarios/tokyoTrip.ts'
import { check, scoreScenario } from '../judges/scenario_judge.ts'
import { buildTrip, NOW } from '../lib/fixture.ts'
import type { Check, ScenarioResult } from '../schemas/scenario_result.ts'

type Trip = ReturnType<typeof createTokyoTrip>

/** Confirm and reject a proposal on fresh repositories; report both halves. */
async function lifecycle(trip: Trip, proposal: Proposal, catalogue: PlaceCatalogue = bundledCatalogue) {
  const planBefore = JSON.stringify(trip.plan)
  const stateBefore = JSON.stringify(trip.state)

  const confirmRepos = createRepositories()
  const committed = await confirmProposal({
    proposal, state: trip.state, plan: trip.plan, catalogue, repositories: confirmRepos,
    receiptId: 'rcpt_eval', timestamp: NOW.toISOString(),
  })
  const receiptsAfterConfirm = await confirmRepos.receipts.listByTrip(proposal.tripId)

  const rejectRepos = createRepositories()
  const rejected = await rejectProposal({ proposal, repositories: rejectRepos })
  const receiptsAfterReject = await rejectRepos.receipts.listByTrip(proposal.tripId)

  // Atomicity: a failure part-way through the unit of work must leave nothing behind.
  const store = createStore()
  store.states.set(proposal.tripId, trip.state)
  store.plans.set(proposal.tripId, trip.plan)
  const failing = createRepositories(store, { failCommitAt: 'receipt' })
  let threw = false
  try {
    await confirmProposal({ proposal, state: trip.state, plan: trip.plan, catalogue, repositories: failing, receiptId: 'rcpt_fail', timestamp: NOW.toISOString() })
  } catch {
    threw = true
  }
  const atomic =
    threw &&
    store.states.get(proposal.tripId)?.version === trip.state.version &&
    store.plans.get(proposal.tripId)?.version === trip.plan.version &&
    store.receipts.length === 0

  return {
    committed,
    receiptsAfterConfirm: receiptsAfterConfirm.length,
    receiptType: receiptsAfterConfirm[0]?.type,
    receipt: receiptsAfterConfirm[0],
    rejectedStatus: rejected.status,
    receiptsAfterReject: receiptsAfterReject.length,
    activeUnchangedAfterReject: JSON.stringify(trip.plan) === planBefore && JSON.stringify(trip.state) === stateBefore,
    atomicOnFailure: atomic,
  }
}

function validity(trip: Trip, plan: Plan, catalogue: PlaceCatalogue = bundledCatalogue) {
  return validatePlan(plan, { frame: trip.frame, state: trip.state, places: toValidationPlaces(catalogue), now: NOW })
}

// ─────────────────────────────────────────────── H1 Replace

export async function runH1(): Promise<ScenarioResult> {
  const trip = createTokyoTrip()
  const event = scenario.events.find((entry) => entry.id === 'evt_closed_restaurant')!
  const ramen = allItems(trip.plan).find((item) => item.placeId === event.placeId)
    ?? allItems(trip.plan).find((item) => bundledCatalogue.get(item.placeId)?.category === 'ramen')
  if (!ramen) {
    return scoreScenario({ id: 'H1', title: 'Replace', smoke: true, checks: [], error: 'fixture plan holds no ramen stop' })
  }
  const message = event.text.replace(/\bday\s*\d+\b/i, `Day ${ramen.dayIndex + 1}`)
  const planBefore = JSON.stringify(trip.plan)

  const outcome = await handleChatMessage({
    message, tripId: 'trip_1', frame: trip.frame, state: trip.state, plan: trip.plan, catalogue: bundledCatalogue,
    llm: createStubLlm(), now: NOW, proposalId: 'prop_h1', createdAt: NOW.toISOString(), memorySnapshot: trip.trip.memorySnapshot,
  })
  const hallucinated = await handleChatMessage({
    message, tripId: 'trip_1', frame: trip.frame, state: trip.state, plan: trip.plan, catalogue: bundledCatalogue,
    llm: createStubLlm({ hallucinatePlaceId: 'ramen_that_does_not_exist' }), now: NOW, proposalId: 'prop_h1b', createdAt: NOW.toISOString(),
  })

  if (outcome.kind !== 'proposal') {
    return scoreScenario({
      id: 'H1', title: 'Replace', smoke: true,
      checks: [check('proposal', 'correctness', 'A proposal is produced', false, outcome, { onFail: { severity: 'P0', category: 'CLASSIFICATION_FAILURE' } })],
    })
  }
  const proposal = outcome.proposal
  const diff = proposal.planDiff
  const changed = diff.added.length + diff.removed.length + diff.modified.length
  const swap = diff.modified[0]
  const otherScheduleChanges = diff.modified.filter((entry) => entry.fields.some((field) => field === 'startTime' || field === 'dayIndex')).length
  const replacement = swap ? bundledCatalogue.get(swap.after.placeId) : undefined
  const life = await lifecycle(trip, proposal)
  const candidateValid = validity(trip, proposal.candidatePlan)

  const checks: Check[] = [
    check('classification', 'correctness', 'classification = Replace', proposal.type === 'replace', proposal.type, { onFail: { severity: 'P0', category: 'CLASSIFICATION_FAILURE' } }),
    check('state_diff_empty', 'correctness', 'stateDiff = empty', isStateDiffEmpty(proposal.stateDiff), proposal.stateDiff, { onFail: { severity: 'P0', category: 'CLASSIFICATION_FAILURE' } }),
    check('one_item', 'correctness', 'changedPlanItemCount = 1', changed === 1, { changed, fields: swap?.fields }, { onFail: { severity: 'P0', category: 'CLASSIFICATION_FAILURE' } }),
    check('receipt_confirm', 'correctness', 'receiptCountDelta = 1 after confirm; plan v+1, state unchanged',
      life.receiptsAfterConfirm === 1 && life.committed.plan.version === trip.plan.version + 1 && life.committed.state.version === trip.state.version,
      { receipts: life.receiptsAfterConfirm, planVersion: life.committed.plan.version, stateVersion: life.committed.state.version }, { onFail: { severity: 'P0', category: 'CONTROL_FAILURE' } }),
    check('receipt_reject', 'correctness', 'receiptCountDelta = 0 after reject', life.receiptsAfterReject === 0, life.receiptsAfterReject, { onFail: { severity: 'P0', category: 'CONTROL_FAILURE' } }),
    check('registry', 'correctness', 'Replacement exists in the Candidate Registry; a hallucinated id is refused',
      replacement !== undefined && hallucinated.kind === 'conflict', { replacement: replacement?.placeId, hallucinatedOutcome: hallucinated.kind }, { onFail: { severity: 'P0', category: 'FILTER_FAILURE' } }),
    check('replacement_fits', 'relevance', 'Replacement fits the slot (valid plan, meal-role category, open at the time)',
      candidateValid.valid && replacement !== undefined, { replacement: replacement ? `${replacement.name} [${replacement.category}]` : null, errors: candidateValid.errors }, { onFail: { severity: 'P1', category: 'RANKING_FAILURE' } }),
    check('replacement_same_kind', 'relevance', 'Replacement preserves the kind of meal asked about (ramen → ramen when one is open)',
      replacement?.category === 'ramen', replacement?.category, { weight: 'partial', onFail: { severity: 'P2', category: 'RANKING_FAILURE' } }),
    check('rationale', 'explainability', 'Proposal and Receipt carry a non-empty rationale',
      proposal.rationale.length > 0 && (life.receipt?.rationale.length ?? 0) > 0, proposal.rationale, { onFail: { severity: 'P1', category: 'EVIDENCE_FAILURE' } }),
    check('pending_no_mutation', 'control', 'Plan remains unchanged while pending', JSON.stringify(trip.plan) === planBefore, null, { onFail: { severity: 'P0', category: 'CONTROL_FAILURE' } }),
    check('atomic', 'control', 'A failed commit leaves State, Plan and Receipts untouched', life.atomicOnFailure, null, { onFail: { severity: 'P0', category: 'CONTROL_FAILURE' } }),
    check('no_other_changes', 'efficiency', 'otherScheduleChanges = 0 (identity swap only)', otherScheduleChanges === 0, { fields: swap?.fields }, { onFail: { severity: 'P1', category: 'CLASSIFICATION_FAILURE' } }),
    check('route_cost', 'efficiency', 'Replacement does not add a large detour (walkingDistanceDelta ≤ 5 km); stub picks the top-ranked candidate',
      proposal.impact.walkingDistanceDeltaM === null || proposal.impact.walkingDistanceDeltaM <= 5000,
      { walkingDistanceDeltaM: proposal.impact.walkingDistanceDeltaM, from: bundledCatalogue.get(ramen.placeId)?.neighborhood, to: replacement?.neighborhood,
        note: 'bundled fixture: every open alternative is ≥ 6 km away except p4 sushi (loses on cost); the delta is shown in Expected Impact' },
      { weight: 'partial', onFail: { severity: 'P2', category: 'ROUTE_FAILURE' } }),
    check('impact_scope', 'efficiency', 'Expected Impact itemsAffected = 1', proposal.impact.itemsAffected === 1, proposal.impact, { weight: 'partial', onFail: { severity: 'P2', category: 'EVIDENCE_FAILURE' } }),
  ]
  return scoreScenario({
    id: 'H1', title: 'Replace', smoke: true, checks,
    observations: { message, outgoing: bundledCatalogue.get(ramen.placeId)?.name, replacement: replacement?.name, impact: proposal.impact, rationale: proposal.rationale },
  })
}

// ─────────────────────────────────────────────── H2 Reorganize

/**
 * Two parts since 2026-09-30. (a) The spec sentence, "rain after 3pm on Day 3": the
 * fixture's Day 3 is all indoors after 15:00, so the right answer is no change. (b) A
 * variant bringing rain on while an outdoor stop is still running, which exercises
 * the re-planning path the spec is about.
 */
export async function runH2(): Promise<ScenarioResult> {
  const trip = createTokyoTrip()
  // The eval spec's own sentence, fixed here: the demo script's rain line may change.
  const message = "It's going to rain after 3pm on Day 3."
  const planBefore = JSON.stringify(trip.plan)
  const ask = (text: string, id: string) => handleChatMessage({
    message: text, tripId: 'trip_1', frame: trip.frame, state: trip.state, plan: trip.plan, catalogue: bundledCatalogue,
    llm: createStubLlm(), now: NOW, proposalId: id, createdAt: NOW.toISOString(), memorySnapshot: trip.trip.memorySnapshot,
  })
  const outdoor = (item: { placeId: string }) => isOutdoor(bundledCatalogue.get(item.placeId)!.category)

  const specOutcome = await ask(message, 'prop_h2')
  const day3OutdoorAfter = trip.plan.days[2].items.filter((item) => outdoor(item) && item.endTime > '15:00')
  const specCorrect = day3OutdoorAfter.length === 0
    ? specOutcome.kind === 'answer' && specOutcome.noChangeNeeded === true
    : specOutcome.kind === 'proposal'

  const target = allItems(trip.plan).find(outdoor)
  const hour = target ? Number(target.startTime.split(':')[0]) : 10
  const variantMessage = `It's going to rain after ${hour > 12 ? `${hour - 12}:30pm` : `${hour}:30am`} on Day ${(target?.dayIndex ?? 0) + 1}.`
  const outcome = await ask(variantMessage, 'prop_h2b')
  if (outcome.kind !== 'proposal') {
    return scoreScenario({ id: 'H2', title: 'Reorganize', smoke: false, checks: [
      check('spec_no_change', 'correctness', 'Spec sentence: no change when nothing is outdoors after the rain starts', specCorrect, specOutcome, { onFail: { severity: 'P1', category: 'CLASSIFICATION_FAILURE' } }),
      check('proposal', 'correctness', 'Variant: an outdoor stop in the rain produces a proposal', false, outcome, { onFail: { severity: 'P0', category: 'CLASSIFICATION_FAILURE' } }),
    ] })
  }
  const proposal = outcome.proposal
  const diff = proposal.planDiff
  const touched = [...diff.removed, ...diff.modified.map((entry) => entry.before)]
  const touchedDays = new Set(touched.map((item) => item.dayIndex).concat(diff.added.map((item) => item.dayIndex)))
  const impact = proposal.impact
  const computedItems = diff.added.length + diff.removed.length + diff.modified.length
  const life = await lifecycle(trip, proposal)
  const swappedIn = diff.modified.map((entry) => bundledCatalogue.get(entry.after.placeId)!)

  const checks: Check[] = [
    check('spec_no_change', 'correctness', 'Spec sentence (Day 3, after 3pm): no change when nothing is outdoors then; a proposal when something is',
      specCorrect, { outcome: specOutcome.kind, day3OutdoorAfter: day3OutdoorAfter.map((item) => item.placeId), text: specOutcome.kind === 'answer' ? specOutcome.text : undefined },
      { onFail: { severity: 'P1', category: 'CLASSIFICATION_FAILURE' } }),
    check('classification', 'correctness', 'Variant classified from the diff (Replace for one swap, Reorganize for more), never Reframe',
      proposal.type === (computedItems === 1 && diff.modified.length === 1 ? 'replace' : 'reorganize'), { type: proposal.type, computedItems }, { onFail: { severity: 'P0', category: 'CLASSIFICATION_FAILURE' } }),
    check('state_unchanged', 'correctness', 'State unchanged', isStateDiffEmpty(proposal.stateDiff), proposal.stateDiff, { onFail: { severity: 'P0', category: 'CLASSIFICATION_FAILURE' } }),
    check('receipt', 'correctness', 'One Receipt after confirmation; none after reject', life.receiptsAfterConfirm === 1 && life.receiptsAfterReject === 0, { confirm: life.receiptsAfterConfirm, reject: life.receiptsAfterReject }, { onFail: { severity: 'P0', category: 'CONTROL_FAILURE' } }),
    check('valid', 'correctness', 'Candidate plan validates', validity(trip, proposal.candidatePlan).valid, validity(trip, proposal.candidatePlan).errors, { onFail: { severity: 'P0', category: 'ROUTE_FAILURE' } }),
    check('outdoor_moved_indoors', 'relevance', 'The outdoor stop in the rain is replaced by an indoor one (or dropped only if none is open)',
      touched.some((item) => item.id === target?.id) && swappedIn.every((place) => !isOutdoor(place.category)),
      { target: target?.placeId, now: swappedIn.map((place) => `${place.name} [${place.category}]`) }, { onFail: { severity: 'P1', category: 'RANKING_FAILURE' } }),
    check('indoor_kept', 'relevance', 'Rain never touches an indoor stop or a meal',
      touched.every(outdoor) && !touched.some((item) => item.role === 'lunch' || item.role === 'dinner'),
      touched.map((item) => `${bundledCatalogue.get(item.placeId)?.name} [${item.role}]`), { onFail: { severity: 'P1', category: 'CLASSIFICATION_FAILURE' } }),
    check('impact_code', 'explainability', 'Impact metrics are code-computed and consistent with the diff (itemsAffected = diff size)',
      impact.itemsAffected === computedItems, { impact, computedItems }, { onFail: { severity: 'P1', category: 'EVIDENCE_FAILURE' } }),
    check('impact_complete', 'explainability', 'travelTimeDelta available where data exists',
      impact.travelTimeDeltaMin !== null, { travelTimeDeltaMin: impact.travelTimeDeltaMin }, { weight: 'partial', onFail: { severity: 'P2', category: 'EVIDENCE_FAILURE' } }),
    check('pending_no_mutation', 'control', 'Current Plan preserved while pending', JSON.stringify(trip.plan) === planBefore, null, { onFail: { severity: 'P0', category: 'CONTROL_FAILURE' } }),
    check('atomic', 'control', 'A failed commit leaves State, Plan and Receipts untouched', life.atomicOnFailure, null, { onFail: { severity: 'P0', category: 'CONTROL_FAILURE' } }),
    check('scoped_to_day', 'efficiency', 'Only the rainy day is touched', touchedDays.size === 1 && touchedDays.has(target?.dayIndex ?? -1), [...touchedDays], { onFail: { severity: 'P1', category: 'CLASSIFICATION_FAILURE' } }),
  ]
  return scoreScenario({
    id: 'H2', title: 'Reorganize', smoke: false, checks,
    observations: {
      spec: { message, outcome: specOutcome.kind, reply: specOutcome.kind === 'answer' ? specOutcome.text : null },
      variant: { message: variantMessage, rationale: proposal.rationale, impact, type: proposal.type },
    },
  })
}

// ─────────────────────────────────────────────── H3 Reframe

export async function runH3(): Promise<ScenarioResult> {
  const trip = createTokyoTrip()
  const message = eventText('evt_tired')
  const planBefore = JSON.stringify(trip.plan)
  const stateBefore = JSON.stringify(trip.state)
  const outcome = await handleChatMessage({
    message, tripId: 'trip_1', frame: trip.frame, state: trip.state, plan: trip.plan, catalogue: bundledCatalogue,
    llm: createStubLlm(), now: NOW, proposalId: 'prop_h3', createdAt: NOW.toISOString(), memorySnapshot: trip.trip.memorySnapshot,
  })
  if (outcome.kind !== 'proposal') {
    return scoreScenario({ id: 'H3', title: 'Reframe', smoke: true, checks: [check('proposal', 'correctness', 'A proposal is produced', false, outcome, { onFail: { severity: 'P0', category: 'CLASSIFICATION_FAILURE' } })] })
  }
  const proposal = outcome.proposal
  const life = await lifecycle(trip, proposal)
  const removed = proposal.planDiff.removed
  const days = trip.plan.days.length
  const addedPace = proposal.candidateState.considering.find((item) => !trip.state.considering.some((old) => old.id === item.id))

  const checks: Check[] = [
    check('classification', 'correctness', 'classification = Reframe', proposal.type === 'reframe', proposal.type, { onFail: { severity: 'P0', category: 'CLASSIFICATION_FAILURE' } }),
    check('state_changed', 'correctness', 'Agent proposes a State change (pace)', !isStateDiffEmpty(proposal.stateDiff), addedPace?.text, { onFail: { severity: 'P0', category: 'CLASSIFICATION_FAILURE' } }),
    check('atomic_versions', 'correctness', 'State and Plan versions increment together; exactly one Receipt',
      life.committed.state.version === trip.state.version + 1 && life.committed.plan.version === trip.plan.version + 1 && life.receiptsAfterConfirm === 1 &&
        life.receipt?.resultingStateVersion === life.committed.state.version && life.receipt?.resultingPlanVersion === life.committed.plan.version,
      { state: life.committed.state.version, plan: life.committed.plan.version, receipts: life.receiptsAfterConfirm }, { onFail: { severity: 'P0', category: 'CONTROL_FAILURE' } }),
    check('valid', 'correctness', 'Candidate plan validates', validity(trip, proposal.candidatePlan).valid, validity(trip, proposal.candidatePlan).errors, { onFail: { severity: 'P0', category: 'ROUTE_FAILURE' } }),
    check('fewer_spots', 'relevance', 'Result has fewer stops per day', removed.length > 0, { removed: removed.length }, { onFail: { severity: 'P1', category: 'CLASSIFICATION_FAILURE' } }),
    check('removes_least_valuable', 'relevance', 'The dropped stop is chosen by value, and never a meal',
      !removed.some((item) => item.role === 'lunch' || item.role === 'dinner'), removed.map((item) => `D${item.dayIndex + 1} ${item.role}: ${bundledCatalogue.get(item.placeId)?.name}`),
      { weight: 'partial', onFail: { severity: 'P1', category: 'RANKING_FAILURE' } }),
    check('rationale', 'explainability', 'Preview explains the State change and what was dropped', proposal.rationale.length > 0 && addedPace !== undefined, proposal.rationale, { onFail: { severity: 'P1', category: 'EVIDENCE_FAILURE' } }),
    check('pending_no_mutation', 'control', 'Before confirmation active State and Plan unchanged', JSON.stringify(trip.plan) === planBefore && JSON.stringify(trip.state) === stateBefore, null, { onFail: { severity: 'P0', category: 'CONTROL_FAILURE' } }),
    check('reject', 'control', 'Rejection leaves active State and Plan unchanged, no Receipt', life.activeUnchangedAfterReject && life.receiptsAfterReject === 0, life.rejectedStatus, { onFail: { severity: 'P0', category: 'CONTROL_FAILURE' } }),
    check('atomic', 'control', 'A failed commit leaves State, Plan and Receipts untouched', life.atomicOnFailure, null, { onFail: { severity: 'P0', category: 'CONTROL_FAILURE' } }),
    check('minimal', 'efficiency', 'Minimal reduction: at most one stop removed per day', removed.length <= days, { removed: removed.length, days }, { weight: 'partial', onFail: { severity: 'P2', category: 'CLASSIFICATION_FAILURE' } }),
    check('scope_asked', 'efficiency', '"I feel tired" is scoped (today / next days), or each day is its own declinable change',
      new Set(removed.map((item) => item.dayIndex)).size < days || (proposal.units?.length === removed.length && proposal.units.every((unit) => !unit.required)),
      { daysTouched: new Set(removed.map((item) => item.dayIndex)).size, days, units: proposal.units?.length ?? 0 },
      { weight: 'partial', onFail: { severity: 'P1', category: 'CLASSIFICATION_FAILURE' } }),
  ]
  return scoreScenario({ id: 'H3', title: 'Reframe', smoke: true, checks, observations: { stateAdded: addedPace?.text, removed: removed.map((item) => `D${item.dayIndex + 1} ${item.role}: ${bundledCatalogue.get(item.placeId)?.name}`), rationale: proposal.rationale } })
}

// ─────────────────────────────────────────────── H4 Direct State edit

export async function runH4(): Promise<ScenarioResult> {
  const trip = createTokyoTrip()
  const planBefore = JSON.stringify(trip.plan)
  const stateBefore = JSON.stringify(trip.state)
  const draft = toStateDraft(trip.state)
  const convenience = draft.priorities.find((priority) => priority.name === 'convenience')!
  const from = convenience.weight
  convenience.weight = 'high'
  const outcome = proposeStateEdit({
    tripId: 'trip_1', frame: trip.frame, state: trip.state, plan: trip.plan, draft, catalogue: bundledCatalogue,
    now: NOW, proposalId: 'prop_h4', createdAt: NOW.toISOString(), memorySnapshot: trip.trip.memorySnapshot,
  })

  // Invariant probe (same scenario family, §12 "any State change → Reframe"): a State
  // edit whose consequence is a single swap.
  const probeDraft = toStateDraft(trip.state)
  probeDraft.considering.push({ id: 'cons_probe', text: 'Day 2 dinner: ramen' })
  const probe = proposeStateEdit({
    tripId: 'trip_1', frame: trip.frame, state: trip.state, plan: trip.plan, draft: probeDraft, catalogue: bundledCatalogue,
    now: NOW, proposalId: 'prop_h4_probe', createdAt: NOW.toISOString(), memorySnapshot: trip.trip.memorySnapshot,
  })
  const probeInfo = 'proposal' in probe
    ? { outcome: probe.kind, type: probe.proposal.type, stateChanged: !isStateDiffEmpty(probe.proposal.stateDiff), previewRequired: probe.kind === 'proposal' }
    : { outcome: probe.kind }

  if (outcome.kind === 'conflict' || outcome.kind === 'unchanged') {
    return scoreScenario({ id: 'H4', title: 'State edit', smoke: false, checks: [check('outcome', 'correctness', 'State edit produces a Reframe', false, outcome.kind, { onFail: { severity: 'P0', category: 'CLASSIFICATION_FAILURE' } })] })
  }
  const proposal = outcome.proposal
  const life = await lifecycle(trip, proposal)
  const planChanges = proposal.planDiff.added.length + proposal.planDiff.removed.length + proposal.planDiff.modified.length
  const expectedPlanVersion = planChanges === 0 ? trip.plan.version : trip.plan.version + 1

  const checks: Check[] = [
    check('classification', 'correctness', 'State edit classified Reframe', proposal.type === 'reframe', proposal.type, { onFail: { severity: 'P0', category: 'CLASSIFICATION_FAILURE' } }),
    check('one_receipt', 'correctness', 'Exactly one Receipt; versions consistent (planDiff empty → plan version kept)',
      life.receiptsAfterConfirm === 1 && life.committed.state.version === trip.state.version + 1 && life.committed.plan.version === expectedPlanVersion,
      { receipts: life.receiptsAfterConfirm, state: life.committed.state.version, plan: life.committed.plan.version, expectedPlanVersion }, { onFail: { severity: 'P0', category: 'CONTROL_FAILURE' } }),
    check('any_state_change_is_reframe', 'correctness', 'Invariant probe: a State edit that swaps one stop is still a Reframe',
      'proposal' in probe && probe.proposal.type === 'reframe', probeInfo, { onFail: { severity: 'P0', category: 'SPEC_CONFLICT' } }),
    check('priority_effect', 'relevance', 'Raising Convenience is honoured: stops move only when a replacement wins by the product margin, and the day gets shorter or stays equal',
      planChanges === 0 || proposal.impact.walkingDistanceDeltaM === null || proposal.impact.walkingDistanceDeltaM <= 0,
      { planChanges, walkingDistanceDeltaM: proposal.impact.walkingDistanceDeltaM }, { weight: 'partial', onFail: { severity: 'P1', category: 'RANKING_FAILURE' } }),
    check('explained', 'explainability', 'Outcome says what happened to the itinerary', proposal.rationale.length > 0, proposal.rationale, { weight: 'partial', onFail: { severity: 'P2', category: 'EVIDENCE_FAILURE' } }),
    check('no_immediate_rearrange', 'control', 'Active itinerary not rearranged before confirmation', JSON.stringify(trip.plan) === planBefore && JSON.stringify(trip.state) === stateBefore, null, { onFail: { severity: 'P0', category: 'CONTROL_FAILURE' } }),
    check('preview_if_plan_changes', 'control', 'If the plan changes, a preview precedes commit', planChanges === 0 || outcome.kind === 'proposal', { outcome: outcome.kind, planChanges }, { onFail: { severity: 'P0', category: 'CONTROL_FAILURE' } }),
    check('probe_preview', 'control', 'Invariant probe: a State edit that changes the plan is previewed before commit',
      probe.kind === 'proposal' || probe.kind === 'conflict', probeInfo, { onFail: { severity: 'P0', category: 'SPEC_CONFLICT' } }),
    check('atomic', 'control', 'A failed commit leaves State, Plan and Receipts untouched', life.atomicOnFailure, null, { onFail: { severity: 'P0', category: 'CONTROL_FAILURE' } }),
    check('minimal', 'efficiency', 'Priority change touches few stops (≤ 3)', planChanges <= 3, planChanges, { weight: 'partial', onFail: { severity: 'P2', category: 'RANKING_FAILURE' } }),
  ]
  return scoreScenario({
    id: 'H4', title: 'State edit', smoke: false, checks,
    observations: { edit: `Convenience: ${from} → high`, outcome: outcome.kind, planChanges, impact: proposal.impact, rationale: proposal.rationale, probe: probeInfo },
  })
}

// ─────────────────────────────────────────────── H5 Conflict

/** Test data: Nezu Museum closed on Day 4 (Thursday 2026-10-08). */
function nezuClosedDay4(): PlaceCatalogue {
  return createPlaceCatalogue(
    places.map((place) =>
      place.placeId === 'nezu_museum' ? { ...place, openingHours: { ...place.openingHours!, thu: 'closed' } } : place,
    ),
  )
}

export async function runH5(): Promise<ScenarioResult> {
  const SENTENCE = 'Must visit Nezu Museum on Day 4.'
  const catalogue = nezuClosedDay4()
  const tag = tagConsidering(SENTENCE, catalogue)

  // Path A — creation: the requirement is part of Stage B.
  const frame = toFrame(SETUP)
  const { trip: created, state } = confirmReview({
    tripId: 'trip_h5', frame,
    draft: { intent: [{ id: 'intent_1', text: 'Slow-paced' }], considering: [{ id: 'cons_1', text: SENTENCE }], priorities: defaultPriorities() },
    profileMemories: [pacePattern()], catalogue, createdAt: NOW.toISOString(),
  })
  const generated = generateFirstPlan({ frame, state, catalogue, days: 5, now: NOW, memorySnapshot: created.memorySnapshot })
  const nezuAtCreate = allItems(generated.plan).find((item) => item.placeId === 'nezu_museum')

  // Path B — State edit on an existing trip.
  // Built on the Day-4-closed catalogue, so the existing plan is valid against it.
  const trip = buildTrip({ catalogue, intent: ['Slow-paced'], memories: [pacePattern()] })
  const planBefore = JSON.stringify(trip.plan)
  const draft = toStateDraft(trip.state)
  draft.considering.push({ id: 'cons_nezu', text: SENTENCE })
  const edit = proposeStateEdit({
    tripId: 'trip_1', frame: trip.frame, state: trip.state, plan: trip.plan, draft, catalogue,
    now: NOW, proposalId: 'prop_h5', createdAt: NOW.toISOString(), memorySnapshot: trip.trip.memorySnapshot,
  })
  const editPlan = 'proposal' in edit ? edit.proposal.candidatePlan : trip.plan
  const nezuAfterEdit = allItems(editPlan).find((item) => item.placeId === 'nezu_museum')
  const editValid = validatePlan(editPlan, { frame: trip.frame, state: 'proposal' in edit ? edit.proposal.candidateState : trip.state, places: toValidationPlaces(catalogue), now: NOW })

  // Control: the conflict path itself, with Nezu closed on every trip day.
  const closedAll = createPlaceCatalogue(places.map((place) => place.placeId === 'nezu_museum'
    ? { ...place, openingHours: { mon: 'closed', tue: 'closed', wed: 'closed', thu: 'closed', fri: 'closed', sat: '10:00-17:00', sun: '10:00-17:00' } } : place))
  const controlDraft = toStateDraft(trip.state)
  controlDraft.considering.push({ id: 'cons_nezu', text: 'Must visit Nezu Museum.' })
  const control = proposeStateEdit({
    tripId: 'trip_1', frame: trip.frame, state: trip.state, plan: trip.plan, draft: controlDraft, catalogue: closedAll,
    now: NOW, proposalId: 'prop_h5c', createdAt: NOW.toISOString(), memorySnapshot: trip.trip.memorySnapshot,
  })

  const dayHonoured = (item: typeof nezuAtCreate) => item?.dayIndex === 3
  const silentlyDropped =
    (edit.kind !== 'conflict' && !dayHonoured(nezuAfterEdit)) || (generated.validation.valid && !dayHonoured(nezuAtCreate))

  const checks: Check[] = [
    check('tag_keeps_day', 'correctness', 'The Considering tag keeps "Day 4" (must_visit carries a day)',
      tag !== undefined && 'dayIndex' in tag && (tag as { dayIndex?: number }).dayIndex === 3, { tag }, { onFail: { severity: 'P0', category: 'CONSTRAINT_FAILURE' } }),
    check('conflict_returned', 'correctness', 'State edit returns a Conflict (Day 4 closed)', edit.kind === 'conflict',
      { outcome: edit.kind, nezuPlacedOn: nezuAfterEdit ? `Day ${nezuAfterEdit.dayIndex + 1}` : null }, { onFail: { severity: 'P0', category: 'CONSTRAINT_FAILURE' } }),
    check('not_silently_dropped', 'correctness', 'Constraint is never silently dropped or weakened (create and edit paths)', !silentlyDropped,
      { create: { valid: generated.validation.valid, nezuOn: nezuAtCreate ? `Day ${nezuAtCreate.dayIndex + 1}` : null }, edit: { outcome: edit.kind, nezuOn: nezuAfterEdit ? `Day ${nezuAfterEdit.dayIndex + 1}` : null } },
      { onFail: { severity: 'P0', category: 'CONSTRAINT_FAILURE' } }),
    check('control_conflict_works', 'relevance', 'Control: must-visit closed on every trip day → Conflict', control.kind === 'conflict',
      { outcome: control.kind, message: control.kind === 'conflict' ? control.conflicts.map((conflict) => conflict.message) : null }, { weight: 'partial', onFail: { severity: 'P1', category: 'CONSTRAINT_FAILURE' } }),
    check('concrete_reason', 'explainability', 'Conflict reason is concrete (names the place and the day)',
      edit.kind === 'conflict' && edit.conflicts.some((conflict) => /nezu/i.test(conflict.message) && /day\s*4|thu/i.test(conflict.message)),
      edit.kind === 'conflict' ? edit.conflicts : null, { onFail: { severity: 'P1', category: 'EVIDENCE_FAILURE' } }),
    check('resolution_options', 'explainability', 'Structured resolution options (move day / remove / edit requirement)',
      edit.kind === 'conflict' && edit.conflicts.some((conflict) => {
        const kinds = new Set((conflict.options ?? []).map((option) => option.kind))
        return kinds.has('move_day') && kinds.has('remove') && kinds.has('edit')
      }),
      edit.kind === 'conflict' ? edit.conflicts.map((conflict) => conflict.options ?? []) : null,
      { weight: 'partial', onFail: { severity: 'P1', category: 'EVIDENCE_FAILURE' } }),
    check('invalid_never_shown', 'control', 'Invalid Plan is never displayed (any returned candidate validates)', edit.kind === 'conflict' || editValid.valid, editValid.errors, { onFail: { severity: 'P0', category: 'CONTROL_FAILURE' } }),
    check('active_untouched', 'control', 'Active plan untouched', JSON.stringify(trip.plan) === planBefore, null, { onFail: { severity: 'P0', category: 'CONTROL_FAILURE' } }),
    check('no_side_changes', 'efficiency', 'Conflict path proposes no other changes', edit.kind === 'conflict' || ('proposal' in edit && edit.proposal.planDiff.removed.length + edit.proposal.planDiff.modified.length <= 1),
      'proposal' in edit ? edit.proposal.planDiff : null, { weight: 'partial', onFail: { severity: 'P2', category: 'CLASSIFICATION_FAILURE' } }),
  ]
  return scoreScenario({
    id: 'H5', title: 'Conflict', smoke: true, checks,
    observations: {
      tag,
      createPath: { valid: generated.validation.valid, nezuOn: nezuAtCreate ? `Day ${nezuAtCreate.dayIndex + 1}` : null, errors: generated.validation.errors },
      editPath: { outcome: edit.kind, nezuOn: nezuAfterEdit ? `Day ${nezuAfterEdit.dayIndex + 1}` : null, type: 'proposal' in edit ? edit.proposal.type : null },
      control: control.kind,
    },
  })
}
