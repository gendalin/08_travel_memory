/**
 * Search text for each thing the profile wants to find (B2).
 *
 * The division of labour, which is the whole point of this step:
 *
 *   the model  writes the WORDS of a search, because reading "time in local
 *              neighbourhoods" and knowing it points at a back-street kissaten
 *              rather than a landmark is a semantic job. Measurement settled that
 *              code cannot do it: the demo Intent matched zero of thirty-three
 *              places by any string rule.
 *   Places     supplies the PLACES, with real ids, real hours and real
 *              coordinates. Nothing the model says becomes a place.
 *   code       decides which searches are worth issuing at all, and re-checks
 *              everything that comes back.
 *
 * Every model output passes through `resolveQueryPlan` before it is used, and
 * nothing it returns is trusted: a category it invented is dropped, a category no
 * role can use is dropped, an empty query falls back to one written here. A run
 * with no model at all produces a complete, usable plan — which is what makes the
 * degradation path real rather than aspirational.
 */

import { areasFor, characterSpans, CHARACTER_CATEGORIES, type AreaCharacter } from '../../domain/places/areas.ts'
import { kmBetween } from '../../domain/places/geo.ts'
import { categoriesFor, rolesForPace, type DayRole } from '../../domain/plan/dayRoles.ts'
import { termMatchesWord, toTerms } from '../../domain/ranking/score.ts'
import { INTEREST_CATEGORIES } from '../../domain/plan/dayRoles.ts'
import type { PlannedQuery, QueryPlanResult } from '../../services/llm/types.ts'
import { searchPlan, type RetrievalProfile } from './retrievalProfile.ts'

/**
 * Extra categories the model may add beyond what the profile asked for.
 *
 * Bounded because each one is a real API call, and because a model given an open
 * budget will find something to add to every trip.
 */
export const MAX_EXTRA_CATEGORIES = 3

/** One search, ready to issue. */
export interface ResolvedQuery {
  category: string
  /** How many places to ask for. */
  retrieve: number
  textQuery: string
  /** Whether the words came from the model or were written here. */
  source: 'model' | 'default'
  /** True when a memory asked for this category. */
  preferred: boolean
  /** True when the model added it rather than the profile asking for it. */
  addedByModel: boolean
  /**
   * The traveller's own words this search was written for, each verified to be a
   * span of what they wrote. Absent when no words of theirs are in it.
   */
  servesWords?: string[]
  /** Set for an area search: where to centre it, instead of on the lodging. */
  area?: { id: string; name: string; lat: number; lng: number; radiusMetres: number }
}

/** Areas searched per trip, beyond the lodging's own. A few calls, not a city sweep. */
export const MAX_DISCOVERY_AREAS = 2
/** Places asked for per area search — one category's worth for a day or two. */
export const AREA_RETRIEVE = 3
/** Categories searched per area. */
export const CATEGORIES_PER_AREA = 3
/** Without a measured reach, how far from the lodging an area may be and still be a day out. */
export const DEFAULT_AREA_REACH_KM = 15

/**
 * Area discovery (decided 2026-09-30; eval R1).
 *
 * Retrieval used to search "<lodging> <category>" and nothing else, so a trip asking
 * for Showa-era literary streets was planned entirely from what happened to be around
 * the hotel, and 11 of its 12 Intent words never reached a search. This reads the
 * characters the traveller asked for — from their words and from any confirmed
 * neighbourhood memory — picks the best matching areas from the code-owned table
 * (areas.ts), within reach, and searches those areas for the kinds of place that
 * make them what they are.
 *
 * The area the lodging already sits in is skipped: its own searches cover it.
 */
