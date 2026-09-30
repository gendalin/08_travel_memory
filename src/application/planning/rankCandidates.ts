/**
 * State + Memory + the plan so far -> a RankingContext the domain can score with
 * (product_spec §12.2).
 *
 * The domain scorer is deliberately ignorant of Trip, Plan and the catalogue.
 * This is the one place that knows how to read those and hand it plain facts,
 * so Replace, Alternatives and first-plan generation all rank against the same
 * definition of "better" — the same reason `buildProposal` is shared.
 */

import { categoryPreferences, planShape, traitPreferences } from '../../domain/memory/preferences.ts'
import type { MemorySnapshot } from '../../domain/memory/types.ts'
import type { WeekdayKey } from '../../domain/places/openingHours.ts'
import { allItems, findItem, type Plan, type SlateEntry } from '../../domain/plan/types.ts'
import {
  lostOn,
  rankPlaces,
  toTerms,
  weightMultiplier,
  type PriorityWeights,
  type RankingContext,
  type ScoredPlace,
} from '../../domain/ranking/score.ts'
import { CORE_PRIORITIES, type TripState } from '../../domain/state/types.ts'
import type { TripFrame } from '../../domain/trip/types.ts'
import type { DemoPlace, PlaceCatalogue } from '../../services/places/types.ts'
import { budgetOf } from './tripContext.ts'

/** Where a candidate would sit, geographically and in the plan's history. */
export interface RankingGeography {
  /** The stop before this slot — base lodging for the first slot of a day. */
  anchorPlaceId?: string
  /** Places already on this day, lodging included. */
  dayPlaceIds: string[]
  /** Places already used anywhere in the plan, for the repetition half of novelty. */
  usedPlaceIds: string[]
}

const CORE_PRIORITY_NAMES = new Set<string>(CORE_PRIORITIES)

/**
 * Priority weights from State (§3.3).
 *
 * A Priority the user removed scores 0, which drops its components from the
 * weighted mean entirely rather than scoring them badly.
 */
export function priorityWeights(state: TripState): PriorityWeights {
  const weightOf = (name: string): number => {
    const priority = state.priorities.find(
      (entry) => entry.name.toLowerCase() === name,
    )
    return priority ? weightMultiplier(priority.weight) : 0
  }

  return {
    convenience: weightOf('convenience'),
    cost: weightOf('cost'),
    novelty: weightOf('novelty'),
  }
}

/**
 * Free-text terms a candidate can be matched against.
 *
 * Intent, plus the Considering items that carry NO structured tag, plus any
 * agent-proposed Priority the user accepted. A tagged Considering item is
 * already enforced by the validator or the budget component, so including its
 * text here would count the same constraint twice.
 */
export function stateTerms(state: TripState): string[] {
  const sources = [
    ...state.intent.map((item) => item.text),
    ...state.considering.filter((item) => !item.tag).map((item) => item.text),
    ...state.priorities
      .filter((priority) => !CORE_PRIORITY_NAMES.has(priority.name.toLowerCase()))
      .map((priority) => priority.name),
  ]

  return [...new Set(sources.flatMap(toTerms))]
}

/** `avoid` Considering values — soft, and handled only by ranking (§8). */
function avoidValues(state: TripState): string[] {
  return state.considering
    .map((item) => (item.tag?.kind === 'avoid' ? item.tag.value : undefined))
    .filter((value): value is string => value !== undefined)
}

