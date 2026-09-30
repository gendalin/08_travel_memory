/**
 * Core product eval (eval spec §21). `--smoke` runs the six smoke scenarios (§32).
 *
 *   npm run eval:core
 *   npm run eval:smoke
 *
 * Writes eval_reports/eval_<YYYYMMDD_HHMM>_<build>.{md,json} and
 * artifacts/recommendation_runs/<run>_<scenario>/recommendation_trace.{json,md}.
 * Never overwrites an existing report.
 */

import { execSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { runM1, runM2, runM3, m1Memory, m1AreaMemory } from '../scenarios/memory.ts'
import { runH1, runH2, runH3, runH4, runH5, runH6 } from '../scenarios/collaboration.ts'
import { runR1, runR2, type RecommendationRun } from '../scenarios/recommendation.ts'
import { issuesOf } from '../judges/scenario_judge.ts'
import { judgeMemory } from '../judges/memory_judge.ts'
import { pacePattern } from '../lib/fixture.ts'
import { EVAL_SUITE_VERSION, type EvalReport, type FunctionalStatus } from '../schemas/eval_report.ts'
import type { Issue, ScenarioResult } from '../schemas/scenario_result.ts'
import { renderMarkdown } from './render_report.ts'
import { compareWithPrevious } from './compare_eval_runs.ts'
import type { Memory } from '../../src/domain/memory/types.ts'

const SMOKE = process.argv.includes('--smoke')
const SMOKE_IDS = new Set(['M1', 'M2', 'H1', 'H3', 'H5', 'R1'])
const started = Date.now()

// ─────────────── 1. build / commit

function buildId(): { build: string; commit: string } {
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() !== ''
    return { build: sha + (dirty ? '-dirty' : ''), commit: sha }
  } catch {
    // Not a git repository: a content hash of src/ and data/ identifies the build instead.
    const hash = createHash('sha1')
    const walk = (dir: string) => {
      for (const name of readdirSync(dir).sort()) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(ts|tsx|json)$/.test(name)) hash.update(path).update(readFileSync(path))
      }
    }
    walk('src')
    walk('data/demo_tokyo_v1')
    const digest = hash.digest('hex').slice(0, 7)
    return { build: `src-${digest}`, commit: `no-git (content hash ${digest})` }
  }
}

const { build, commit } = buildId()
const now = new Date()
const pad = (value: number) => String(value).padStart(2, '0')
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`
const runId = `${stamp}_${build}`

// ─────────────── 2. validate test data  3. deterministic tests

const CATEGORY_RULES: Array<[string, RegExp]> = [
  ['proposal lifecycle tests', /lifecycle|supersede|invalidat/i],
  ['State / Plan consistency tests', /commit\.test|diff\.test|atomic|version/i],
  ['Receipt tests', /receipt/i],
  ['Memory snapshot tests', /snapshot/i],
  ['candidate Memory tests', /memory|candidate|profile/i],
  ['constraint tests', /must.?visit|constraint|considering|half.?day|fixed.?time|budget/i],
  ['locked item tests', /lock/i],
  ['recommendation validation tests', /ranking|retriev|alternatives|queryPlan|explainStop|priority/i],
  ['schema validation tests', /validat|llmResilience|schema/i],
  ['domain tests', /tests\/domain/i],
]

function runDeterministic(): FunctionalStatus {
  const data = spawnSync('npx', ['tsx', 'scripts/validate_demo_data.ts'], { encoding: 'utf8' })
  const dataOut = `${data.stdout}\n${data.stderr}`
  const errorsMatch = dataOut.match(/(\d+) errors?/)
  const warnings = dataOut.split('\n').filter((line) => line.trim().startsWith('!')).map((line) => line.trim())

  const out = join('artifacts', `vitest_${runId}.json`)
  mkdirSync('artifacts', { recursive: true })
  spawnSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${out}`], { encoding: 'utf8' })
  const json = JSON.parse(readFileSync(out, 'utf8')) as {
    numPassedTests: number; numFailedTests: number; numPendingTests: number
    testResults: Array<{ name: string; assertionResults: Array<{ fullName: string; status: string }> }>
  }

  const byCategory: FunctionalStatus['byCategory'] = {}
  for (const [category] of CATEGORY_RULES) byCategory[category] = { passed: 0, failed: 0 }
  for (const file of json.testResults) {
    for (const assertion of file.assertionResults) {
      // Relative path: the repo folder itself is named *_travel_memory.
      const haystack = `${relative(process.cwd(), file.name)} ${assertion.fullName}`
      for (const [category, rule] of CATEGORY_RULES) {
        if (!rule.test(haystack)) continue
        byCategory[category][assertion.status === 'passed' ? 'passed' : 'failed']++
      }
    }
  }

  return {
    command: 'vitest run (43 files) + scripts/validate_demo_data.ts',
    passed: json.numPassedTests,
    failed: json.numFailedTests,
    skipped: json.numPendingTests,
    byCategory,
    dataValidation: { ok: data.status === 0 && Number(errorsMatch?.[1] ?? 1) === 0, errors: Number(errorsMatch?.[1] ?? -1), warnings },
  }
}

