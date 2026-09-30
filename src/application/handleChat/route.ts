/**
 * Message -> operation (product_spec §6.1, Axis A).
 *
 * This decides *what to try*, never *what kind of change it was*. The
 * transaction type is computed later, by the domain classifier, from the diff
 * the operation produced — so a routing mistake can only produce a worse
 * proposal, never a mislabelled one.
 *
 * The rules are deterministic and deliberately narrow. A message that matches
 * nothing becomes a clarifying question rather than a guess: silently changing
 * the wrong stop is worse than asking.
 */

import { allItems, type Plan } from '../../domain/plan/types.ts'
import type { PlaceCatalogue } from '../../services/places/types.ts'

export type ChatOperation =
  /** Swap one stop for another in the same slot. */
  | { kind: 'replace_place'; itemId: string; placeId: string }
  /** Finish a day by a cut-off — a booking, an early start, being back somewhere. */
  | { kind: 'clear_after'; dayIndex: number; endBy: string; reason: string }
  /** Weather from a time on: move what is outdoors after it indoors. */
  | { kind: 'weather_after'; dayIndex: number; from: string; reason: string }
  /** Thin the trip out: fewer stops a day. */
  | { kind: 'fewer_stops'; maxPerDay: number }
  /**
   * Something about the traveller rather than about a stop: "I never enjoy crowded
   * tourist spots". Becomes a candidate Memory, and optionally a change to this trip.
   */
  | { kind: 'preference_statement'; polarity: 1 | -1; text: string }
  | { kind: 'unresolved' }

const FEWER_STOPS =
  /\bfewer\b|\bless\b|\btoo (?:much|many)\b|\btired\b|\bexhausted\b|\bworn out\b|\bslow (?:it |things )?down\b|\blighter\b/i

/** "after 3pm", "from 15:00", "by 18:00" — all mean "be finished by then". */
const CUT_OFF = /\b(?:after|from|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i

const CUT_OFF_REASON =
  /\brain\b|\brainy\b|\bstorm\b|\bsnow\b|\btyphoon\b|\bweather\b|\bback by\b|\bhead back\b|\bdone by\b|\bfinish(?:ed)? by\b|\bdinner\b|\bflight\b/i

const ALL_DAY = /\ball day\b|\bthe whole day\b|\ball-day\b|整天|一整天|全天/i

/** Weather is about where to be, not when to stop (outdoor.ts). */
const WEATHER = /\brain(?:y|ing|s)?\b|\bstorm\b|\bsnow(?:ing)?\b|\btyphoon\b|\bweather\b|下雨|雨/i

const DAY = /\bday\s*(\d+)/i

function toClock(hour: string, minute: string | undefined, meridiem: string | undefined): string {
  let hours = Number(hour)
  if (meridiem?.toLowerCase() === 'pm' && hours < 12) hours += 12
  if (meridiem?.toLowerCase() === 'am' && hours === 12) hours = 0
  // "rain after 3" with no meridiem means the afternoon on a trip itinerary.
  if (!meridiem && hours <= 8) hours += 12
  return `${String(hours).padStart(2, '0')}:${minute ?? '00'}`
}

/**
 * Finds the stop the user is talking about: a day reference plus a category,
 * name, or tag word. Exported because the Replace path re-reads it.
 */
export function resolveTargetItem(
  message: string,
  plan: Plan,
  catalogue: PlaceCatalogue,
): { itemId: string; placeId: string } | undefined {
  const lower = message.toLowerCase()

  const dayMatch = lower.match(DAY)
  const dayIndex = dayMatch ? Number(dayMatch[1]) - 1 : undefined

  const scoped = allItems(plan).filter(
    (item) => dayIndex === undefined || item.dayIndex === dayIndex,
  )

  for (const item of scoped) {
    const place = catalogue.get(item.placeId)
    if (!place) continue

    const words = [place.category.replace(/_/g, ' '), place.name.toLowerCase(), ...place.tags]
    if (words.some((word) => lower.includes(word.toLowerCase()))) {
      return { itemId: item.id, placeId: item.placeId }
    }
  }
  return undefined
}

/** Stops on the busiest day, which is what "fewer" is measured against. */
function busiestDayLength(plan: Plan): number {
  return plan.days.reduce((most, day) => Math.max(most, day.items.length), 0)
}

/** "I never / always / don't / really … like / enjoy / prefer / avoid …" — and the Chinese forms. */
const PREFERENCE_CUE =
  /\b(?:i|we)(?:'m| am| are)?\s+(?:(?:never|always|usually|generally|really|just|do not|don't|dont|not a fan of|can't stand|cannot stand)\s+)*(?:like|love|enjoy|prefer|hate|avoid|mind|fans? of|into)\b|\b(?:i|we)(?:'m| am| are)? not (?:a )?fans? of\b|我(?:們)?(?:從不|從來不|不太|不)?(?:喜歡|愛|享受|討厭|偏好)/i

const NEGATIVE_CUE = /\bnever\b|\bdon'?t\b|\bdo not\b|\bhate\b|\bavoid\b|\bnot a fan\b|\bnot fans?\b|\bcan'?t stand\b|\bcannot stand\b|從不|從來不|不喜歡|不太喜歡|討厭/i

export function preferenceStatement(message: string): Extract<ChatOperation, { kind: 'preference_statement' }> | undefined {
  if (!PREFERENCE_CUE.test(message)) return undefined
  return { kind: 'preference_statement', polarity: NEGATIVE_CUE.test(message) ? -1 : 1, text: message.trim() }
}

export function routeMessage(input: {
  message: string
  plan: Plan
  catalogue: PlaceCatalogue
  /** Day the user is looking at, used when the message names no day. */
  focusDayIndex?: number
}): ChatOperation {
  const { message, plan, catalogue } = input

  // Pace first: "fewer spots" is about the whole trip, and would otherwise be
  // mistaken for a comment about whichever stop it happens to mention.
  if (FEWER_STOPS.test(message)) {
    return { kind: 'fewer_stops', maxPerDay: Math.max(1, busiestDayLength(plan) - 1) }
  }

  // "It's going to rain all day on Day 2": weather from the start of the day.
  if (WEATHER.test(message) && ALL_DAY.test(message)) {
    const dayMatch = message.match(DAY)
    const dayIndex = dayMatch ? Number(dayMatch[1]) - 1 : input.focusDayIndex
    if (dayIndex !== undefined && plan.days.some((day) => day.dayIndex === dayIndex)) {
      return { kind: 'weather_after', dayIndex, from: '00:00', reason: message }
    }
  }

  const cutOff = message.match(CUT_OFF)
  if (cutOff && CUT_OFF_REASON.test(message)) {
    const dayMatch = message.match(DAY)
    const dayIndex = dayMatch ? Number(dayMatch[1]) - 1 : input.focusDayIndex
    if (dayIndex !== undefined && plan.days.some((day) => day.dayIndex === dayIndex)) {
      if (WEATHER.test(message)) {
        return { kind: 'weather_after', dayIndex, from: toClock(cutOff[1], cutOff[2], cutOff[3]), reason: message }
      }
      return {
        kind: 'clear_after',
        dayIndex,
        endBy: toClock(cutOff[1], cutOff[2], cutOff[3]),
        reason: message,
      }
    }
  }

  const target = resolveTargetItem(message, plan, catalogue)
  if (target) return { kind: 'replace_place', ...target }

  // Only once no stop was named: "I don't like the sushi place on Day 2" is a swap.
  const statement = preferenceStatement(message)
  if (statement) return statement

  return { kind: 'unresolved' }
}
