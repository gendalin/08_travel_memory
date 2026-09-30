/**
 * A State edit's reach: which stops it actually affects, and each one re-chosen in
 * place (product_spec §7.6).
 *
 * The rule this module exists to hold: a change to State touches the stops it
 * affects and nothing else. "Day 2 dinner: sushi" changes one dinner. "Avoid
 * izakaya" changes the izakaya and leaves every other stop exactly where it is. A
 * new line of Intent re-chooses only the stops that now fit clearly worse than
 * something else would. Nothing is regenerated wholesale.
 *
 * Every re-choice is in place: same day, same start, same part of the day, ranked
 * from where the traveller arrives from. The stop's end may move within its part of
 * the day — a sushi counter takes longer than the ramen it replaced — but nothing
 * after it is pushed.
 *
 * What is never re-chosen:
 *   - a stop that has already happened
 *   - a stop the traveller picked, named, or booked (`placedBy` user / must_visit / event)
 *   - a stop a memory claimed, for a change that is only a matter of degree — it
 *     is re-chosen only when it breaks something the traveller has now said
 *
 * Each re-choice is returned as its own `ChangeUnit`, so the traveller can accept
 * some and keep the original stop in the rest.
 */

import { findInSnapshot } from '../../domain/memory/preferences.ts'
import type { MemorySnapshot } from '../../domain/memory/types.ts'
import { overBudget } from '../../domain/places/facets.ts'
import { isOpenFor, weekdayKey, windowCovering, type WeekdayKey } from '../../domain/places/openingHours.ts'
import { categoriesFor, roleById, type DayRole } from '../../domain/plan/dayRoles.ts'
import {
  allItems,
  fromMinutes,
  placedByOf,
  toMinutes,
  type Plan,
  type PlanDay,
  type PlanItem,
  type SlateEntry,
} from '../../domain/plan/types.ts'
import type { ChangeUnit } from '../../domain/proposals/types.ts'
import { matchesAvoid, scorePlace, type ScoredPlace } from '../../domain/ranking/score.ts'
import type { ConsideringTag, TripState } from '../../domain/state/types.ts'
import { dateOfDay } from '../../domain/trip/phase.ts'
import type { TripFrame } from '../../domain/trip/types.ts'
import { CATEGORY_BY_ID } from '../../domain/places/taxonomy.ts'
import type { DemoPlace, PlaceCatalogue } from '../../services/places/types.ts'
import { explainStop, rationaleText } from '../generatePlan/explainStop.ts'
import { kmBetween } from '../../domain/places/geo.ts'
import { eventPlaceId } from '../../services/places/eventPlaces.ts'
import { applyUnits } from '../planning/narrowProposal.ts'
import {
  buildRankingContext,
  geographyForItem,
  priorityWeights,
  rankCandidates,
  slateFrom,
} from '../planning/rankCandidates.ts'
import { keepsPace, movementBudgetOf, preferWithinPace } from '../planning/movementBudget.ts'
import { inArea, preferInArea } from '../planning/areaDays.ts'
import { measureMovement, withinBudget } from '../../domain/plan/movement.ts'
import { budgetOf, slotCategories } from '../planning/tripContext.ts'

/**
 * How much better a replacement must score before a change of degree — Intent
 * wording, a Priority's weight — swaps a stop. Scores are weighted means in 0-1.
 *
 * Without a margin every near-tie flips, and a one-word Intent edit rewrites the
 * trip. With it, only stops that now fit clearly worse are offered for change.
 */
export const SOFT_CHANGE_MARGIN = 0.1

/** Shortest stop a slot is given, as the first plan gives it. */
const MIN_STOP_MINUTES = 30

export interface RescopeResult {
  plan: Plan
  units: ChangeUnit[]
  /**
   * Stops the change reached but could not re-choose — nothing else fits that slot.
   * Said to the traveller: "avoid izakaya" followed by silence would read as if the
   * trip already had none.
   */
  unchanged: string[]
}

interface Context {
  frame: TripFrame
  after: TripState
  catalogue: PlaceCatalogue
  memorySnapshot?: MemorySnapshot
  locked: Set<string>
}

interface Trigger {
  /** Leads the new stop's reasons. */
  text: string
  stateItemIds: string[]
  /** The unit's reason line on the review card. */
  unitReason: string
}

function categoryWords(category: string): string {
  const label = CATEGORY_BY_ID.get(category)?.labelEn ?? category.replace(/_/g, ' ')
  return label.replace(/\s*\/\s*/g, ' or ').toLowerCase()
}

function weekdayOf(frame: TripFrame, dayIndex: number): WeekdayKey {
  return weekdayKey(dateOfDay(frame, dayIndex))
}

