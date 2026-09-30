/**
 * Candidate ranking (product_spec §12.2).
 *
 * The step the pipeline named but did not have: between "code filters
 * impossible POIs" and "LLM selects from a bounded candidate set" there has to
 * be a ranking, or the bounded set is just whatever order the dataset happened
 * to be written in — and Priorities, which §3.3 defines as the dimensions used
 * to choose between otherwise valid plans, never choose anything.
 *
 * Pure and synchronous, like the validator: every fact it needs is passed in.
 *
 * Three properties this module exists to hold:
 *
 *   - **Missing data scores null, never zero.** A place without coordinates is
 *     not an inconvenient place. Null components are dropped from the weighted
 *     mean rather than read as a bad score, the same refusal of false precision
 *     `computeExpectedImpact` makes.
 *
 *   - **Novelty genuinely opposes memoryMatch.** §3.3 defines novelty as
 *     "difference from known Memory/history", so the two components pull apart
 *     by construction and the user's novelty weight decides the balance. A
 *     scorer where memory only ever adds would make the novelty Priority
 *     decorative.
 *
 *   - **Explicit State outranks inferred Memory.** stateMatch carries the
 *     larger base weight. It is the same rule §10.3 applies to activation —
 *     what the user said beats what was inferred about them.
 */

import type { CategoryPreference, TraitPreference } from '../memory/preferences.ts'
import { popularity } from '../places/facets.ts'
import { hasCharacter } from '../places/areas.ts'
import { facetValuesOn, priceCeiling } from '../places/facets.ts'
import { CATEGORY_BY_ID } from '../places/taxonomy.ts'
import { kmBetween, type Coordinates } from '../places/geo.ts'
import type { OpeningHours, WeekdayKey } from '../places/openingHours.ts'
import type { PriorityWeight } from '../state/types.ts'
import type { ID } from '../trip/types.ts'

/** The subset of a place the scorer needs. Mirrors the validator's own view. */
export interface RankablePlace {
  placeId: string
  category: string
  neighborhood: string
  /** Its name, for what it IS when matching an `avoid`. */
  name?: string
  lat?: number
  lng?: number
  priceLevel?: 0 | 1 | 2 | 3 | 4
  tags: string[]
  shortDescription?: string
  /** Reviews the place has. A measure of fame, which is the opposite of novelty. */
  userRatingCount?: number
  /** Needed for the time-band facets; absent means those facets are simply absent. */
  openingHours?: OpeningHours
  typicalDurationMin?: number
}

/** Every component is 0..1, or null when the facts behind it are unavailable. */
export interface ScoreComponents {
  /** Overlap with Intent, Considering and accepted Priority names. */
  stateMatch: number | null
  /** Category strength in the trip's Memory snapshot. */
  memoryMatch: number | null
  /** Burden of the hop from the previous stop. */
  convenience: number | null
  /** Price level against the budget Considering, or cheapness without one. */
  cost: number | null
  /** Distance from what the Memory snapshot and the plan so far already cover. */
  novelty: number | null
  /** How far this stop stretches the day's existing geography. */
  routeFit: number | null
}

export interface ScoredPlace<T extends RankablePlace = RankablePlace> {
  place: T
  /** Weighted mean of the available components, 0..1. */
  total: number
  components: ScoreComponents
  /** The memory behind a non-zero memoryMatch, for `rationaleRefs.memoryIds`. */
  memoryId?: ID
}

export type { Coordinates }