export function buildRankingContext(input: {
  state: TripState
  memorySnapshot?: MemorySnapshot
  catalogue: PlaceCatalogue
  geography: RankingGeography
  /**
   * The weekday the slot falls on. Time-band facets are per day, so without it
   * they are left out of matching rather than derived against a guessed day.
   */
  weekday?: WeekdayKey
  /**
   * Memories that have had their share of the trip (`claimsAllowed`). Their pull is
   * cut to a quarter from here on: the bound used to hold only for the first claim,
   * and ranking kept drawing the same category into every later slot — four
   * bookstores from a memory allowed two.
   */
  spentMemoryIds?: readonly string[]
}): RankingContext {
  const coordinatesOf = (placeId: string) => {
    const place = input.catalogue.get(placeId)
    return place ? { lat: place.lat, lng: place.lng } : undefined
  }

  const anchor = input.geography.anchorPlaceId
    ? coordinatesOf(input.geography.anchorPlaceId)
    : undefined

  const budget = budgetOf(input.state)

  /** The traveller's own daily reach, measured by a `pattern` memory. */
  const daySpanBudgetMetres = planShape(input.memorySnapshot).daySpanMetres?.value

  return {
    traits: traitPreferences(input.memorySnapshot),
    preferences: categoryPreferences(input.memorySnapshot).map((preference) =>
      input.spentMemoryIds?.includes(preference.memoryId) && preference.weight > 0
        ? { ...preference, weight: preference.weight * SPENT_MEMORY_FACTOR }
        : preference,
    ),
    ...(budget ? { budgetLevel: budget.level } : {}),
    avoid: avoidValues(input.state),
    stateTerms: stateTerms(input.state),
    ...(anchor ? { anchor } : {}),
    dayPoints: input.geography.dayPlaceIds
      .map(coordinatesOf)
      .filter((point): point is { lat: number; lng: number } => point !== undefined),
    usedCategories: input.geography.usedPlaceIds
      .map((placeId) => input.catalogue.get(placeId)?.category)
      .filter((category): category is string => category !== undefined),
    ...(daySpanBudgetMetres !== undefined ? { daySpanBudgetMetres } : {}),
    ...(input.weekday ? { weekday: input.weekday } : {}),
    weights: priorityWeights(input.state),
  }
}

/** What a memory still pulls once it has had its share of the trip. */
export const SPENT_MEMORY_FACTOR = 0.25

export function rankCandidates(
  places: DemoPlace[],
  context: RankingContext,
): Array<ScoredPlace<DemoPlace>> {
  return rankPlaces(places, context)
}

/**
 * Geography for swapping an existing item: what the day looks like WITHOUT it.
 *
 * The outgoing place is excluded from every list — otherwise it anchors the
 * convenience score to itself and makes its own category look repetitive, both
 * of which bias the ranking toward whatever is already there.
 */
export function geographyForItem(input: {
  frame: TripFrame
  plan: Plan
  itemId: string
}): RankingGeography {
  const item = findItem(input.plan, input.itemId)
  if (!item) return { dayPlaceIds: [], usedPlaceIds: [] }

  const day = input.plan.days.find((entry) => entry.dayIndex === item.dayIndex)
  const onDay = [...(day?.items ?? [])].sort((a, b) => a.startTime.localeCompare(b.startTime))

  const position = onDay.findIndex((entry) => entry.id === input.itemId)
  const previous = position > 0 ? onDay[position - 1] : undefined

  return {
    anchorPlaceId: previous?.placeId ?? input.frame.baseLodging.placeId,
    dayPlaceIds: [
      input.frame.baseLodging.placeId,
      ...onDay.filter((entry) => entry.id !== input.itemId).map((entry) => entry.placeId),
    ],
    usedPlaceIds: allItems(input.plan)
      .filter((entry) => entry.id !== input.itemId)
      .map((entry) => entry.placeId),
  }
}

/** §5.6 asks for 3-5 alternatives, so a slot keeps that many runners-up. */
export const SLATE_SIZE = 5

/**
 * Runners-up for a slot, from an already-ranked candidate set.
 *
 * Takes the ranking rather than recomputing it, so the slate is by construction
 * the same ordering the winner came from — a second ranking could drift from the
 * first and offer "alternatives" that were never actually in the running.
 */
export function slateFrom(
  ranked: Array<ScoredPlace<DemoPlace>>,
  winnerPlaceId: string,
  weights: PriorityWeights,
  /** Whether the traveller stated a budget, so `lostOn` tiers cost the same way. */
  statedBudget = false,
): SlateEntry[] {
  const winner = ranked.find((scored) => scored.place.placeId === winnerPlaceId)
  if (!winner) return []

  return ranked
    .filter((scored) => scored.place.placeId !== winnerPlaceId)
    .slice(0, SLATE_SIZE)
    .map((scored) => {
      const lost = lostOn(winner.components, scored.components, weights, statedBudget)
      return {
        placeId: scored.place.placeId,
        score: scored.total,
        components: scored.components,
        ...(lost ? { lostOn: lost } : {}),
      }
    })
}
