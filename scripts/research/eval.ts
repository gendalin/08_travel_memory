/**
 * research:eval — runs the full and baseline conditions over the same Tokyo
 * scenario and prints comparable numbers (Gate 7 Definition of Done).
 *
 * Research-only. Nothing in the product imports this, and it is reachable only
 * from the command line, never from product navigation (§15).
 *
 * Deterministic: the stub LLM and a fixed clock, so two runs of the same code
 * produce the same report and a change in the numbers means a change in
 * behaviour.
 *
 * Run: npm run research:eval
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { BundledMemory } from '../../src/application/manageMemory/manageMemory.ts'
import { allItems } from '../../src/domain/plan/types.ts'
import { createPlaceCatalogue } from '../../src/services/places/catalogue.ts'
import { createStubLlm } from '../../src/services/llm/stubLlm.ts'
import type { DemoPlace } from '../../src/services/places/types.ts'
import { runComparison, type ComparisonReport, type ConditionRun } from '../../src/research/runComparison.ts'
import { tokyoBrief, type DemoScenario } from '../../src/research/tokyoBrief.ts'

const OUT_DIR = resolve(process.cwd(), 'research-out')

/** Fixed so the report is reproducible; the pre-trip phase leaves nothing locked. */
const NOW = new Date('2026-09-21T09:00:00Z')

const places = JSON.parse(
  readFileSync('data/demo_tokyo_v1/tokyo_places.json', 'utf8'),
) as DemoPlace[]
const scenario = JSON.parse(
  readFileSync('data/demo_tokyo_v1/demo_scenario.json', 'utf8'),
) as DemoScenario
const bundledMemories = JSON.parse(
  readFileSync('data/demo_tokyo_v1/memories.json', 'utf8'),
) as BundledMemory[]

const catalogue = createPlaceCatalogue(places)
const lodging = places.find((place) => place.category === 'accommodation')
if (!lodging) throw new Error('the catalogue has no accommodation to base the trip at')

const brief = tokyoBrief(scenario, lodging.placeId, bundledMemories)

/** Right-aligned column, or "—" where a metric has no backing data. */
function cell(value: number | boolean | null, width = 9): string {
  const text =
    value === null ? '—' : typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value)
  return text.padStart(width)
}

function row(label: string, full: number | boolean | null, baseline: number | boolean | null): void {
  console.log(`  ${label.padEnd(42)}${cell(full)}${cell(baseline)}`)
}

function section(title: string): void {
  console.log(`\n  ${title}\n  ${'-'.repeat(42 + 18)}`)
}

function changeTable(run: ConditionRun): void {
  for (const change of run.changes) {
    const verdict = change.reportedConflict
      ? 'reported as a conflict, plan untouched'
      : `${change.itemsAffected} item(s) changed` +
        `${change.confirmed ? ', after confirmation' : ', with no confirmation'}` +
        `${change.stopsDropped > 0 ? `, ${change.stopsDropped} stop(s) dropped` : ''}` +
        `${change.mustVisitsLost > 0 ? `, ${change.mustVisitsLost} must-visit LOST` : ''}`
    console.log(`    "${change.request}"`)
    console.log(`        ${change.operation} -> ${verdict}`)
  }
}

