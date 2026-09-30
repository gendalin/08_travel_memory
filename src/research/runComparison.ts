/**
 * Runs the full and baseline conditions over one Tokyo brief and reports
 * comparable numbers (Gate 7 Definition of Done).
 *
 * Both conditions get the same brief, the same catalogue, the same clock and
 * the same LLM. The full run goes through the product's real use cases —
 * `confirmReview`, `generateFirstPlan`, `handleChatMessage`, `confirmProposal` —
 * so the report describes the shipping product rather than a model of it. The
 * baseline goes through `src/research`'s own composition, which differs only by
 * what §15.2 removes.
 *
 * Nothing here is allowed to flatter either side. Where a difference does not
 * exist, the two columns come out equal, and that is the result.
 */

import {
  buildReviewDraft,
  confirmReview,
  toFrame,
  tripDays,
  type StageAInput,
} from '../application/createTrip/createTrip.ts'
import { generateFirstPlan, type PlanTension } from '../application/generatePlan/generatePlan.ts'
import { handleChatMessage } from '../application/handleChat/handleChat.ts'
import { confirmProposal } from '../application/commitProposal/commitProposalUseCase.ts'
import {
  confirmCandidate,
  loadProfileMemories,
  seedProfile,
  type BundledMemory,
} from '../application/manageMemory/manageMemory.ts'
import { affectedItemIds } from '../domain/plan/diff.ts'
import { allItems, type Plan } from '../domain/plan/types.ts'
import type { MemorySnapshot } from '../domain/memory/types.ts'
import type { TripState } from '../domain/state/types.ts'
import type { LlmService } from '../services/llm/types.ts'
import { createRepositories } from '../services/persistence/inMemory.ts'
import type { PlaceCatalogue } from '../services/places/types.ts'
import { baselineHandleMessage } from './baselineChat.ts'
import { BASELINE_STATE, generateBaselinePlan } from './baselinePlan.ts'
import { readConstraints, type BriefConstraints, type ResearchBrief } from './brief.ts'
import { phraseForPlan } from './requests.ts'
import { BASELINE, FULL, type Condition } from './conditions.ts'
import { createResearchLog, type ResearchEvent, type ResearchLog } from './eventLog.ts'
import {
  planMetrics,
  totalsOf,
  type ChangeMetrics,
  type ConditionTotals,
  type PlanMetrics,
} from './metrics.ts'

export interface ConditionRun {
  condition: Condition
  /**
   * Stops that sit against something the traveller stated, and why (A6).
   *
   * Baseline has none by construction — with no State model there is nothing
   * stated for a stop to sit against, which is the finding rather than a gap in
   * the harness.
   */
  tensions: PlanTension[]
  /** The itinerary as first generated, before any request. */
  firstPlan: Plan
  /** The itinerary after every scripted request has been handled. */
  finalPlan: Plan
  firstPlanMetrics: PlanMetrics
  finalPlanMetrics: PlanMetrics
  changes: ChangeMetrics[]
  totals: ConditionTotals
  /** Absent for baseline: it has no Memory (§15.2). */
  memorySnapshot?: MemorySnapshot
  state: TripState
}

export interface ComparisonReport {
  brief: ResearchBrief
  constraints: BriefConstraints
  full: ConditionRun
  baseline: ConditionRun
  events: readonly ResearchEvent[]
  generatedAt: string
}

function toStageA(brief: ResearchBrief): StageAInput {
  return {
    name: brief.name,
    startDate: brief.startDate,
    endDate: brief.endDate,
    baseLodgingPlaceId: brief.baseLodgingPlaceId,
    baseLodgingName: brief.baseLodgingName,
    intentText: brief.intentText,
    consideringText: brief.consideringText,
  }
}

/** Must-visits the brief pinned that a change took out of the plan. */
function mustVisitsLost(before: Plan, after: Plan, constraints: BriefConstraints): number {
  const wasThere = new Set(allItems(before).map((item) => item.placeId))
  const stillThere = new Set(allItems(after).map((item) => item.placeId))
  return constraints.mustVisitPlaceIds.filter(
    (placeId) => wasThere.has(placeId) && !stillThere.has(placeId),
  ).length
}

function stopsDropped(before: Plan, after: Plan): number {
  const stillThere = new Set(allItems(after).map((item) => item.placeId))
  return allItems(before).filter((item) => !stillThere.has(item.placeId)).length
}

// --- full condition ----------------------------------------------------------