export interface RankingContext {
  /** Category preferences from the trip's immutable Memory snapshot. */
  preferences: CategoryPreference[]
  /** Popularity / neighbourhood-character preferences from the same snapshot. */
  traits?: TraitPreference[]
  /** Budget level from Considering, when the user stated one. */
  budgetLevel?: 'low' | 'moderate' | 'high'
  /** `avoid` Considering values. Soft: they crush stateMatch, never invalidate. */
  avoid: string[]
  /** Words drawn from Intent, Considering text and accepted Priority names. */
  stateTerms: string[]
  /** Where the traveller comes from for this slot. Absent on an unplaced slot. */
  anchor?: Coordinates
  /** Points already on this day, lodging included, for spatial continuity. */
  dayPoints: Coordinates[]
  /** Categories already used in the plan, for the repetition half of novelty. */
  usedCategories: string[]
  /**
   * Metres the traveller's days typically span, from a `pattern` memory.
   *
   * A candidate that would stretch the day past this is marked down: it is not a
   * worse place, it is a place that makes the day bigger than this traveller
   * usually makes it. §4.2 puts base lodging in every day, so the same
   * measurement also bounds how far from the hotel a stop can sit.
   *
   * This is a BUDGET, deliberately, and not a decay scale. Rescaling the
   * proximity curve was tried and is inert: `1/(1 + d/h)` falls monotonically in
   * `d` for every `h`, so changing `h` moves every candidate the same way and
   * cannot change which one wins. Measured across three settings — no memory,
   * 5.6 km and 1.5 km — the plan came out identical. A threshold does change an
   * ordering, because only the candidates over it are touched.
   */
  daySpanBudgetMetres?: number
  /**
   * The weekday the slot falls on, so time-band facets can be derived.
   *
   * Absent means the caller is scoring outside a day — the time-band facets are
   * then simply not part of the haystack, rather than guessed at.
   */
  weekday?: WeekdayKey
  weights: PriorityWeights
}

/** Priority weights, already resolved from State to multipliers. */
export interface PriorityWeights {
  convenience: number
  cost: number
  novelty: number
}

const WEIGHT_MULTIPLIER: Record<PriorityWeight, number> = {
  low: 0.5,
  medium: 1,
  high: 2,
}

/**
 * The precedence lattice (§0.2, §10.3).
 *
 * One declaration, so the ordering is a rule rather than a pattern six scattered
 * numbers happen to follow.
 *
 *   hard constraint  the validator's job; a plan that breaks one is invalid and
 *                    never reaches ranking at all
 *   stated           what the traveller typed for THIS trip
 *   inferred         what was learnt about them across trips
 *   default          what the product optimises for when nothing else says
 *
 * `inferred` sits strictly above `default` because otherwise a confirmed memory
 * has no effect: with memoryMatch and novelty at the same weight, a remembered
 * category scores `w` and `1 - w` while an unremembered one scores `0` and `1`,
 * both summing to the same number. The research harness measured the net effect
 * of confirming a memory as exactly 0.0000, which is what produced this tier.
 */
export const PRECEDENCE = {
  stated: 2,
  inferred: 1.5,
  default: 1,
} as const

/**
 * Base weights, before the Priority multipliers.
 *
 * `cost` moves between tiers, and that is the point. A budget the traveller
 * actually stated is a `stated` constraint; the cost Priority on its own is the
 * product optimising by default. Holding cost at the default tier in both cases
 * weighted a stated budget exactly the same as novelty — a rule the system
 * invented — and measurement showed the consequence: one stop in the demo trip
 * sat above a stated moderate budget purely because ranking chose it.
 *
 * routeFit sits below convenience because the convenience Priority scales both,
 * and at equal weight the same idea would be counted twice.
 */
function baseWeights(statedBudget: boolean) {
  return {
    stateMatch: PRECEDENCE.stated,
    memoryMatch: PRECEDENCE.inferred,
    convenience: PRECEDENCE.default,
    cost: statedBudget ? PRECEDENCE.stated : PRECEDENCE.default,
    novelty: PRECEDENCE.default,
    routeFit: PRECEDENCE.default * 0.75,
  } as const
}

/** Hop distance at which convenience has fallen to half. Tokyo scale. */
const CONVENIENCE_HALF_KM = 2
/** Distance from the day's centre at which routeFit has fallen to half. */
const ROUTE_FIT_HALF_KM = 3

/**
 * How far over the day-span budget a candidate can be before routeFit is gone.
 *
 * At the budget itself nothing is lost; at twice it nothing is left. A ramp
 * rather than a cliff, because the budget is a median of a handful of days, not
 * a rule the traveller stated.
 */
const SPAN_OVERRUN_RUINS_AT = 2

