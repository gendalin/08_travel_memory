/**
 * Direct user State edit (product_spec §7.6).
 *
 *   User edits State
 *   -> draft State
 *   -> generate candidate Plan
 *   -> validate
 *   -> proposal
 *   -> user confirms
 *   -> State + Plan commit together
 *
 * A State edit never mutates the Plan on the spot. The one shortcut the spec
 * allows is the empty-planDiff case: if the edit changes nothing about the
 * itinerary, the State may commit immediately and still writes one Receipt —
 * pressing Save on the editor is the confirmation, and asking the user to
 * approve an unchanged itinerary would be noise.
 *
 * The type is computed, not asserted: a non-empty State diff means
 * `classifyChange` returns Reframe.
 */

import { isPlanDiffEmpty } from '../../domain/plan/diff.ts'
import type { Plan } from '../../domain/plan/types.ts'
import { diffStates, isStateDiffEmpty } from '../../domain/state/diff.ts'
import type { ConsideringItem, TripEvent, TripState } from '../../domain/state/types.ts'
import { withEventPlaces } from '../../services/places/eventPlaces.ts'
import type { Proposal } from '../../domain/proposals/types.ts'
import type { TripFrame } from '../../domain/trip/types.ts'
import type { ValidationResult } from '../../domain/validation/types.ts'
import type { PlaceCatalogue } from '../../services/places/types.ts'
import { tagAll } from '../decompose/tagConsidering.ts'
import { explainValidationError, pinConflict, type ConflictDetail } from '../planning/conflicts.ts'
import { buildProposal } from '../planning/buildProposal.ts'
import { lockedItemIds } from '../planning/tripContext.ts'
import type { MemorySnapshot } from '../../domain/memory/types.ts'
import { diffPlans } from '../../domain/plan/diff.ts'
import type { ChangeUnit } from '../../domain/proposals/types.ts'
import { adaptPlanToState } from './adaptPlan.ts'
import { rescopePlan } from './rescope.ts'

/** A State draft as the editor holds it: text the user typed, no tags yet. */
export interface StateDraft {
  intent: Array<{ id: string; text: string }>
  /**
   * `event` is the game or show the traveller picked for this line, once they have.
   * It is carried on the draft because the line's text alone ("at least one baseball
   * game") would be read as a new request every time State is saved.
   */
  considering: Array<{ id: string; text: string; event?: TripEvent }>
  priorities: TripState['priorities']
}

/** A Conflict against the traveller's own sentence, with the ways out of it. */
export type StateConflictDetail = ConflictDetail

export type StateEditOutcome =
  /** Plan changes too, beyond one stop: preview, then commit both together. */
  | { kind: 'proposal'; proposal: Proposal; notes: string[] }
  /** Plan is untouched: State may commit immediately, one Receipt (§7.6). */
  | { kind: 'commit_now'; proposal: Proposal; notes: string[] }
  | { kind: 'conflict'; conflicts: StateConflictDetail[]; validation: ValidationResult }
  | { kind: 'unchanged' }

export function toStateDraft(state: TripState): StateDraft {
  return {
    intent: state.intent.map((item) => ({ id: item.id, text: item.text })),
    considering: state.considering.map((item) => ({
      id: item.id,
      text: item.text,
      ...(item.tag?.kind === 'event' ? { event: item.tag.event } : {}),
    })),
    priorities: state.priorities.map((priority) => ({ ...priority })),
  }
}

/** Draft -> State, re-running the deterministic tagger over every sentence. */
export function draftToState(draft: StateDraft, base: TripState, catalogue: PlaceCatalogue): TripState {
  const considering: ConsideringItem[] = draft.considering
    .filter((item) => item.text.trim() !== '')
    .map((item) => ({ id: item.id, text: item.text.trim() }))
  const picked = new Map(draft.considering.filter((item) => item.event).map((item) => [item.id, item.event!]))

  return {
    version: base.version,
    intent: draft.intent
      .filter((item) => item.text.trim() !== '')
      .map((item) => ({ id: item.id, text: item.text.trim() })),
    // A line the traveller picked an event for keeps that event; every other line is
    // tagged from its words.
    considering: tagAll(considering, catalogue).map((item) =>
      picked.has(item.id) ? { ...item, tag: { kind: 'event' as const, event: picked.get(item.id)! } } : item,
    ),
    priorities: draft.priorities,
  }
}


