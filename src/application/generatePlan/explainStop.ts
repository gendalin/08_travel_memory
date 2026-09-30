/**
 * Why a stop is in the plan, from the facts that actually put it there.
 *
 * The previous rationale was one of two sentences, true of any stop in the same
 * slot, and it cited every Intent item and every Priority whether or not they had
 * moved the choice. Every reason here comes from something the planner used:
 *
 *   - the traveller's own words — a must-visit, the words a search was written for
 *     (verified to be theirs), or terms their State shares with the place
 *   - the named places in the evidence behind a memory
 *   - the ranking components that carried the most weight, stated as the fact
 *     behind them: a walk in minutes, a budget, a review count
 *   - the runner-up it beat, and what that one lost on
 *
 * What the traveller said outranks what was inferred about them, which outranks
 * what the product optimises by default — the same precedence ranking uses — and
 * the strongest reason is marked primary.
 *
 * Pure: every fact it needs is passed in, so the same plan always explains itself
 * the same way.
 */

import type { DayRole } from '../../domain/plan/dayRoles.ts'
import type { RationaleRefs, StopReason } from '../../domain/plan/types.ts'
import type { Memory } from '../../domain/memory/types.ts'
import { overBudget, popularity } from '../../domain/places/facets.ts'
import { metresBetween } from '../../domain/places/geo.ts'
import { CATEGORY_BY_ID } from '../../domain/places/taxonomy.ts'
import {
  contributions,
  matchedStateTerms,
  toTerms,
  termMatchesWord,
  type PriorityWeights,
  type RankingContext,
  type ScoreComponents,
  type ScoredPlace,
} from '../../domain/ranking/score.ts'
import type { TripState } from '../../domain/state/types.ts'
import type { DemoPlace } from '../../services/places/types.ts'
import { verifiedWords, normaliseWords } from '../planning/queryPlan.ts'
import { budgetOf } from '../planning/tripContext.ts'

/** How a stop came to hold its slot. */
export type StopVia =
  | { kind: 'must_visit' }
  | { kind: 'memory'; memory: Memory }
  | { kind: 'ranking' }

export interface ExplainStopInput {
  place: DemoPlace
  /** The part of the day it fills. Absent for a stop placed by name or an event. */
  role?: DayRole
  dayIndex: number
  state: TripState
  via: StopVia
  /** The stop's own scores, when it was ranked. */
  scored?: ScoredPlace<DemoPlace>
  /** The best candidate it beat, and the component that one lost most on. */
  runnerUp?: { place: DemoPlace; lostOn?: keyof ScoreComponents }
  /** Where the traveller arrives from: the previous stop, or the lodging. */
  from?: { name: string; lat?: number; lng?: number }
  ranking?: RankingContext
  weights: PriorityWeights
  /** Resolves the memory behind a memoryMatch the stop was ranked with. */
  memoryById?: (memoryId: string) => Memory | undefined
  /** Every memory in the trip's snapshot, to find a stop the traveller saved. */
  memories?: readonly Memory[]
  /**
   * The State change that put this stop here, when one did — "You asked to avoid
   * izakaya." It is the answer to "why did this change", so it leads.
   */
  trigger?: { text: string; stateItemIds: string[] }
}

export interface StopExplanation {
  reasons: StopReason[]
  refs: RationaleRefs
}

/** Saved places named in a memory sentence before it says "…". */
const EXAMPLES_SHOWN = 3

/** At most this many reasons besides the primary one. Enough to be specific. */
const MAX_SECONDARY = 2

/** Walking pace for "an N-minute walk", metres a minute. */
const WALK_METRES_PER_MINUTE = 80
/** Beyond this a stop is described by distance, not as a walk. */
const WALK_UP_TO_METRES = 1_600

/** Fewer reviews than this and a place is not on the tourist circuit. */
const LITTLE_KNOWN_REVIEWS = 500

/** A component below this did not make the stop good on that count. */
const WORTH_SAYING = 0.5

/**
 * Candidate reasons carry a rank: the tier of what they rest on, then how much
 * weight they carried. The tiers mirror ranking's precedence (`PRECEDENCE`), with
 * one deliberate exception: what DECIDED the slot leads — a must-visit, then a
 * saved place, then a memory that claimed the slot — because the primary reason
 * is the answer to "why this one", not the most authoritative thing true of it.
 */
const TIER = { stated: 100, inferred: 80, measured: 0, comparison: -10, fallback: -20 } as const

