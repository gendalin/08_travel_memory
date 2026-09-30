/**
 * Result shapes for one Golden Scenario run (eval spec §4, §5, §20).
 *
 * A scenario is a list of checks. Each check belongs to one of the five scoring
 * dimensions, and the judge turns the checks into 0/1/2 per dimension — so every
 * point in the scoreboard can be traced back to a named, evidence-carrying check.
 */

export type Dimension = 'correctness' | 'relevance' | 'explainability' | 'control' | 'efficiency'

export const DIMENSIONS: readonly Dimension[] = [
  'correctness',
  'relevance',
  'explainability',
  'control',
  'efficiency',
]

export type Severity = 'P0' | 'P1' | 'P2'

export type FailureCategory =
  | 'DISCOVERY_FAILURE'
  | 'RANKING_FAILURE'
  | 'FILTER_FAILURE'
  | 'DIVERSITY_FAILURE'
  | 'ROUTE_FAILURE'
  | 'EVIDENCE_FAILURE'
  | 'MEMORY_FAILURE'
  | 'CLASSIFICATION_FAILURE'
  | 'CONTROL_FAILURE'
  | 'CONSTRAINT_FAILURE'
  | 'SPEC_CONFLICT'

export interface Check {
  id: string
  dimension: Dimension
  description: string
  passed: boolean
  /**
   * `critical`: failing it zeroes the dimension. `partial`: failing it caps the
   * dimension at 1. Critical is reserved for the spec's own "must" rules.
   */
  weight: 'critical' | 'partial'
  /** Observed values, so a reader can see why without re-running. */
  evidence: unknown
  /** Set on a failed check: the issue it raises. */
  onFail?: { severity: Severity; category: FailureCategory }
}

export interface Issue {
  id: string
  scenario: string
  severity: Severity
  category: FailureCategory
  title: string
  evidence: string
}

export interface DimensionScores {
  correctness: number
  relevance: number
  explainability: number
  control: number
  efficiency: number
}

export interface ScenarioResult {
  id: string
  title: string
  smoke: boolean
  checks: Check[]
  scores: DimensionScores
  total: number
  status: 'PASS' | 'PARTIAL' | 'FAIL'
  /** Free-form structured facts the report quotes. */
  observations: Record<string, unknown>
  /** Judge notes for dimensions set by rubric rather than by a single check. */
  judgeNotes: string[]
  error?: string
}
