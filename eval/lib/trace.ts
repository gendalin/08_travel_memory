/**
 * Recommendation trace (eval spec §14, §18).
 *
 * The product records per-stop reasons, rationaleRefs and a five-entry slate, but
 * no single trace of a generation. This rebuilds one from the product's own pure
 * functions — the same ranking context, the same scorer, the same retrieval profile
 * — so every number in it is one the planner would compute, not an eval estimate.
 *
 * Stages follow §14: input signals → semantic expansion → area candidates → POI
 * candidates → hard filters → scoring → diversity → route/time → final POIs.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildRankingContext, priorityWeights, rankCandidates, stateTerms } from '../../src/application/planning/rankCandidates.ts'
import { buildRetrievalProfile } from '../../src/application/planning/retrievalProfile.ts'
import { areaQueries, resolveQueryPlan } from '../../src/application/planning/queryPlan.ts'
import { movementBudgetOf } from '../../src/application/planning/movementBudget.ts'
import { traitPreferences } from '../../src/domain/memory/preferences.ts'
import type { AreaCharacter } from '../../src/domain/places/areas.ts'
import { categoryPreferences, planShape } from '../../src/domain/memory/preferences.ts'
import { categoriesFor, rolesForPace, DEFAULT_STOPS_PER_DAY } from '../../src/domain/plan/dayRoles.ts'
import { allItems, type Plan } from '../../src/domain/plan/types.ts'
import { kmBetween } from '../../src/domain/places/geo.ts'
import { isOpenFor, weekdayKey } from '../../src/domain/places/openingHours.ts'
import { contributions, type ScoredPlace } from '../../src/domain/ranking/score.ts'
import { dateOfDay } from '../../src/domain/trip/phase.ts'
import { validatePlan } from '../../src/domain/validation/validate.ts'
import { toValidationPlaces } from '../../src/services/places/catalogue.ts'
import type { DemoPlace } from '../../src/services/places/types.ts'
import type { EvalTrip } from './fixture.ts'

export interface RankedEntry {
  rank: number
  placeId: string
  name: string
  category: string
  neighborhood: string
  total: number
  components: Record<string, number | null>
  contributions: Record<string, number>
  memoryId?: string
}

function round(value: number | null | undefined, places = 3): number | null {
  return value === null || value === undefined ? null : Number(value.toFixed(places))
}

export function toEntry(scored: ScoredPlace<DemoPlace>, rank: number, trip: EvalTrip): RankedEntry {
  const weights = priorityWeights(trip.state)
  const stated = trip.state.considering.some((item) => item.tag?.kind === 'budget')
  return {
    rank,
    placeId: scored.place.placeId,
    name: scored.place.name,
    category: scored.place.category,
    neighborhood: scored.place.neighborhood,
    total: round(scored.total)!,
    components: Object.fromEntries(
      Object.entries(scored.components).map(([key, value]) => [key, round(value)]),
    ),
    contributions: Object.fromEntries(
      contributions(scored.components, weights, stated).map(([key, value]) => [key, round(value)!]),
    ),
    ...(scored.memoryId ? { memoryId: scored.memoryId } : {}),
  }
}

/**
 * Every non-lodging place ranked in one neutral context: Day 1, leaving the lodging,
 * nothing used yet. "Top 10 POIs" in §17.2 needs one ordering over the whole pool,
 * and this is the one the first slot of the trip sees.
 */
export function neutralRanking(trip: EvalTrip): Array<ScoredPlace<DemoPlace>> {
  const lodging = trip.frame.baseLodging.placeId
  const context = buildRankingContext({
    state: trip.state,
    memorySnapshot: trip.trip.memorySnapshot,
    catalogue: trip.catalogue,
    geography: { anchorPlaceId: lodging, dayPlaceIds: [lodging], usedPlaceIds: [] },
    weekday: weekdayKey(dateOfDay(trip.frame, 0)),
  })
  const pool = trip.catalogue.all().filter((place) => place.category !== 'accommodation')
  return rankCandidates(pool, context)
}

/** Which roles, at this trip's pace, a category could ever fill. */
export function rolesAdmitting(trip: EvalTrip, category: string): string[] {
  const pace = planShape(trip.trip.memorySnapshot).stopsPerDay?.value ?? DEFAULT_STOPS_PER_DAY
  return rolesForPace(pace)
    .filter((role) => categoriesFor(role).includes(category))
    .map((role) => role.id)
}

export interface DayRoute {
  dayIndex: number
  stops: number
  spanKm: number
  maxHopKm: number
  pathKm: number
  categories: string[]
  neighborhoods: string[]
}