/** stateMatch when nothing matches: no signal is not a bad signal. */
const STATE_MATCH_LADDER = [0.4, 0.7, 1] as const

/** Words too common to carry meaning when matched against a place's tags. */
const STOPWORDS = new Set([
  'with', 'that', 'this', 'from', 'want', 'like', 'some', 'more', 'less',
  'trip', 'tokyo', 'days', 'time', 'good', 'nice', 'very', 'really', 'much',
  'need', 'have', 'keep', 'stay', 'each', 'every', 'them', 'they', 'would',
  // Degree words. "Mostly on foot" matched a description's "most", and a State
  // edit re-chose a lunch on the strength of it.
  'mostly', 'mainly', 'quite', 'often', 'usually', 'maybe', 'perhaps', 'also', 'just',
])

/** 1 at zero distance, 0.5 at `halfKm`, approaching 0 far out. */
function proximity(km: number, halfKm: number): number {
  return 1 / (1 + km / halfKm)
}

function coordinatesOf(place: RankablePlace): Coordinates | undefined {
  return place.lat === undefined || place.lng === undefined
    ? undefined
    : { lat: place.lat, lng: place.lng }
}

/** Below this a word is too short to match on without catching everything. */
const MIN_TERM_LENGTH = 4

/** Splits free text into matchable terms: lowercase, de-punctuated, meaningful. */
export function toTerms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= MIN_TERM_LENGTH && !STOPWORDS.has(word))
}

/**
 * Whether a term matches a word, allowing for plain English inflection.
 *
 * Exact substring matching measurably lost ordinary phrasing: "mornings only"
 * failed to reach the `morning` band and "short lunches" failed to reach
 * `lunch`, because a traveller pluralises and a facet name does not. A prefix
 * relation in either direction covers that without a stemmer, and both sides are
 * at least four characters, so it does not start matching everything.
 *
 * The shorter side must cover most of the longer — 70% — so an inflection
 * matches ("lunch"/"lunches", "local"/"locals") and a different word that merely
 * starts the same way does not ("most"/"mostly", "slow"/"slowly" is lost too, and
 * is the price of it).
 *
 * It does NOT close the semantic gap: "dinners" still fails to reach the
 * `evening` band, and "slow-paced" reaches nothing at all. Mapping a phrase onto
 * a facet is a step for the query planner, not for string comparison.
 */
export function termMatchesWord(term: string, word: string): boolean {
  const [shorter, longer] = term.length <= word.length ? [term, word] : [word, term]
  return longer.startsWith(shorter) && shorter.length / longer.length >= 0.7
}

/**
 * Everything about a place that free-text State terms can match against.
 *
 * Facet values are in here because the authored surface is thin: the demo
 * Intent matched zero of thirty-three places against category, neighbourhood,
 * tags and description alone, so `stateMatch` sat at its no-match floor for
 * every stop. Facets add words like "lunch", "late", "budget" and "short" that a
 * traveller plausibly uses, derived rather than authored.
 *
 * This widens what CAN match; it does not close the gap on its own. "Slow-paced"
 * still matches nothing, because mapping a phrase onto a facet is a semantic
 * step, and that step belongs to the query planner rather than to substring
 * comparison.
 */
function haystackOf(place: RankablePlace, weekday: WeekdayKey | undefined): string {
  const facets =
    weekday && place.typicalDurationMin !== undefined
      ? facetValuesOn(
          {
            priceLevel: place.priceLevel,
            typicalDurationMin: place.typicalDurationMin,
            openingHours: place.openingHours,
            userRatingCount: place.userRatingCount,
          },
          weekday,
        )
      : []

  return [
    place.category.replace(/_/g, ' '),
    place.neighborhood,
    ...place.tags,
    ...facets,
    place.shortDescription ?? '',
  ]
    .join(' ')
    .toLowerCase()
}

/** The haystack as comparable words, so a term can match one by inflection. */
function haystackWords(place: RankablePlace, weekday: WeekdayKey | undefined): string[] {
  return haystackOf(place, weekday)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= MIN_TERM_LENGTH)
}

