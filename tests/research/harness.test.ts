/**
 * The research harness (product_spec §15, Gate 7).
 *
 * Two kinds of claim are worth holding here:
 *
 *   - the harness does not pollute the product — a structural rule, checkable
 *   - the baseline is a fair comparison rather than a straw man, and the
 *     yardstick both conditions are measured with is neutral
 *
 * If the second one slips, every number the harness prints becomes an argument
 * for whatever the harness was built to prove, which is worse than no harness.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { tripDays, toFrame } from '../../src/application/createTrip/createTrip.ts'
import { allItems, type Plan } from '../../src/domain/plan/types.ts'
import { DAY_ROLES } from '../../src/domain/plan/dayRoles.ts'
import { readConstraints, consideringClauses } from '../../src/research/brief.ts'
import { BASELINE, FULL } from '../../src/research/conditions.ts'
import { createResearchLog } from '../../src/research/eventLog.ts'
import { generateBaselinePlan, BASELINE_STATE } from '../../src/research/baselinePlan.ts'
import { phraseForPlan } from '../../src/research/requests.ts'
import { runComparison } from '../../src/research/runComparison.ts'
import { tokyoBrief, type DemoScenario } from '../../src/research/tokyoBrief.ts'
import type { BundledMemory } from '../../src/application/manageMemory/manageMemory.ts'
import { createPlaceCatalogue } from '../../src/services/places/catalogue.ts'
import { createStubLlm } from '../../src/services/llm/stubLlm.ts'
import type { DemoPlace } from '../../src/services/places/types.ts'

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
const lodging = places.find((place) => place.category === 'accommodation')!
const brief = tokyoBrief(scenario, lodging.placeId, bundledMemories)
const NOW = new Date('2026-09-21T09:00:00Z')

const report = await runComparison({
  brief,
  catalogue,
  bundledMemories,
  llm: createStubLlm(),
  now: NOW,
})

// --- the structural rule -----------------------------------------------------

describe('research does not pollute the product (Gate 7)', () => {
  /** Every .ts/.tsx file under a directory, recursively. */
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) return sourceFiles(path)
      return /\.tsx?$/.test(entry) ? [path] : []
    })
  }

  const PRODUCT_DIRS = [
    'src/app',
    'src/ui',
    'src/application',
    'src/domain',
    'src/services',
    'server',
  ]

  it('is never imported by product code', () => {
    const offenders = PRODUCT_DIRS.flatMap(sourceFiles).filter((path) =>
      /from\s+['"][^'"]*research/.test(readFileSync(path, 'utf8')),
    )
    expect(offenders).toEqual([])
  })

  it('keeps baseline out of the shipped entry point, so no user can select it', () => {
    expect(readFileSync('src/main.tsx', 'utf8')).not.toMatch(/baseline/i)
  })
})

// --- the baseline is a fair comparison ---------------------------------------

describe('the baseline is not a straw man (§15.2 "Keep")', () => {
  const baselinePlan = generateBaselinePlan({
    frame: toFrame({
      name: brief.name,
      startDate: brief.startDate,
      endDate: brief.endDate,
      baseLodgingPlaceId: brief.baseLodgingPlaceId,
      baseLodgingName: brief.baseLodgingName,
      intentText: brief.intentText,
      consideringText: brief.consideringText,
    }),
    catalogue,
    days: tripDays(brief.startDate, brief.endDate),
    now: NOW,
  })

  it('passes the same validation the product plan does', () => {
    expect(baselinePlan.validation.valid).toBe(true)
  })

  it('only ever schedules real places from the same catalogue', () => {
    for (const item of allItems(baselinePlan.plan)) {
      expect(catalogue.has(item.placeId)).toBe(true)
    }
  })

  it('lays a day out with the same roles, at the same times', () => {
    const roleStarts = DAY_ROLES.map((role) => role.window.from)
    const starts = [...new Set(allItems(baselinePlan.plan).map((item) => item.startTime))]
    expect(starts.length).toBeGreaterThan(0)
    for (const start of starts) expect(roleStarts).toContain(start)
  })

  /**
   * Baseline is never the SHORTER itinerary — that would make every comparison a
   * comparison of length. It is now the fuller one, and by design: §15.2 removes
   * Memory, which removes the pace pattern, and with nothing measured about the
   * traveller there is no reason to plan a short day. The full condition plans three
   * stops because the evidence says three.
   */
  it('is never the shorter itinerary of the two', () => {
    expect(report.baseline.firstPlanMetrics.stops).toBeGreaterThanOrEqual(
      report.full.firstPlanMetrics.stops,
    )
  })

  it('plans a full day precisely because it has no pace to go on', () => {
    expect(report.baseline.firstPlanMetrics.patternStopsPerDay).toBeNull()
    expect(report.full.firstPlanMetrics.patternStopsPerDay).toBe(3)

    const busiest = (stops: number[]) => Math.max(...stops)
    expect(busiest(report.baseline.firstPlanMetrics.stopsPerDay)).toBeGreaterThan(
      busiest(report.full.firstPlanMetrics.stopsPerDay),
    )
  })

  it('understands the scripted requests as well as the full condition does', () => {
    // Same router, so a request either resolves for both or for neither. The
    // comparison must not come down to one side misreading the traveller.
    expect(report.baseline.changes).toHaveLength(report.full.changes.length)
  })
})