export function routeOf(trip: EvalTrip, plan: Plan = trip.plan): DayRoute[] {
  const lodging = trip.catalogue.get(trip.frame.baseLodging.placeId)!
  return plan.days.map((day) => {
    const stops = [...day.items].sort((a, b) => a.startTime.localeCompare(b.startTime))
    const points = [lodging, ...stops.map((item) => trip.catalogue.get(item.placeId)!), lodging]
    let pathKm = 0
    let maxHopKm = 0
    for (let i = 1; i < points.length; i++) {
      const hop = kmBetween(points[i - 1], points[i])
      pathKm += hop
      maxHopKm = Math.max(maxHopKm, hop)
    }
    let spanKm = 0
    for (const a of points) for (const b of points) spanKm = Math.max(spanKm, kmBetween(a, b))
    return {
      dayIndex: day.dayIndex,
      stops: stops.length,
      spanKm: round(spanKm, 2)!,
      maxHopKm: round(maxHopKm, 2)!,
      pathKm: round(pathKm, 2)!,
      categories: stops.map((item) => trip.catalogue.get(item.placeId)!.category),
      neighborhoods: stops.map((item) => trip.catalogue.get(item.placeId)!.neighborhood),
    }
  })
}

/**
 * Diversity interventions: slots where the repetition half of novelty changed the
 * winner. Re-ranks the slot's own slate + winner with the plan's used categories
 * cleared; if a different place would have won, the diversity rule intervened.
 */
export function diversityInterventions(trip: EvalTrip): Array<{ itemId: string; winner: string; withoutRule: string }> {
  const found: Array<{ itemId: string; winner: string; withoutRule: string }> = []
  const items = allItems(trip.plan)
  for (const item of items) {
    if (!item.slate || item.slate.length === 0) continue
    const pool = [item.placeId, ...item.slate.map((entry) => entry.placeId)]
      .map((placeId) => trip.catalogue.get(placeId))
      .filter((place): place is DemoPlace => place !== undefined)
    const dayItems = items.filter((other) => other.dayIndex === item.dayIndex && other.startTime < item.startTime)
    const context = buildRankingContext({
      state: trip.state,
      memorySnapshot: trip.trip.memorySnapshot,
      catalogue: trip.catalogue,
      geography: {
        anchorPlaceId: dayItems.at(-1)?.placeId ?? trip.frame.baseLodging.placeId,
        dayPlaceIds: [trip.frame.baseLodging.placeId, ...dayItems.map((other) => other.placeId)],
        usedPlaceIds: [],
      },
      weekday: weekdayKey(dateOfDay(trip.frame, item.dayIndex)),
    })
    const top = rankCandidates(pool, context)[0]
    if (top && top.place.placeId !== item.placeId && item.placedBy !== 'must_visit') {
      found.push({ itemId: item.id, winner: trip.catalogue.get(item.placeId)?.name ?? item.placeId, withoutRule: top.place.name })
    }
  }
  return found
}

export interface Trace {
  runId: string
  scenario: string
  input_signals: unknown
  semantic_expansion: unknown
  area_candidates: unknown
  poi_candidates: unknown
  hard_filters: unknown
  scoring: { top10: RankedEntry[] }
  diversity: unknown
  route_time: unknown
  final_pois: unknown
  audit: { selected: unknown[]; rejected: unknown[] }
}

