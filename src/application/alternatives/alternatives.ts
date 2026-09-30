/**
 * Alternatives (product_spec §5.6).
 *
 * Three to five options drawn from the bounded Tokyo set — never invented, and
 * never a place already in the trip.
 *
 * Options come from the slot's SLATE first — the runners-up the generator kept
 * when it chose this stop — and only then from a live ranking of what is left.
 * That order matters: before the slate existed, alternatives were whatever the
 * plan had not used, which for a fifteen-stop plan drawn from thirty-three places
 * meant the eighteen the generator had already rejected. The options offered were
 * structurally the worst ones available.
 *
 * A slate is a cache of a ranking, not a promise, so every entry is re-checked
 * against the plan as it stands now: a place on this slot's slate may since have
 * been scheduled elsewhere, and a Reorganize may have moved the slot to an hour
 * the place is shut. Anything that fails is dropped and the live ranking tops the
 * list back up.
 *
 * Every option is also checked against the hours of the window it would
 * actually occupy — which is not the same window for every option. A same-slot
 * swap inherits the outgoing stop's exact times; one that needs longer runs from
 * the same start for its own duration. Offering a closed door as an alternative
 * is worse than offering fewer alternatives.
 *
 * The important distinction is the second one the spec draws: an alternative
 * that fits the same slot is a Replace and the user's tap IS the confirmation;
 * one that would push the rest of the day is a Reorganize and has to be
 * previewed first. That is decided here, from the slot length, and marked on
 * every option so the user can see which is which before tapping.
 */

import type { MemorySnapshot } from '../../domain/memory/types.ts'
import { categoriesFor, roleById } from '../../domain/plan/dayRoles.ts'
import { isOpenFor, weekdayKey } from '../../domain/places/openingHours.ts'
import { durationMinutes, findItem, fromMinutes, toMinutes, type Plan } from '../../domain/plan/types.ts'
import { retimeAfter } from '../../domain/plan/reschedule.ts'
import type { ScoreComponents } from '../../domain/ranking/score.ts'
import type { TripState } from '../../domain/state/types.ts'
import { dateOfDay } from '../../domain/trip/phase.ts'
import type { TripFrame } from '../../domain/trip/types.ts'
import type { DemoPlace, PlaceCatalogue } from '../../services/places/types.ts'
import { buildProposal, type BuildProposalOutcome } from '../planning/buildProposal.ts'
import { buildRankingContext, geographyForItem, rankCandidates } from '../planning/rankCandidates.ts'
import { lockedItemIds } from '../planning/tripContext.ts'

/** §5.6: "Show 3–5 options". */
export const MAX_ALTERNATIVES = 5

export interface Alternative {
  place: DemoPlace
  /** Why this one is being offered. Code-written; there is nothing to infer. */
  reason: string
  /** True when picking it reshapes the rest of the day (§5.6, §7.1). */
  shiftsSchedule: boolean
  /** Ranking score, 0-1. Ordering only — never shown as a number (§10.2). */
  score: number
  /** The components behind that score, for "Why this place?" and receipts. */
  components: ScoreComponents
}

function minutesNeeded(place: DemoPlace): number {
  return Math.max(30, place.typicalDurationMin)
}

/**
 * What this option is, relative to the stop it would replace.
 *
 * Three honest cases, and no fourth: same kind of place, same part of town, or
 * neither — in which case it says what it actually is and where it actually is.
 */
function describePlace(option: DemoPlace, current: DemoPlace): string {
  const kind = option.category.replace(/_/g, ' ')

  if (option.category === current.category) {
    return `Another ${kind}, in ${option.neighborhood}.`
  }
  if (option.neighborhood === current.neighborhood) {
    return `Also in ${current.neighborhood}, for a different kind of stop.`
  }
  return `A ${kind} in ${option.neighborhood}.`
}

/**
 * Why a runner-up came second, in the user's terms.
 *
 * Stated as a comparison with the stop that won, because that is the only
 * comparison this option was actually in. Saying "it is farther" without saying
 * farther than what would be a claim rather than a reason.
 */
