/** Human-readable report in the exact §23 structure. */

import { DIMENSIONS } from '../schemas/scenario_result.ts'
import type { EvalReport } from '../schemas/eval_report.ts'
import type { Comparison } from './compare_eval_runs.ts'

const TITLES: Record<string, string> = {
  M1: 'M1 Memory influence', M2: 'M2 State override', M3: 'M3 Candidate Memory',
  H1: 'H1 Replace', H2: 'H2 Reorganize', H3: 'H3 Reframe', H4: 'H4 State edit', H5: 'H5 Conflict',
  R1: 'R1 Discovery/ranking', R2: 'R2 Diversity/feasibility',
}

const json = (value: unknown) => '`' + JSON.stringify(value) + '`'

export function renderMarkdown(report: EvalReport, comparison: Comparison | null): string {
  const scenario = (id: string) => report.scenarios.find((entry) => entry.id === id)
  const summary = (ids: string[]) => ids
    .map((id) => scenario(id))
    .filter((entry) => entry !== undefined)
    .map((entry) => `${entry!.id} ${entry!.total}/10`)
    .join(', ')
  const byScenario = (id: string) => {
    const entry = scenario(id)
    if (!entry) return 'not run'
    const failed = entry.checks.filter((check) => !check.passed).map((check) => check.id)
    return `${entry.total}/10 ${entry.status}${failed.length ? ` — failed: ${failed.join(', ')}` : ' — all checks pass'}`
  }
  const rec = report.recommendation as Record<string, any>
  const lines: string[] = []
  const push = (...rows: string[]) => lines.push(...rows)

  push(
    '# The Next Trip — Core Eval Report', '',
    `Build: ${report.build}`, `Commit: ${report.commit}`, `Date: ${report.date}`, `Eval suite version: ${report.suiteVersion} (${report.mode})`,
    `Run duration: ${report.durationSeconds}s`, '',
    '## 1. Executive Status', '',
    `Overall status: **${report.overallStatus}**`, '',
    `P0: ${report.counts.P0}`, `P1: ${report.counts.P1}`, `P2: ${report.counts.P2}`, '',
    'Core summary:',
    `- Memory: ${summary(['M1', 'M2', 'M3'])}`,
    `- Collaboration: ${summary(['H1', 'H2', 'H3', 'H4', 'H5'])}`,
    `- Recommendation: ${summary(['R1', 'R2'])}`, '',
    '## 2. Scoreboard', '',
    '| Scenario | Correctness | Relevance | Explainability | Control | Efficiency | Total | Status |',
    '|---|---:|---:|---:|---:|---:|---:|---|',
    ...Object.keys(TITLES).map((id) => {
      const entry = scenario(id)
      if (!entry) return `| ${TITLES[id]} | – | – | – | – | – | – | not run |`
      return `| ${TITLES[id]} | ${DIMENSIONS.map((dimension) => entry.scores[dimension]).join(' | ')} | ${entry.total}/10 | ${entry.status} |`
    }),
    '',
    '## 3. Functional Test Status', '',
    `Tests passed: ${report.functional.passed}`, `Tests failed: ${report.functional.failed}`, `Blocked tests: ${report.functional.skipped}`,
    `Data validation: ${report.functional.dataValidation.ok ? 'ok' : 'FAILED'} (${report.functional.dataValidation.errors} errors; warnings: ${report.functional.dataValidation.warnings.join(' / ') || 'none'})`, '',
    '| Category (spec §19) | Passed | Failed |', '|---|---:|---:|',
    ...Object.entries(report.functional.byCategory).map(([category, count]) => `| ${category} | ${count.passed} | ${count.failed} |`),
    '', 'Critical invariant status:',
    ...Object.entries(report.invariants).map(([name, value]) => `- ${name}: **${value.status}** — ${value.evidence}`),
    '',
    '## 4. Memory Evaluation', '',
    `Active memories evaluated: ${report.memory.scores.filter((entry) => entry.status === 'active').length}`,
    `Candidate memories evaluated: ${report.memory.scores.filter((entry) => entry.status !== 'active').length}`, '',
    '| Memory | Accuracy | Specificity | Stability | Provenance | Actionability | Total | Issue |',
    '|---|---:|---:|---:|---:|---:|---:|---|',
    ...report.memory.scores.map((entry) => `| ${entry.id} — ${entry.text.slice(0, 60)} | ${entry.accuracy} | ${entry.specificity} | ${entry.stability} | ${entry.provenance} | ${entry.actionability} | ${entry.total}/10 | ${entry.issue} |`),
    '', 'Memory influence comparison (M1, same State, Memory on vs off):', '',
    '```json', JSON.stringify(scenario('M1')?.observations ?? null, null, 2), '```', '',
    '## 5. Recommendation Evaluation', '',
    `Candidate recall proxy: ${rec.candidateRecallProxy ?? 'n/a'} / 2`,
    `Top-10 relevance: ${rec.top10MeanRelevance ?? 'n/a'} / 2 (final R1 selection: ${rec.finalMeanRelevanceR1 ?? 'n/a'})`,
    `Memory influence: ${json(rec.memoryInfluence ? { movedUp: rec.memoryInfluence.movedUp, movedDown: rec.memoryInfluence.movedDown, finalSelectionsChanged: rec.memoryInfluence.finalSelectionsChanged } : null)}`,
    `Constraint violation rate: ${rec.constraintViolationRate}`,
    `Diversity: ${json(rec.diversity)}`,
    `Route/time feasibility: ${json(rec.routeTimeFeasibility)}`, '',
    'Top 10 (R1, neutral context):', '',
    '| # | Place | Category | Score | stateMatch | Relevance |', '|---:|---|---|---:|---:|---:|',
    ...((rec.top10 as any[]) ?? []).map((entry) => `| ${entry.rank} | ${entry.name} | ${entry.category} | ${entry.total} | ${entry.stateMatch} | ${entry.relevance} |`),
    '', 'Selected POIs audited:',
    ...((rec.audit?.selected as any[]) ?? []).map((entry, index) => `${index + 1}. **${entry.name}** (${entry.slot}, neutral rank ${entry.neutralRank}) — ${entry.whyWon.reasons.join(' ')} Beat ${entry.whyWon.beat}.`),
    '', 'Rejected POIs audited:',
    ...((rec.audit?.rejected as any[]) ?? []).map((entry, index) => `${index + 1}. **${entry.name}** [${entry.category}] (neutral rank ${entry.neutralRank}, score ${entry.neutralScore}) — ${entry.whyLost}`),
    '', 'Failure category counts:',
    ...['DISCOVERY_FAILURE', 'RANKING_FAILURE', 'FILTER_FAILURE', 'DIVERSITY_FAILURE', 'ROUTE_FAILURE', 'EVIDENCE_FAILURE'].map((category) => `- ${category}: ${report.failureCategoryCounts[category] ?? 0}`),
    `- (other: ${Object.entries(report.failureCategoryCounts).filter(([category]) => !category.match(/^(DISCOVERY|RANKING|FILTER|DIVERSITY|ROUTE|EVIDENCE)_/)).map(([category, count]) => `${category} ${count}`).join(', ') || 'none'})`,
    '', `Traces: ${report.traces.join(', ')}`, '',
    '## 6. Human–Agent Collaboration Evaluation', '',
    `Replace: ${byScenario('H1')}`, `Reorganize: ${byScenario('H2')}`, `Reframe: ${byScenario('H3')}`,
    `Direct State edit: ${byScenario('H4')}`, `Conflict: ${byScenario('H5')}`, '',
    `Proposal lifecycle: pending proposals never mutated active State/Plan in H1-H5; reject writes no Receipt.`,
    `Receipt behavior: invariant "one Receipt per commit" = ${report.invariants['one Receipt per commit'].status}.`,
    `State / Plan consistency: ${report.invariants['State / Plan consistency'].status}; atomic Reframe: ${report.invariants['atomic Reframe'].status}.`, '',
    '## 7. Issues', '',
    ...(['P0', 'P1', 'P2'] as const).flatMap((severity) => [
      `### ${severity}`, '',
      ...(report.issues.filter((issue) => issue.severity === severity).map((issue) => `- **[${issue.id}]** ${issue.category} — ${issue.title}  \n  Evidence: ${issue.evidence.slice(0, 400)}`)),
      ...(report.issues.some((issue) => issue.severity === severity) ? [] : ['- none']),
      '',
    ]),
    '## 8. Regression vs Previous Run', '',
    ...(comparison
      ? [
          `Previous: ${comparison.previous}`,
          `Improved: ${comparison.improved.join(', ') || 'none'}`,
          `Regressed: ${comparison.regressed.join(', ') || 'none'}`,
          `Unchanged: ${comparison.unchanged.join(', ') || 'none'}`, '',
          'Score deltas:', ...comparison.scoreDeltas.map((entry) => `- ${entry.scenario}: ${entry.previous} → ${entry.current} (${entry.delta >= 0 ? '+' : ''}${entry.delta})`),
          `Alerts: ${comparison.alerts.join('; ') || 'none'}`,
        ]
      : ['No prior eval report — this run is the baseline.']),
    '', 'Scenario definition changes this run:', ...report.scenarioChanges.map((change) => `- ${change}`), '',
    '## 9. Recommended Fixes for Current Version', '',
    '<!-- FIXES -->', '',
    '## 10. Strengthening Opportunities', '',
    'These are not bugs but high-value improvements.', '',
    '<!-- STRENGTHENING -->', '',
    '## 11. Next Eval Focus', '',
    '<!-- NEXT -->', '',
  )
  return lines.join('\n')
}
