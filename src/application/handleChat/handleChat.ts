/**
 * Chat -> candidate State / Plan -> validate -> diff -> classify -> proposal
 * (product_spec §6, §7).
 *
 * The order here is the whole point:
 *
 *   1. deterministic routing picks an OPERATION (not a change type)
 *   2. code (or, for a replacement, the LLM from a BOUNDED candidate set)
 *      builds a candidate State/Plan
 *   3. code re-checks every placeId against the catalogue — a hallucinated id
 *      is rejected here, before it can reach validation or the screen
 *   4. code validates the candidate
 *   5. code diffs
 *   6. code classifies
 *
 * The LLM never returns a change type, and never sees the words Replace,
 * Reorganize or Reframe. `classifyChange` decides, from the diff alone.
 * The committed Plan is never mutated — the proposal carries a candidate.
 */

import type { Memory, MemorySnapshot, MemorySubject } from '../../domain/memory/types.ts'
import { charactersIn } from '../../domain/places/areas.ts'
import { CATEGORY_BY_ID, categoriesNamedBy } from '../../domain/places/taxonomy.ts'
import { CROWD_WORDS } from '../../domain/ranking/score.ts'
import { proposeStateEdit, toStateDraft } from '../editState/proposeStateEdit.ts'
import { weekdayKey } from '../../domain/places/openingHours.ts'
import { categoriesFor, roleById } from '../../domain/plan/dayRoles.ts'
import { compressDayBefore, reduceStopsPerDay } from '../../domain/plan/reschedule.ts'
import type { Plan } from '../../domain/plan/types.ts'
import { allItems, findItem, type PlanItem } from '../../domain/plan/types.ts'
import { kmBetween } from '../../domain/places/geo.ts'
import { timePhase } from '../../domain/trip/phase.ts'
import { dateOfDay } from '../../domain/trip/phase.ts'
import type { TripState } from '../../domain/state/types.ts'
import type { ChangeUnit, Proposal } from '../../domain/proposals/types.ts'
import type { TripFrame } from '../../domain/trip/types.ts'
import type { ValidationResult } from '../../domain/validation/types.ts'
import type { PlaceCatalogue } from '../../services/places/types.ts'
import type { LlmService } from '../../services/llm/types.ts'
import { buildProposal } from '../planning/buildProposal.ts'
import { buildRankingContext, geographyForItem, rankCandidates } from '../planning/rankCandidates.ts'
import { canScheduleWith, lockedItemIds, mustVisitPlaceIds, slotCategories } from '../planning/tripContext.ts'
import { routeMessage, type ChatOperation } from './route.ts'
import { movementBudgetOf, preferWithinPace } from '../planning/movementBudget.ts'
import { preferInArea } from '../planning/areaDays.ts'
import { isOutdoor } from '../../domain/places/outdoor.ts'

export { resolveTargetItem, routeMessage } from './route.ts'
export type { ChatOperation } from './route.ts'

/**
 * `memoryCandidates`: things the traveller said about themselves, to be saved to the
 * Profile as CANDIDATES — never active until they confirm one (§10.3). Carried beside
 * the proposal, not inside it: confirming this trip's change does not confirm the
 * memory, and declining it does not discard the memory.
 */
export type ChatOutcome =
  | { kind: 'proposal'; proposal: Proposal; memoryCandidates?: Memory[] }
  /** `noChangeNeeded`: the request was understood and the plan already meets it. */
  | { kind: 'answer'; text: string; noChangeNeeded?: boolean; memoryCandidates?: Memory[] }
  | { kind: 'conflict'; reason: string; validation?: ValidationResult }

export interface HandleChatInput {
  message: string
  tripId: string
  frame: TripFrame
  state: TripState
  plan: Plan
  catalogue: PlaceCatalogue
  llm: LlmService
  now: Date
  proposalId: string
  createdAt: string
  /** Day the user is looking at, used when the message names no day. */
  focusDayIndex?: number
  /** The trip's immutable snapshot, so Replace ranks with the same memory. */
  memorySnapshot?: MemorySnapshot
  /** Id of the chat turn this message is, for the provenance of anything learnt from it. */
  turnId?: string
}

/** Max regeneration attempts before returning a Conflict (§8). */
export const MAX_GENERATION_ATTEMPTS = 3