/** When a stop at `start` would end: its own length, capped by its part of the day and by closing. */
function endFor(place: DemoPlace, role: DayRole | undefined, weekday: WeekdayKey, start: string): string {
  const options = [fromMinutes(toMinutes(start) + Math.max(MIN_STOP_MINUTES, place.typicalDurationMin))]
  if (role) options.push(role.window.to)
  const closes = windowCovering(place.openingHours, weekday, start)?.closes
  if (closes !== undefined) options.push(fromMinutes(closes))
  return options.reduce((earliest, time) => (time < earliest ? time : earliest))
}

function replaceItem(plan: Plan, next: PlanItem): Plan {
  return {
    ...plan,
    days: plan.days.map((day) => ({
      ...day,
      items: day.items.map((item) => (item.id === next.id ? next : item)),
    })),
  }
}

/** Every avoid and the budget as they stand in State, for filtering replacements. */
function breaksState(place: DemoPlace, state: TripState, weekday: WeekdayKey, budgetBinds = true): boolean {
  const avoid = state.considering
    .map((item) => (item.tag?.kind === 'avoid' ? item.tag.value : undefined))
    .filter((value): value is string => value !== undefined)
  const budget = budgetOf(state)
  return (
    Boolean(matchesAvoid(place, avoid, weekday)) ||
    (budgetBinds && budget !== undefined && overBudget(place, budget.level))
  )
}

/**
 * The best place for this slot as State now stands, or nothing if no other place fits.
 *
 * `categories` narrows the slot to what the traveller asked for; otherwise the
 * slot's own part of the day decides what belongs.
 */
function bestFor(
  ctx: Context,
  plan: Plan,
  item: PlanItem,
  categories?: readonly string[],
  /**
   * For a slot the traveller named outright: when nothing of that kind is within
   * budget, the named kind wins over the budget — and the reason says so.
   */
  budgetYields = false,
  /** Rank from here instead of the stop before — the venue, for a stop around an event. */
  anchorPlaceId?: string,
  /** Somewhere the stop should no longer be — a day in a town that was taken away. */
  awayFrom?: { center: { lat: number; lng: number }; radiusKm: number },
): { ranked: Array<ScoredPlace<DemoPlace>>; winner: ScoredPlace<DemoPlace> } | undefined {
  const role = item.role ? roleById(item.role) : undefined
  const weekday = weekdayOf(ctx.frame, item.dayIndex)
  const inPlan = new Set(allItems(plan).map((entry) => entry.placeId))
  const eligible = categories ?? (role ? slotCategories(role, ctx.memorySnapshot) : [ctx.catalogue.get(item.placeId)?.category ?? ''])

  const geography = geographyForItem({ frame: ctx.frame, plan, itemId: item.id })
  const ranking = buildRankingContext({
    state: ctx.after,
    memorySnapshot: ctx.memorySnapshot,
    catalogue: ctx.catalogue,
    geography: anchorPlaceId ? { ...geography, anchorPlaceId } : geography,
    weekday,
  })

  const openFrom = { weekday, startTime: item.startTime, endTime: fromMinutes(toMinutes(item.startTime) + MIN_STOP_MINUTES) }
  const open = eligible
    .flatMap((category) => ctx.catalogue.candidates({ category, excludePlaceIds: [...inPlan], openAt: openFrom }))
    .filter((place) =>
      isOpenFor(place.openingHours, weekday, item.startTime, endFor(place, role, weekday, item.startTime)),
    )
  const within = open.filter((place) => !breaksState(place, ctx.after, weekday))
  const allowed =
    within.length > 0 || !budgetYields ? within : open.filter((place) => !breaksState(place, ctx.after, weekday, false))
  // Keep a slow day walkable (movement.ts): in-budget candidates first.
  const sameDay = (plan.days.find((day) => day.dayIndex === item.dayIndex)?.items ?? [])
    .filter((entry) => entry.id !== item.id)
    .flatMap((entry) => {
      const place = ctx.catalogue.get(entry.placeId)
      return place ? [{ lat: place.lat, lng: place.lng, startTime: entry.startTime }] : []
    })
  // An area day's stop is re-chosen in that neighbourhood first (areaDays.ts).
  const area = item.role !== 'nightcap' ? plan.days.find((day) => day.dayIndex === item.dayIndex)?.area : undefined
  const outside = awayFrom ? allowed.filter((place) => !inArea(place, awayFrom)) : allowed
  const candidates = preferWithinPace(preferInArea(outside.length > 0 ? outside : allowed, area), sameDay, item.startTime, movementBudgetOf(ctx.after)?.budget).candidates

  const ranked = rankCandidates(candidates, ranking)
  return ranked[0] ? { ranked, winner: ranked[0] } : undefined
}

/**
 * `item` re-chosen in place with `winner`, reasons led by what the traveller changed.
 * The place it replaces goes first on the new slate, so "More options" offers it back.
 */
