/**
 * Plan — the itinerary (product_spec §2.1, §4.2).
 *
 * Each day begins and ends at the trip's base lodging. Those anchors are
 * fields on the day rather than items, so the rule is checkable by the
 * validator without the anchors polluting diffs and change classification.
 */

import type { DayRoleId } from './dayRoles.ts'
import type { ScoreComponents } from '../ranking/score.ts'
import type { ID, PlaceRef } from '../trip/types.ts'

export interface RationaleRefs {
  stateItemIds: ID[]
  priorityIds: ID[]
  memoryIds: ID[]
}

/**
 * One reason a stop is in the plan, as the traveller reads it.
 *
 * Every reason is built from a fact the planner actually used — their own words, a
 * named place in their evidence, a distance, a runner-up it beat — never from a
 * template that would be true of any stop. `primary` is the one that decided it;
 * the rest are `secondary`. The UI sets them in one paragraph, the primary heavier.
 */
export interface StopReason {
  text: string
  strength: 'primary' | 'secondary'
}

/**
 * A candidate that was ranked for this slot and did not win.
 *
 * Kept because alternatives were structurally the leftovers: `listAlternatives`
 * excluded everything already in the plan and ranked what remained, so for a
 * fifteen-stop plan drawn from thirty-three places the options offered were the
 * eighteen the generator had already rejected. Retaining the runners-up turns
 * that around — the alternatives for a slot become the second, third and fourth
 * best choices FOR THAT SLOT, and each one can say what it lost on.
 *
 * A cache of a ranking, not a promise. It was computed against the day as it
 * stood at plan time, so a reader must re-check each entry against the plan as it
 * stands now: a place on one slot's slate may since have been scheduled
 * elsewhere, and a Reorganize may have moved the slot to an hour the place is
 * shut.
 */
export interface SlateEntry {
  placeId: string
  /** Ranking score at plan time, 0-1. Ordering only; never displayed (§10.2). */
  score: number
  components: ScoreComponents
  /**
   * The component on which this candidate lost the most weighted ground to the
   * winner — why it came second, in one word the UI can turn into a sentence.
   */
  lostOn?: keyof ScoreComponents
  /**
   * The stop that held this slot before a State edit re-chose it. Offered first
   * under "More options", so undoing a swap is one tap — the product has no undo
   * button (§7), and this is not one: it is an ordinary Replace back.
   */
  previous?: boolean
}

export interface PlanItem {
  id: ID
  placeId: string
  /**
   * Which part of the day this stop fills.
   *
   * The generator knows it and used to throw it away, which left every later reader
   * guessing from the clock or from the category of whatever happened to be there —
   * and a Replace guessing that a closed ramen counter can only become another ramen
   * counter. The role is what says a stop is dinner; the place is only what dinner
   * turned out to be.
   *
   * Provenance, like `slate`: absent on a plan built before the role model, and not
   * a field `diffPlans` compares, because re-labelling a stop is not a change to the
   * itinerary.
   */
  role?: DayRoleId
  /** Zero-based day index within the trip. */
  dayIndex: number
  /** HH:MM, local trip time. */
  startTime: string
  /** HH:MM, local trip time. */
  endTime: string
  /**
   * Generated at plan time and stored on the item — never regenerated on open
   * (§5.4). Absent until a plan generator fills it.
   */
  rationale?: string
  /**
   * The rationale as separate reasons, primary first. `rationale` is these joined,
   * kept for every reader that wants one string. Absent on items written before
   * reasons existed, and on stops placed by a path that writes its own rationale.
   */
  reasons?: StopReason[]
  /** Only the State items, Priorities and memories a reason actually cites. */
  rationaleRefs?: RationaleRefs
  /**
   * What put the stop here. A later State edit re-chooses only what the system
   * chose: a stop the traveller picked, named or booked is theirs, and is never
   * swapped out by a change to something else (product_spec §7.6).
   *
   * Absent on plans written before it existed; read through `placedByOf`.
   */
  placedBy?: 'ranking' | 'memory' | 'must_visit' | 'user' | 'event'
  /**
   * Runners-up for this slot, best first. Absent when the slot was not filled by
   * ranking — a must-visit is pinned by name and has no runners-up.
   *
   * Not part of `diffPlans`' compared fields: a slate is provenance, so changing
   * it is not a change to the itinerary.
   */
  slate?: SlateEntry[]
}

/** Who placed a stop, for plans written before `placedBy` was recorded. */
export function placedByOf(item: PlanItem): NonNullable<PlanItem['placedBy']> {
  if (item.placedBy) return item.placedBy
  const text = item.rationale ?? ''
  if (text.includes('You picked it') || text.includes('by name')) return 'user'
  if ((item.rationaleRefs?.memoryIds.length ?? 0) > 0 && text.includes('keeps turning up')) return 'memory'
  return 'ranking'
}

export interface PlanDay {
  dayIndex: number
  /** Every day starts and ends at base lodging. */
  startsAt: PlaceRef
  endsAt: PlaceRef
  items: PlanItem[]
  /**
   * The neighbourhood this day is spent in, when it is an area day (areaDays.ts).
   * Kept on the day so a later swap looks for its replacement there too.
   */
  area?: { id: string; name: string; center: { lat: number; lng: number }; radiusKm: number }
}

export interface Plan {
  version: number
  days: PlanDay[]
}

/** All items across all days, in (day, startTime) order. */
export function allItems(plan: Plan): PlanItem[] {
  return plan.days
    .flatMap((day) => day.items)
    .sort((a, b) => a.dayIndex - b.dayIndex || a.startTime.localeCompare(b.startTime))
}

export function findItem(plan: Plan, itemId: ID): PlanItem | undefined {
  return allItems(plan).find((item) => item.id === itemId)
}

/** HH:MM -> minutes since midnight. */
export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export function durationMinutes(item: PlanItem): number {
  return toMinutes(item.endTime) - toMinutes(item.startTime)
}

/** minutes since midnight -> HH:MM. Inverse of `toMinutes`. */
export function fromMinutes(total: number): string {
  const clamped = Math.max(0, Math.min(total, 24 * 60 - 1))
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`
}