/** Considering item id carrying the pace constraint a "fewer spots" Reframe adds. */
export const PACE_CONSIDERING_ID = 'cons_pace'

/**
 * Every operation funnels through the shared builder, which is what guarantees
 * no surface can skip validation or invent its own change type.
 */
function toProposal(
  input: HandleChatInput,
  candidate: { state: TripState; plan: Plan; rationale: string },
): ChatOutcome {
  return buildProposal({
    tripId: input.tripId,
    frame: input.frame,
    catalogue: input.catalogue,
    now: input.now,
    proposalId: input.proposalId,
    createdAt: input.createdAt,
    initiator: 'user',
    trigger: input.message,
    rationale: candidate.rationale,
    currentState: input.state,
    currentPlan: input.plan,
    candidateState: candidate.state,
    candidatePlan: candidate.plan,
  })
}

/** §12.1: "10-30 candidates per planning decision, not the entire dataset." */
const REPLACEMENT_CANDIDATES = 10

/**
 * Replace: the LLM picks from a bounded same-category candidate set, and the
 * chosen id is re-checked against the catalogue before anything else sees it.
 *
 * The set is RANKED before it is bounded, so the ten the model sees are the ten
 * that best fit the day rather than the first ten in the dataset. Cutting an
 * unordered list to ten is a silent editorial decision made by file order; this
 * makes it one the Priorities are responsible for. Order matters twice over —
 * models are sensitive to it, and the cut itself decides what can be chosen.
 */
async function replacePlace(
  input: HandleChatInput,
  operation: Extract<ChatOperation, { kind: 'replace_place' }>,
): Promise<ChatOutcome> {
  const outgoing = input.catalogue.get(operation.placeId)
  if (!outgoing) {
    return { kind: 'conflict', reason: `Place "${operation.placeId}" is not in the dataset.` }
  }

  // A replacement inherits the outgoing stop's exact times, so it has to be
  // open for that window — not merely open somewhere that day.
  const target = findItem(input.plan, operation.itemId)
  const openAt = target
    ? {
        weekday: weekdayKey(dateOfDay(input.frame, target.dayIndex)),
        startTime: target.startTime,
        endTime: target.endTime,
      }
    : undefined

  const ranking = buildRankingContext({
    state: input.state,
    memorySnapshot: input.memorySnapshot,
    catalogue: input.catalogue,
    geography: geographyForItem({
      frame: input.frame,
      plan: input.plan,
      itemId: operation.itemId,
    }),
    ...(openAt ? { weekday: openAt.weekday } : {}),
  })

  /**
   * What may fill the slot: the role's own category gate, not the outgoing place's
   * exact category.
   *
   * A closed ramen counter at dinner does not mean the evening has to be ramen. The
   * role is what says the slot is dinner, and §12.1 asks for "category relevance"
   * rather than category identity — so dinner can become the sushi counter or the
   * izakaya that is actually open, which is what a traveller told "it's closed today"
   * expects to be offered.
   *
   * It mattered immediately: five ramen in the catalogue, three of them already in
   * the trip, and neither of the other two open at six in the evening. Same-category
   * retrieval turned the demo's own scripted scenario into a Conflict.
   *
   * A plan built before the role model carries no role, and then the outgoing
   * category is the only thing there is to go on.
   */
  const role = target?.role ? roleById(target.role) : undefined
  const eligible = role ? slotCategories(role, input.memorySnapshot) : [outgoing.category]
  const alreadyPlanned = allItems(input.plan).map((item) => item.placeId)

  // A slow day stays walkable: candidates that keep it within its movement budget
  // come first, and only when none do does the budget give way.
  const pace = movementBudgetOf(input.state)
  const sameDay = target
    ? input.plan.days
        .find((day) => day.dayIndex === target.dayIndex)!
        .items.filter((item) => item.id !== target.id)
        .flatMap((item) => {
          const place = input.catalogue.get(item.placeId)
          return place ? [{ lat: place.lat, lng: place.lng, startTime: item.startTime }] : []
        })
    : []
  const pool = eligible.flatMap((category) =>
    input.catalogue.candidates({
      category,
      excludePlaceIds: alreadyPlanned,
      ...(openAt ? { openAt } : {}),
    }),
  )
  // On an area day the replacement is looked for in the same neighbourhood first.
  const area = target && target.role !== 'nightcap' ? input.plan.days.find((day) => day.dayIndex === target.dayIndex)?.area : undefined
  const candidates = rankCandidates(
    preferWithinPace(preferInArea(pool, area), sameDay, target?.startTime ?? '12:00', pace?.budget).candidates,
    ranking,
  )
    .slice(0, REPLACEMENT_CANDIDATES)
    .map((scored) => scored.place)

  if (candidates.length === 0) {
    return {
      kind: 'conflict',
      reason: role
        ? `Nothing else is open for ${role.label} at that time.`
        : `No alternative ${outgoing.category.replace(/_/g, ' ')} is open for that slot.`,
    }
  }

  let last: ChatOutcome | undefined

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const choice = await input.llm.chooseReplacement({
      message: input.message,
      outgoing,
      candidates,
    })

    // The model may only choose from what it was given. Re-checked here rather
    // than trusted, because a hallucinated id must never reach the validator.
    const replacement = candidates.find((place) => place.placeId === choice.placeId)
    if (!replacement) continue

    const candidatePlan: Plan = {
      ...input.plan,
      days: input.plan.days.map((day) => ({
        ...day,
        items: day.items.map((item) =>
          item.id === operation.itemId
            ? { ...item, placeId: replacement.placeId, rationale: choice.rationale }
            : item,
        ),
      })),
    }

    last = toProposal(input, {
      state: input.state,
      plan: candidatePlan,
      rationale: choice.rationale,
    })
    if (last.kind === 'proposal') return last
  }

  return (
    last ?? {
      kind: 'conflict',
      reason: 'I could not find a replacement that fits the rest of the day.',
    }
  )
}