describe('what the baseline genuinely lacks (§15.2 "removes")', () => {
  it('has no State to hold a constraint in', () => {
    expect(BASELINE_STATE.considering).toEqual([])
    expect(BASELINE_STATE.priorities).toEqual([])
  })

  it('carries no rationale and no provenance on any stop', () => {
    for (const item of allItems(report.baseline.firstPlan)) {
      expect(item.rationale).toBeUndefined()
      expect(item.rationaleRefs).toBeUndefined()
    }
    expect(report.baseline.firstPlanMetrics.traceableStops).toBe(0)
  })

  it('writes no receipt and confirms nothing', () => {
    expect(report.baseline.totals.receipts).toBe(0)
    expect(report.baseline.totals.everyChangePreviewed).toBe(false)
  })

  it('records every applied change as unconfirmed', () => {
    const applied = report.baseline.changes.filter((change) => !change.reportedConflict)
    expect(applied.length).toBeGreaterThan(0)
    expect(report.baseline.totals.mutationsWithoutConfirmation).toBe(applied.length)
  })
})

// --- the yardstick ------------------------------------------------------------

describe('the yardstick is read from the brief, not from either condition', () => {
  it('reads the constraints the traveller stated', () => {
    const constraints = readConstraints(brief, catalogue)
    expect(constraints.budgetLevel).toBe('moderate')
    expect(constraints.mustVisitPlaceIds).toHaveLength(1)
    expect(constraints.avoid).not.toEqual([])
  })

  it('does not depend on the full condition having built a State', () => {
    // Same function, same brief, no trip anywhere in sight.
    expect(readConstraints(brief, catalogue)).toEqual(report.constraints)
  })

  it('drops a must-visit the catalogue cannot satisfy, rather than scoring it as a miss', () => {
    const impossible = { ...brief, consideringText: 'We must visit teamLab Planets.' }
    expect(readConstraints(impossible, catalogue).mustVisitPlaceIds).toEqual([])
  })

  it('splits Considering the way the product decomposition would', () => {
    expect(consideringClauses('Moderate budget. We must visit X. Avoid queues.')).toEqual([
      'Moderate budget',
      'We must visit X',
      'Avoid queues',
    ])
  })
})

// --- the report ---------------------------------------------------------------

describe('opening hours are honoured by both conditions (A1)', () => {
  /**
   * Regression. Before the validator compared a stop's time to the place's hours,
   * this measured three of fifteen in EACH condition while both plans reported
   * valid — a ramen counter hours after it shut, an izakaya before it opened, a
   * market as it packed up. Opening hours are a fact about the world, not part of
   * the State model the baseline gives up, so zero is the only acceptable value
   * on either side.
   */
  it('schedules nothing while a place is shut, in either condition', () => {
    expect(report.full.firstPlanMetrics.closedStops).toBe(0)
    expect(report.baseline.firstPlanMetrics.closedStops).toBe(0)
  })

  it('still holds after every scripted request has been handled', () => {
    expect(report.full.finalPlanMetrics.closedStops).toBe(0)
    expect(report.baseline.finalPlanMetrics.closedStops).toBe(0)
  })
})

describe('the comparison report', () => {
  it('names what separates the conditions, so a reader need not infer it', () => {
    expect(FULL.removes).toEqual([])
    expect(BASELINE.removes.length).toBeGreaterThan(0)
    expect(BASELINE.keeps).toEqual(FULL.keeps.slice(0, BASELINE.keeps.length))
  })

  it('traces the full condition back to the memory the participant confirmed', () => {
    expect(report.full.memorySnapshot?.memories.map((memory) => memory.id)).toEqual([
      ...brief.activeMemoryIds,
    ])
    expect(report.full.firstPlanMetrics.memoryCitedStops).toBeGreaterThan(0)
  })

  it('is reproducible, so a change in the numbers is a change in behaviour', async () => {
    const again = await runComparison({
      brief,
      catalogue,
      bundledMemories,
      llm: createStubLlm(),
      now: NOW,
    })
    expect(JSON.stringify(again)).toBe(JSON.stringify(report))
  })

  it('logs both conditions against one clock', () => {
    expect(report.events.map((event) => event.at)).toEqual(
      report.events.map(() => NOW.toISOString()),
    )
    expect(new Set(report.events.map((event) => event.condition))).toEqual(
      new Set(['full', 'baseline']),
    )
  })
})