async function runFull(input: {
  brief: ResearchBrief
  constraints: BriefConstraints
  catalogue: PlaceCatalogue
  bundledMemories: BundledMemory[]
  llm: LlmService
  now: Date
  log: ResearchLog
}): Promise<ConditionRun> {
  const { brief, catalogue, log, now } = input
  const repositories = createRepositories()

  // Profile: seed the candidates, then confirm exactly the ones the brief says
  // the participant confirmed. Activation is always explicit (§10.3).
  await seedProfile(input.bundledMemories, repositories.memories, now.toISOString())
  for (const memoryId of brief.activeMemoryIds) {
    await confirmCandidate(memoryId, repositories.memories)
    log.append('full', 'memory_confirmed', { memoryId })
  }
  const profileMemories = await loadProfileMemories(repositories.memories)

  const frame = toFrame(toStageA(brief))
  const days = tripDays(brief.startDate, brief.endDate)
  const draft = await buildReviewDraft(toStageA(brief), input.llm)

  const { trip, state: initialState } = confirmReview({
    tripId: 'trip_full',
    frame,
    draft,
    profileMemories,
    catalogue,
    createdAt: now.toISOString(),
  })
  log.append('full', 'trip_created', {
    activeMemories: trip.memorySnapshot.memories.length,
    considering: initialState.considering.length,
    priorities: initialState.priorities.map((priority) => `${priority.name}:${priority.weight}`),
  })

  const generated = generateFirstPlan({
    frame,
    state: initialState,
    catalogue,
    days,
    now,
    memorySnapshot: trip.memorySnapshot,
  })
  log.append('full', 'plan_generated', {
    stops: allItems(generated.plan).length,
    valid: generated.validation.valid,
  })

  const firstPlan = generated.plan
  let state = initialState
  let plan = firstPlan
  const changes: ChangeMetrics[] = []

  for (const [index, scripted] of brief.requests.entries()) {
    // Phrased against the plan as it stands, so neither condition is scored on
    // where its planner happened to put the stop the scenario is about.
    const phrased = phraseForPlan(scripted, plan, catalogue)
    const request = phrased.text
    log.append('full', 'message_sent', {
      request,
      ...(phrased.rephrasedFrom ? { rephrasedFrom: phrased.rephrasedFrom } : {}),
    })

    const outcome = await handleChatMessage({
      message: request,
      tripId: 'trip_full',
      frame,
      state,
      plan,
      catalogue,
      llm: input.llm,
      now,
      proposalId: `prop_${index + 1}`,
      createdAt: now.toISOString(),
      memorySnapshot: trip.memorySnapshot,
    })

    if (outcome.kind === 'answer' && outcome.noChangeNeeded) {
      // Understood, and the plan already meets it: nothing to preview, nothing refused.
      log.append('full', 'answered_no_change', { request, reason: outcome.text })
      changes.push({
        request, operation: 'answer', itemsAffected: 0, previewed: false, confirmed: false,
        receipts: 0, stopsDropped: 0, mustVisitsLost: 0, reportedConflict: false,
      })
      continue
    }

    if (outcome.kind !== 'proposal') {
      // A Conflict or a clarifying question: the plan is untouched (§8).
      log.append('full', 'conflict_shown', {
        request,
        kind: outcome.kind,
        reason: outcome.kind === 'conflict' ? outcome.reason : outcome.text,
      })
      changes.push({
        request,
        operation: outcome.kind,
        itemsAffected: 0,
        previewed: true,
        confirmed: false,
        receipts: 0,
        stopsDropped: 0,
        mustVisitsLost: 0,
        reportedConflict: true,
      })
      continue
    }

    // The proposal is shown first and changes nothing on its own (§7.7).
    log.append('full', 'change_previewed', {
      request,
      type: outcome.proposal.type,
      itemsAffected: outcome.proposal.impact.itemsAffected,
    })

    const before = plan
    const committed = await confirmProposal({
      proposal: outcome.proposal,
      state,
      plan,
      catalogue,
      repositories,
      receiptId: `rcpt_${index + 1}`,
      timestamp: now.toISOString(),
    })
    log.append('full', 'change_confirmed', { request, type: outcome.proposal.type })
    log.append('full', 'receipt_written', { receiptId: committed.receipt.id })

    state = committed.state
    plan = committed.plan

    changes.push({
      request,
      operation: outcome.proposal.type,
      itemsAffected: new Set(affectedItemIds(outcome.proposal.planDiff)).size,
      previewed: true,
      confirmed: true,
      receipts: 1,
      stopsDropped: stopsDropped(before, plan),
      mustVisitsLost: mustVisitsLost(before, plan, input.constraints),
      reportedConflict: false,
    })
  }

  const metricsInput = {
    catalogue,
    constraints: input.constraints,
    frame,
    memorySnapshot: trip.memorySnapshot,
  }

  return {
    condition: FULL,
    tensions: generated.tensions,
    firstPlan,
    finalPlan: plan,
    firstPlanMetrics: planMetrics({ plan: firstPlan, ...metricsInput }),
    finalPlanMetrics: planMetrics({ plan, ...metricsInput }),
    changes,
    totals: totalsOf(changes),
    memorySnapshot: trip.memorySnapshot,
    state,
  }
}