export function buildTrace(runId: string, scenario: string, trip: EvalTrip): Trace {
  const snapshot = trip.trip.memorySnapshot
  const weekday0 = weekdayKey(dateOfDay(trip.frame, 0))
  const pace = planShape(snapshot).stopsPerDay?.value ?? DEFAULT_STOPS_PER_DAY
  const roles = rolesForPace(pace)

  const profile = buildRetrievalProfile({ days: 5, snapshot, state: trip.state })
  const ownWords = [...trip.state.intent, ...trip.state.considering].map((item) => item.text).join(' ')
  const lodgingPlace = trip.catalogue.get(trip.frame.baseLodging.placeId)!
  const areaSearches = areaQueries({
    ownWords,
    remembered: traitPreferences(snapshot).filter((trait) => trait.trait === 'area_character' && trait.weight > 0).map((trait) => trait.value as AreaCharacter),
    lodging: lodgingPlace,
    ...(profile.radiusMetres === undefined ? {} : { radiusMetres: profile.radiusMetres }),
  })
  const queries = [...resolveQueryPlan({ profile, destination: 'Tokyo', baseLodgingName: 'Kuramae', ownWords }), ...areaSearches]
  const terms = stateTerms(trip.state)
  const served = queries.flatMap((query) => query.servesWords ?? []).join(' ').toLowerCase()
  const paceSource = movementBudgetOf(trip.state)?.source.text.toLowerCase() ?? ''
  const carried = (term: string) =>
    queryText.includes(term) || served.includes(term) || (paceSource.includes(term) && /^slow/.test(term))
  const queryText = queries.map((query) => query.textQuery.toLowerCase()).join(' | ')

  const pool = trip.catalogue.all().filter((place) => place.category !== 'accommodation')
  const byCategory: Record<string, number> = {}
  const byNeighborhood: Record<string, number> = {}
  for (const place of pool) {
    byCategory[place.category] = (byCategory[place.category] ?? 0) + 1
    byNeighborhood[place.neighborhood] = (byNeighborhood[place.neighborhood] ?? 0) + 1
  }

  // Hard filters as the first day's roles see them: category gate, then opening hours.
  const filters = roles.map((role) => {
    const eligible = pool.filter((place) => categoriesFor(role).includes(place.category))
    const closed = eligible.filter(
      (place) => !isOpenFor(place.openingHours, weekday0, role.window.from, addMinutes(role.window.from, 30)),
    )
    return {
      role: role.id,
      categoryGate: `${eligible.length}/${pool.length} pass`,
      closedAtRoleStart: closed.length,
      closedSample: closed.slice(0, 3).map((place) => place.name),
    }
  })

  const ranked = neutralRanking(trip)
  const top10 = ranked.slice(0, 10).map((scored, index) => toEntry(scored, index + 1, trip))
  const items = allItems(trip.plan)
  const selectedIds = new Set(items.map((item) => item.placeId))

  const finalPois = items.map((item) => ({
    itemId: item.id,
    day: item.dayIndex + 1,
    role: item.role,
    time: `${item.startTime}-${item.endTime}`,
    placeId: item.placeId,
    name: trip.catalogue.get(item.placeId)?.name,
    category: trip.catalogue.get(item.placeId)?.category,
    placedBy: item.placedBy ?? (item.rationaleRefs?.memoryIds.length ? 'memory?' : 'ranking'),
    reasons: item.reasons?.map((reason) => reason.text) ?? [],
    memoryRefs: item.rationaleRefs?.memoryIds ?? [],
    runnerUp: item.slate?.[0]
      ? { placeId: item.slate[0].placeId, name: trip.catalogue.get(item.slate[0].placeId)?.name, score: round(item.slate[0].score), lostOn: item.slate[0].lostOn }
      : null,
  }))

  const selected = items.slice(0, 3).map((item) => {
    const place = trip.catalogue.get(item.placeId)!
    const inTop = ranked.findIndex((scored) => scored.place.placeId === item.placeId)
    return {
      placeId: item.placeId,
      name: place.name,
      slot: `Day ${item.dayIndex + 1} ${item.role}`,
      neutralRank: inTop + 1,
      whyWon: {
        placedBy: item.placedBy ?? 'ranking',
        reasons: item.reasons?.map((reason) => reason.text) ?? [],
        beat: item.slate?.[0]
          ? `${trip.catalogue.get(item.slate[0].placeId)?.name} (${round(item.slate[0].score)}), which lost most on ${item.slate[0].lostOn ?? 'tie-break'}`
          : 'no runner-up (pinned or only option)',
      },
    }
  })

  const rejected = ranked
    .filter((scored) => !selectedIds.has(scored.place.placeId))
    .slice(0, 3)
    .map((scored) => {
      const admitting = rolesAdmitting(trip, scored.place.category)
      const onSlate = items.find((item) => item.slate?.some((entry) => entry.placeId === scored.place.placeId))
      const slateEntry = onSlate?.slate?.find((entry) => entry.placeId === scored.place.placeId)
      return {
        placeId: scored.place.placeId,
        name: scored.place.name,
        category: scored.place.category,
        neutralRank: ranked.indexOf(scored) + 1,
        neutralScore: round(scored.total),
        whyLost:
          admitting.length === 0
            ? `FILTER: no role at ${pace} stops/day admits ${scored.place.category} (roles: ${roles.map((role) => role.id).join(', ')})`
            : onSlate
              ? `RANKING: runner-up for Day ${onSlate.dayIndex + 1} ${onSlate.role}, lost to ${trip.catalogue.get(onSlate.placeId)?.name} on ${slateEntry?.lostOn ?? 'tie-break'} (${round(slateEntry?.score)} vs winner)`
              : `RANKING/CONTEXT: eligible for ${admitting.join(', ')} but never in a slot's top ${6} once day geography, hours and used places applied`,
      }
    })

  const validation = validatePlan(trip.plan, {
    frame: trip.frame,
    state: trip.state,
    places: toValidationPlaces(trip.catalogue),
    now: new Date('2026-09-21T09:00:00'),
  })

  return {
    runId,
    scenario,
    input_signals: {
      intent: trip.state.intent.map((item) => item.text),
      considering: trip.state.considering.map((item) => ({ text: item.text, tag: item.tag ?? null })),
      stateTerms: terms,
      memories: snapshot.memories.map((memory) => ({ id: memory.id, kind: memory.kind, subject: memory.subject, strength: memory.strength })),
      categoryPreferences: categoryPreferences(snapshot),
      priorityWeights: priorityWeights(trip.state),
      pace,
      roles: roles.map((role) => role.id),
    },
    semantic_expansion: {
      searches: queries.map((query) => ({ category: query.category, textQuery: query.textQuery, retrieve: query.retrieve })),
      // A term counts as carried when a search is worded with it, an area was chosen
      // for it (servesWords), or the pace budget consumes it ("slow").
      stateTermsReachingAnyQuery: terms.filter((term) => carried(term)),
      stateTermsLost: terms.filter((term) => !carried(term)),
      radiusMetres: profile.radiusMetres ?? null,
    },
    area_candidates: {
      stageExists: true,
      chosenAreas: [...new Set(areaSearches.map((query) => query.area!.name))],
      areaSearches: areaSearches.map((query) => query.textQuery),
      note: 'Area searches are issued at live retrieval; the pool below is the frozen demo_retrieved_v1 set, retrieved before this stage existed.',
      neighborhoodsInPool: byNeighborhood,
    },
    poi_candidates: { poolSize: pool.length, byCategory },
    hard_filters: filters,
    scoring: { top10 },
    diversity: {
      categoryCounts: countOf(items.map((item) => trip.catalogue.get(item.placeId)!.category)),
      neighborhoodCounts: countOf(items.map((item) => trip.catalogue.get(item.placeId)!.neighborhood)),
      interventions: diversityInterventions(trip),
    },
    route_time: {
      days: routeOf(trip),
      validation: { valid: validation.valid, errors: validation.errors.map((error) => `${error.code}: ${error.message}`) },
      unfilled: trip.generated.unfilled,
      tensions: trip.generated.tensions,
    },
    final_pois: finalPois,
    audit: { selected, rejected },
  }
}

