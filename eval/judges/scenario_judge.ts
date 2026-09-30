/**
 * Five-dimension scoring (eval spec §4, §20).
 *
 * Deterministic rubric over structured checks — no model call. The spec allows an
 * LLM judge only where a deterministic assertion cannot decide; every dimension
 * here is decided by named checks, and the semantic ones (relevance of a POI to an
 * Intent) use the lexicon rubric in recommendation_judge.ts, whose inputs are
 * written into the report so a human or a model can re-judge them.
 *
 *   any failed critical check in a dimension  → 0
 *   any failed partial check                  → 1
 *   all checks passed                         → 2
 *   no check for the dimension                → 1, flagged "not evaluable"
 */

import {
  DIMENSIONS,
  type Check,
  type DimensionScores,
  type Issue,
  type ScenarioResult,
} from '../schemas/scenario_result.ts'

export function scoreScenario(input: {
  id: string
  title: string
  smoke: boolean
  checks: Check[]
  observations?: Record<string, unknown>
  judgeNotes?: string[]
  error?: string
}): ScenarioResult {
  const notes = [...(input.judgeNotes ?? [])]
  const scores = {} as DimensionScores

  for (const dimension of DIMENSIONS) {
    const mine = input.checks.filter((check) => check.dimension === dimension)
    if (mine.length === 0) {
      scores[dimension] = 1
      notes.push(`${dimension}: no applicable check — scored 1 (not evaluable)`)
      continue
    }
    if (mine.some((check) => !check.passed && check.weight === 'critical')) scores[dimension] = 0
    else if (mine.some((check) => !check.passed)) scores[dimension] = 1
    else scores[dimension] = 2
  }

  const total = DIMENSIONS.reduce((sum, dimension) => sum + scores[dimension], 0)
  const status = input.error || scores.correctness === 0 ? 'FAIL' : total >= 7 ? 'PASS' : 'PARTIAL'

  return {
    id: input.id,
    title: input.title,
    smoke: input.smoke,
    checks: input.checks,
    scores,
    total,
    status,
    observations: input.observations ?? {},
    judgeNotes: notes,
    ...(input.error ? { error: input.error } : {}),
  }
}

export function issuesOf(result: ScenarioResult): Issue[] {
  return result.checks
    .filter((check) => !check.passed && check.onFail)
    .map((check) => ({
      id: `${result.id}.${check.id}`,
      scenario: result.id,
      severity: check.onFail!.severity,
      category: check.onFail!.category,
      title: check.description,
      evidence: typeof check.evidence === 'string' ? check.evidence : JSON.stringify(check.evidence),
    }))
}

/** Builder, so scenario code reads as a list of rules. */
export function check(
  id: string,
  dimension: Check['dimension'],
  description: string,
  passed: boolean,
  evidence: unknown,
  options: { weight?: Check['weight']; onFail?: Check['onFail'] } = {},
): Check {
  return {
    id,
    dimension,
    description,
    passed,
    weight: options.weight ?? 'critical',
    evidence,
    ...(options.onFail ? { onFail: options.onFail } : {}),
  }
}