function print(report: ComparisonReport): void {
  console.log('\nResearch evaluation — full vs baseline, one Tokyo scenario\n')
  console.log(`  brief        : ${report.brief.name}, ${report.brief.startDate} to ${report.brief.endDate}`)
  console.log(`  intent       : ${report.brief.intentText}`)
  console.log(`  considering  : ${report.brief.consideringText}`)
  console.log(`  memories on  : ${report.brief.activeMemoryIds.join(', ') || '(none)'}`)

  console.log('\n  Baseline removes:')
  for (const removed of report.baseline.condition.removes) console.log(`    - ${removed}`)
  console.log('  Both conditions keep:')
  for (const kept of report.baseline.condition.keeps) console.log(`    - ${kept}`)

  console.log(`\n  Read from the brief by the product's own tagger, once, for both:`)
  console.log(`    must-visit : ${report.constraints.mustVisitPlaceIds.join(', ') || '(none)'}`)
  console.log(`    budget     : ${report.constraints.budgetLevel ?? '(none)'}`)
  console.log(`    avoid      : ${report.constraints.avoid.join(', ') || '(none)'}`)

  console.log(`\n  ${''.padEnd(42)}${'full'.padStart(9)}${'baseline'.padStart(9)}`)

  const f = report.full.firstPlanMetrics
  const b = report.baseline.firstPlanMetrics

  section('First itinerary')
  row('stops', f.stops, b.stops)
  row('distinct categories', f.distinctCategories, b.distinctCategories)
  row('straight-line distance walked (m)', f.walkingDistanceM, b.walkingDistanceM)

  section('Memory -> recommendation -> rationale (§20)')
  row('stops in a remembered category', f.memoryAlignedStops, b.memoryAlignedStops)
  row('stops citing the memory behind them', f.memoryCitedStops, b.memoryCitedStops)
  row('stops with traceable provenance', f.traceableStops, b.traceableStops)
  // A pattern memory shapes the day rather than picking a stop; null means the
  // trip's Memory carries no measurement of it.
  row('pattern says stops/day', f.patternStopsPerDay, b.patternStopsPerDay)
  row('pattern says day span (m)', f.patternDaySpanMetres, b.patternDaySpanMetres)
  console.log(`  ${'actual stops per day'.padEnd(42)}${JSON.stringify(f.stopsPerDay).padStart(9)}${JSON.stringify(b.stopsPerDay).padStart(9)}`)

  section('Did the itinerary honour the brief?')
  row('must-visits requested', f.mustVisitsRequested, b.mustVisitsRequested)
  row('must-visits honoured', f.mustVisitsHonoured, b.mustVisitsHonoured)
  row('stops over the stated budget', f.overBudgetStops, b.overBudgetStops)
  row('stops matching "avoid"', f.avoidedStops, b.avoidedStops)
  // Not about what §15.2 removes: both conditions must be zero.
  row('stops scheduled while shut', f.closedStops, b.closedStops)

  const byCause = (run: ConditionRun, cause: string) =>
    run.tensions.filter((tension) => tension.because === cause).length
  // Over budget AND surfaced, split by what put it there. Baseline has no State,
  // so it has nothing stated to sit against — that is the finding, not a gap.
  row('  ...because a memory claimed it', byCause(report.full, 'memory_claim'), byCause(report.baseline, 'memory_claim'))
  row('  ...because nothing else was open', byCause(report.full, 'only_option'), byCause(report.baseline, 'only_option'))
  row('  ...because ranking preferred it', byCause(report.full, 'ranking_chose'), byCause(report.baseline, 'ranking_chose'))

  section('Handling the scripted requests (§20, theme 2)')
  row('requests handled', report.full.changes.length, report.baseline.changes.length)
  row('items changed, all requests', report.full.totals.itemsAffected, report.baseline.totals.itemsAffected)
  row('changes with no confirmation', report.full.totals.mutationsWithoutConfirmation, report.baseline.totals.mutationsWithoutConfirmation)
  row('every change previewed first', report.full.totals.everyChangePreviewed, report.baseline.totals.everyChangePreviewed)
  row('receipts left behind', report.full.totals.receipts, report.baseline.totals.receipts)
  row('stops that left the itinerary', report.full.totals.stopsDropped, report.baseline.totals.stopsDropped)
  // Baseline can only "lose" a must-visit it had; read this with the
  // must-visits-honoured row above, not on its own.
  row('must-visits lost to a change', report.full.totals.mustVisitsLost, report.baseline.totals.mustVisitsLost)

  section('Final itinerary, after every request')
  row('stops', report.full.finalPlanMetrics.stops, report.baseline.finalPlanMetrics.stops)
  row('must-visits still honoured', report.full.finalPlanMetrics.mustVisitsHonoured, report.baseline.finalPlanMetrics.mustVisitsHonoured)
  row('stops over the stated budget', report.full.finalPlanMetrics.overBudgetStops, report.baseline.finalPlanMetrics.overBudgetStops)

  console.log('\n  Request by request — full condition:')
  changeTable(report.full)
  console.log('\n  Request by request — baseline condition:')
  changeTable(report.baseline)

  console.log(`\n  ${report.events.length} events logged.`)
}

const report = await runComparison({
  brief,
  catalogue,
  bundledMemories,
  llm: createStubLlm(),
  now: NOW,
})

print(report)

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(resolve(OUT_DIR, 'comparison.json'), JSON.stringify(report, null, 2), 'utf8')
writeFileSync(
  resolve(OUT_DIR, 'events.jsonl'),
  report.events.map((event) => JSON.stringify(event)).join('\n'),
  'utf8',
)
writeFileSync(
  resolve(OUT_DIR, 'itineraries.txt'),
  [report.full, report.baseline]
    .map((run) =>
      [
        `${run.condition.label} — final itinerary`,
        ...run.finalPlan.days.map(
          (day) =>
            `  Day ${day.dayIndex + 1}: ` +
            day.items
              .map((item) => `${item.startTime} ${catalogue.get(item.placeId)?.name ?? item.placeId}`)
              .join(' | '),
        ),
        `  ${allItems(run.finalPlan).length} stops`,
      ].join('\n'),
    )
    .join('\n\n'),
  'utf8',
)

console.log(`  Exported to research-out/ (comparison.json, events.jsonl, itineraries.txt)\n`)
