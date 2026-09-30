/**
 * R1, R2 — Recommendation discovery, ranking, diversity, feasibility (eval spec §14, §15, §17).
 *
 * Runs on the 104 places live retrieval froze for the demo (data/demo_retrieved_v1),
 * i.e. what discovery actually returns around the Kuramae lodging. No live call is
 * made: the eval measures the pipeline the way a stubbed run uses it.
 */

import { allItems } from '../../src/domain/plan/types.ts'
import { measureMovement, SLOW_MAX_AREAS, SLOW_MAX_MOVES } from '../../src/domain/plan/movement.ts'
import { check, scoreScenario } from '../judges/scenario_judge.ts'
import { candidateRecall, judgePoi, LITERARY_SHOWA } from '../judges/recommendation_judge.ts'
import { buildTrip, catalogues, evalMemory, livePlaces } from '../lib/fixture.ts'
import { createPlaceCatalogue } from '../../src/services/places/catalogue.ts'
import { buildTrace, writeTrace, type Trace } from '../lib/trace.ts'
import type { Check, ScenarioResult } from '../schemas/scenario_result.ts'

export const R1_INTENT = [
  'Showa-era literary and cultural atmosphere',
  'slow neighborhood exploration',
  'old bookstores',
  'kissaten',
  'small independent cultural places',
]