function addMinutes(time: string, minutes: number): string {
  const [hours, mins] = time.split(':').map(Number)
  const total = hours * 60 + mins + minutes
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function countOf(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

export function writeTrace(trace: Trace): string {
  const dir = join('artifacts', 'recommendation_runs', `${trace.runId}_${trace.scenario}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'recommendation_trace.json'), JSON.stringify(trace, null, 2))

  const lines = [
    `# Recommendation trace — ${trace.scenario}`,
    '',
    `Run: ${trace.runId}`,
    '',
    '## Input signals',
    '```json',
    JSON.stringify(trace.input_signals, null, 2),
    '```',
    '## Semantic expansion',
    '```json',
    JSON.stringify(trace.semantic_expansion, null, 2),
    '```',
    '## Area candidates',
    '```json',
    JSON.stringify(trace.area_candidates, null, 2),
    '```',
    '## POI candidates / hard filters',
    '```json',
    JSON.stringify({ poi: trace.poi_candidates, filters: trace.hard_filters }, null, 2),
    '```',
    '## Top 10 (neutral context: Day 1, from lodging)',
    '',
    '| # | Place | Category | Total | stateMatch | memoryMatch | novelty | convenience | cost |',
    '|---:|---|---|---:|---:|---:|---:|---:|---:|',
    ...trace.scoring.top10.map(
      (entry) =>
        `| ${entry.rank} | ${entry.name} | ${entry.category} | ${entry.total} | ${entry.components.stateMatch} | ${entry.components.memoryMatch} | ${entry.components.novelty} | ${entry.components.convenience} | ${entry.components.cost} |`,
    ),
    '',
    '## Diversity',
    '```json',
    JSON.stringify(trace.diversity, null, 2),
    '```',
    '## Route / time',
    '```json',
    JSON.stringify(trace.route_time, null, 2),
    '```',
    '## Final POIs',
    '```json',
    JSON.stringify(trace.final_pois, null, 2),
    '```',
    '## Audit',
    '```json',
    JSON.stringify(trace.audit, null, 2),
    '```',
  ]
  writeFileSync(join(dir, 'recommendation_trace.md'), lines.join('\n'))
  return dir
}