const LOST_ON_REASON: Record<keyof ScoreComponents, string> = {
  stateMatch: 'Less of a match for what you asked for than the current stop.',
  memoryMatch: 'Less like the places you keep coming back to.',
  convenience: 'Further from the stop before it.',
  cost: 'Pricier than the current stop.',
  novelty: 'Closer to something the trip already has.',
  routeFit: 'Further from where the rest of that day sits.',
}

export function listAlternatives(input: {
  itemId: string
  frame: TripFrame
  state: TripState
  plan: Plan
  catalogue: PlaceCatalogue
  /** The trip's immutable snapshot, so a memory can lift its own categories. */
  memorySnapshot?: MemorySnapshot
  limit?: number
}): Alternative[] {
  const item = findItem(input.plan, input.itemId)
  if (!item) return []

  const current = input.catalogue.get(item.placeId)
  if (!current) return []

  const inPlan = input.plan.days.flatMap((day) => day.items.map((planned) => planned.placeId))
  const exclude = [...inPlan]

  // Ranked against the day WITHOUT the outgoing stop, so the place being
  // replaced does not anchor the scores to its own location and category.
  const ranking = buildRankingContext({
    state: input.state,
    memorySnapshot: input.memorySnapshot,
    catalogue: input.catalogue,
    geography: geographyForItem({ frame: input.frame, plan: input.plan, itemId: input.itemId }),
    weekday: weekdayKey(dateOfDay(input.frame, item.dayIndex)),
  })

  // What fits the slot leads, then the same area. The groups stay in that order —
  // a substitute for this slot is what the user opened the sheet for — and
  // ranking decides the order WITHIN each group.
  // Open on arrival at least; the per-option check below applies the real window.
  const openAt = { weekday: weekdayKey(dateOfDay(input.frame, item.dayIndex)), startTime: item.startTime, endTime: item.endTime }

  /**
   * The slot's own runners-up, in the order the generator ranked them, minus
   * anything that is no longer usable. Scored then, so the components are the
   * ones the losing comparison actually used.
   */
  const fromSlate = (item.slate ?? [])
    .map((entry) => {
      const place = input.catalogue.get(entry.placeId)
      return place
        ? { place, total: entry.score, components: entry.components, lostOn: entry.lostOn, previous: entry.previous }
        : undefined
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    .filter((entry) => !exclude.includes(entry.place.placeId))

  /**
   * Everything the slot itself allows, which is the role's category gate rather
   * than the outgoing place's own category.
   *
   * The two are not the same question. "Another ramen counter" is one answer to
   * "what else could dinner be"; it is not the question. Reading the gate off the
   * role is also what keeps this sheet and a chat-driven Replace offering the same
   * set — they disagreed while this tier was category-exact, and the sheet was the
   * one that looked broken: five ramen in the catalogue, three already in the trip
   * and the other two shut by six, so a dinner stop had exactly one alternative.
   *
   * A plan built before the role model carries no role, and then the outgoing
   * category is all there is to go on.
   */
  const role = item.role ? roleById(item.role) : undefined
  const eligible = role ? categoriesFor(role) : [current.category]

  const forSlot = rankCandidates(
    eligible.flatMap((category) =>
      input.catalogue.candidates({ category, excludePlaceIds: exclude, openAt }),
    ),
    ranking,
  )

  const sameArea = rankCandidates(
    input.catalogue
      .candidates({
        neighborhood: current.neighborhood,
        excludePlaceIds: [...exclude, ...forSlot.map((scored) => scored.place.placeId)],
        openAt,
      })
      .filter((place) => !eligible.includes(place.category)),
    ranking,
  )

  const window = durationMinutes(item)
  const weekday = weekdayKey(dateOfDay(input.frame, item.dayIndex))

  /** The window this option would occupy, which depends on how long it needs. */
  const occupies = (place: DemoPlace): { startTime: string; endTime: string } =>
    minutesNeeded(place) <= window
      ? { startTime: item.startTime, endTime: item.endTime }
      : { startTime: item.startTime, endTime: fromMinutes(toMinutes(item.startTime) + minutesNeeded(place)) }

  // Slate first, then the live ranking to top up, with no place twice.
  const seen = new Set<string>()
  const ordered = [...fromSlate, ...forSlot, ...sameArea].filter((entry) => {
    if (seen.has(entry.place.placeId)) return false
    seen.add(entry.place.placeId)
    return true
  })

  return ordered
    .filter((scored) => {
      const { startTime, endTime } = occupies(scored.place)
      return isOpenFor(scored.place.openingHours, weekday, startTime, endTime)
    })
    .slice(0, input.limit ?? MAX_ALTERNATIVES)
    .map((scored) => ({
      place: scored.place,
      reason: [
        // Written from the option's OWN attributes, not from which tier it came
        // through. Keying it off the tier let a slate entry from another part of
        // the city be described as "also in" the current stop's neighbourhood,
        // which was simply untrue.
        'previous' in scored && scored.previous ? 'What was here before you changed the trip.' : describePlace(scored.place, current),
        // Only claim a memory drove it when one actually did. Everything else
        // the score weighed is a comparison between options, and saying so on
        // an option the user has not compared would be a claim, not a reason.
        'memoryId' in scored && scored.memoryId ? 'The kind of place you keep coming back to.' : '',
        // A slate entry knows what it lost on, because it was compared with the
        // stop that won. A live-ranked one was never in that comparison.
        'lostOn' in scored && scored.lostOn ? LOST_ON_REASON[scored.lostOn] : '',
      ]
        .filter(Boolean)
        .join(' '),
      shiftsSchedule: minutesNeeded(scored.place) > window,
      score: scored.total,
      components: scored.components,
    }))
}

/**
 * Builds the proposal for a picked alternative. The caller commits a Replace
 * straight away (§5.6: selection is confirmation) and previews a Reorganize.
 */
export function proposeAlternative(input: {
  tripId: string
  frame: TripFrame
  state: TripState
  plan: Plan
  itemId: string
  placeId: string
  catalogue: PlaceCatalogue
  now: Date
  proposalId: string
  createdAt: string
}): BuildProposalOutcome {
  const item = findItem(input.plan, input.itemId)
  const place = input.catalogue.get(input.placeId)

  if (!item || !place) {
    return {
      kind: 'conflict',
      reason: 'That option is no longer available.',
      validation: { valid: false, errors: [] },
    }
  }

  const rationale = `${place.shortDescription} You picked it from the alternatives for this slot.`

  // Same-slot swap: identical start and end, so the diff is the place alone.
  const swapped: Plan = {
    ...input.plan,
    days: input.plan.days.map((day) => ({
      ...day,
      items: day.items.map((planned) =>
        planned.id === input.itemId
          ? { ...planned, placeId: place.placeId, rationale }
          : planned,
      ),
    })),
  }

  const needed = minutesNeeded(place)
  const fitsSlot = needed <= durationMinutes(item)

  let candidatePlan = swapped
  if (!fitsSlot) {
    const retimed = retimeAfter(swapped, {
      itemId: input.itemId,
      endTime: fromMinutes(toMinutes(item.startTime) + needed),
      lockedItemIds: lockedItemIds(input.frame, input.plan, input.now),
    })
    if (!retimed.fits) {
      return {
        kind: 'conflict',
        reason: `${place.name} needs ${needed} minutes, and the rest of that day cannot move to make room.`,
        validation: { valid: false, errors: [] },
      }
    }
    candidatePlan = retimed.plan
  }

  return buildProposal({
    tripId: input.tripId,
    frame: input.frame,
    catalogue: input.catalogue,
    now: input.now,
    proposalId: input.proposalId,
    createdAt: input.createdAt,
    initiator: 'user',
    trigger: `You chose ${place.name} from the alternatives`,
    rationale,
    currentState: input.state,
    currentPlan: input.plan,
    candidateState: input.state,
    candidatePlan,
  })
}