export interface RecommendationRun {
  result: ScenarioResult
  trace: Trace
  traceDir: string
  metrics: Record<string, unknown>
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

export async function runR1(runId: string): Promise<RecommendationRun> {
  // EVAL_R1_CATALOGUE points R1 at a live discovery run instead of the frozen demo set.
  const live = process.env.EVAL_R1_CATALOGUE
  const catalogue = live ? createPlaceCatalogue(livePlaces(live)) : catalogues.retrieved()
  const trip = buildTrip({ catalogue, intent: R1_INTENT })
  const trace = buildTrace(runId, 'R1', trip)
  const traceDir = writeTrace(trace)

  const pool = catalogue.all().filter((place) => place.category !== 'accommodation')
  const recall = candidateRecall(pool, LITERARY_SHOWA)
  const top10 = trace.scoring.top10.map((entry) => ({ ...entry, judge: judgePoi(catalogue.get(entry.placeId)!, LITERARY_SHOWA) }))
  const top10Mean = mean(top10.map((entry) => entry.judge.score))
  const items = allItems(trip.plan)
  // Dinner and nightcap must be restaurants/bars by role; relevance is judged on activities and lunch.
  const finalJudged = items.filter((item) => item.role !== 'dinner' && item.role !== 'nightcap').map((item) => ({ item, judge: judgePoi(catalogue.get(item.placeId)!, LITERARY_SHOWA) }))
  const finalMean = mean(finalJudged.map((entry) => entry.judge.score))
  const strongBookstoresRanked = trace.scoring.top10.filter((entry) => entry.category === 'bookstore').length
  const expansion = trace.semantic_expansion as { stateTermsReachingAnyQuery: string[]; stateTermsLost: string[]; searches: Array<{ category: string; textQuery: string }> }
  const termsReach = expansion.stateTermsReachingAnyQuery.length / Math.max(1, expansion.stateTermsReachingAnyQuery.length + expansion.stateTermsLost.length)
  const bookstoreSearched = expansion.searches.some((search) => search.category === 'bookstore')
  const reasonsCiteIntent = items.filter((item) => (item.reasons ?? []).some((reason) => /you asked|showa|literary|bookstore|kissaten|independent|neighbo/i.test(reason.text)))
  const route = trace.route_time as { validation: { valid: boolean; errors: string[] }; days: Array<{ spanKm: number; maxHopKm: number }> }
  const unregistered = items.filter((item) => !catalogue.has(item.placeId))
  const bookstoreTerms = trace.input_signals as { stateTerms: string[] }

  // Category plausibility: a place whose own name says what it is, filed under another category.
  const NAME_SAYS: Array<[RegExp, string[]]> = [
    [/\b(soba|udon)\b/i, ['soba_udon']], [/\bramen\b/i, ['ramen']], [/\bsushi\b/i, ['sushi']],
    [/\b(coffee|cafe|café|kissa)\b/i, ['cafe_kissaten', 'bakery_sweets']], [/\b(books?|shob[oō])\b/i, ['bookstore']],
    [/\b(bar|pub)\b/i, ['bar_cocktail', 'izakaya']],
  ]
  // A name that names two kinds ("Cafe & Bar") decides nothing; only a single one is held against the category.
  const miscategorised = pool.filter((place) => {
    const said = NAME_SAYS.filter(([rule]) => rule.test(place.name))
    return said.length === 1 && !said[0][1].includes(place.category)
  })
  const miscategorisedPlanned = items.filter((item) => miscategorised.some((place) => place.placeId === item.placeId))

  const slowDays = trip.plan.days.map((day) => {
    const ordered = [...day.items].sort((a, b) => a.startTime.localeCompare(b.startTime))
    return { stops: ordered.length, ...measureMovement(ordered.map((item) => catalogue.get(item.placeId)!)) }
  })

  const checks: Check[] = [
    check('category_plausible', 'correctness', 'Planned stops are filed under a category their own name agrees with',
      miscategorisedPlanned.length === 0,
      { inPool: miscategorised.map((place) => `${place.name} → ${place.category}`), planned: miscategorisedPlanned.map((item) => `D${item.dayIndex + 1} ${item.role}: ${catalogue.get(item.placeId)?.name} [${catalogue.get(item.placeId)?.category}]`) },
      { weight: 'partial', onFail: { severity: 'P2', category: 'FILTER_FAILURE' } }),
    check('valid_plan', 'correctness', 'Final plan validates (hours, overlaps, anchors)', route.validation.valid, route.validation.errors, { onFail: { severity: 'P0', category: 'ROUTE_FAILURE' } }),
    check('registry', 'control', 'No POI outside the Candidate Registry', unregistered.length === 0, unregistered.map((item) => item.placeId), { onFail: { severity: 'P0', category: 'FILTER_FAILURE' } }),
    check('recall', 'relevance', 'Candidate recall proxy ≥ 1 (obvious types entered the pool)', recall.score >= 1, recall.reason, { onFail: { severity: 'P1', category: 'DISCOVERY_FAILURE' } }),
    check('recall_areas', 'relevance', 'Candidate recall proxy = 2 (literary areas such as Jimbocho / Shimokitazawa / Koenji reached)', recall.score === 2, recall.detail, { weight: 'partial', onFail: { severity: 'P1', category: 'DISCOVERY_FAILURE' } }),
    check('discovered_area_planned', 'relevance', 'The plan actually spends time in a discovered literary area (at least one stop there)',
      items.some((item) => LITERARY_SHOWA.expectedAreas.test(catalogue.get(item.placeId)!.neighborhood)),
      { plannedAreas: [...new Set(items.map((item) => catalogue.get(item.placeId)!.neighborhood))], discoveredInPool: recall.detail.expectedAreaHits },
      { weight: 'partial', onFail: { severity: 'P1', category: 'RANKING_FAILURE' } }),
    check('every_day_anchored', 'correctness', 'Every day has its main stop (no required role left unfilled)',
      (trace.route_time as { unfilled: unknown[] }).unfilled.length === 0, (trace.route_time as { unfilled: unknown[] }).unfilled,
      { weight: 'partial', onFail: { severity: 'P1', category: 'DISCOVERY_FAILURE' } }),
    check('top10', 'relevance', 'Top-10 mean relevance ≥ 1.2', top10Mean >= 1.2, { top10Mean: Number(top10Mean.toFixed(2)), bookstoresInTop10: strongBookstoresRanked }, { weight: 'partial', onFail: { severity: 'P1', category: 'RANKING_FAILURE' } }),
    check('final_relevance', 'relevance', 'Final non-meal POIs (activities + lunch) mean relevance ≥ 1.0', finalMean >= 1, { finalMean: Number(finalMean.toFixed(2)) }, { weight: 'partial', onFail: { severity: 'P1', category: 'RANKING_FAILURE' } }),
    check('term_match', 'relevance', 'Intent word "bookstores" matches bookstore places (stateMatch)', trace.scoring.top10.some((entry) => entry.category === 'bookstore' && (entry.components.stateMatch ?? 0) > 0.4) || allItems(trip.plan).some((item) => catalogue.get(item.placeId)?.category === 'bookstore'),
      { stateTerms: bookstoreTerms.stateTerms }, { weight: 'partial', onFail: { severity: 'P1', category: 'RANKING_FAILURE' } }),
    check('slow_pace', 'relevance', 'Intent "slow" keeps each day to ≤ 1 move (> 1 km hop) and ≤ 2 walkable areas — slow is movement, not stop count',
      slowDays.every((day) => day.moves <= SLOW_MAX_MOVES && day.areas <= SLOW_MAX_AREAS),
      { perDay: slowDays.map((day) => `${day.stops}st/${day.moves}mv/${day.areas}ar`) },
      { weight: 'partial', onFail: { severity: 'P1', category: 'ROUTE_FAILURE' } }),
    check('audit', 'explainability', '≥3 selected and ≥3 rejected POIs have a structured why-won / why-lost', trace.audit.selected.length >= 3 && trace.audit.rejected.length >= 3, trace.audit, { onFail: { severity: 'P1', category: 'EVIDENCE_FAILURE' } }),
    check('reasons_cite_intent', 'explainability', 'At least a third of stop reasons cite the Intent they served', reasonsCiteIntent.length >= items.length / 3,
      { citing: reasonsCiteIntent.length, of: items.length, sample: items.slice(0, 4).map((item) => item.reasons?.map((reason) => reason.text)) }, { weight: 'partial', onFail: { severity: 'P1', category: 'EVIDENCE_FAILURE' } }),
    check('expansion', 'efficiency', 'Semantic expansion carries ≥ 50% of Intent terms into discovery queries', termsReach >= 0.5,
      { reached: expansion.stateTermsReachingAnyQuery, lost: expansion.stateTermsLost }, { weight: 'partial', onFail: { severity: 'P1', category: 'DISCOVERY_FAILURE' } }),
    check('bookstore_searched', 'efficiency', 'Discovery searches the bookstore category when Intent names it', bookstoreSearched,
      expansion.searches.map((search) => search.category), { weight: 'partial', onFail: { severity: 'P1', category: 'DISCOVERY_FAILURE' } }),
    check('area_stage', 'efficiency', 'An area-candidate stage exists before POI retrieval and picks literary areas',
      (trace.area_candidates as { chosenAreas: string[] }).chosenAreas.length > 0, trace.area_candidates, { weight: 'partial', onFail: { severity: 'P1', category: 'DISCOVERY_FAILURE' } }),
  ]

  const result = scoreScenario({
    id: 'R1', title: 'Discovery/ranking', smoke: true, checks,
    observations: {
      traceDir,
      candidateRecall: recall,
      top10: top10.map((entry) => ({ rank: entry.rank, name: entry.name, category: entry.category, total: entry.total, stateMatch: entry.components.stateMatch, relevance: entry.judge.score })),
      top10Mean: Number(top10Mean.toFixed(2)),
      final: finalJudged.map(({ item, judge }) => `D${item.dayIndex + 1} ${item.role}: ${catalogue.get(item.placeId)?.name} [${catalogue.get(item.placeId)?.category}] rel=${judge.score}`),
      finalMean: Number(finalMean.toFixed(2)),
    },
  })
  return {
    result, trace, traceDir,
    metrics: {
      candidateRecallProxy: recall.score,
      top10MeanRelevance: Number(top10Mean.toFixed(2)),
      finalMeanRelevance: Number(finalMean.toFixed(2)),
      validation: route.validation,
    },
  }
}

export async function runR2(runId: string): Promise<RecommendationRun> {
  const catalogue = catalogues.retrieved()
  const memory = evalMemory({
    id: 'mem_eval_r2_bookstores',
    text: 'Seeks out independent and second-hand bookstores on most travel days.',
    kind: 'preference',
    subject: { facet: 'category', value: 'bookstore' },
    strength: 1,
    sourceRef: 'turn:R2:setup',
  })
  const trip = buildTrip({ catalogue, intent: R1_INTENT, memories: [memory] })
  const trace = buildTrace(runId, 'R2', trip)
  const traceDir = writeTrace(trace)

  const items = allItems(trip.plan)
  const categories = items.map((item) => catalogue.get(item.placeId)!.category)
  const counts: Record<string, number> = {}
  for (const category of categories) counts[category] = (counts[category] ?? 0) + 1
  const largest = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  const largestShare = largest[1] / items.length
  const repeatedCategory = Object.values(counts).filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0)
  const neighborhoods: Record<string, number> = {}
  for (const item of items) neighborhoods[catalogue.get(item.placeId)!.neighborhood] = (neighborhoods[catalogue.get(item.placeId)!.neighborhood] ?? 0) + 1
  const largestArea = Object.entries(neighborhoods).sort((a, b) => b[1] - a[1])[0]
  const sameDayRepeats = trip.plan.days.filter((day) => {
    const cats = day.items.map((item) => catalogue.get(item.placeId)!.category)
    return cats.some((category) => cats.filter((other) => other === category).length > 2)
  })
  const diversity = trace.diversity as { interventions: unknown[] }
  const route = trace.route_time as { validation: { valid: boolean; errors: string[] }; days: Array<{ spanKm: number; maxHopKm: number; pathKm: number }>; unfilled: unknown[] }
  const closedErrors = route.validation.errors.filter((error) => error.startsWith('poi_closed_at_time'))
  const maxSpan = Math.max(...route.days.map((day) => day.spanKm))
  const maxHop = Math.max(...route.days.map((day) => day.maxHopKm))
  const finalMean = mean(items.filter((item) => item.role !== 'dinner' && item.role !== 'nightcap').map((item) => judgePoi(catalogue.get(item.placeId)!, LITERARY_SHOWA).score))
  const bookstores = counts.bookstore ?? 0