export function proposeStateEdit(input: {
  tripId: string
  frame: TripFrame
  state: TripState
  plan: Plan
  draft: StateDraft
  catalogue: PlaceCatalogue
  now: Date
  proposalId: string
  createdAt: string
  /** The trip's memory snapshot, so a re-chosen stop is ranked the way the first plan was. */
  memorySnapshot?: MemorySnapshot
}): StateEditOutcome {
  const candidateState = draftToState(input.draft, input.state, input.catalogue)
  const stateDiff = diffStates(input.state, candidateState)
  if (isStateDiffEmpty(stateDiff)) return { kind: 'unchanged' }

  // The venue of an event being picked has to be a place the planner, the validator
  // and the diff can all see.
  const catalogue = withEventPlaces(input.catalogue, input.state, candidateState)
  input = { ...input, catalogue }

  const locked = lockedItemIds(input.frame, input.plan, input.now)

  // Schedule surgery first — a named place inserted, a day cut short — then the
  // in-place re-choices a changed avoid, budget, slot or Intent calls for.
  const { plan: adapted, unsatisfied } = adaptPlanToState({
    plan: input.plan,
    before: input.state,
    after: candidateState,
    catalogue: input.catalogue,
    frame: input.frame,
    lockedItemIds: locked,
  })
  const rescoped = rescopePlan({
    plan: adapted,
    before: input.state,
    after: candidateState,
    catalogue: input.catalogue,
    frame: input.frame,
    memorySnapshot: input.memorySnapshot,
    lockedItemIds: locked,
  })
  const candidatePlan = rescoped.plan
  const units: ChangeUnit[] = [...scheduleUnits(input.plan, adapted, input.catalogue), ...rescoped.units]

  // Deterministic: re-running would produce the same plan, so the §8 retry
  // budget is spent inside adaptPlanToState rather than here.
  const built = buildProposal({
    tripId: input.tripId,
    frame: input.frame,
    catalogue: input.catalogue,
    now: input.now,
    proposalId: input.proposalId,
    createdAt: input.createdAt,
    initiator: 'user',
    trigger: 'You edited the trip state',
    rationale: 'I adjusted the itinerary to match what you changed.',
    currentState: input.state,
    currentPlan: input.plan,
    candidateState,
    candidatePlan,
  })

  if (built.kind === 'conflict') {
    return {
      kind: 'conflict',
      conflicts: built.validation.errors.map((error) => explainValidationError(error, candidateState, input.frame, input.catalogue)),
      validation: built.validation,
    }
  }

  if (unsatisfied.length > 0) {
    return {
      kind: 'conflict',
      conflicts: unsatisfied.map((pin) => {
        const source = candidateState.considering.find(
          (item) => item.tag?.kind === 'must_visit' && item.tag.placeId === pin.placeId,
        )
        return pinConflict({
          ...pin,
          sourceText: source?.text ?? input.catalogue.get(pin.placeId)?.name ?? pin.placeId,
          consideringId: source?.id,
          frame: input.frame,
          catalogue: input.catalogue,
        })
      }),
      validation: { valid: false, errors: [] },
    }
  }

  const proposal = units.length > 0 ? { ...built.proposal, units } : built.proposal

  const notes = rescoped.unchanged

  if (isPlanDiffEmpty(proposal.planDiff)) {
    return {
      kind: 'commit_now',
      notes,
      proposal: {
        ...proposal,
        rationale:
          notes.length > 0
            ? `Saved, but the itinerary could not follow it: ${notes.join(' ')}`
            : 'The itinerary still works as it stands, so only the trip state changes.',
      },
    }
  }

  // Every State edit that moves the itinerary is previewed, even a single swap
  // (decided 2026-09-30): the traveller changed the terms of the trip, and sees what
  // that does before it happens.
  return {
    kind: 'proposal',
    notes,
    proposal: notes.length > 0 ? { ...proposal, rationale: `${proposal.rationale} ${notes.join(' ')}` } : proposal,
  }
}

/**
 * The schedule changes a named place or a shortened day made, one unit each. They
 * are what the traveller asked for, so they are required: declining them would be
 * declining the request.
 */
function scheduleUnits(before: Plan, after: Plan, catalogue: PlaceCatalogue): ChangeUnit[] {
  const diff = diffPlans(before, after)
  const name = (placeId: string) => catalogue.get(placeId)?.name ?? placeId
  const where = (dayIndex: number, time: string) => `Day ${dayIndex + 1} · ${time}`
  return [
    ...diff.added.map((item) => ({
      id: `unit_add_${item.id}`,
      summary: `${where(item.dayIndex, item.startTime)}: + ${name(item.placeId)}`,
      reason: 'You asked for this one by name.',
      required: true,
      removeItemIds: [],
      putItems: [item],
    })),
    ...diff.modified.map((entry) => ({
      id: `unit_move_${entry.after.id}`,
      summary: `${where(entry.after.dayIndex, entry.before.startTime)}: ${name(entry.after.placeId)} → ${entry.after.startTime}`,
      reason: 'Moved to fit the time you set.',
      required: true,
      removeItemIds: [],
      putItems: [entry.after],
    })),
    ...diff.removed.map((item) => ({
      id: `unit_drop_${item.id}`,
      summary: `${where(item.dayIndex, item.startTime)}: ${name(item.placeId)} → out`,
      reason: 'No longer fits the time you set.',
      required: true,
      removeItemIds: [item.id],
      putItems: [],
    })),
  ]
}