/**
 * Reorganize: pull a day forward so it finishes before a cut-off.
 *
 * No model call and no retry loop — the transform's own gap ladder is the
 * retry, and re-running a deterministic function would produce the same plan.
 */
function clearAfter(
  input: HandleChatInput,
  operation: Extract<ChatOperation, { kind: 'clear_after' }>,
): ChatOutcome {
  const result = compressDayBefore(input.plan, {
    dayIndex: operation.dayIndex,
    endBy: operation.endBy,
    lockedItemIds: lockedItemIds(input.frame, input.plan, input.now),
    protectedPlaceIds: mustVisitPlaceIds(input.state),
    canSchedule: canScheduleWith(input.frame, input.catalogue),
  })

  if (!result.fits) {
    return {
      kind: 'conflict',
      reason: `Day ${operation.dayIndex + 1} cannot finish by ${operation.endBy} without dropping something you asked to keep.`,
    }
  }

  const droppedNames = result.dropped
    .map((item) => input.catalogue.get(item.placeId)?.name ?? item.placeId)
    .join(', ')

  const rationale = [
    `Day ${operation.dayIndex + 1} now finishes by ${operation.endBy}, with the stops moved earlier in the same order.`,
    droppedNames && `${droppedNames} did not fit before the cut-off.`,
  ]
    .filter(Boolean)
    .join(' ')

  return toProposal(input, { state: input.state, plan: result.plan, rationale })
}

/**
 * Weather: what is outdoors once it turns moves indoors, in place (decided 2026-09-30).
 *
 * Indoor stops — a museum, a meal — are untouched, and so is the length of the day.
 * Each affected stop is re-chosen for the same slot from indoor places open then,
 * keeping to a slow pace if State asks for one; only when nothing indoor is open is it
 * taken out. Nothing outdoors after the change means nothing to do, and the traveller
 * is told so rather than handed a proposal for its own sake.
 */