  const checks: Check[] = [
    check('valid', 'correctness', 'Planner validation passes', route.validation.valid, route.validation.errors, { onFail: { severity: 'P0', category: 'ROUTE_FAILURE' } }),
    check('time_windows', 'correctness', 'No stop scheduled while closed', closedErrors.length === 0, closedErrors, { onFail: { severity: 'P0', category: 'ROUTE_FAILURE' } }),
    check('category_saturation', 'relevance', 'Largest category share ≤ 40%', largestShare <= 0.4, { largest: largest[0], share: Number(largestShare.toFixed(2)), counts }, { onFail: { severity: 'P1', category: 'DIVERSITY_FAILURE' } }),
    check('bookstore_cap', 'relevance', 'No 4th+ bookstore (marginal value falls)', bookstores <= 3, { bookstores }, { weight: 'partial', onFail: { severity: 'P1', category: 'DIVERSITY_FAILURE' } }),
    check('relevance_kept', 'relevance', 'Selection preserves semantic relevance (final mean ≥ 1.0)', finalMean >= 1, Number(finalMean.toFixed(2)), { weight: 'partial', onFail: { severity: 'P1', category: 'RANKING_FAILURE' } }),
    check('no_same_day_pattern', 'relevance', 'No day repeats a category more than twice', sameDayRepeats.length === 0, sameDayRepeats.map((day) => day.dayIndex + 1), { weight: 'partial', onFail: { severity: 'P1', category: 'DIVERSITY_FAILURE' } }),
    check('diversity_visible', 'explainability', 'Diversity rule is visible in the trace (an intervention or a stated rule)',
      diversity.interventions.length > 0, { interventions: diversity.interventions, note: 'repetition acts only through novelty; no explicit "diversity" reason is written on a stop' },
      { weight: 'partial', onFail: { severity: 'P2', category: 'EVIDENCE_FAILURE' } }),
    check('unfilled_reported', 'explainability', 'Roles the catalogue could not fill are reported, not hidden', Array.isArray(route.unfilled), route.unfilled, { weight: 'partial' }),
    check('route_reasonable', 'efficiency', 'Route cost reasonable: day span ≤ 8 km and no hop > 5 km', maxSpan <= 8 && maxHop <= 5, { maxSpan, maxHop }, { weight: 'partial', onFail: { severity: 'P1', category: 'ROUTE_FAILURE' } }),
    check('area_saturation', 'efficiency', 'Area saturation ≤ 60% of stops in one neighbourhood', largestArea[1] / items.length <= 0.6,
      { largest: largestArea[0], share: Number((largestArea[1] / items.length).toFixed(2)), neighborhoods }, { weight: 'partial', onFail: { severity: 'P2', category: 'DIVERSITY_FAILURE' } }),
    check('registry', 'control', 'No POI outside the Candidate Registry', items.every((item) => catalogue.has(item.placeId)), null, { onFail: { severity: 'P0', category: 'FILTER_FAILURE' } }),
  ]

  const result = scoreScenario({
    id: 'R2', title: 'Diversity/feasibility', smoke: false, checks,
    observations: {
      traceDir, counts, neighborhoods, bookstores, repeatedCategory, interventions: diversity.interventions,
      route: route.days, final: items.map((item) => `D${item.dayIndex + 1} ${item.role}: ${catalogue.get(item.placeId)?.name} [${catalogue.get(item.placeId)?.category}]`),
    },
  })
  return {
    result, trace, traceDir,
    metrics: {
      repeatedCategoryCount: repeatedCategory,
      largestCategoryShare: Number(largestShare.toFixed(2)),
      largestCategory: largest[0],
      repeatedAreaCount: Object.values(neighborhoods).filter((count) => count > 1).reduce((sum, count) => sum + count - 1, 0),
      diversityInterventions: diversity.interventions.length,
      invalidTemporalPlacements: closedErrors.length,
      excessiveRouteJumps: route.days.filter((day) => day.maxHopKm > 5).length,
      plannerValidationFailures: route.validation.errors.length,
      maxDaySpanKm: maxSpan,
    },
  }
}