// --- baseline condition ------------------------------------------------------

function runBaseline(input: {
  brief: ResearchBrief
  constraints: BriefConstraints
  catalogue: PlaceCatalogue
  now: Date
  log: ResearchLog
}): ConditionRun {
  const { brief, catalogue, log, now } = input

  const frame = toFrame(toStageA(brief))
  const days = tripDays(brief.startDate, brief.endDate)

  const generated = generateBaselinePlan({ frame, catalogue, days, now })
  log.append('baseline', 'trip_created', { activeMemories: 0, considering: 0, priorities: [] })
  log.append('baseline', 'plan_generated', {
    stops: allItems(generated.plan).length,
    valid: generated.validation.valid,
  })

  const firstPlan = generated.plan
  let plan = firstPlan
  // Nothing in baseline holds the trip's constraints, so the runner carries the
  // ruled-out places forward itself — otherwise a later regeneration would
  // cheerfully schedule the restaurant the participant said was closed.
  const excluded: string[] = []
  const changes: ChangeMetrics[] = []

  for (const scripted of brief.requests) {
    const phrased = phraseForPlan(scripted, plan, catalogue)
    const request = phrased.text
    log.append('baseline', 'message_sent', {
      request,
      ...(phrased.rephrasedFrom ? { rephrasedFrom: phrased.rephrasedFrom } : {}),
    })

    const before = plan
    const result = baselineHandleMessage({
      message: request,
      frame,
      plan,
      catalogue,
      days,
      now,
      excludePlaceIds: excluded,
    })

    if (result.kind === 'unresolved') {
      log.append('baseline', 'conflict_shown', { request, operation: result.operation })
      changes.push({
        request,
        operation: result.operation,
        itemsAffected: 0,
        previewed: false,
        confirmed: false,
        receipts: 0,
        stopsDropped: 0,
        mustVisitsLost: 0,
        reportedConflict: true,
      })
      continue
    }

    plan = result.plan
    for (const placeId of result.droppedPlaceIds) {
      if (!excluded.includes(placeId)) excluded.push(placeId)
    }

    // No preview, no confirmation, no receipt — that is the condition (§15.2).
    log.append('baseline', 'change_applied_without_confirmation', {
      request,
      operation: result.operation,
      itemsAffected: new Set(affectedItemIds(result.diff)).size,
    })

    changes.push({
      request,
      operation: result.operation,
      itemsAffected: new Set(affectedItemIds(result.diff)).size,
      previewed: false,
      confirmed: false,
      receipts: 0,
      stopsDropped: stopsDropped(before, plan),
      mustVisitsLost: mustVisitsLost(before, plan, input.constraints),
      reportedConflict: false,
    })
  }

  const metricsInput = { catalogue, constraints: input.constraints, frame }

  return {
    condition: BASELINE,
    // No State, so nothing stated for a stop to sit against (§15.2).
    tensions: [],
    firstPlan,
    finalPlan: plan,
    firstPlanMetrics: planMetrics({ plan: firstPlan, ...metricsInput }),
    finalPlanMetrics: planMetrics({ plan, ...metricsInput }),
    changes,
    totals: totalsOf(changes),
    state: BASELINE_STATE,
  }
}

export async function runComparison(input: {
  brief: ResearchBrief
  catalogue: PlaceCatalogue
  bundledMemories: BundledMemory[]
  llm: LlmService
  now: Date
}): Promise<ComparisonReport> {
  // One clock for both runs, so the log is reproducible and the two columns are
  // measured at the same moment in the trip's life.
  const log = createResearchLog(() => input.now)
  const constraints = readConstraints(input.brief, input.catalogue)

  const full = await runFull({ ...input, constraints, log })
  const baseline = runBaseline({ ...input, constraints, log })

  return {
    brief: input.brief,
    constraints,
    full,
    baseline,
    events: log.entries(),
    generatedAt: input.now.toISOString(),
  }
}