// ─────────────── 4-5. scenarios and traces

async function safely(id: string, run: () => Promise<ScenarioResult>): Promise<ScenarioResult> {
  try {
    return await run()
  } catch (error) {
    return {
      id, title: id, smoke: SMOKE_IDS.has(id), checks: [],
      scores: { correctness: 0, relevance: 0, explainability: 0, control: 0, efficiency: 0 },
      total: 0, status: 'FAIL', observations: {}, judgeNotes: ['harness error'],
      error: error instanceof Error ? `${error.message}\n${error.stack?.split('\n').slice(1, 4).join('\n')}` : String(error),
    }
  }
}

async function main() {
  console.log(`[eval] ${SMOKE ? 'smoke' : 'core'} run ${runId}`)
  const functional = runDeterministic()
  console.log(`[eval] deterministic: ${functional.passed} passed, ${functional.failed} failed`)

  const scenarios: ScenarioResult[] = []
  let r1: RecommendationRun | undefined
  let r2: RecommendationRun | undefined
  const want = (id: string) => !SMOKE || SMOKE_IDS.has(id)

  if (want('M1')) scenarios.push(await safely('M1', runM1))
  if (want('M2')) scenarios.push(await safely('M2', runM2))
  if (want('M3')) scenarios.push(await safely('M3', runM3))
  if (want('H1')) scenarios.push(await safely('H1', runH1))
  if (want('H2')) scenarios.push(await safely('H2', runH2))
  if (want('H3')) scenarios.push(await safely('H3', runH3))
  if (want('H4')) scenarios.push(await safely('H4', runH4))
  if (want('H5')) scenarios.push(await safely('H5', runH5))
  if (want('H6')) scenarios.push(await safely('H6', runH6))
  if (want('R1')) scenarios.push(await safely('R1', async () => (r1 = await runR1(runId)).result))
  if (want('R2')) scenarios.push(await safely('R2', async () => (r2 = await runR2(runId)).result))
  for (const scenario of scenarios) console.log(`[eval] ${scenario.id} ${scenario.total}/10 ${scenario.status}${scenario.error ? ` ERROR ${scenario.error}` : ''}`)

  const find = (id: string) => scenarios.find((scenario) => scenario.id === id)

  // ─────────────── 6. Memory quality
  const bundledMemories = JSON.parse(readFileSync('data/demo_tokyo_v1/memories.json', 'utf8')) as Array<{ id: string; text: string; status: string; kind: Memory['kind']; subject: Memory['subject']; polarity: 1 | -1; strength: number; confidence: number; provenance: { type: string; sourceRefs: string[] } }>
  const evidenceIds = new Set((JSON.parse(readFileSync('data/demo_tokyo_v1/evidence.json', 'utf8')) as Array<{ id: string }>).map((entry) => entry.id))
  const turnRefs = ['turn:M1:setup', 'turn:M2:setup', 'turn:R2:setup']
  const knownRefs = new Set([...evidenceIds, ...turnRefs])
  const threeStopCategories = new Set(['museum_gallery', 'architecture_design', 'temple_shrine', 'exhibition_event', 'park_garden', 'viewpoint_scenic', 'sushi', 'ramen', 'soba_udon', 'teishoku', 'tempura_tonkatsu', 'cafe_kissaten', 'izakaya', 'yakiniku_grill'])
  const pace = pacePattern()
  const memoryScores = [
    ...bundledMemories.map((raw) => {
      const memory: Memory = {
        id: raw.id, text: raw.text, status: raw.status === 'active' ? 'active' : 'candidate', kind: raw.kind, subject: raw.subject,
        polarity: raw.polarity, strength: raw.strength, confidence: raw.confidence,
        provenance: { type: raw.provenance.type.startsWith('category_trend') ? 'saved_places' : raw.provenance.type.startsWith('photo') ? 'historical_behavior' : 'agent_inference', sourceRefs: raw.provenance.sourceRefs, createdAt: '' },
      }
      return judgeMemory({
        memory, knownRefs,
        usableAtPace: memory.subject.facet === 'category' ? threeStopCategories.has(String(memory.subject.value)) : true,
        ...(raw.id === pace.id ? { note: 'active in every H-scenario fixture (3 stops/day)' } : {}),
      })
    }),
    judgeMemory({ memory: m1Memory(), knownRefs, usableAtPace: true, note: 'bookstore half; a main stop can hold it at 3 stops/day since 2026-09-30' }),
    judgeMemory({ memory: m1AreaMemory(), knownRefs, usableAtPace: true, note: '"literary neighborhoods" half, as area_character' }),
    judgeMemory({ memory: { id: 'mem_eval_m2_quiet', text: 'Prefers quiet, less crowded places.', status: 'active', kind: 'aversion', subject: { facet: 'popularity', value: 'landmark' }, polarity: -1, strength: 0.8, confidence: 0.8, provenance: { type: 'explicit_statement', sourceRefs: ['turn:M2:setup'], createdAt: '' } }, knownRefs }),
    ...(((find('M3')?.observations.candidates as Memory[] | undefined) ?? []).length > 0
      ? ((find('M3')!.observations.candidates as Memory[]).map((memory) => judgeMemory({ memory, knownRefs: new Set([...knownRefs, ...memory.provenance.sourceRefs]), note: 'created from the M3 chat turn' })))
      : [judgeMemory({ memory: { id: '(none created)', text: 'M3: no candidate Memory', status: 'candidate', representable: false }, knownRefs, note: 'chat path created no candidate' })]),
  ]

  // ─────────────── 7-8. recommendation metrics, issues
  const issues: Issue[] = []
  const seen = new Set<string>()
  for (const scenario of scenarios) {
    for (const issue of issuesOf(scenario)) {
      if (seen.has(issue.id)) continue
      seen.add(issue.id)
      issues.push(issue)
    }
    if (scenario.error) issues.push({ id: `${scenario.id}.harness`, scenario: scenario.id, severity: 'P1', category: 'EVIDENCE_FAILURE', title: 'Scenario errored in the harness', evidence: scenario.error })
  }
  if (functional.failed > 0) issues.push({ id: 'functional.tests', scenario: '-', severity: 'P0', category: 'CONTROL_FAILURE', title: `${functional.failed} deterministic tests failed`, evidence: 'see vitest json' })
  const rank = { P0: 0, P1: 1, P2: 2 }
  issues.sort((a, b) => rank[a.severity] - rank[b.severity] || a.scenario.localeCompare(b.scenario))
  const counts = { P0: 0, P1: 0, P2: 0 }
  for (const issue of issues) counts[issue.severity]++
  const failureCategoryCounts: Record<string, number> = {}
  for (const issue of issues) failureCategoryCounts[issue.category] = (failureCategoryCounts[issue.category] ?? 0) + 1

  const passed = (id: string, checkId: string) => find(id)?.checks.find((entry) => entry.id === checkId)?.passed
  const inv = (checks: Array<[string, string]>, evidence: string): { status: 'PASS' | 'FAIL' | 'NOT_RUN'; evidence: string } => {
    const values = checks.map(([id, checkId]) => passed(id, checkId)).filter((value) => value !== undefined)
    return { status: values.length === 0 ? 'NOT_RUN' : values.every(Boolean) ? 'PASS' : 'FAIL', evidence }
  }
  const lockedOk = functional.byCategory['locked item tests'].failed === 0 && functional.byCategory['locked item tests'].passed > 0
  const invariants = {
    'State / Plan consistency': inv([['H1', 'receipt_confirm'], ['H3', 'atomic_versions'], ['H4', 'one_receipt'], ['H1', 'pending_no_mutation'], ['H2', 'pending_no_mutation']], 'versions + pending proposals never mutate active State/Plan'),
    'atomic Reframe': inv([['H3', 'atomic_versions'], ['H3', 'atomic'], ['H4', 'any_state_change_is_reframe'], ['H4', 'probe_preview']], 'H3 commit + failure injection; H4 invariant probe (State edit → single swap)'),
    'one Receipt per commit': inv([['H1', 'receipt_confirm'], ['H1', 'receipt_reject'], ['H2', 'receipt'], ['H3', 'atomic_versions'], ['H4', 'one_receipt']], 'receipt count after confirm = 1, after reject = 0'),
    'Memory snapshot immutability': inv([['M3', 'snapshot_immutable']], `deep-frozen snapshot; snapshot tests ${functional.byCategory['Memory snapshot tests'].passed} passed`),
    'constraint violation': inv([['H5', 'not_silently_dropped'], ['H5', 'tag_keeps_day'], ['R1', 'valid_plan'], ['R2', 'valid']], 'H5 day-bound must-visit; planner validation on R1/R2'),
    'locked item protection': { status: lockedOk ? 'PASS' as const : 'FAIL' as const, evidence: `deterministic locked-item tests: ${functional.byCategory['locked item tests'].passed} passed, ${functional.byCategory['locked item tests'].failed} failed (no Golden Scenario runs in-trip)` },
    'Candidate Registry enforcement': inv([['H1', 'registry'], ['R1', 'registry'], ['R2', 'registry']], 'hallucinated id refused; every planned id resolves'),
  }
  const invariantsPass = Object.values(invariants).every((entry) => entry.status !== 'FAIL')
  const constraintViolations = invariants['constraint violation'].status === 'FAIL' ? 1 : 0

  const m1 = find('M1')
  const recommendation = {
    candidateRecallProxy: r1?.metrics.candidateRecallProxy ?? null,
    top10MeanRelevance: r1?.metrics.top10MeanRelevance ?? null,
    finalMeanRelevanceR1: r1?.metrics.finalMeanRelevance ?? null,
    memoryInfluence: m1?.observations.memoryInfluence ?? null,
    constraintViolationRate: constraintViolations > 0 ? 'non-zero (H5)' : '0%',
    diversity: r2?.metrics ?? null,
    routeTimeFeasibility: r2 ? { invalidTemporalPlacements: r2.metrics.invalidTemporalPlacements, excessiveRouteJumps: r2.metrics.excessiveRouteJumps, plannerValidationFailures: r2.metrics.plannerValidationFailures } : null,
    audit: r1?.trace.audit ?? null,
    top10: r1?.result.observations.top10 ?? null,
  }

  // Status rules §24 / §32.
  let overallStatus: EvalReport['overallStatus']
  if (functional.failed > 0) overallStatus = 'BLOCKED_BY_FUNCTIONAL_FAILURE'
  else if (counts.P0 > 0 || !invariantsPass || constraintViolations > 0) overallStatus = 'FAIL'
  else if (counts.P1 > 0 || scenarios.some((scenario) => scenario.total < 7 || scenario.scores.correctness === 0)) overallStatus = 'PASS WITH RISKS'
  else overallStatus = 'PASS'

  const report: EvalReport = {
    suiteVersion: EVAL_SUITE_VERSION,
    mode: SMOKE ? 'smoke' : 'core',
    runId, build, commit,
    date: now.toISOString(),
    durationSeconds: Math.round((Date.now() - started) / 1000),
    overallStatus, counts, functional, invariants, scenarios,
    memory: { scores: memoryScores, influence: m1?.observations ?? null },
    recommendation, issues, failureCategoryCounts,
    traces: [r1?.traceDir, r2?.traceDir].filter((dir): dir is string => dir !== undefined),
    scenarioChanges: [
      'H6 added (2026-10-01): a Considering line added or removed updates the itinerary as a previewed, versioned change; unreadable lines are said to be so.',
      ...(process.env.EVAL_R1_CATALOGUE ? [`R1 scored on a LIVE discovery run: ${process.env.EVAL_R1_CATALOGUE} (live_discovery.ts, R1 brief, code wording, lodging + area searches). R2 still uses demo_retrieved_v1.`] : []),
      'R1 (2026-09-30): adds discovered_area_planned (a stop in a discovered area, not only in the pool) and every_day_anchored (no required role unfilled).',
      'R1 slow_pace (2026-09-30, user definition): "slow" is judged by moves (> 1 km hops) ≤ 1 and walkable areas ≤ 2 per day, no longer by stops per day ≤ 4.',
      'M1 (2026-09-30): the memory sentence is stored whole — category=bookstore plus area_character=literary — now that area_character exists.',
      'M2 (2026-09-30): the spec memory is stored as itself (aversion to popularity=landmark); the temple_shrine proxy is retired. memory_representable now checks memoryMatch < 0 on Senso-ji.',
      'M3 (2026-09-30): the harness saves chat memoryCandidates to the Profile as the app store does, then checks the repository.',
      'M1 claim_bound / scoped_change (2026-09-30, harness fix): counted against the no-memory plan (bookstores added; new places), not absolute totals or day reshuffles.',
      'M2 conflict_in_trace (2026-09-30, harness fix): regex widened to "usually … / would rather avoid"; it missed the product\'s actual wording.',
      'R1 category_plausible (2026-09-30, harness fix): a name naming two kinds ("Cafe & Bar") is not held against either category.',
      'R1 expansion (2026-09-30): an Intent term counts as carried when a search is worded with it, an area was chosen for it (servesWords), or the pace budget consumes it.',
      'R1 area_stage (2026-09-30): checks the trace names discovery areas; recall is still measured on the frozen pool, which predates area discovery.',
      'H2 (2026-09-30): rain is weather, not a cut-off. The spec sentence now expects "no change" when Day 3 has nothing outdoors after 15:00; a variant with rain during an outdoor stop exercises the re-plan (Replace or Reorganize by diff).',
      'H3 (2026-09-30): scope check accepts per-day declinable change units in place of asking; meals are never dropped.',
      'H5 resolution_options: was a placeholder always-fail; now checks the Conflict carries move_day + remove + edit options.',
      'M2: the spec Memory is not representable; a documented proxy (aversion: temple_shrine) is used for the State>Memory ranking checks.',
      'H4: adds an invariant probe (State edit "Day 2 dinner: ramen") alongside the Convenience edit.',
      'H5: test data sets Nezu Museum closed on Thursdays (Day 4 = 2026-10-08) in an eval-local catalogue copy.',
      'R1/R2: run on data/demo_retrieved_v1 (104 places retrieved around Kuramae) — no live Places calls.',
    ],
  }

  mkdirSync('eval_reports', { recursive: true })
  const base = join('eval_reports', `eval_${stamp}_${build}${SMOKE ? '_smoke' : ''}`)
  let path = base
  for (let n = 2; existsSync(`${path}.json`); n++) path = `${base}_${n}`
  const comparison = compareWithPrevious(report, path)
  writeFileSync(`${path}.json`, JSON.stringify({ ...report, comparison }, null, 2))
  writeFileSync(`${path}.md`, renderMarkdown(report, comparison))
  console.log(`[eval] ${overallStatus} — P0 ${counts.P0} · P1 ${counts.P1} · P2 ${counts.P2}`)
  console.log(`[eval] wrote ${path}.md / .json in ${report.durationSeconds}s`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