function weatherAfter(
  input: HandleChatInput,
  operation: Extract<ChatOperation, { kind: 'weather_after' }>,
): ChatOutcome {
  const locked = new Set(lockedItemIds(input.frame, input.plan, input.now))
  const pinned = new Set(mustVisitPlaceIds(input.state))
  const day = input.plan.days.find((entry) => entry.dayIndex === operation.dayIndex)!
  const affected = day.items.filter((item) => {
    const place = input.catalogue.get(item.placeId)
    return (
      place !== undefined &&
      isOutdoor(place.category) &&
      item.endTime > operation.from &&
      !locked.has(item.id) &&
      !pinned.has(item.placeId) &&
      item.placedBy !== 'user' &&
      item.placedBy !== 'event'
    )
  })

  if (affected.length === 0) {
    return {
      kind: 'answer',
      text: `Nothing on Day ${operation.dayIndex + 1}${operation.from === '00:00' ? '' : ` after ${operation.from}`} is outdoors, so the plan holds as it is. Worth an umbrella for getting between stops.`,
      noChangeNeeded: true,
    }
  }

  const weekday = weekdayKey(dateOfDay(input.frame, operation.dayIndex))
  const pace = movementBudgetOf(input.state)
  const inPlan = new Set(allItems(input.plan).map((item) => item.placeId))
  let plan = input.plan
  const lines: string[] = []

  for (const item of affected) {
    const role = item.role ? roleById(item.role) : undefined
    const indoor = (role ? slotCategories(role, input.memorySnapshot) : []).filter((category) => !isOutdoor(category))
    const openAt = { weekday, startTime: item.startTime, endTime: item.endTime }
    const area = item.role !== 'nightcap' ? plan.days.find((entry) => entry.dayIndex === item.dayIndex)?.area : undefined
    const pool = preferInArea(
      indoor.flatMap((category) => input.catalogue.candidates({ category, excludePlaceIds: [...inPlan], openAt })),
      area,
    )
    const others = plan.days
      .find((entry) => entry.dayIndex === item.dayIndex)!
      .items.filter((entry) => entry.id !== item.id)
      .flatMap((entry) => {
        const place = input.catalogue.get(entry.placeId)
        return place ? [{ lat: place.lat, lng: place.lng, startTime: entry.startTime }] : []
      })
    const ranking = buildRankingContext({
      state: input.state,
      memorySnapshot: input.memorySnapshot,
      catalogue: input.catalogue,
      geography: geographyForItem({ frame: input.frame, plan, itemId: item.id }),
      weekday,
    })
    const best = rankCandidates(preferWithinPace(pool, others, item.startTime, pace?.budget).candidates, ranking)[0]
    const outgoing = input.catalogue.get(item.placeId)!.name

    if (best) {
      inPlan.add(best.place.placeId)
      const reason = `${operation.from === '00:00' ? 'Rain all day' : `Rain from ${operation.from}`}: ${best.place.name} is indoors, in place of ${outgoing}.`
      plan = {
        ...plan,
        days: plan.days.map((entry) => ({
          ...entry,
          items: entry.items.map((stop) =>
            stop.id === item.id
              ? { ...stop, placeId: best.place.placeId, placedBy: 'ranking' as const, rationale: reason, reasons: [{ text: reason, strength: 'primary' as const }] }
              : stop,
          ),
        })),
      }
      lines.push(`${outgoing} → ${best.place.name}`)
    } else {
      plan = { ...plan, days: plan.days.map((entry) => ({ ...entry, items: entry.items.filter((stop) => stop.id !== item.id) })) }
      lines.push(`${outgoing} is out — nothing indoors is open then`)
    }
  }

  const rationale = `${operation.from === '00:00' ? 'Rain all day' : `Rain from ${operation.from}`} on Day ${operation.dayIndex + 1}: ${lines.join('; ')}. Everything indoors stays as it was.`
  return toProposal(input, { state: input.state, plan, rationale })
}

/**
 * Reframe: "fewer spots" is a change of trip direction, not a change of stop,
 * so it edits State as well as Plan. The classifier then reads the non-empty
 * State diff and returns Reframe — nothing here asserts the type.
 */