export function areaQueries(input: {
  ownWords: string
  /** Characters from confirmed `area_character` memories. */
  remembered?: readonly AreaCharacter[]
  lodging: { lat: number; lng: number }
  /** A measured reach (B7); areas beyond it would be filtered out anyway. */
  radiusMetres?: number
  /** Categories nobody wants (an avoid, an aversion). */
  excluded?: readonly string[]
}): ResolvedQuery[] {
  const spans = characterSpans(input.ownWords)
  const characters = [...new Set([...spans.map((entry) => entry.character), ...(input.remembered ?? [])])]
  const reachKm = input.radiusMetres !== undefined ? input.radiusMetres / 1000 : DEFAULT_AREA_REACH_KM

  const chosen = areasFor(characters, input.lodging)
    .filter(({ area }) => kmBetween(area.center, input.lodging) > area.radiusKm)
    .filter(({ area }) => kmBetween(area.center, input.lodging) <= reachKm)
    .slice(0, MAX_DISCOVERY_AREAS)

  return chosen.flatMap(({ area, matched }) => {
    // Categories most of the matched characters point at come first; one only a single
    // character points at is kept only when nothing better-supported exists — "independent"
    // alone should not spend a search on homeware in a literary quarter.
    const support = new Map<string, number>()
    for (const category of matched.flatMap((character) => CHARACTER_CATEGORIES[character])) {
      support.set(category, (support.get(category) ?? 0) + 1)
    }
    const ranked = [...support]
      .filter(([category]) => !(input.excluded ?? []).includes(category))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    const strong = ranked.filter(([, count]) => count >= 2)
    const categories = (strong.length > 0 ? strong : ranked).map(([category]) => category).slice(0, CATEGORIES_PER_AREA)
    const words = [...new Set(spans.filter((entry) => matched.includes(entry.character)).map((entry) => entry.span))]
    return categories.map((category) => ({
      category,
      retrieve: AREA_RETRIEVE,
      textQuery: `${area.name} ${categoryWords(category)}`,
      source: 'default' as const,
      preferred: true,
      addedByModel: false,
      ...(words.length > 0 ? { servesWords: words } : {}),
      area: { id: area.id, name: area.name, lat: area.center.lat, lng: area.center.lng, radiusMetres: Math.round(area.radiusKm * 1000) },
    }))
  })
}

/** The category id as words. The product spells categories this way everywhere. */
export function categoryWords(category: string): string {
  return category.replace(/_/g, ' ')
}

/**
 * Search text written without a model.
 *
 * Deliberately plain: the category, near where the trip is based, in the
 * destination. It finds the right KIND of place and leaves the traveller's own
 * words out, because a rule that tried to work them in would be the same string
 * matching that already measured as useless.
 */
export function defaultTextQuery(input: {
  category: string
  destination: string
  baseLodgingName: string
}): string {
  return `${categoryWords(input.category)} near ${input.baseLodgingName}, ${input.destination}`
}

/** Categories any role in play could actually use. */
function usableCategories(profile: RetrievalProfile): Set<string> {
  const roles: readonly DayRole[] = rolesForPace(profile.stopsPerDay)
  return new Set(roles.flatMap((role) => categoriesFor(role)))
}