/**
 * Overlap with what the user actually said.
 *
 * An `avoid` hit returns 0 outright. §8 keeps `avoid` out of hard validation —
 * a plan is not invalid for containing a place the user would rather skip — so
 * this is the only place it can take effect at all.
 */
/**
 * Whether a place is something the traveller said to avoid.
 *
 * Matched against what the place IS — its category, its types, its name — and not
 * against what its description mentions. "Avoid museums" once took out Ueno Park,
 * whose description names the museums inside it, and left the Tokyo National Museum
 * alone, because its category says "museum" and the sentence said "museums". Every
 * word of the avoided thing must match, by the same inflection rule as State terms,
 * so "avoid izakaya" and "avoid izakayas" mean the same and "avoid art" does not
 * reach a place merely described as "artisan".
 *
 * Shared with State-edit rescoping, so the stop a new `avoid` takes out and the
 * ranking that picks its replacement agree on what it means.
 */
/** Words that make an `avoid` about crowds rather than about a kind of place. */
export const CROWD_WORDS = /\bcrowd(?:s|ed)?\b|\btouristy\b|\btourist (?:spots?|traps?|places?|sights?)\b|\bbusy\b|\bqueues?\b|人多|擁擠|觀光客/i

export function matchesAvoid(
  place: RankablePlace,
  avoid: readonly string[],
  // Kept for callers; what a place is does not depend on the day.
  _weekday?: WeekdayKey,
): string | undefined {
  // "Avoid crowded tourist spots" is about how busy a place is, not what it is: it
  // rules out the landmarks (2026-09-30), as well as anything whose own types say so.
  const crowd = avoid.find((value) => CROWD_WORDS.test(value))
  if (crowd && placePopularity(place) === 'landmark') return crowd

  const label = CATEGORY_BY_ID.get(place.category)?.labelEn ?? ''
  const identity = [place.category.replace(/_/g, ' '), label, ...place.tags, place.name ?? '']
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3)

  return avoid.find((value) => {
    const wanted = value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3 && !STOPWORDS.has(word) && !['the', 'and', 'any', 'all'].includes(word))
    return wanted.length > 0 && wanted.every((word) => identity.some((have) => termMatchesWord(word, have)))
  })
}

function stateMatch(place: RankablePlace, context: RankingContext): number {
  if (matchesAvoid(place, context.avoid, context.weekday)) return 0

  const words = haystackWords(place, context.weekday)
  const hits = new Set(
    context.stateTerms.filter((term) => words.some((word) => termMatchesWord(term, word))),
  ).size

  return STATE_MATCH_LADDER[Math.min(hits, STATE_MATCH_LADDER.length - 1)]
}

/**
 * Which of the traveller's State terms this place matched — the words behind a
 * stateMatch above its floor, so a rationale can quote them.
 */
export function matchedStateTerms(place: RankablePlace, context: RankingContext): string[] {
  const words = haystackWords(place, context.weekday)
  return context.stateTerms.filter((term) => words.some((word) => termMatchesWord(term, word)))
}

/** Strength of this place's category in the trip's Memory snapshot, 0 if absent. */
function memoryPreference(
  place: RankablePlace,
  context: RankingContext,
): CategoryPreference | undefined {
  return context.preferences.find((preference) => preference.category === place.category)
}

/**
 * Price level against the stated budget, or plain cheapness without one.
 *
 * The cost Priority exists whether or not the user stated a budget (§3.3), so
 * it has to mean something on its own rather than going quiet.
 */
function cost(place: RankablePlace, context: RankingContext): number | null {
  if (place.priceLevel === undefined) return null

  if (!context.budgetLevel) return 1 - place.priceLevel / 4

  const over = place.priceLevel - priceCeiling(context.budgetLevel)
  return over <= 0 ? 1 : Math.max(0, 1 - 0.5 * over)
}

/**
 * Reviews at which a place counts as fully famous.
 *
 * A calibration choice, stated so it can be argued with. Ten thousand reviews is
 * somewhere no one needs this product to find.
 */
const FAME_SATURATES_AT = 10_000