function fewerStops(
  input: HandleChatInput,
  operation: Extract<ChatOperation, { kind: 'fewer_stops' }>,
): ChatOutcome {
  const paceText = `Fewer stops each day — at most ${operation.maxPerDay}.`

  const existing = input.state.considering.find((item) => item.id === PACE_CONSIDERING_ID)
  if (existing?.text === paceText) {
    return {
      kind: 'answer',
      text: `The plan is already down to ${operation.maxPerDay} stops a day. Tell me which day still feels heavy and I'll look at it.`,
    }
  }

  const considering = existing
    ? input.state.considering.map((item) =>
        item.id === PACE_CONSIDERING_ID ? { ...item, text: paceText } : item,
      )
    : [...input.state.considering, { id: PACE_CONSIDERING_ID, text: paceText }]

  const candidateState: TripState = { ...input.state, considering }

  // Which days: from today on during the trip, every day before it.
  const today = timePhase(input.frame, input.now) === 'in_trip'
    ? Math.max(0, Math.floor((input.now.getTime() - dateOfDay(input.frame, 0).getTime()) / 86_400_000))
    : 0
  const dayIndexes = input.plan.days.map((day) => day.dayIndex).filter((dayIndex) => dayIndex >= today)

  // Meals stay: a tired traveller still eats. What goes is the stop that costs the
  // most getting to and from — tiredness is travel, not stop count (movement.ts) —
  // with the optional parts of the day before the anchor.
  const lodging = input.catalogue.get(input.frame.baseLodging.placeId)
  const where = (placeId: string) => input.catalogue.get(placeId) ?? lodging
  const hop = (a?: { lat: number; lng: number }, b?: { lat: number; lng: number }) => (a && b ? kmBetween(a, b) : 0)
  const meals = allItems(input.plan).filter((item) => item.role === 'lunch' || item.role === 'dinner').map((item) => item.id)
  const dropValue = (item: PlanItem, day: PlanItem[]) => {
    const index = day.findIndex((entry) => entry.id === item.id)
    const before = index > 0 ? where(day[index - 1].placeId) : lodging
    const after = index < day.length - 1 ? where(day[index + 1].placeId) : lodging
    const here = where(item.placeId)
    const saved = hop(before, here) + hop(here, after) - hop(before, after)
    const optional = item.role && roleById(item.role)?.required === false ? 100 : 0
    return optional + saved
  }

  const result = reduceStopsPerDay(input.plan, {
    maxPerDay: operation.maxPerDay,
    keepItemIds: meals,
    dropValue,
    dayIndexes,
    lockedItemIds: lockedItemIds(input.frame, input.plan, input.now),
    protectedPlaceIds: mustVisitPlaceIds(input.state),
  })

  const name = (placeId: string) => input.catalogue.get(placeId)?.name ?? placeId
  const scope = today > 0 ? `from Day ${today + 1} on` : 'on each day'
  if (result.dropped.length === 0) {
    return {
      kind: 'answer',
      text: `Every day ${scope} is already down to its meals and what you asked for by name, so there is nothing more I can take out. Tell me which day feels heavy and I'll look at shortening it instead.`,
    }
  }
  const rationale =
    `I took out one stop a day ${scope} — the one that meant the most travel — and kept your meals. ` +
    'Keep any day as it was by declining its change.'

  // One declinable change per day, so "I'm tired" can mean today only.
  const units: ChangeUnit[] = result.dropped.map((item) => ({
    id: `unit_rest_${item.id}`,
    summary: `Day ${item.dayIndex + 1} · ${item.startTime}: ${name(item.placeId)} → out`,
    reason: 'Less travel that day.',
    required: false,
    removeItemIds: [item.id],
    putItems: [],
  }))

  const outcome = toProposal(input, { state: candidateState, plan: result.plan, rationale })
  return outcome.kind === 'proposal' && units.length > 0 ? { ...outcome, proposal: { ...outcome.proposal, units } } : outcome
}

// --- things the traveller says about themselves ------------------------------------

const QUIET_WORDS = /\bquiet\b|\bpeaceful\b|\bhidden\b|\bless crowded\b|\boff the beaten\b|安靜|人少/i
const AREA_WORDS = /\bneighbou?rhoods?\b|\bareas?\b|\bstreets?\b|\bdistricts?\b|街區|街道|一帶/i

/**
 * What a statement says about the traveller, as memory subjects.
 *
 * Deterministic, and only into the vocabulary the planner reads: a crowd or a quiet
 * word is popularity, a kind of neighbourhood is area character (only when they say
 * neighbourhood — "I love bookstores" is about shops), and a named kind of place is a
 * category. Anything else is not guessed at.
 */
function subjectsIn(text: string): MemorySubject[] {
  const subjects: MemorySubject[] = []
  if (CROWD_WORDS.test(text)) subjects.push({ facet: 'popularity', value: 'landmark' })
  else if (QUIET_WORDS.test(text)) subjects.push({ facet: 'popularity', value: 'local' })
  if (AREA_WORDS.test(text)) {
    for (const character of charactersIn(text)) subjects.push({ facet: 'area_character', value: character })
  }
  for (const category of categoriesNamedBy(text)) {
    if (CATEGORY_BY_ID.get(category)?.interestPoint) subjects.push({ facet: 'category', value: category })
  }
  return subjects
}