/** Lower-cased, whitespace collapsed: the form two spans of text are compared in. */
export function normaliseWords(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * The model's claimed source words, kept only if the traveller really wrote them.
 *
 * A span, not a paraphrase: "local neighbourhoods" passes against "Time in local
 * neighbourhoods.", "quiet areas" does not. This is what lets a stop quote the
 * traveller back to themselves — the quote is guaranteed to be theirs.
 */
export function verifiedWords(claimed: string | undefined, ownWords: string): string | undefined {
  const words = claimed?.trim().replace(/[.,;:!?]+$/, '')
  if (!words || words.length < 3) return undefined
  return normaliseWords(ownWords).includes(normaliseWords(words)) ? words : undefined
}

/** The traveller's text as the sentences they wrote it in. */
function clausesOf(ownWords: string): string[] {
  return ownWords
    .split(/[.;\n]+/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length >= 3)
}

/**
 * Which of the traveller's sentences a model-written query was written for.
 *
 * Read off the query itself rather than taken on the model's say-so. Asked to name
 * the words it used, the model answered inconsistently — the same prompt returned
 * the right phrase, a label copied from the prompt, or nothing at all, while the
 * query text plainly carried the traveller's words each time. The query is the
 * evidence: a sentence is served when a word of it appears in the query, matched by
 * the same rule ranking matches State with. A claim from the model that verifies
 * is kept as well.
 *
 * The sentence is quoted whole, as they wrote it, so the quote is always theirs.
 */
export function wordsServed(input: {
  textQuery: string
  claimed?: string
  ownWords: string
}): string[] {
  // British and American spellings fold together — the traveller writes
  // "neighbourhoods", the model often writes "neighborhoods".
  const fold = (word: string) => word.replace(/our/g, 'or')
  const queryWords = input.textQuery.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(fold)
  const fromQuery = clausesOf(input.ownWords).filter((clause) =>
    toTerms(clause).some((term) => queryWords.some((word) => termMatchesWord(fold(term), word))),
  )
  const claimed = verifiedWords(input.claimed, input.ownWords)
  // A claimed phrase inside a sentence already quoted adds nothing.
  const extra =
    claimed && !fromQuery.some((clause) => normaliseWords(clause).includes(normaliseWords(claimed)))
      ? [claimed]
      : []
  return [...fromQuery, ...extra]
}

function trimmedQuery(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/**
 * The profile's searches, with words attached and the model's additions folded in.
 *
 * `planned` absent — no model, or a failed call — yields the same list with
 * default wording, so retrieval never depends on the model having answered.
 */
export function resolveQueryPlan(input: {
  profile: RetrievalProfile
  destination: string
  baseLodgingName: string
  planned?: QueryPlanResult
  /**
   * What the traveller wrote — Intent and Considering. Model-claimed source words
   * are checked against it; without it, none are kept.
   */
  ownWords?: string
}): ResolvedQuery[] {
  const ownWords = input.ownWords ?? ''
  const asked = searchPlan(input.profile)
  const usable = usableCategories(input.profile)

  // Model queries indexed by category, keeping only categories that were asked
  // for. A query for something nobody requested is not an improvement, it is the
  // model changing the subject.
  const askedFor = new Set(asked.map((entry) => entry.category))
  const modelQueries = new Map<string, PlannedQuery>()
  for (const query of input.planned?.queries ?? []) {
    if (!askedFor.has(query.category)) continue
    if (!trimmedQuery(query.textQuery)) continue
    if (!modelQueries.has(query.category)) modelQueries.set(query.category, query)
  }

  const resolved: ResolvedQuery[] = asked.map((entry) => {
    const fromModel = trimmedQuery(modelQueries.get(entry.category)?.textQuery)
    // Only the model works the traveller's words in; plain wording carries none.
    const servesWords = fromModel
      ? wordsServed({
          textQuery: fromModel,
          claimed: modelQueries.get(entry.category)?.servesWords,
          ownWords,
        })
      : []
    return {
      category: entry.category,
      retrieve: entry.retrieve,
      textQuery:
        fromModel ??
        defaultTextQuery({
          category: entry.category,
          destination: input.destination,
          baseLodgingName: input.baseLodgingName,
        }),
      source: fromModel ? 'model' : 'default',
      preferred: entry.preferred,
      addedByModel: false,
      ...(servesWords.length > 0 ? { servesWords } : {}),
    }
  })

  // Additions, filtered three ways: it has to be a real category, a day has to be
  // able to use it, and it must not already be on the list.
  const extras = (input.planned?.alsoSearch ?? [])
    .filter((category) => INTEREST_CATEGORIES.includes(category))
    .filter((category) => usable.has(category))
    .filter((category) => !askedFor.has(category))
    .filter((category, index, all) => all.indexOf(category) === index)
    .slice(0, MAX_EXTRA_CATEGORIES)

  // Shallow on purpose: the profile did not ask for these, so they are a hedge on
  // the model's reading of the Intent rather than a commitment to it. The shallowest
  // depth already in the plan, or one when the plan is empty.
  const depths = asked.map((entry) => entry.retrieve)
  const extraDepth = depths.length === 0 ? 1 : Math.max(1, Math.min(...depths))

  for (const category of extras) {
    const planned = (input.planned?.queries ?? []).find((query) => query.category === category)
    const fromModel = trimmedQuery(planned?.textQuery)
    const servesWords = fromModel
      ? wordsServed({ textQuery: fromModel, claimed: planned?.servesWords, ownWords })
      : []

    resolved.push({
      category,
      retrieve: extraDepth,
      textQuery:
        fromModel ??
        defaultTextQuery({
          category,
          destination: input.destination,
          baseLodgingName: input.baseLodgingName,
        }),
      source: fromModel ? 'model' : 'default',
      preferred: false,
      addedByModel: true,
      ...(servesWords.length > 0 ? { servesWords } : {}),
    })
  }

  return resolved
}
