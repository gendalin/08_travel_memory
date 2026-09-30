/** Machine-readable eval report (eval spec §22). One file per run, never overwritten. */

import type { MemoryScore } from '../judges/memory_judge.ts'
import type { Issue, ScenarioResult } from './scenario_result.ts'

export const EVAL_SUITE_VERSION = 'core-eval-1.0'

export interface FunctionalStatus {
  command: string
  passed: number
  failed: number
  skipped: number
  byCategory: Record<string, { passed: number; failed: number }>
  dataValidation: { ok: boolean; errors: number; warnings: string[] }
}

export type InvariantStatus = 'PASS' | 'FAIL' | 'NOT_RUN'

export interface EvalReport {
  suiteVersion: string
  mode: 'core' | 'smoke'
  runId: string
  build: string
  commit: string
  date: string
  durationSeconds: number
  overallStatus: 'PASS' | 'PASS WITH RISKS' | 'FAIL' | 'BLOCKED_BY_FUNCTIONAL_FAILURE'
  counts: { P0: number; P1: number; P2: number }
  functional: FunctionalStatus
  invariants: Record<string, { status: InvariantStatus; evidence: string }>
  scenarios: ScenarioResult[]
  memory: { scores: MemoryScore[]; influence: unknown }
  recommendation: Record<string, unknown>
  issues: Issue[]
  failureCategoryCounts: Record<string, number>
  traces: string[]
  scenarioChanges: string[]
}