interface Candidate {
  text: string
  rank: number
  stateItemIds?: string[]
  priorityNames?: string[]
  memoryIds?: string[]
  /** The runner-up comparison keeps a slot of its own when there is room. */
  comparison?: boolean
  /** Already states the review count, which novelty would otherwise repeat. */
  coversReviews?: boolean
}

/** A category as a person would say it: "temple or shrine", not "temple_shrine". */
function categoryWords(category: string): string {
  const label = CATEGORY_BY_ID.get(category)?.labelEn ?? category.replace(/_/g, ' ')
  return label.replace(/\s*\/\s*/g, ' or ').toLowerCase()
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/** Same place, by name — exact, or one name containing the other. */
function sameName(a: string, b: string): boolean {
  const x = normaliseWords(a)
  const y = normaliseWords(b)
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)))
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function quoted(words: string): string {
  return `“${words}”`
}

/** State items (Intent or Considering) whose text contains, or is contained by, these words. */
function stateItemsFor(state: TripState, words: string): string[] {
  const needle = normaliseWords(words)
  return [...state.intent, ...state.considering]
    .filter((item) => {
      const text = normaliseWords(item.text)
      return text.includes(needle) || (text.length >= 4 && needle.includes(text))
    })
    .map((item) => item.id)
}

function distanceFrom(input: ExplainStopInput): number | undefined {
  const from = input.from
  if (!from || from.lat === undefined || from.lng === undefined) return undefined
  return metresBetween(
    { lat: from.lat, lng: from.lng },
    { lat: input.place.lat, lng: input.place.lng },
  )
}

function travelPhrase(metres: number, fromName: string): string {
  if (metres <= WALK_UP_TO_METRES) {
    const minutes = Math.max(1, Math.round(metres / WALK_METRES_PER_MINUTE))
    return `A ${minutes}-minute walk from ${fromName}.`
  }
  return `${(metres / 1000).toFixed(1)} km from ${fromName}.`
}

/** What the runner-up lost on, as the rest of a sentence about it. */
function lostPhrase(component: keyof ScoreComponents, fromName: string | undefined): string {
  switch (component) {
    case 'convenience':
      return fromName ? `farther from ${fromName}` : 'farther out of the way'
    case 'cost':
      return 'pricier'
    case 'novelty':
      return 'better known'
    case 'stateMatch':
      return 'a weaker match for what you wrote'
    case 'memoryMatch':
      return 'less like what you usually save'
    case 'routeFit':
      return 'further from the rest of the day'
  }
}

// --- the traveller's own words ------------------------------------------------

function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4)
}

/**
 * What about the place a State term matched, as the end of a sentence.
 *
 * Ranking matches terms against one haystack — description, tags, category,
 * neighbourhood and derived facets — and says only THAT it matched. Quoting the
 * bare term back ("Matches “local”") hid the fact that made it true, so this
 * finds which part of the place the word came from and says that.
 */
function whereMatched(term: string, place: DemoPlace): string | undefined {
  const has = (text: string) => wordsOf(text).some((word) => termMatchesWord(term, word))

  const described = wordsOf(place.shortDescription ?? '').find((word) => termMatchesWord(term, word))
  if (described) return `its description mentions ${quoted(described)}`
  const tag = place.tags.find(has)
  if (tag) return `it is a ${tag}`
  if (has(categoryWords(place.category))) return `it is a ${categoryWords(place.category)}`
  if (has(place.neighborhood)) return `it is in ${place.neighborhood}`
  if (popularity(place) === 'local' && termMatchesWord(term, 'local') && place.userRatingCount !== undefined) {
    return `mostly locals know it — ${plural(place.userRatingCount, 'review')}`
  }
  return undefined
}