/**
 * "I never enjoy crowded tourist spots" (eval M3, 2026-09-30).
 *
 * Two independent results, as §6.2 and the eval ask:
 *
 *   future trips  a candidate Memory per subject, provenance the chat turn itself,
 *                 status candidate — the traveller confirms it in the Profile or not
 *   this trip     a Reframe proposal adding the matching State line ("Avoid crowded
 *                 tourist spots"), built through the ordinary State-edit path, so it
 *                 re-chooses only the stops it rules out and is previewed first
 *
 * Neither implies the other. The trip snapshot is not touched: a memory confirmed now
 * shapes the next trip, not this one (§10.5) — this one changes only through State.
 */
function statePreference(
  input: HandleChatInput,
  operation: Extract<ChatOperation, { kind: 'preference_statement' }>,
): ChatOutcome {
  const subjects = subjectsIn(operation.text)
  if (subjects.length === 0) {
    return {
      kind: 'answer',
      text: 'Noted — which kind of places do you mean? A type (sushi, bookstores), a kind of neighbourhood, or how busy a place is?',
    }
  }

  const sourceRef = input.turnId ?? `chat:${input.proposalId}`
  const memoryCandidates: Memory[] = subjects.map((subject, index) => ({
    id: `mem_chat_${input.proposalId}_${index + 1}`,
    text: operation.text,
    status: 'candidate',
    kind: operation.polarity > 0 ? 'preference' : 'aversion',
    subject,
    polarity: operation.polarity,
    strength: 0.6,
    confidence: 0.7,
    provenance: { type: 'explicit_statement', sourceRefs: [sourceRef], createdAt: input.createdAt },
  }))

  // This trip: an aversion becomes an `avoid`, a liking an Intent line.
  const draft = toStateDraft(input.state)
  const avoidText = subjects.some((subject) => subject.facet === 'popularity' && subject.value === 'landmark')
    ? 'Avoid crowded tourist spots'
    : `Avoid ${subjects.filter((subject) => subject.facet === 'category').map((subject) => String(subject.value).replace(/_/g, ' ')).join(' and ')}`
  if (operation.polarity < 0 && !/^Avoid\s*$/.test(avoidText)) {
    draft.considering.push({ id: `cons_pref_${input.proposalId}`, text: avoidText })
  } else {
    draft.intent.push({ id: `intent_pref_${input.proposalId}`, text: operation.text })
  }

  const edit = proposeStateEdit({
    tripId: input.tripId, frame: input.frame, state: input.state, plan: input.plan, draft,
    catalogue: input.catalogue, now: input.now, proposalId: input.proposalId, createdAt: input.createdAt,
    memorySnapshot: input.memorySnapshot,
  })
  const saved = `I've added this to your Profile to confirm for future trips.`

  if (edit.kind === 'proposal' || edit.kind === 'commit_now') {
    const changes = edit.proposal.planDiff.added.length + edit.proposal.planDiff.removed.length + edit.proposal.planDiff.modified.length
    return {
      kind: 'proposal',
      memoryCandidates,
      proposal: {
        ...edit.proposal,
        trigger: operation.text,
        rationale:
          changes > 0
            ? `For this trip I'd change ${changes === 1 ? 'one stop' : `${changes} stops`} to match. ${saved}`
            : `Nothing in the plan clashes with it now; this keeps later changes to it. ${saved}`,
      },
    }
  }
  return { kind: 'answer', text: `${saved} This trip stays as it is.`, memoryCandidates }
}

export async function handleChatMessage(input: HandleChatInput): Promise<ChatOutcome> {
  const operation = routeMessage({
    message: input.message,
    plan: input.plan,
    catalogue: input.catalogue,
    focusDayIndex: input.focusDayIndex,
  })

  switch (operation.kind) {
    case 'replace_place':
      return replacePlace(input, operation)
    case 'clear_after':
      return clearAfter(input, operation)
    case 'weather_after':
      return weatherAfter(input, operation)
    case 'fewer_stops':
      return fewerStops(input, operation)
    case 'preference_statement':
      return statePreference(input, operation)
    default:
      return {
        kind: 'answer',
        text: 'I could not tell which place you mean. Which day and which stop should I look at?',
      }
  }
}
