/**
 * Decision Receipt (product_spec §9).
 *
 * Exactly one Receipt per committed transaction — not one per POI.
 *
 * Receipts provide accountability, explainability and traceability. They do NOT
 * provide undo, rollback, restore, or a version-control UI.
 */

import type { ChangeType } from '../proposals/classify.ts'
import type { ExpectedImpact } from '../proposals/impact.ts'
import type { Initiator } from '../proposals/types.ts'
import type { PlanDiff } from '../plan/diff.ts'
import type { StateDiff } from '../state/diff.ts'
import type { ID } from '../trip/types.ts'

export interface Receipt {
  id: ID
  tripId: ID
  proposalId: ID
  type: ChangeType
  initiator: Initiator
  trigger: string
  summary: string
  stateDiff: StateDiff
  planDiff: PlanDiff
  rationale: string
  impact: ExpectedImpact
  resultingStateVersion: number
  resultingPlanVersion: number
  /**
   * The catalogue version the decision was made against (B4).
   *
   * Without it "why this place and not another" stops being answerable the moment the
   * set of places grows: a Replace chosen from forty options reads afterwards as
   * though it had been chosen from sixty. Absent for a trip with no catalogue
   * snapshot, which is any trip planned against a pre-loaded catalogue.
   */
  catalogueVersion?: number
  timestamp: string
}