function fromStatedWords(input: ExplainStopInput): Candidate[] {
  const { place, state } = input
  const candidates: Candidate[] = []

  if (input.via.kind === 'must_visit') {
    const item = state.considering.find(
      (entry) => entry.tag?.kind === 'must_visit' && entry.tag.placeId === place.placeId,
    )
    candidates.push({
      text: item ? `You asked for this one: ${quoted(item.text)}.` : 'You asked for this one by name.',
      rank: TIER.stated + 30,
      ...(item ? { stateItemIds: [item.id] } : {}),
    })
  }

  // Words the search that found it was written for — re-checked against State as
  // it stands now, so a phrase the traveller has since deleted is not quoted back.
  const ownWords = [...state.intent, ...state.considering].map((item) => item.text).join('\n')
  const phrases = (place.foundFor ?? [])
    .map((words) => verifiedWords(words, ownWords))
    .filter((words): words is string => words !== undefined)
  if (phrases.length > 0) {
    candidates.push({
      text: `Found for ${listPhrase(phrases.map(quoted))}, from what you wrote.`,
      rank: TIER.stated + 5,
      stateItemIds: [...new Set(phrases.flatMap((words) => stateItemsFor(state, words)))],
    })
  }

  // Terms their State shares with the place, when ranking saw any. Only when no
  // search phrase already made the point, which is the stronger form of it.
  // One sentence, for the first term that can say both halves: the traveller's
  // own line it came from, and what about the place it matched.
  if (phrases.length === 0 && input.ranking) {
    const lines = [...state.intent, ...state.considering.filter((item) => !item.tag)]
    for (const term of matchedStateTerms(place, input.ranking)) {
      const line = lines.find((item) => wordsOf(item.text).some((word) => termMatchesWord(term, word)))
      const where = whereMatched(term, place)
      if (!line || !where) continue
      candidates.push({
        text: `For ${quoted(line.text)}: ${where}.`,
        rank: TIER.stated,
        stateItemIds: [line.id],
        // Says the review count already, so novelty need not say it again.
        ...(where.startsWith('mostly locals') ? { coversReviews: true } : {}),
      })
      break
    }
  }

  return candidates
}

// --- what was learnt about them -------------------------------------------------

/**
 * What stands behind a memory, counted by kind and with saved places named:
 * "5 places saved on Maps (Sawada, Hakkoku, Kizaki…), 9 screenshots and 4 photos".
 */
/** What a trait memory says, in words. */
const TRAIT_WORDS: Record<string, string> = {
  local: 'quieter places mostly locals know',
  known: 'places people know without being mobbed',
  landmark: 'the famous sights',
  literary: 'literary neighbourhoods', used_books: 'second-hand bookshop streets', kissaten: 'kissaten streets',
  showa: 'Showa-era streets', vintage: 'vintage neighbourhoods', live_music: 'live-music neighbourhoods',
  craft: 'craft neighbourhoods', traditional: 'old-Tokyo neighbourhoods', independent: 'neighbourhoods of small independent shops',
  coffee: 'coffee neighbourhoods', antiques: 'antique-shop streets',
}

function memorySentence(memory: Memory): string {
  if (memory.subject.facet === 'popularity' || memory.subject.facet === 'area_character') {
    const words = TRAIT_WORDS[memory.subject.value] ?? String(memory.subject.value).replace(/_/g, ' ')
    const leaning = memory.polarity > 0 ? 'like' : 'would rather avoid'
    return memory.provenance.type === 'explicit_statement'
      ? `You told me you ${leaning} ${words}.`
      : `You tend to ${leaning} ${words}.`
  }
  const category =
    memory.subject.facet === 'category' ? categoryWords(memory.subject.value) : undefined
  const subject = capitalised(category ?? 'This')
  const counts = memory.sourceCounts

  if (!counts) {
    // Said the way the memory actually arose. It used to say "turns up N times in
    // your photos and saved places" whatever the source — including for something
    // the traveller told us in words, and "1 times" besides.
    switch (memory.provenance.type) {
      case 'explicit_statement':
        return category ? `You told me you like ${category}.` : 'You told me this matters to you.'
      case 'agent_inference':
        return `${subject} is something I inferred from your trips.`
      default:
        return `${subject} turns up ${plural(memory.provenance.sourceRefs.length, 'time')} in your photos and saved places.`
    }
  }

  const examples = memory.examples ?? []
  const saved = counts.saved_place ?? 0
  const named =
    examples.length > 0
      ? ` (${examples.slice(0, EXAMPLES_SHOWN).join(', ')}${saved > EXAMPLES_SHOWN ? '…' : ''})`
      : ''
  const parts = [
    ...(saved > 0 ? [`${plural(saved, 'place')} saved on Maps${named}`] : []),
    ...(counts.screenshot ? [plural(counts.screenshot, 'screenshot')] : []),
    ...(counts.photo ? [plural(counts.photo, 'photo')] : []),
  ]
  return `${subject} keeps turning up in what you keep: ${listPhrase(parts)}.`
}