/**
 * How well known a place is, 0-1, from its review count.
 *
 * Review COUNT, never rating. Ranking by rating would push every trip toward
 * crowd-pleasers, which is the definition of the generic itinerary this is meant to
 * avoid; ranking down by fame says only that a place thousands of people have
 * already written about is not a discovery.
 *
 * Log-scaled, because the difference between 50 and 500 reviews says far more about
 * how findable a place is than the difference between 20,000 and 20,450.
 */
function fame(place: RankablePlace): number {
  const reviews = place.userRatingCount
  if (reviews === undefined || reviews <= 0) return 0
  return Math.min(1, Math.log10(reviews + 1) / Math.log10(FAME_SATURATES_AT + 1))
}

/**
 * Distance from what is already known — by the traveller, by this plan, and by
 * everyone else.
 *
 * Familiar by any route counts as familiar, so the three are combined with max
 * rather than averaged: a category the traveller loves does not become novel again
 * because it has not appeared in this plan yet, and a landmark does not become a
 * discovery because it is the first of its kind in the trip.
 *
 * Fame enters HERE rather than as a component of its own, so the novelty Priority
 * governs it. A traveller who wants the famous things sets novelty low and gets
 * them; the product does not decide on their behalf that well known is bad.
 */
function novelty(place: RankablePlace, context: RankingContext): number {
  const fromMemory = memoryPreference(place, context)?.weight ?? 0

  const repeats = context.usedCategories.filter((category) => category === place.category).length
  const fromPlan = repeats / (repeats + 1)

  return 1 - Math.max(fromMemory, fromPlan, fame(place))
}

function convenience(place: RankablePlace, context: RankingContext): number | null {
  const here = coordinatesOf(place)
  if (!here || !context.anchor) return null
  return proximity(kmBetween(context.anchor, here), CONVENIENCE_HALF_KM)
}

/** Greatest distance between any two of these points, in kilometres. */
function maxPairwiseKm(points: Coordinates[]): number {
  let widest = 0
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      widest = Math.max(widest, kmBetween(points[i], points[j]))
    }
  }
  return widest
}

/**
 * Spatial continuity: how far this stop sits from the day's centre of gravity,
 * and whether it would stretch the day past what this traveller's days span.
 */
function routeFit(place: RankablePlace, context: RankingContext): number | null {
  const here = coordinatesOf(place)
  if (!here || context.dayPoints.length === 0) return null

  const centroid: Coordinates = {
    lat: context.dayPoints.reduce((sum, point) => sum + point.lat, 0) / context.dayPoints.length,
    lng: context.dayPoints.reduce((sum, point) => sum + point.lng, 0) / context.dayPoints.length,
  }
  const fit = proximity(kmBetween(centroid, here), ROUTE_FIT_HALF_KM)

  const budgetKm = context.daySpanBudgetMetres === undefined
    ? undefined
    : context.daySpanBudgetMetres / 1000
  if (budgetKm === undefined || budgetKm <= 0) return fit

  const spanWithIt = maxPairwiseKm([...context.dayPoints, here])
  if (spanWithIt <= budgetKm) return fit

  const overrun = (spanWithIt - budgetKm) / (budgetKm * (SPAN_OVERRUN_RUINS_AT - 1))
  return fit * Math.max(0, 1 - overrun)
}

/** Weighted mean over the components that have data. Null ones are dropped. */
function combine(
  components: ScoreComponents,
  weights: PriorityWeights,
  statedBudget: boolean,
): number {
  let weighted = 0
  let total = 0
  for (const [, value, weight] of weightedComponents(components, weights, statedBudget)) {
    if (value === null || weight === 0) continue
    weighted += value * weight
    total += weight
  }

  return total === 0 ? 0 : weighted / total
}

/** Each component with its value and the weight it carries in this context. */
function weightedComponents(
  components: ScoreComponents,
  weights: PriorityWeights,
  statedBudget: boolean,
): Array<[keyof ScoreComponents, number | null, number]> {
  const base = baseWeights(statedBudget)
  return [
    ['stateMatch', components.stateMatch, base.stateMatch],
    ['memoryMatch', components.memoryMatch, base.memoryMatch],
    ['convenience', components.convenience, base.convenience * weights.convenience],
    ['cost', components.cost, base.cost * weights.cost],
    ['novelty', components.novelty, base.novelty * weights.novelty],
    ['routeFit', components.routeFit, base.routeFit * weights.convenience],
  ]
}

