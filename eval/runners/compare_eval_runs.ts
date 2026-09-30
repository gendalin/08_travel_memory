/**
 * Regression vs the most recent prior report of the same mode (eval spec §27).
 *
 *   npm run eval:compare                 # latest two core reports
 *   npm run eval:compare -- a.json b.json
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { EvalReport } from '../schemas/eval_report.ts'

export interface Comparison {
  previous: string | null
  scoreDeltas: Array<{ scenario: string; previous: number; current: number; delta: number }>
  improved: string[]
  regressed: string[]
  unchanged: string[]
  countDeltas: Record<string, number>
  newP0: string[]
  alerts: string[]
  metricDeltas: Record<string, { previous: unknown; current: unknown }>
}

export function compare(previous: EvalReport, current: EvalReport, previousName: string): Comparison {
  const scoreDeltas = current.scenarios.flatMap((scenario) => {
    const old = previous.scenarios.find((entry) => entry.id === scenario.id)
    return old ? [{ scenario: scenario.id, previous: old.total, current: scenario.total, delta: scenario.total - old.total }] : []
  })
  const previousP0 = new Set(previous.issues.filter((issue) => issue.severity === 'P0').map((issue) => issue.id))
  const newP0 = current.issues.filter((issue) => issue.severity === 'P0' && !previousP0.has(issue.id)).map((issue) => issue.id)
  const alerts = [
    ...scoreDeltas.filter((entry) => entry.delta <= -2).map((entry) => `${entry.scenario} regressed ${entry.delta} points`),
    ...newP0.map((id) => `new P0: ${id}`),
  ]
  const pick = (report: EvalReport, key: string) => (report.recommendation as Record<string, unknown>)[key]
  return {
    previous: previousName,
    scoreDeltas,
    improved: scoreDeltas.filter((entry) => entry.delta > 0).map((entry) => entry.scenario),
    regressed: scoreDeltas.filter((entry) => entry.delta < 0).map((entry) => entry.scenario),
    unchanged: scoreDeltas.filter((entry) => entry.delta === 0).map((entry) => entry.scenario),
    countDeltas: {
      P0: current.counts.P0 - previous.counts.P0,
      P1: current.counts.P1 - previous.counts.P1,
      P2: current.counts.P2 - previous.counts.P2,
    },
    newP0,
    alerts,
    metricDeltas: Object.fromEntries(
      ['top10MeanRelevance', 'candidateRecallProxy', 'constraintViolationRate'].map((key) => [key, { previous: pick(previous, key), current: pick(current, key) }]),
    ),
  }
}

/** Latest earlier report of the same mode, if any. */
export function compareWithPrevious(current: EvalReport, currentPath: string): Comparison | null {
  const dir = 'eval_reports'
  const candidates = readdirSync(dir)
    .filter((name) => name.endsWith('.json') && name.startsWith('eval_'))
    .filter((name) => (current.mode === 'smoke') === name.includes('_smoke'))
    .map((name) => join(dir, name))
    .filter((path) => path !== `${currentPath}.json`)
    .sort()
  const latest = candidates.at(-1)
  if (!latest) return null
  return compare(JSON.parse(readFileSync(latest, 'utf8')) as EvalReport, current, latest)
}

if (process.argv[1]?.endsWith('compare_eval_runs.ts')) {
  const [a, b] = process.argv.slice(2)
  const files = a && b ? [a, b] : readdirSync('eval_reports').filter((name) => name.endsWith('.json') && !name.includes('_smoke')).sort().slice(-2).map((name) => join('eval_reports', name))
  if (files.length < 2) {
    console.log('Need two reports to compare.')
  } else {
    const result = compare(JSON.parse(readFileSync(files[0], 'utf8')), JSON.parse(readFileSync(files[1], 'utf8')), files[0])
    console.log(JSON.stringify(result, null, 2))
  }
}
