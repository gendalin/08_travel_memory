/** Proposal model (product_spec §7.7). */

import type { ExpectedImpact } from './impact.ts'
import type { ChangeType } from './classify.ts'
import type { PlanDiff } from '../plan/diff.ts'
import type { StateDiff } from '../state/diff.ts'
import type { Plan, PlanItem } from '../plan/types.ts'
import type { TripState } from '../state/types.ts'
import type { ID } from '../trip/types.ts'

export type ProposalStatus =
  | 'generating'
  | 'pending'
  | 'committed'
  | 'rejected'
  | 'superseded'
  | 'invalidated'
  | 'failed'

export type Initiator = 'user' | 'agent'

/**
 * One change inside a proposal that the traveller can accept or decline on its own
 * (product_spec §7.6).
 *
 * A proposal that touches several stops is a list of these. Declining one keeps the
 * original stop in that slot and applies the rest. `required` marks the part the
 * request itself is — the game being on the plan, the stops its hours overlap —
 * which cannot be declined without dropping the request.
 */
export interface ChangeUnit {
  id: ID
  /** One line: what changes. "Day 3 18:00: Sushidokoro Genki → out". */
  summary: string
  /** Why, tied to what the traveller changed. */
  reason: string
  required: boolean
  /** Items this unit takes out of the plan, by id. */
  removeItemIds: ID[]
  /** Items it puts in, whole — a swapped stop keeps its id. */
  putItems: PlanItem[]
  /** True when it adds a stop rather than changing one: declining it adds nothing. */
  adds?: boolean
}

export interface Proposal {
  id: ID
  tripId: ID
  status: ProposalStatus
  type: ChangeType
  initiator: Initiator
  /** What prompted it — the chat message, or the State edit. */
  trigger: string
  /** Candidate state/plan this proposal would commit. */
  candidateState: TripState
  candidatePlan: Plan
  stateDiff: StateDiff
  planDiff: PlanDiff
  impact: ExpectedImpact
  /**
   * Short user-facing reason. Written by the LLM for a model-chosen change, or
   * by the deterministic transform that built the candidate. Never a
   * classification — the type field is computed from the diff.
   */
  rationale: string
  /**
   * The proposal as separately acceptable changes, when it has them. Absent means
   * the whole diff is one change — accepted or kept as a whole.
   */
  units?: ChangeUnit[]
  createdAt: string
}