function swapped(
  ctx: Context,
  plan: Plan,
  item: PlanItem,
  found: { ranked: Array<ScoredPlace<DemoPlace>>; winner: ScoredPlace<DemoPlace> },
  trigger: Trigger,
  placedBy: PlanItem['placedBy'],
): PlanItem {
  const role = item.role ? roleById(item.role) : undefined
  const weekday = weekdayOf(ctx.frame, item.dayIndex)
  const place = found.winner.place
  const weights = priorityWeights(ctx.after)
  const statedBudget = budgetOf(ctx.after) !== undefined
  const ranking = buildRankingContext({
    state: ctx.after,
    memorySnapshot: ctx.memorySnapshot,
    catalogue: ctx.catalogue,
    geography: geographyForItem({ frame: ctx.frame, plan, itemId: item.id }),
    weekday,
  })

  const slate = slateFrom(found.ranked, place.placeId, weights, statedBudget)
  const previous = ctx.catalogue.get(item.placeId)
  const wasHere: SlateEntry[] = previous
    ? [{ ...slateEntryFor(scorePlace(previous, ranking)), previous: true }]
    : []

  const geography = geographyForItem({ frame: ctx.frame, plan, itemId: item.id })
  const fromPlace = geography.anchorPlaceId ? ctx.catalogue.get(geography.anchorPlaceId) : undefined
  const fromName =
    geography.anchorPlaceId === ctx.frame.baseLodging.placeId ? ctx.frame.baseLodging.name : fromPlace?.name

  const explanation = explainStop({
    place,
    ...(role ? { role } : {}),
    dayIndex: item.dayIndex,
    state: ctx.after,
    via: { kind: 'ranking' },
    scored: found.winner,
    ...(slate[0] && ctx.catalogue.get(slate[0].placeId)
      ? { runnerUp: { place: ctx.catalogue.get(slate[0].placeId)!, lostOn: slate[0].lostOn } }
      : {}),
    ...(fromName ? { from: { name: fromName, lat: fromPlace?.lat, lng: fromPlace?.lng } } : {}),
    ranking,
    weights,
    memoryById: (memoryId) => findInSnapshot(ctx.memorySnapshot, memoryId),
    memories: ctx.memorySnapshot?.memories ?? [],
    trigger: { text: trigger.text, stateItemIds: trigger.stateItemIds },
  })

  return {
    ...item,
    placeId: place.placeId,
    endTime: endFor(place, role, weekday, item.startTime),
    rationale: rationaleText(explanation.reasons),
    reasons: explanation.reasons,
    rationaleRefs: explanation.refs,
    slate: [...wasHere, ...slate.slice(0, 4)],
    placedBy,
  }
}

function slateEntryFor(scored: ScoredPlace<DemoPlace>): SlateEntry {
  return { placeId: scored.place.placeId, score: scored.total, components: scored.components }
}

function stopLabel(ctx: Context, item: PlanItem): string {
  return `Day ${item.dayIndex + 1} · ${item.startTime}`
}

function unitFor(ctx: Context, before: PlanItem, after: PlanItem, reason: string, required: boolean): ChangeUnit {
  const was = ctx.catalogue.get(before.placeId)?.name ?? before.placeId
  const now = ctx.catalogue.get(after.placeId)?.name ?? after.placeId
  return {
    id: `unit_${before.id}`,
    summary: `${stopLabel(ctx, before)}: ${was} → ${now}`,
    reason,
    required,
    removeItemIds: [],
    putItems: [after],
  }
}

/** Tags `before` had that `after` no longer has, compared by value (2026-10-01). */
function removed(before: TripState, after: TripState): Array<{ tag: ConsideringTag; itemId: string; text: string }> {
  const still = new Set(after.considering.map((item) => item.tag).filter(Boolean).map((tag) => JSON.stringify(tag)))
  return before.considering
    .filter((item) => item.tag && !still.has(JSON.stringify(item.tag)))
    .map((item) => ({ tag: item.tag!, itemId: item.id, text: item.text }))
}

/** Tags in `after` that `before` did not have, compared by value. */
function added(before: TripState, after: TripState): Array<{ tag: ConsideringTag; itemId: string; text: string }> {
  const existing = new Set(
    before.considering.map((item) => item.tag).filter(Boolean).map((tag) => JSON.stringify(tag)),
  )
  return after.considering
    .filter((item) => item.tag && !existing.has(JSON.stringify(item.tag)))
    .map((item) => ({ tag: item.tag!, itemId: item.id, text: item.text }))
}

const BUDGET_ORDER = { low: 0, moderate: 1, high: 2 } as const

/** Getting to and into an event: kept clear on both sides of it. */
const EVENT_BUFFER_MINUTES = 30
/** A meal moved before an event is kept short. */
const MEAL_BEFORE_EVENT_MINUTES = 75