/**
 * How well known a place is: its review count where fetched, else a `landmark` tag
 * — the bundled places predate review counts, and a landmark is marked as one.
 */
export function placePopularity(place: RankablePlace): 'local' | 'known' | 'landmark' | undefined {
  if (place.userRatingCount !== undefined) {
    return popularity({ typicalDurationMin: place.typicalDurationMin ?? 60, userRatingCount: place.userRatingCount })
  }
  return place.tags.includes('landmark') ? 'landmark' : undefined
}

/** The trait preferences this place meets, strongest first. */
function traitMatches(place: RankablePlace, context: RankingContext): TraitPreference[] {
  const here = coordinatesOf(place)
  return (context.traits ?? [])
    .filter((trait) =>
      trait.trait === 'popularity'
        ? placePopularity(place) === trait.value
        : here !== undefined && hasCharacter(here, trait.value),
    )
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
}

export function scorePlace<T extends RankablePlace>(
  place: T,
  context: RankingContext,
): ScoredPlace<T> {
  const categoryPreference = memoryPreference(place, context)
  const traits = traitMatches(place, context)
  const memoryWeight = Math.max(-1, Math.min(1, (categoryPreference?.weight ?? 0) + traits.reduce((sum, trait) => sum + trait.weight, 0)))
  // The memory cited is the one that moved the score most.
  const strongest = [categoryPreference, ...traits]
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))[0]
  const preference = strongest

  const components: ScoreComponents = {
    stateMatch: stateMatch(place, context),
    memoryMatch: memoryWeight,
    convenience: convenience(place, context),
    cost: cost(place, context),
    novelty: novelty(place, context),
    routeFit: routeFit(place, context),
  }

  return {
    place,
    total: combine(components, context.weights, context.budgetLevel !== undefined),
    components,
    ...(preference ? { memoryId: preference.memoryId } : {}),
  }
}

/**
 * Ranks a bounded candidate set, best first.
 *
 * Ties break on placeId so the ordering is total and the same inputs always
 * produce the same plan — scenario tests and Decision Receipts both depend on
 * that reproducibility.
 */
export function rankPlaces<T extends RankablePlace>(
  places: T[],
  context: RankingContext,
): Array<ScoredPlace<T>> {
  return places
    .map((place) => scorePlace(place, context))
    .sort((a, b) => b.total - a.total || a.place.placeId.localeCompare(b.place.placeId))
}

/** State's low/medium/high onto multipliers, with `medium` as the neutral 1. */
export function weightMultiplier(weight: PriorityWeight): number {
  return WEIGHT_MULTIPLIER[weight]
}

/** Weighted contribution of each component, under the given Priority weights. */
export function contributions(
  components: ScoreComponents,
  weights: PriorityWeights,
  statedBudget: boolean,
): Array<[keyof ScoreComponents, number]> {
  return weightedComponents(components, weights, statedBudget).map(
    ([component, value, weight]) => [component, (value ?? 0) * weight],
  )
}

/**
 * The component on which `loser` gave up the most weighted ground to `winner`.
 *
 * Read off the weighted contributions rather than the raw component values, so
 * the answer reflects the arithmetic the ordering actually used: losing 0.4 of
 * novelty at weight 1 matters less than losing 0.3 of stateMatch at weight 2.
 *
 * Undefined when the loser was not behind on any component — which happens when
 * it lost only to the tie-break.
 */
export function lostOn(
  winner: ScoreComponents,
  loser: ScoreComponents,
  weights: PriorityWeights,
  statedBudget = false,
): keyof ScoreComponents | undefined {
  const winnerBy = new Map(contributions(winner, weights, statedBudget))

  const gaps = contributions(loser, weights, statedBudget)
    .map(([component, value]) => [component, (winnerBy.get(component) ?? 0) - value] as const)
    .filter(([, gap]) => gap > 0)
    .sort((a, b) => b[1] - a[1])

  return gaps[0]?.[0]
}
