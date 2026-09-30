/**
 * First Plan generation (product_spec §12, Gate 3 step 3).
 *
 * Deterministic on purpose. §0.3 puts deterministic code before LLM judgment,
 * and the vertical slice needs a reproducible Plan v1 for its tests. The LLM's
 * role in this slice is decomposition (Stage B) and replacement choice (step 6),
 * not first-plan construction.
 *
 * The plan is validated before it is ever returned for display (§8).
 *
 * Within a slot the category is chosen by the rules below; WHICH place fills it
 * is decided by `rankCandidates` (§12.2), so Priorities, budget, `avoid` and the
 * day's geography all bear on the choice. Before that layer existed this took
 * the first match in dataset order, and a Priority changed nothing.
 *
 * A memory's claim on the plan is BOUNDED — see `claimsAllowed`. An
 * unbounded claim let one confirmed memory take every eligible slot of every
 * day, which put five p4 sushi counters into a trip whose Considering said
 * "moderate budget" and left no ramen anywhere for a later request to talk
 * about. The research harness measured both.
 *
 * Memory's effect is concentrated here: categories carried by the trip's
 * immutable snapshot get first claim on a slot they are eligible for, and the
 * resulting item records the memory id in `rationaleRefs.memoryIds`. That is
 * what makes "Memory -> recommendation -> rationale" traceable rather than
 * decorative — and it reads the snapshot only, so activating a memory later
 * cannot alter an existing trip (§10.5).
 */

import { categoryPreferences, claimsAllowed, findInSnapshot, planShape } from '../../domain/memory/preferences.ts'
import {
  isOpenFor,
  weekdayKey,
  windowCovering,
  type WeekdayKey,
} from '../../domain/places/openingHours.ts'
import { dateOfDay } from '../../domain/trip/phase.ts'
import type { MemorySnapshot } from '../../domain/memory/types.ts'
import { validatePlan } from '../../domain/validation/validate.ts'
import type { ValidationResult } from '../../domain/validation/types.ts'
import {
  categoriesFor,
  DEFAULT_STOPS_PER_DAY,
  MEAL_CATEGORIES,
  roleById,
  rolesForPace,
  type DayRole,
  type DayRoleId,
} from '../../domain/plan/dayRoles.ts'
import type { Plan, PlanDay, PlanItem } from '../../domain/plan/types.ts'
import type { TripState } from '../../domain/state/types.ts'
import type { TripFrame } from '../../domain/trip/types.ts'
import { overBudget } from '../../domain/places/facets.ts'
import { budgetOf, slotCategories } from '../planning/tripContext.ts'
import { movementBudgetOf, preferWithinPace } from '../planning/movementBudget.ts'
import { areaDaysFor, inArea, preferInArea } from '../planning/areaDays.ts'
import { explainStop, rationaleText } from './explainStop.ts'
import { toValidationPlaces } from '../../services/places/catalogue.ts'
import type { ScoredPlace } from '../../domain/ranking/score.ts'
import type { DemoPlace, PlaceCatalogue } from '../../services/places/types.ts'
import {
  buildRankingContext,
  priorityWeights,
  rankCandidates,
  slateFrom,
} from '../planning/rankCandidates.ts'