function fromMemory(input: ExplainStopInput): Candidate[] {
  // The most personal reason there is: they saved this very place.
  const savedIn = (input.memories ?? []).find((memory) =>
    (memory.examples ?? []).some((name) => sameName(name, input.place.name)),
  )
  const saved: Candidate[] = savedIn
    ? [{ text: 'You saved this place on Maps yourself.', rank: TIER.stated + 25, memoryIds: [savedIn.id] }]
    : []

  if (input.via.kind === 'memory') {
    return [
      ...saved,
      {
        text: memorySentence(input.via.memory),
        // A memory that CLAIMED the slot is what put the stop here, ahead of any
        // word the place also happens to match — so it leads. Only a must-visit,
        // which the traveller named outright, outranks it.
        rank: TIER.stated + 20,
        memoryIds: [input.via.memory.id],
      },
    ]
  }

  // Ranked on its merits, but a memory still pulled it up.
  const memoryId = input.scored?.memoryId
  const memory = memoryId ? input.memoryById?.(memoryId) : undefined
  if (memory && (input.scored?.components.memoryMatch ?? 0) > 0 && memory.polarity === 1) {
    return [
      ...saved,
      {
        // "What you usually save" is true only of a memory learnt from saved places.
        text:
          memory.subject.facet === 'category' && memory.provenance.type !== 'explicit_statement'
            ? `Close to what you usually save: ${categoryWords(input.place.category)}.`
            : memorySentence(memory),
        rank: TIER.inferred,
        memoryIds: [memory.id],
      },
    ]
  }

  // State won over a memory that pulled the other way (§0.2). Said, not hidden: the
  // memory has not gone away, this trip simply asked for something else.
  if (memory && (input.scored?.components.memoryMatch ?? 0) < 0 && input.ranking) {
    const terms = matchedStateTerms(input.place, input.ranking)
    const line = input.state.intent.find((item) => toTerms(item.text).some((term) => terms.includes(term)))
    if (line) {
      const usual = memorySentence(memory).replace(/^You told me you /, 'You usually ').replace(/^You tend to /, 'You usually ')
      return [
        ...saved,
        {
          text: `${usual.replace(/\.$/, '')} — included because this trip you asked for “${line.text}”.`,
          rank: TIER.inferred,
          memoryIds: [memory.id],
          stateItemIds: [line.id],
        },
      ]
    }
  }
  return saved
}

// --- what the ranking measured --------------------------------------------------

function fromComponents(input: ExplainStopInput): Candidate[] {
  const scored = input.scored
  if (!scored) return []

  const { place, state } = input
  const budget = budgetOf(state)
  const statedBudget = budget !== undefined
  const weightOf = new Map(contributions(scored.components, input.weights, statedBudget))
  const candidates: Candidate[] = []

  const convenience = scored.components.convenience
  const metres = distanceFrom(input)
  if (convenience !== null && convenience >= WORTH_SAYING && metres !== undefined && input.from) {
    candidates.push({
      text: travelPhrase(metres, input.from.name),
      rank: TIER.measured + (weightOf.get('convenience') ?? 0) * 10,
      priorityNames: ['convenience'],
    })
  }

  // Said only when it decided something: the next-best place would have broken the
  // budget. Every stop within budget saying so is a checklist, not a reason.
  const runnerUp = input.runnerUp?.place
  if (
    budget &&
    place.priceLevel !== undefined &&
    !overBudget(place, budget.level) &&
    runnerUp &&
    overBudget(runnerUp, budget.level)
  ) {
    const item = state.considering.find((entry) => entry.tag?.kind === 'budget')
    candidates.push({
      text: `Within the ${budget.level} budget you set — ${runnerUp.name} is not.`,
      rank: TIER.stated - 5,
      ...(item ? { stateItemIds: [item.id] } : {}),
      priorityNames: ['cost'],
      comparison: true,
    })
  }

  const novelty = scored.components.novelty
  if (novelty !== null && novelty >= WORTH_SAYING) {
    const firstOfKind = !(input.ranking?.usedCategories ?? []).includes(place.category)
    const reviews = place.userRatingCount
    const weight = (weightOf.get('novelty') ?? 0) * 10
    if (reviews !== undefined && reviews < LITTLE_KNOWN_REVIEWS) {
      candidates.push({
        text: `Not a tourist fixture — ${plural(reviews, 'review')}.`,
        rank: TIER.measured + weight,
        priorityNames: ['novelty'],
      })
    } else if (firstOfKind && input.via.kind !== 'memory' && !scored.memoryId) {
      // Not said of a category a memory stands behind: "you keep coming back to
      // izakaya" and "the first izakaya of the trip" read as a contradiction.
      // True, but the weakest thing novelty can say, so it yields to the rest.
      candidates.push({
        text: `The first ${categoryWords(place.category)} of the trip.`,
        rank: TIER.measured + weight / 2,
        priorityNames: ['novelty'],
      })
    }
  }

  const routeFit = scored.components.routeFit
  if (routeFit !== null && routeFit >= 0.7 && (input.ranking?.dayPoints.length ?? 0) > 1) {
    candidates.push({
      text: `Keeps Day ${input.dayIndex + 1} close together.`,
      rank: TIER.measured + (weightOf.get('routeFit') ?? 0) * 10,
      priorityNames: ['convenience'],
    })
  }

  return candidates
}

