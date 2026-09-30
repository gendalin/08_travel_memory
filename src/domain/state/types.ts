/**
 * Trip State (product_spec §2.2, §3).
 *
 * State contains exactly three things: Intent, Considering, Priorities.
 * It is explicit, editable, versioned and user-visible — NOT hidden
 * chain-of-thought, and never silently merged with Memory.
 */

import type { DayRoleId } from '../plan/dayRoles.ts'
import type { ID } from '../trip/types.ts'

/** What kind of trip the user wants. Not a numeric trade-off weight. */
export interface IntentItem {
  id: ID
  text: string
  /**
   * What the line was understood to ask of the plan (2026-10-01): a pace, kinds of
   * neighbourhood. Read by the model where one is available, by rules otherwise, and
   * shown back to the traveller as `readAs` so a misreading can be corrected.
   */
  reading?: IntentReading
  readAs?: string
}

export interface IntentReading {
  pace?: 'slow' | 'normal' | 'packed'
  /** Area characters (areas.ts) — "Showa-era literary" → showa, literary. */
  characters?: string[]
}

/** Where a day is spent when the traveller names a place for it (2026-10-01). */
export interface DayPlace {
  /** As the traveller wrote it. */
  name: string
  /** Set once resolved — from the area table, the trip's places, or a geocode. */
  center?: { lat: number; lng: number }
  radiusKm?: number
  areaId?: string
}

/**
 * Structured tags are internal, for deterministic validation.
 * The user only ever sees the natural-language `text`.
 */
export type ConsideringTag =
  | { kind: 'fixed_time'; dayIndex: number; time: string }
  /**
   * A place pinned by name. `dayIndex` when the traveller named the day too ("on Day 4"):
   * the pin is then to that day, and a plan with it elsewhere does not satisfy it.
   */
  | { kind: 'must_visit'; placeId: string; dayIndex?: number }
  | { kind: 'half_day'; dayIndex: number }
  | { kind: 'time_block'; dayIndex: number; minutes: number }
  | { kind: 'budget'; level: 'low' | 'moderate' | 'high' }
  | { kind: 'avoid'; value: string }
  /**
   * A way of getting around the traveller rules out: "No taxis." The plan never books
   * transport, so this bounds nothing in validation; it is tagged so the words do not
   * leak into ranking as a search term, and so a move longer than a walk is always
   * one transit can make.
   */
  | { kind: 'transport'; avoid: 'taxi' }
  /** One part of one day should be a different kind of place: "Day 2 dinner: sushi". */
  | { kind: 'slot_category'; dayIndex: number; role: DayRoleId; category: string }
  /**
   * An activity that needs a real date and time before it can be planned — "at least
   * one baseball game". Resolved by searching live sources into an `event`.
   */
  | { kind: 'event_request'; activity: string }
  /** A dated, timed activity the traveller picked from live search results. */
  | { kind: 'event'; event: TripEvent }
  /**
   * A whole day spent somewhere: "go to Yokohama on the last day" (2026-10-01). The
   * day is re-planned around the place; an unresolved place is a Conflict.
   */
  | { kind: 'day_in_place'; dayIndex: number; place: DayPlace }
  /** How full and how mobile the days should be: "take it slow" (movement.ts). */
  | { kind: 'pace'; style: 'slow' | 'normal' | 'packed' }

/**
 * A real event on the trip, found by live search and checked by code
 * (product_spec §7.8). Every field comes from a fetched page or from Places — never
 * from a model's say-so — and it carries where and when it was found.
 */
export interface TripEvent {
  id: string
  title: string
  activity: string
  /** Zero-based trip day. */
  dayIndex: number
  /** YYYY-MM-DD. */
  date: string
  /** HH:MM. */
  start: string
  /** HH:MM. */
  end: string
  /** True when the source gave only a start time and the end is a typical length. */
  endEstimated: boolean
  venue: { name: string; lat: number; lng: number; neighborhood: string }
  sourceUrl: string
  sourceTitle?: string
  /** ISO time the source was fetched. Live data goes stale. */
  fetchedAt: string
  /** True when this came from the prototype's recorded snapshot, not a live search. */
  recorded?: boolean
}

export interface ConsideringItem {
  id: ID
  text: string
  tag?: ConsideringTag
  /** How the line was understood, in words, shown under it (2026-10-01). */
  readAs?: string
  /** Set when the line could not be turned into anything the plan can act on. */
  question?: string
  /** Who read it: the model, or the rules it falls back to. */
  readBy?: 'model' | 'rules'
}

export type PriorityWeight = 'low' | 'medium' | 'high'

/** Core MVP priorities. The agent may propose more, never add them silently. */
export const CORE_PRIORITIES = ['convenience', 'cost', 'novelty'] as const
export type CorePriority = (typeof CORE_PRIORITIES)[number]

export interface Priority {
  id: ID
  /** Core priority id, or an agent-proposed name confirmed by the user. */
  name: string
  weight: PriorityWeight
  /** True for a priority the agent proposed and the user accepted. */
  proposedByAgent?: boolean
}

export interface TripState {
  version: number
  intent: IntentItem[]
  considering: ConsideringItem[]
  priorities: Priority[]
}

export const DEFAULT_PRIORITY_WEIGHT: PriorityWeight = 'medium'