function addMinutes(time: string, minutes: number): string {
  const [hours, mins] = time.split(':').map(Number)
  const total = hours * 60 + mins + minutes
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Stops of one kind a trip holds before another of that kind has to wait. */
export const SATURATION_COUNT = 3

/** The shortest stop worth scheduling; also the window retrieval filters on. */
const MIN_STOP_MINUTES = 30

function toMinutes(time: string): number {
  const [hours, mins] = time.split(':').map(Number)
  return hours * 60 + mins
}

/**
 * Caps a stop so it cannot overrun the role's own window OR the place's closing
 * time.
 *
 * The closing cap is what makes the retrieval filter sufficient: retrieval only
 * knows the role's start and a minimum stop length, so a place open for 40 more
 * minutes can still be chosen for a 90-minute stop. Capping here keeps the
 * visit inside the door rather than leaving the validator to reject the plan.
 *
 * The role window cap is what keeps the day's shape: roles leave a gap between
 * stops for getting between them, and a long museum visit must not eat it.
 */
function stopEnd(role: DayRole, place: DemoPlace, weekday: WeekdayKey): string {
  const start = role.window.from
  // The window the stop actually starts in, not the day's first: a counter open
  // 12:00-14:00 and 18:00-20:30 must cap a dinner at 20:30, not at 14:00.
  const closes = windowCovering(place.openingHours, weekday, start)?.closes

  const candidates = [
    addMinutes(start, Math.max(MIN_STOP_MINUTES, place.typicalDurationMin)),
    role.window.to,
  ]
  if (closes !== undefined) candidates.push(fromMinutes(closes))
  return candidates.reduce((earliest, time) => (time < earliest ? time : earliest))
}

/** The stop's own reasons, with the area day's leading and the pace note trailing. */
function withExtraReasons(
  reasons: readonly { text: string; strength: 'primary' | 'secondary' }[],
  areaReason: string | undefined,
  paceReason: string | undefined,
): Array<{ text: string; strength: 'primary' | 'secondary' }> {
  return [
    ...(areaReason ? [{ text: areaReason, strength: 'primary' as const }] : []),
    ...reasons,
    ...(paceReason ? [{ text: paceReason, strength: 'secondary' as const }] : []),
  ]
}

function fromMinutes(total: number): string {
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * A stop that sits against something the traveller stated, and why it is there
 * anyway (§0.2's precedence, §7.5's refusal to hide a cost).
 *
 * The precedence lattice decides which signal wins, and sometimes the answer is
 * that a stated constraint loses — to a bounded memory claim, or to there being
 * nothing else open. A plan that quietly went over a stated budget and said
 * nothing would be the worst of the three outcomes: measurement found three such
 * stops in the demo trip and the plan reported itself valid.
 *
 * Not a validation error. The plan is not wrong; it is a plan the traveller
 * should be told something about.
 */
export interface PlanTension {
  itemId: string
  placeId: string
  /** What the traveller stated, in the terms they stated it. */
  stated: string
  /**
   * Why the stop is there regardless.
   *
   *   `memory_claim`  an active memory claimed the slot, within its bound
   *   `only_option`   nothing else was open for that slot
   *   `ranking_chose` ranking preferred it, which the lattice should prevent —
   *                   surfaced rather than swallowed so it cannot go unnoticed
   *   `pace_yielded`  nothing open for the role kept the day to the movement
   *                   budget a slow pace sets, so the day moves more than asked
   */
  because: 'memory_claim' | 'only_option' | 'ranking_chose' | 'pace_yielded'
  memoryId?: string
}

/**
 * A part of a day the catalogue could not fill.
 *
 * Reported rather than silently skipped. A day coming back a stop short is the
 * candidate set running out, and staying quiet about it is how that went unnoticed
 * through four steps running — alternatives below the spec's floor, half the facets
 * dropped, a geography budget with nothing to choose between, and a stop over a
 * stated budget because it was the only thing open.
 */
export interface UnfilledRole {
  dayIndex: number
  role: DayRoleId
  because: 'nothing_available'
}

export interface GeneratePlanResult {
  plan: Plan
  validation: ValidationResult
  /** Stops that sit against a stated constraint. Empty when none do. */
  tensions: PlanTension[]
  /** Parts of a day left empty, with the reason. Empty when every role filled. */
  unfilled: UnfilledRole[]
}

/**
 * Builds Plan v1 by filling three slots a day from the bounded catalogue,
 * never repeating a place, and honouring must-visit Considering items first.
 */
export function generateFirstPlan(input: {
  frame: TripFrame
  state: TripState
  catalogue: PlaceCatalogue
  days: number
  now: Date
  /** The trip's immutable active-Memory snapshot. Absent = no memory influence. */
  memorySnapshot?: MemorySnapshot
}): GeneratePlanResult {
  const used = new Set<string>([input.frame.baseLodging.placeId])

  // Must-visits are placed before anything else competes for a slot.
  // A pin with a day waits for that day; one without takes the first role it fits.
  const pending = input.state.considering
    .flatMap((item) => (item.tag?.kind === 'must_visit' ? [item.tag] : []))
    .filter((tag) => input.catalogue.has(tag.placeId))
    .map((tag) => ({ placeId: tag.placeId, dayIndex: tag.dayIndex }))
  const preferences = categoryPreferences(input.memorySnapshot)

  // Slots each memory has already claimed, across the whole trip, against a
  // limit the memory carries itself (§10: `scope.ratePerDay`).
  const claimed = new Map<string, number>()
  const claimLimitOf = (memoryId: string): number => {
    const memory = findInSnapshot(input.memorySnapshot, memoryId)
    return memory ? claimsAllowed(memory, input.days) : 1
  }

  /**
   * How many stops a day should hold, from a `pattern` memory.
   *
   * Before pattern memories were typed, this memory was discarded outright:
   * preference extraction dropped anything without a category, and the pace memory
   * has none. It now decides which of the day's roles are in play — an unhurried
   * traveller gets the anchor and the two meals, and a full day gets all eight.
   *
   * No measurement means the shared default — a real day rather than the fullest
   * possible one. Retrieval reads the same constant, so the searches issued and the
   * roles planned describe the same day.
   */
  const shape = planShape(input.memorySnapshot)
  const stopsPerDay = Math.max(1, shape.stopsPerDay?.value ?? DEFAULT_STOPS_PER_DAY)

  const budget = budgetOf(input.state)
  // Days spent in a neighbourhood the traveller's words or memories point at.
  const lodgingPlace = input.catalogue.get(input.frame.baseLodging.placeId)
  const areaDays = lodgingPlace
    ? areaDaysFor({
        state: input.state,
        snapshot: input.memorySnapshot,
        pool: input.catalogue.all(),
        lodging: lodgingPlace,
        days: input.days,
        ...(planShape(input.memorySnapshot).daySpanMetres ? { radiusMetres: planShape(input.memorySnapshot).daySpanMetres!.value } : {}),
      })
    : []
  /** What the day's lunch can be, so an area day's main stop leaves those to it. */
  const lunchRole = roleById('lunch')
  const lunchCategories = lunchRole ? categoriesFor(lunchRole) : []
  // "Slow" as the traveller means it: few moves, few neighbourhoods (movement.ts).
  const pace = movementBudgetOf(input.state)
  const tensions: PlanTension[] = []

  const days: PlanDay[] = []
  const unfilled: UnfilledRole[] = []

  // Anchors first, then the stops that hang off them. Day order would mean choosing
  // an "on the way" stop before the destination it is meant to be on the way to —
  // and the role model says which anchor each one belongs to, which is only usable
  // if the anchor is already placed.
  const roles = rolesForPace(stopsPerDay)
  const required = roles.filter((role) => role.required)
  const optional = roles.filter((role) => !role.required)

  for (let dayIndex = 0; dayIndex < input.days; dayIndex++) {
    const weekday = weekdayKey(dateOfDay(input.frame, dayIndex))
    const areaDay = areaDays.find((entry) => entry.dayIndex === dayIndex)
    const filled = new Map<DayRoleId, PlanItem>()
    // The day's path so far. Grows as roles fill, so each choice is ranked against
    // where the day has actually reached rather than against the trip.
    const dayPlaceIds: string[] = [input.frame.baseLodging.placeId]

    const fill = (role: DayRole): void => {
      const start = role.window.from

      let chosen: DemoPlace | undefined
      let viaMemoryId: string | undefined
      /** The ranking the winner was scored in, kept so its reasons can cite it. */
      let ranking: ReturnType<typeof buildRankingContext> | undefined
      /** The pool the winner was chosen from, kept for the role's slate. */
      let ranked: Array<ScoredPlace<DemoPlace>> = []
      /** Set when the movement budget changed which place won this role. */
      let paceReason: string | undefined
      let paceYielded = false
      const dayPoints = [...filled.values()].map((item) => ({
        ...input.catalogue.get(item.placeId)!,
        startTime: item.startTime,
      }))
      // On an area day every part of the day but the late one is looked for there first.
      const areaForRole = areaDay && role.id !== 'nightcap' ? areaDay.area : undefined
      /** Ranks a pool, keeping to the area and the movement budget when any candidate can. */
      // An optional stop is not the same kind of place as the stop right before it —
      // no second kissaten straight after a kissaten lunch — unless nothing else is open.
      const previous = [...filled.values()]
        .filter((item) => item.startTime < start)
        .sort((a, b) => b.startTime.localeCompare(a.startTime))[0]
      const previousCategory = !role.required && previous ? input.catalogue.get(previous.placeId)?.category : undefined
      // Nor a fourth of a kind for the trip: a fourth bookshop adds less than a
      // first kissaten (eval R2), so a kind used SATURATION_COUNT times waits unless
      // nothing else is open. Meals are left to their own roles.
      const usedCount = (category: string) =>
        [...used].filter((placeId) => input.catalogue.get(placeId)?.category === category).length
      const notRepeating = (pool: DemoPlace[]) => {
        const fresh = pool.filter(
          (place) =>
            place.category !== previousCategory &&
            (MEAL_CATEGORIES.includes(place.category) ||
              (role.id === 'lunch' && lunchCategories.includes(place.category)) ||
              usedCount(place.category) < SATURATION_COUNT),
        )
        if (fresh.length > 0) return fresh
        const different = pool.filter((place) => place.category !== previousCategory)
        return different.length > 0 ? different : pool
      }
      const rankWithinPace = (pool: DemoPlace[], context: ReturnType<typeof buildRankingContext>) => {
        const kept = preferWithinPace(notRepeating(preferInArea(pool, areaForRole)), dayPoints, start, pace?.budget)
        if (kept.yielded) paceYielded = true
        const result = rankCandidates(kept.candidates, context)
        if (kept.filtered && pace) {
          const unconstrained = rankCandidates(pool, context)[0]
          if (unconstrained && result[0] && unconstrained.place.placeId !== result[0].place.placeId) {
            paceReason = `Keeps Day ${dayIndex + 1} to a walk rather than a trip across town, for “${pace.source.text}”.`
          }
        }
        return result
      }

      // Only places open for at least a minimum stop at this role's start are
      // candidates for it (§12.1).
      const openAt = { weekday, startTime: start, endTime: addMinutes(start, MIN_STOP_MINUTES) }

      // A must-visit waits for a role it is actually open for, rather than taking
      // the next one going. Scheduling a pinned place behind a locked door honours
      // the letter of the constraint and none of the point of it; a must-visit that
      // fits nowhere is left out, and `must_visit_missing` then reports it against
      // the user's own sentence (§3.6.5).
      // An area day's main stop may be what makes the area: a bookshop street's bookshop.
      const eligible =
        areaDay && role.id === 'main_destination'
          ? [...new Set([...slotCategories(role, input.memorySnapshot), ...areaDay.categories])]
          : slotCategories(role, input.memorySnapshot)
      const forcedIndex = pending.findIndex((pin) => {
        const place = input.catalogue.get(pin.placeId)
        return (
          place !== undefined &&
          (pin.dayIndex === undefined || pin.dayIndex === dayIndex) &&
          eligible.includes(place.category) &&
          isOpenFor(place.openingHours, weekday, openAt.startTime, openAt.endTime)
        )
      })

      // An "on the way" stop is ranked against the anchor it belongs to, not
      // against whatever happened to be scheduled last.
      const anchorPlaceId =
        role.scope.kind === 'near_anchor'
          ? (filled.get(role.scope.anchorRole)?.placeId ?? dayPlaceIds[dayPlaceIds.length - 1])
          : dayPlaceIds[dayPlaceIds.length - 1]

      if (forcedIndex !== -1) {
        chosen = input.catalogue.get(pending.splice(forcedIndex, 1)[0].placeId)
      } else {
        ranking = buildRankingContext({
          state: input.state,
          memorySnapshot: input.memorySnapshot,
          catalogue: input.catalogue,
          geography: { anchorPlaceId, dayPlaceIds, usedPlaceIds: [...used] },
          weekday,
          spentMemoryIds: [...claimed].filter(([memoryId, count]) => count >= claimLimitOf(memoryId)).map(([memoryId]) => memoryId),
        })

        /**
         * Best-ranked candidate of a category, from the bounded set (§12.1).
         *
         * The whole ranked pool is kept, not just the winner, so the runners-up can
         * be retained as the role's slate.
         */
        const context = ranking
        const bestOf = (category: string): DemoPlace | undefined => {
          ranked = rankWithinPace(
            input.catalogue.candidates({ category, excludePlaceIds: [...used], openAt }),
            context,
          )
          return ranked[0]?.place
        }

        // Memory first, up to its claim limit: an active category preference takes a
        // role it is eligible for ahead of anything else, until it has had its share
        // of the trip.
        for (const preference of preferences) {
          if (!eligible.includes(preference.category)) continue
          // An aversion never claims a role; it only ever lowers a score.
          if (preference.weight <= 0) continue
          if ((claimed.get(preference.memoryId) ?? 0) >= claimLimitOf(preference.memoryId)) continue
          const candidate = bestOf(preference.category)
          if (candidate) {
            chosen = candidate
            viaMemoryId = preference.memoryId
            claimed.set(preference.memoryId, (claimed.get(preference.memoryId) ?? 0) + 1)
            break
          }
        }

        // Otherwise — including once a memory has had its share — the best candidate
        // across EVERY category the role allows. The categories are a gate on what
        // belongs in this part of a day; ranking decides the rest.
        if (!chosen) {
          const pool = eligible.flatMap((category) =>
            input.catalogue.candidates({ category, excludePlaceIds: [...used], openAt }),
          )
          // An area day opens on what the area is known for that is not a meal — the
          // bookshop, with the kissaten left for lunch rather than coffee twice by noon.
          const signature =
            areaDay && role.id === 'main_destination'
              ? pool.filter(
                  (place) =>
                    areaDay.categories.includes(place.category) &&
                    !MEAL_CATEGORIES.includes(place.category) &&
                    // A kissaten is what lunch there can be, so it is left for lunch.
                    !lunchCategories.includes(place.category) &&
                    inArea(place, areaDay.area),
                )
              : []
          ranked = rankWithinPace(signature.length > 0 ? signature : pool, context)
          chosen = ranked[0]?.place
        }
      }

      if (!chosen || used.has(chosen.placeId)) {
        // Reported rather than silently skipped. A day that comes back a stop short
        // is the catalogue running out, and staying quiet about it is how that went
        // unnoticed for four steps running.
        unfilled.push({
          dayIndex,
          role: role.id,
          because: role.required ? 'nothing_available' : 'nothing_available',
        })
        return
      }

      used.add(chosen.placeId)
      dayPlaceIds.push(chosen.placeId)

      const itemId = `item_d${dayIndex}_${role.id}`
      if (budget && overBudget(chosen, budget.level)) {
        tensions.push({
          itemId,
          placeId: chosen.placeId,
          stated: budget.level,
          because: viaMemoryId
            ? 'memory_claim'
            : ranked.length <= 1
              ? 'only_option'
              : 'ranking_chose',
          ...(viaMemoryId ? { memoryId: viaMemoryId } : {}),
        })
      }

      const areaReason =
        areaDay && role.id === 'main_destination' && inArea(chosen, areaDay.area)
          ? `Day ${dayIndex + 1} is spent in ${areaDay.area.name}, for “${areaDay.because.text}”.`
          : undefined

      if (paceYielded && pace) {
        tensions.push({ itemId, placeId: chosen.placeId, stated: pace.source.text, because: 'pace_yielded' })
        // Said on the stop itself, so the traveller sees where the day moves more than asked.
        paceReason = `Nothing open for this part of Day ${dayIndex + 1} is within a walk, so the day moves more than “${pace.source.text}” asks.`
      }

      const weights = priorityWeights(input.state)
      const slate = slateFrom(ranked, chosen.placeId, weights, budget !== undefined)

      const memory = viaMemoryId ? findInSnapshot(input.memorySnapshot, viaMemoryId) : undefined
      const scored = ranked.find((entry) => entry.place.placeId === chosen.placeId)
      const runnerUp = slate[0] ? input.catalogue.get(slate[0].placeId) : undefined
      const anchor =
        anchorPlaceId === input.frame.baseLodging.placeId
          ? { name: input.frame.baseLodging.name, place: input.catalogue.get(anchorPlaceId) }
          : { name: input.catalogue.get(anchorPlaceId)?.name, place: input.catalogue.get(anchorPlaceId) }

      const explanation = explainStop({
        place: chosen,
        role,
        dayIndex,
        state: input.state,
        via:
          forcedIndex !== -1
            ? { kind: 'must_visit' }
            : memory
              ? { kind: 'memory', memory }
              : { kind: 'ranking' },
        ...(scored ? { scored } : {}),
        ...(runnerUp ? { runnerUp: { place: runnerUp, lostOn: slate[0].lostOn } } : {}),
        ...(anchor.name
          ? { from: { name: anchor.name, lat: anchor.place?.lat, lng: anchor.place?.lng } }
          : {}),
        ...(ranking ? { ranking } : {}),
        weights,
        memoryById: (memoryId) => findInSnapshot(input.memorySnapshot, memoryId),
        memories: input.memorySnapshot?.memories ?? [],
      })

      filled.set(role.id, {
        id: itemId,
        placeId: chosen.placeId,
        role: role.id,
        dayIndex,
        startTime: start,
        endTime: stopEnd(role, chosen, weekday),
        rationale: rationaleText(withExtraReasons(explanation.reasons, areaReason, paceReason)),
        reasons: withExtraReasons(explanation.reasons, areaReason, paceReason),
        // Only what a reason cites. Citing every Intent item and Priority on every
        // stop made "Why this day" list them all, whether or not they had moved it.
        // The memory that claimed the slot is cited even when a stronger reason led,
        // because it is what put the stop here — and the budget check reads it.
        rationaleRefs: {
          ...explanation.refs,
          memoryIds: [...new Set([...(viaMemoryId ? [viaMemoryId] : []), ...explanation.refs.memoryIds, ...(areaReason ? areaDay!.because.memoryIds : [])])],
          stateItemIds: [...new Set([...explanation.refs.stateItemIds, ...(areaReason ? areaDay!.because.stateItemIds : [])])],
        },
        // A must-visit is pinned by name and was never ranked, so it has no
        // runners-up; an empty slate is left off rather than stored empty.
        ...(slate.length > 0 ? { slate } : {}),
      })
    }

    for (const role of required) fill(role)
    for (const role of optional) fill(role)

    days.push({
      dayIndex,
      ...(areaDay ? { area: areaDay.area } : {}),
      startsAt: input.frame.baseLodging,
      endsAt: input.frame.baseLodging,
      // Back into day order: the passes above fill anchors first, but a day is read
      // forwards.
      items: [...filled.values()].sort((a, b) => a.startTime.localeCompare(b.startTime)),
    })
  }

  const plan: Plan = { version: 1, days }

  const validation = validatePlan(plan, {
    frame: input.frame,
    state: input.state,
    places: toValidationPlaces(input.catalogue),
    now: input.now,
  })

  return { plan, validation, tensions, unfilled }
}