describe('the event log exports', () => {
  it('numbers events monotonically and round-trips as JSON', () => {
    const log = createResearchLog(() => NOW)
    log.append('full', 'trip_created')
    log.append('baseline', 'plan_generated', { stops: 15 })

    expect(log.entries().map((event) => event.seq)).toEqual([1, 2])
    expect(JSON.parse(log.toJson())).toHaveLength(2)
    expect(log.toJsonl().split('\n')).toHaveLength(2)
    expect(log.countOf('baseline', 'plan_generated')).toBe(1)
  })
})

describe('phrasing a scripted request against the plan under test', () => {
  const emptyDay = (dayIndex: number) => ({
    dayIndex,
    startsAt: { placeId: lodging.placeId, name: lodging.name },
    endsAt: { placeId: lodging.placeId, name: lodging.name },
    items: [],
  })

  it('leaves a request the scenario bound to no place completely alone', () => {
    const request = { text: "It's going to rain after 3pm on Day 3." }
    expect(phraseForPlan(request, report.full.firstPlan, catalogue)).toEqual({
      text: request.text,
    })
  })

  it('points the day reference at where that kind of stop actually is', () => {
    const ramen = allItems(report.full.firstPlan).find(
      (item) => catalogue.get(item.placeId)?.category === 'ramen',
    )!
    const phrased = phraseForPlan(
      { text: 'The ramen place on Day 2 is closed today.', placeId: 'ramen_rokurinsha' },
      report.full.firstPlan,
      catalogue,
    )

    expect(phrased.text).toContain(`Day ${ramen.dayIndex + 1}`)
  })

  /** Nothing to reconcile when the scenario already names the right day. */
  it('leaves the text alone when it already points at the right day', () => {
    const ramen = allItems(report.full.firstPlan).find(
      (item) => catalogue.get(item.placeId)?.category === 'ramen',
    )!
    const alreadyRight = `The ramen place on Day ${ramen.dayIndex + 1} is closed today.`

    expect(
      phraseForPlan({ text: alreadyRight, placeId: 'ramen_rokurinsha' }, report.full.firstPlan, catalogue),
    ).toEqual({ text: alreadyRight })
  })

  it('records the original wording when it did have to move the day', () => {
    const ramen = allItems(report.full.firstPlan).find(
      (item) => catalogue.get(item.placeId)?.category === 'ramen',
    )!
    // A day the ramen is definitely not on.
    const wrongDay = ramen.dayIndex === 0 ? 5 : 1
    const original = `The ramen place on Day ${wrongDay} is closed today.`

    const phrased = phraseForPlan(
      { text: original, placeId: 'ramen_rokurinsha' },
      report.full.firstPlan,
      catalogue,
    )
    expect(phrased.text).toContain(`Day ${ramen.dayIndex + 1}`)
    expect(phrased.rephrasedFrom).toBe(original)
  })

  /**
   * The line this rule must not cross. A harness that keeps rewording a request
   * until some condition can act on it is measuring its own persistence.
   */
  it('leaves the text verbatim when the plan has no such stop, rather than finding one that works', () => {
    const noRamen: Plan = { version: 1, days: [emptyDay(0), emptyDay(1)] }
    const request = { text: 'The ramen place on Day 2 is closed today.', placeId: 'ramen_rokurinsha' }

    expect(phraseForPlan(request, noRamen, catalogue)).toEqual({ text: request.text })
  })

  it('changes nothing but the day, so the request still asks what it asked', () => {
    const phrased = phraseForPlan(
      { text: 'The ramen place on Day 2 is closed today.', placeId: 'ramen_rokurinsha' },
      report.full.firstPlan,
      catalogue,
    )
    expect(phrased.text.replace(/Day \d+/, 'Day N')).toBe(
      'The ramen place on Day N is closed today.',
    )
  })

  it('exports every rewrite, so a reader sees what each condition was asked', () => {
    const rewritten = report.events.filter(
      (event) => event.type === 'message_sent' && event.detail?.rephrasedFrom !== undefined,
    )
    expect(rewritten.length).toBeGreaterThan(0)
    for (const event of rewritten) {
      expect(typeof event.detail?.request).toBe('string')
    }
  })

  /** Regression: the closed-restaurant request used to be unresolvable in the
   * full condition, because a hardcoded "Day 2" pointed at a day its planner had
   * put no ramen on. Both conditions must be able to act on every request. */
  it('leaves both conditions able to act on all three scripted requests', () => {
    for (const run of [report.full, report.baseline]) {
      expect(run.changes.filter((change) => change.reportedConflict)).toEqual([])
    }
  })
})