/**
 * A stop nobody ranked — placed by name, or an event — still has a distance from the
 * stop before it, and that is worth saying.
 */
function fromDistanceAlone(input: ExplainStopInput): Candidate[] {
  if (input.scored || !input.from) return []
  const metres = distanceFrom(input)
  if (metres === undefined || metres > WALK_UP_TO_METRES * 2) return []
  return [{ text: travelPhrase(metres, input.from.name), rank: TIER.measured + 5, priorityNames: ['convenience'] }]
}

function fromComparison(input: ExplainStopInput): Candidate[] {
  const runnerUp = input.runnerUp
  if (!runnerUp?.lostOn) return []
  return [
    {
      text: `Chosen over ${runnerUp.place.name}, which is ${lostPhrase(runnerUp.lostOn, input.from?.name)}.`,
      rank: TIER.comparison,
      comparison: true,
    },
  ]
}

// --- putting it together ----------------------------------------------------------

export function explainStop(input: ExplainStopInput): StopExplanation {
  const stated = [
    ...(input.trigger
      ? [{ text: input.trigger.text, rank: TIER.stated + 40, stateItemIds: input.trigger.stateItemIds }]
      : []),
    ...fromStatedWords(input),
  ]
  const reviewsSaid = stated.some((candidate) => candidate.coversReviews)
  const candidates = [
    ...stated,
    ...fromMemory(input),
    ...fromComponents(input).filter(
      (candidate) => !(reviewsSaid && candidate.text.startsWith('Not a tourist fixture')),
    ),
    ...fromDistanceAlone(input),
    ...fromComparison(input),
    {
      text: input.role
        ? `${input.role.label} for the ${input.place.neighborhood} part of the day.`
        : `A stop in ${input.place.neighborhood}.`,
      rank: TIER.fallback,
    },
  ].sort((a, b) => b.rank - a.rank)

  // The strongest reason decides; the comparison never does, and the fallback
  // only when nothing else can.
  const primary = candidates.find((candidate) => !candidate.comparison) ?? candidates[0]
  const rest = candidates.filter((candidate) => candidate !== primary && candidate.rank > TIER.fallback)
  // One comparison with the runner-up, the strongest: a budget it broke beats a
  // component it lost on.
  const comparison = rest.find((candidate) => candidate.comparison)
  const others = rest.filter((candidate) => !candidate.comparison)
  const secondary = [
    ...others.slice(0, comparison ? MAX_SECONDARY - 1 : MAX_SECONDARY),
    ...(comparison ? [comparison] : []),
  ]

  const chosen = [primary, ...secondary]
  const priorityNames = new Set(chosen.flatMap((candidate) => candidate.priorityNames ?? []))

  return {
    reasons: [
      { text: primary.text, strength: 'primary' },
      ...secondary.map((candidate) => ({ text: candidate.text, strength: 'secondary' as const })),
    ],
    refs: {
      stateItemIds: [...new Set(chosen.flatMap((candidate) => candidate.stateItemIds ?? []))],
      priorityIds: input.state.priorities
        .filter((priority) => priorityNames.has(priority.name.toLowerCase()))
        .map((priority) => priority.id),
      memoryIds: [...new Set(chosen.flatMap((candidate) => candidate.memoryIds ?? []))],
    },
  }
}

/** The reasons as one string, for every reader that wants the rationale whole. */
export function rationaleText(reasons: readonly StopReason[]): string {
  return reasons.map((reason) => reason.text).join(' ')
}