/** Door-to-door minutes, roughly: walking when close, rail otherwise. */
export function travelMinutes(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const km = kmBetween(a, b)
  return km <= 1.6 ? Math.round((km * 1000) / 80) : Math.round(10 + km * 3)
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function rescopePlan(input: {
  plan: Plan
  before: TripState
  after: TripState
  catalogue: PlaceCatalogue
  frame: TripFrame
  memorySnapshot?: MemorySnapshot
  lockedItemIds?: string[]
}): RescopeResult {
  const ctx: Context = {
    frame: input.frame,
    after: input.after,
    catalogue: input.catalogue,
    memorySnapshot: input.memorySnapshot,
    locked: new Set(input.lockedItemIds ?? []),
  }
  let plan = input.plan
  const units: ChangeUnit[] = []
  const unchanged: string[] = []
  const noReplacement = (item: PlanItem, why: string) => {
    const name = ctx.catalogue.get(item.placeId)?.name ?? item.placeId
    unchanged.push(`Nothing else fits Day ${item.dayIndex + 1} at ${item.startTime}, so ${name} stays — ${why}.`)
  }
  /** Stops already re-chosen in this pass: one change per stop. */
  const touched = new Set<string>()

  const apply = (before: PlanItem, next: PlanItem, reason: string, required: boolean) => {
    plan = replaceItem(plan, next)
    touched.add(before.id)
    units.push(unitFor(ctx, before, next, reason, required))
  }

  const reChoosable = (item: PlanItem, change: 'explicit' | 'violation' | 'degree'): boolean => {
    if (ctx.locked.has(item.id) || touched.has(item.id)) return false
    const by = placedByOf(item)
    if (change === 'explicit') return true
    if (by === 'user' || by === 'must_visit' || by === 'event') return false
    if (change === 'degree' && by === 'memory') return false
    return true
  }

  const newTags = added(input.before, input.after)

  // --- 0. A picked event — the event, what it overlaps, and what it strands -----
  for (const { tag, itemId } of newTags) {
    if (tag.kind !== 'event') continue
    const event = tag.event
    const venueId = eventPlaceId(event)
    const venue = ctx.catalogue.get(venueId)
    const day = plan.days.find((entry) => entry.dayIndex === event.dayIndex)
    if (!venue || !day) continue

    const from = toMinutes(event.start) - EVENT_BUFFER_MINUTES
    const to = toMinutes(event.end) + EVENT_BUFFER_MINUTES
    const overlapping = day.items.filter(
      (item) => toMinutes(item.startTime) < to && toMinutes(item.endTime) > from,
    )
    const fixed = overlapping.filter((item) => ctx.locked.has(item.id) || ['user', 'must_visit', 'event'].includes(placedByOf(item)))
    if (fixed.length > 0) {
      const names = fixed.map((item) => ctx.catalogue.get(item.placeId)?.name ?? item.placeId).join(', ')
      unchanged.push(`The ${event.start} ${event.activity} on Day ${event.dayIndex + 1} overlaps ${names}, which you chose — so it is not planned. Remove one of them to fit it.`)
      continue
    }

    const eventItem: PlanItem = {
      id: `item_d${event.dayIndex}_${venueId}`,
      placeId: venueId,
      dayIndex: event.dayIndex,
      startTime: event.start,
      endTime: event.end,
      placedBy: 'event',
      reasons: [
        { text: `You asked for ${event.activity}: ${event.title}, ${event.start} at ${event.venue.name}.`, strength: 'primary' },
        {
          text: `Checked ${event.fetchedAt.slice(0, 10)} on ${hostOf(event.sourceUrl)}${event.recorded ? ' — recorded for this demo' : ''}${event.endEstimated ? `; ends around ${event.end}` : ''}.`,
          strength: 'secondary',
        },
      ],
      rationaleRefs: { stateItemIds: [itemId], priorityIds: [], memoryIds: [] },
    }
    eventItem.rationale = rationaleText(eventItem.reasons!)

    const overlapNames = overlapping.map((item) => ctx.catalogue.get(item.placeId)?.name ?? item.placeId)
    const eventUnit: ChangeUnit = {
      id: `unit_event_${event.id}`,
      summary: `Day ${event.dayIndex + 1} · ${event.start}: + ${event.title} (${event.venue.name})`,
      reason:
        overlapping.length > 0
          ? `It runs ${event.start}–${event.end}${event.endEstimated ? ' (end estimated)' : ''}, so ${overlapNames.join(' and ')} come${overlapNames.length === 1 ? 's' : ''} out.`
          : `It fits Day ${event.dayIndex + 1} as it is.`,
      required: true,
      removeItemIds: overlapping.map((item) => item.id),
      putItems: [eventItem],
    }
    plan = applyUnits(plan, [eventUnit])
    units.push(eventUnit)
    overlapping.forEach((item) => touched.add(item.id))
    touched.add(eventItem.id)

    const venuePoint = { lat: venue.lat, lng: venue.lng }

    // A meal the event took, offered again around it and near the venue.
    for (const removed of overlapping) {
      const role = removed.role ? roleById(removed.role) : undefined
      if (!role || !['lunch', 'dinner', 'nightcap'].includes(role.id)) continue
      const current = plan.days.find((entry) => entry.dayIndex === event.dayIndex)!.items
      const before = current
        .filter((item) => toMinutes(item.endTime) <= toMinutes(event.start))
        .sort((a, b) => toMinutes(b.endTime) - toMinutes(a.endTime))[0]
      const earliest = before ? toMinutes(before.endTime) + EVENT_BUFFER_MINUTES : toMinutes(role.window.from) - 120
      const latestBefore = toMinutes(event.start) - EVENT_BUFFER_MINUTES - MEAL_BEFORE_EVENT_MINUTES
      const slots =
        role.id === 'nightcap'
          ? [toMinutes(event.end) + EVENT_BUFFER_MINUTES]
          : latestBefore >= earliest
            ? [Math.floor(latestBefore / 15) * 15]
            : []
      for (const start of slots) {
        if (start > 23 * 60) continue
        const probe: PlanItem = {
          id: `item_d${event.dayIndex}_${role.id}_around_${venueId}`,
          placeId: removed.placeId,
          role: role.id,
          dayIndex: event.dayIndex,
          startTime: fromMinutes(start),
          endTime: fromMinutes(start + MEAL_BEFORE_EVENT_MINUTES),
        }
        const withProbe = applyUnits(plan, [{ id: 'probe', summary: '', reason: '', required: true, removeItemIds: [], putItems: [probe] }])
        const ranked = bestFor(ctx, withProbe, probe, undefined, false, venueId)
        // Near enough to matter: before the event, it must leave time to get there;
        // after it, it must be a short hop. A dinner 25 km away "near" the stadium
        // is not near it, and nobody makes an 18:00 start from it.
        const beforeEvent = role.id !== 'nightcap'
        const reachable = (ranked?.ranked ?? []).filter((entry) => {
          const minutes = travelMinutes(entry.place, venuePoint)
          return beforeEvent
            ? start + MEAL_BEFORE_EVENT_MINUTES + minutes <= toMinutes(event.start)
            : minutes <= 30
        })
        const found = reachable[0] ? { ranked: reachable, winner: reachable[0] } : undefined
        const label = role.id === 'nightcap' ? 'late stop' : role.label.toLowerCase()
        if (!found) {
          unchanged.push(
            `No ${label} near enough to ${event.venue.name} is open at ${fromMinutes(start)}, so Day ${event.dayIndex + 1} has none around the game.`,
          )
          continue
        }
        const minutes = travelMinutes(found.winner.place, venuePoint)
        const placed = swapped(ctx, withProbe, probe, found, {
          text: `${role.label} moved to ${fromMinutes(start)}, ${minutes} minutes from ${event.venue.name}, to fit around the ${event.start} ${event.activity}.`,
          stateItemIds: [itemId],
          unitReason: '',
        }, 'ranking')
        const shortened: PlanItem = {
          ...placed,
          endTime: fromMinutes(Math.min(toMinutes(placed.endTime), start + (role.id === 'nightcap' ? 90 : MEAL_BEFORE_EVENT_MINUTES))),
          // Nothing was here before, so there is nothing to offer back.
          slate: (placed.slate ?? []).filter((entry) => !entry.previous),
        }
        const unit: ChangeUnit = {
          id: `unit_${shortened.id}`,
          summary: `Day ${event.dayIndex + 1} · ${shortened.startTime}: + ${ctx.catalogue.get(shortened.placeId)?.name ?? shortened.placeId} (${label} near ${event.venue.name})`,
          reason: `Keeps a ${label} on Day ${event.dayIndex + 1}, ${travelMinutes(found.winner.place, venuePoint)} minutes from ${event.venue.name}: the game takes the ${removed.startTime} slot.`,
          required: false,
          removeItemIds: [],
          putItems: [shortened],
          adds: true,
        }
        plan = applyUnits(plan, [unit])
        units.push(unit)
        touched.add(shortened.id)
      }
    }

    // The stop before the event, if it is too far to make the start from.
    const dayNow = plan.days.find((entry) => entry.dayIndex === event.dayIndex)!.items
    const last = dayNow
      .filter((item) => item.id !== eventItem.id && toMinutes(item.endTime) <= toMinutes(event.start))
      .sort((a, b) => toMinutes(b.endTime) - toMinutes(a.endTime))[0]
    const lastPlace = last ? ctx.catalogue.get(last.placeId) : undefined
    if (last && lastPlace && reChoosable(last, 'violation')) {
      const needed = travelMinutes(lastPlace, venuePoint)
      const gap = toMinutes(event.start) - toMinutes(last.endTime)
      if (needed > gap - 15) {
        const found = bestFor(ctx, plan, last, undefined, false, venueId)
        if (found && travelMinutes(found.winner.place, venuePoint) < needed) {
          const km = kmBetween(lastPlace, venuePoint).toFixed(1)
          apply(
            last,
            swapped(ctx, plan, last, found, {
              text: `Closer to ${event.venue.name} than ${lastPlace.name}, so the ${event.start} start is within reach.`,
              stateItemIds: [itemId],
              unitReason: '',
            }, placedByOf(last)),
            `${lastPlace.name} is ${km} km from ${event.venue.name} — about ${needed} minutes, with ${gap} before the start.`,
            false,
          )
        }
      }
    }
  }

  const drop = (item: PlanItem, reason: string, required: boolean) => {
    plan = { ...plan, days: plan.days.map((day) => ({ ...day, items: day.items.filter((entry) => entry.id !== item.id) })) }
    touched.add(item.id)
    units.push({
      id: `unit_drop_${item.id}`,
      summary: `${stopLabel(ctx, item)} → out`,
      reason,
      required,
      removeItemIds: [item.id],
      putItems: [],
    })
  }
  const setArea = (dayIndex: number, area: PlanDay['area'] | undefined) => {
    plan = {
      ...plan,
      days: plan.days.map((day) => {
        if (day.dayIndex !== dayIndex) return day
        const { area: _old, ...rest } = day
        return area ? { ...rest, area } : rest
      }),
    }
  }

  // --- 0b. "Go to Yokohama on the last day" — the whole day, around the place --
  //
  // Every stop that day is re-chosen there, and the late "one more" goes: a day out
  // ends with dinner. What the traveller fixed (named, booked, locked) stays. A place
  // never located is left to the validator, which reports it against the sentence.
  for (const { tag, itemId, text } of newTags) {
    if (tag.kind !== 'day_in_place' || !tag.place.center) continue
    const area = { id: tag.place.areaId ?? `named_${tag.place.name.toLowerCase().replace(/\W+/g, '_')}`, name: tag.place.name, center: tag.place.center, radiusKm: tag.place.radiusKm ?? 1.5 }
    setArea(tag.dayIndex, area)
    const reason = `Day ${tag.dayIndex + 1} is spent in ${area.name}, as you asked: “${text}”.`
    const day = [...(plan.days.find((entry) => entry.dayIndex === tag.dayIndex)?.items ?? [])].sort((a, b) => a.startTime.localeCompare(b.startTime))
    for (const item of day.filter((entry) => entry.role === 'nightcap')) {
      if (reChoosable(item, 'violation')) drop(item, `A day in ${area.name} ends with dinner.`, true)
    }
    for (const item of day.filter((entry) => entry.role !== 'nightcap')) {
      if (!reChoosable(item, 'violation')) continue
      const found = bestFor(ctx, plan, item)
      if (!found || !inArea(found.winner.place, area)) {
        noReplacement(item, `nothing in ${area.name} is open then`)
        continue
      }
      apply(item, swapped(ctx, plan, item, found, { text: reason, stateItemIds: [itemId], unitReason: reason }, 'ranking'), reason, true)
    }
  }

  // --- 0c. A line taken away — what it had put in place is re-chosen --------------
  //
  // Loosening a constraint never makes a plan invalid, so it used to change nothing:
  // delete "must visit Nezu" and Nezu stayed. Each removal now undoes what its line
  // had done, as changes the traveller can decline; a removed avoid, budget or pace
  // opens the degree pass below, which swaps only what now clearly fits better.
  let loosened: { text: string; itemId: string } | undefined
  // An edited line is a removal and an addition of the same thing: "must visit Nezu"
  // becoming "must visit Nezu on Day 3" still pins Nezu, and the addition has already
  // moved it. A removal only undoes what nothing in the new State still asks for.
  const afterTags = input.after.considering.flatMap((item) => (item.tag ? [item.tag] : []))
  const stillAsked = (tag: ConsideringTag) =>
    afterTags.some((other) =>
      (tag.kind === 'must_visit' && other.kind === 'must_visit' && other.placeId === tag.placeId) ||
      (tag.kind === 'day_in_place' && other.kind === 'day_in_place' && other.dayIndex === tag.dayIndex) ||
      (tag.kind === 'slot_category' && other.kind === 'slot_category' && other.dayIndex === tag.dayIndex && other.role === tag.role),
    )
  for (const { tag, text, itemId } of removed(input.before, input.after)) {
    if (stillAsked(tag)) continue
    switch (tag.kind) {
      case 'day_in_place': {
        setArea(tag.dayIndex, undefined)
        const reason = `Day ${tag.dayIndex + 1} is an ordinary day again — “${text}” was removed.`
        const away = tag.place.center ? { center: tag.place.center, radiusKm: tag.place.radiusKm ?? 1.5 } : undefined
        const ordered = [...(plan.days.find((day) => day.dayIndex === tag.dayIndex)?.items ?? [])].sort((a, b) => a.startTime.localeCompare(b.startTime))
        for (const item of ordered) {
          if (!reChoosable(item, 'violation')) continue
          const found = bestFor(ctx, plan, item, undefined, false, ctx.frame.baseLodging.placeId, away)
          if (!found || found.winner.place.placeId === item.placeId) continue
          apply(item, swapped(ctx, plan, item, found, { text: reason, stateItemIds: [], unitReason: reason }, 'ranking'), reason, false)
        }
        break
      }
      case 'must_visit': {
        // The place the pin put in the plan, however the stop records it.
        const item = allItems(plan).find((entry) => entry.placeId === tag.placeId && (placedByOf(entry) === 'must_visit' || tag.dayIndex === undefined || entry.dayIndex === tag.dayIndex))
        if (!item || ctx.locked.has(item.id)) break
        const name = ctx.catalogue.get(item.placeId)?.name ?? item.placeId
        if (!item.role) {
          drop(item, `${name} was only here because you asked for it by name.`, false)
          break
        }
        const found = bestFor(ctx, plan, item)
        if (!found) break
        const reason = `${name} is no longer pinned, so this slot is chosen again.`
        apply(item, swapped(ctx, plan, item, found, { text: reason, stateItemIds: [], unitReason: reason }, 'ranking'), reason, false)
        break
      }
      case 'slot_category': {
        const item = plan.days.find((day) => day.dayIndex === tag.dayIndex)?.items.find((entry) => entry.role === tag.role)
        if (!item || !reChoosable(item, 'explicit')) break
        const found = bestFor(ctx, plan, item)
        if (!found || found.winner.place.placeId === item.placeId) break
        const reason = `Day ${tag.dayIndex + 1} ${tag.role} is open again — “${text}” was removed.`
        apply(item, swapped(ctx, plan, item, found, { text: reason, stateItemIds: [], unitReason: reason }, 'ranking'), reason, false)
        break
      }
      default:
        loosened ??= { text, itemId }
    }
  }

  // --- 1. "Day 2 dinner: sushi" — the one slot, nothing else ------------------
  for (const { tag, itemId, text } of newTags) {
    if (tag.kind !== 'slot_category') continue
    const item = plan.days
      .find((day) => day.dayIndex === tag.dayIndex)
      ?.items.find((entry) => entry.role === tag.role)
    if (!item || !reChoosable(item, 'explicit')) continue
    if (ctx.catalogue.get(item.placeId)?.category === tag.category) continue

    const found = bestFor(ctx, plan, item, [tag.category], true)
    if (!found) {
      noReplacement(item, `no other ${categoryWords(tag.category)} is open then that isn't already in the trip`)
      continue
    }
    const role = roleById(tag.role)
    const budget = budgetOf(ctx.after)
    const dearer =
      budget && overBudget(found.winner.place, budget.level)
        ? ` Nothing of that kind is within the ${budget.level} budget you set, so this one is above it.`
        : ''
    apply(
      item,
      swapped(ctx, plan, item, found, {
        text: `You asked for ${categoryWords(tag.category)} for Day ${tag.dayIndex + 1} ${role?.label.toLowerCase() ?? 'this stop'}.${dearer}`,
        stateItemIds: [itemId],
        unitReason: `You asked for ${categoryWords(tag.category)} here.`,
      }, 'user'),
      `You asked for ${categoryWords(tag.category)} here.`,
      true,
    )
  }

  // --- 2. A new "avoid" — only the stops it rules out --------------------------
  for (const { tag, itemId, text } of newTags) {
    if (tag.kind !== 'avoid') continue
    for (const item of allItems(plan)) {
      const place = ctx.catalogue.get(item.placeId)
      if (!place || !reChoosable(item, 'violation')) continue
      if (!matchesAvoid(place, [tag.value], weekdayOf(ctx.frame, item.dayIndex))) continue
      const found = bestFor(ctx, plan, item)
      if (!found) {
        noReplacement(item, `it is what you asked to avoid, but nothing else is open then`)
        continue
      }
      apply(
        item,
        swapped(ctx, plan, item, found, {
          text: `Instead of ${place.name}, because you asked: “${text}”.`,
          stateItemIds: [itemId],
          unitReason: `${place.name} is what you asked to avoid.`,
        }, placedByOf(item)),
        `${place.name} is what you asked to avoid: “${text}”.`,
        false,
      )
    }
  }

  // --- 3. A lower budget — only the stops above it -----------------------------
  const budgetBefore = budgetOf(input.before)?.level
  const budgetAfter = budgetOf(input.after)
  if (budgetAfter && (budgetBefore === undefined || BUDGET_ORDER[budgetAfter.level] < BUDGET_ORDER[budgetBefore])) {
    const line = input.after.considering.find((item) => item.tag?.kind === 'budget')
    for (const item of allItems(plan)) {
      const place = ctx.catalogue.get(item.placeId)
      if (!place || !reChoosable(item, 'violation') || !overBudget(place, budgetAfter.level)) continue
      const found = bestFor(ctx, plan, item)
      if (!found) {
        noReplacement(item, `it is above the ${budgetAfter.level} budget, but nothing cheaper is open then`)
        continue
      }
      apply(
        item,
        swapped(ctx, plan, item, found, {
          text: `Instead of ${place.name}, which is above the ${budgetAfter.level} budget you set.`,
          stateItemIds: line ? [line.id] : [],
          unitReason: `${place.name} is above the ${budgetAfter.level} budget.`,
        }, placedByOf(item)),
        `${place.name} is above the ${budgetAfter.level} budget you set.`,
        false,
      )
    }
  }

  // --- 4. Intent wording or a Priority weight — only what now fits clearly worse --
  // --- A slow pace newly stated: bring days that move too much back to a walk ----
  //
  // Only the stops that make the day move are re-chosen, farthest-out first, and each
  // is a change the traveller can decline. "Slow" is movement and neighbourhoods, not
  // a stop count (movement.ts), so nothing is dropped.
  const paceAfter = movementBudgetOf(input.after)
  if (paceAfter && !movementBudgetOf(input.before)) {
    const reason = (dayIndex: number) => `Keeps Day ${dayIndex + 1} to a walk rather than a trip across town, for “${paceAfter.source.text}”.`
    for (const dayIndex of plan.days.map((day) => day.dayIndex)) {
      const tried = new Set<string>()
      for (;;) {
        const items = [...(plan.days.find((day) => day.dayIndex === dayIndex)?.items ?? [])].sort((a, b) => a.startTime.localeCompare(b.startTime))
        const points = items.map((item) => ctx.catalogue.get(item.placeId)).filter((place): place is DemoPlace => place !== undefined)
        if (points.length !== items.length || withinBudget(measureMovement(points), paceAfter.budget)) break

        // The stop farthest from its nearest neighbour is the one making the day move.
        const nearest = (item: PlanItem) => {
          const here = ctx.catalogue.get(item.placeId)!
          return Math.min(...items.filter((other) => other.id !== item.id).map((other) => kmBetween(here, ctx.catalogue.get(other.placeId)!)))
        }
        const next = items
          .filter((item) => !tried.has(item.id) && reChoosable(item, 'violation'))
          .sort((a, b) => nearest(b) - nearest(a))[0]
        if (!next) {
          unchanged.push(`Day ${dayIndex + 1} still moves more than a walk: nothing open nearby fits in place of what is there.`)
          break
        }
        tried.add(next.id)
        const found = bestFor(ctx, plan, next)
        const others = items.filter((item) => item.id !== next.id).map((item) => ({ ...ctx.catalogue.get(item.placeId)!, startTime: item.startTime }))
        if (!found || !keepsPace(others, { ...found.winner.place, startTime: next.startTime }, paceAfter.budget)) continue
        apply(
          next,
          swapped(ctx, plan, next, found, { text: reason(dayIndex), stateItemIds: [paceAfter.source.id], unitReason: reason(dayIndex) }, 'ranking'),
          reason(dayIndex),
          false,
        )
      }
    }
  }

  const intentBefore = new Set(input.before.intent.map((item) => item.text))
  const newIntent = input.after.intent.filter((item) => !intentBefore.has(item.text))
  const removedIntent = input.before.intent.some(
    (item) => !input.after.intent.some((next) => next.text === item.text),
  )
  const weightOf = (state: TripState) => new Map(state.priorities.map((priority) => [priority.name, priority.weight]))
  const beforeWeights = weightOf(input.before)
  const changedPriorities = input.after.priorities.filter((priority) => beforeWeights.get(priority.name) !== priority.weight)

  if (newIntent.length > 0 || removedIntent || changedPriorities.length > 0 || loosened) {
    const because =
      loosened && newIntent.length === 0 && changedPriorities.length === 0
        ? { text: `Fits better now that “${loosened.text}” is gone`, ids: [] as string[] }
        : newIntent.length > 0
        ? { text: `Fits “${newIntent[0].text}” better`, ids: newIntent.map((item) => item.id) }
        : changedPriorities.length > 0
          ? {
              text: `Fits ${changedPriorities[0].name} at ${changedPriorities[0].weight} better`,
              ids: changedPriorities.map((priority) => priority.id),
            }
          : { text: 'Fits what you now want better', ids: [] }

    for (const item of allItems(plan)) {
      const place = ctx.catalogue.get(item.placeId)
      if (!place || !reChoosable(item, 'degree')) continue
      const weekday = weekdayOf(ctx.frame, item.dayIndex)
      const found = bestFor(ctx, plan, item)
      if (!found) continue
      const current = scorePlace(
        place,
        buildRankingContext({
          state: ctx.after,
          memorySnapshot: ctx.memorySnapshot,
          catalogue: ctx.catalogue,
          geography: geographyForItem({ frame: ctx.frame, plan, itemId: item.id }),
          weekday,
        }),
      )
      if (found.winner.total - current.total < SOFT_CHANGE_MARGIN) continue
      apply(
        item,
        swapped(ctx, plan, item, found, {
          text: `${because.text} than ${place.name}.`,
          stateItemIds: because.ids,
          unitReason: `${because.text} than ${place.name}.`,
        }, 'ranking'),
        `${because.text} than ${place.name}.`,
        false,
      )
    }
  }

  return { plan, units, unchanged }
}
