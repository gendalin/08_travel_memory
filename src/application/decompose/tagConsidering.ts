/**
 * Considering -> structured constraint (product_spec §3.2, §8).
 *
 * Structured tags are internal: the user only ever sees the sentence they
 * wrote. This is what turns that sentence into something the validator can
 * check, and it is deliberately deterministic — a model deciding "this is a
 * must-visit" would make constraint failures unreproducible, and §0.3 puts
 * deterministic code ahead of model judgment.
 *
 * Unrecognised sentences get no tag at all. An untagged Considering item still
 * reaches State and still shows on screen; it is simply not a hard constraint.
 */

import type { DayRoleId } from '../../domain/plan/dayRoles.ts'
import { CATEGORIES } from '../../domain/places/taxonomy.ts'
import { findArea } from '../../domain/places/areas.ts'
import type { ConsideringTag } from '../../domain/state/types.ts'
import type { PlaceCatalogue } from '../../services/places/types.ts'

/**
 * Marks a must-visit the catalogue could not resolve. The id cannot exist in
 * the dataset, so the validator reports `must_visit_missing` and the user gets
 * a Conflict naming their own sentence — rather than a silently dropped
 * constraint, which is the failure mode that matters here.
 */
export const UNRESOLVED_PLACE_PREFIX = 'unresolved:'

export function isUnresolvedPlaceId(placeId: string): boolean {
  return placeId.startsWith(UNRESOLVED_PLACE_PREFIX)
}

const MUST_VISIT =
  /\b(?:must|have to|need to|want to make sure (?:we|i))\s+(?:visit|see|go to|eat at|get to|stop at)\s+(?:the\s+)?(.+)/i
const CLEAR_BY = /\b(?:clear|free|done|finished|back|wrapped up)\s+by\s+([0-9]{1,2})(?::([0-9]{2}))?\s*(am|pm)?/i
const HALF_DAY = /\bhalf[-\s]?day\b/i
const FREE_BLOCK = /\b(\d+)\s*(?:hours?|hrs?)\s+(?:free|open|unplanned|to (?:ourselves|myself))/i
const BUDGET = /\bbudget\b|\bspend\b|\bcheap\b|\bsplurge\b/i
const AVOID = /\b(?:avoid|skip|stay away from|no more)\s+(?:the\s+)?(.+)/i

const DAY = /\bday\s*(\d+)/i
const LAST_DAY = /\b(?:the\s+)?(?:last|final)\s+day\b|最後一天|最后一天|最終日/i
const FIRST_DAY = /\b(?:the\s+)?first\s+day\b|第一天|初日/i
const CJK_DAY = /第\s*(\d+)\s*天|(\d+)\s*日目/

/**
 * A whole day somewhere: "go to Yokohama on the last day", "Day 5: Kamakura",
 * "最後一天去橫濱" (2026-10-01). The rules' reading, used when no model reading is
 * available; a model reads far more ways of saying it.
 */
const DAY_IN_PLACE = [
  /\b(?:go(?:ing)? to|visit|head to|spend (?:a |the )?day in|day[-\s]trip to|trip to)\s+(?:the\s+)?(.+?)\s+(?:on|for)\s+(?:the\s+)?(?:day\s*\d+|(?:last|final|first)\s+day)\b/i,
  /^\s*day\s*\d+\s*[:：\-–]\s*(.+?)\s*$/i,
  /(?:最後一天|最后一天|第\s*\d+\s*天|第一天)\s*(?:去|到|在)\s*(.+?)\s*$/,
]

const SLOW = /\b(?:slow|slowly|slower|slow-paced|unhurried|leisurely|relaxed|take it easy|no rush)\b|慢慢|悠閒|悠哉|ゆっくり|のんびり/i
const NO_TAXI = /\bno (?:taxis?|cabs?)\b|\bwithout (?:a )?(?:taxi|cab)\b|\b(?:avoid|skip) (?:taxis?|cabs?)\b|不(?:搭|坐)計程車|タクシーなし/i

/** The part of a day a sentence names. Meals only: they are what a traveller swaps. */
const SLOT_WORDS: Array<[RegExp, DayRoleId]> = [
  [/\bafter[-\s]dinner\b|\bnightcap\b|\blate[-\s]night\b|\bdrinks?\b/i, 'nightcap'],
  [/\blunch\b/i, 'lunch'],
  [/\bdinner\b|\bsupper\b/i, 'dinner'],
]

/**
 * Activities that only exist on a date, at a time — so they need a live search
 * before they can be planned (§7.8).
 */
const ACTIVITIES: Array<[RegExp, string]> = [
  [/\bbaseball\b|\bnpb\b|棒球|野球/i, 'baseball'],
  [/\bsumo\b|相撲/i, 'sumo'],
  [/\bj[-\s]?league\b|\bfootball match\b|\bsoccer\b/i, 'football'],
  [/\bconcerts?\b|\blive music\b|\bgigs?\b/i, 'concert'],
  [/\bkabuki\b/i, 'kabuki'],
  [/\bfestivals?\b|\bmatsuri\b/i, 'festival'],
]

/** What the traveller is moving away from — "instead of ramen" — is not what they want. */
const INSTEAD = /\b(?:instead of|rather than|not)\b.*$/i

/**
 * "Day 2 dinner: sushi", "sushi for lunch on day 3 instead of ramen" -> one slot,
 * one kind of place. The category is read from the taxonomy's own words, so it can
 * only ever be a category places are indexed by.
 */
function slotCategory(text: string, dayIndex: number | undefined): ConsideringTag | undefined {
  if (dayIndex === undefined) return undefined
  const role = SLOT_WORDS.find(([pattern]) => pattern.test(text))?.[1]
  if (!role) return undefined

  const wanted = text.replace(INSTEAD, '').toLowerCase()
  const words = (value: string) => value.toLowerCase().split(/[^a-z\u3040-\u30ff\u4e00-\u9fff]+/).filter((word) => word.length >= 3)
  const category = CATEGORIES.filter((entry) => entry.interestPoint).find((entry) => {
    const names = [...entry.id.split('_'), ...words(entry.labelEn), ...entry.keywords.map((keyword) => keyword.toLowerCase())]
    return names.some((name) => name.length >= 3 && new RegExp(`(^|[^a-z])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(wanted))
  })
  return category ? { kind: 'slot_category', dayIndex, role, category: category.id } : undefined
}

/** The day a sentence names: "Day 3", "the last day", "第3天". `days` resolves "last". */
export function dayIndexIn(text: string, days?: number): number | undefined {
  const match = text.match(DAY)
  if (match) return Number(match[1]) - 1
  const cjk = text.match(CJK_DAY)
  if (cjk) return Number(cjk[1] ?? cjk[2]) - 1
  if (LAST_DAY.test(text) && days !== undefined) return days - 1
  if (FIRST_DAY.test(text)) return 0
  return undefined
}

/** "3", "3" + "pm", "15" + ":00" -> "HH:MM". */
function toClock(hour: string, minute: string | undefined, meridiem: string | undefined): string {
  let hours = Number(hour)
  if (meridiem?.toLowerCase() === 'pm' && hours < 12) hours += 12
  if (meridiem?.toLowerCase() === 'am' && hours === 12) hours = 0
  return `${String(hours).padStart(2, '0')}:${minute ?? '00'}`
}

function budgetLevel(text: string): 'low' | 'moderate' | 'high' | undefined {
  const lower = text.toLowerCase()
  if (/\b(low|cheap|tight|budget-friendly|shoestring)\b/.test(lower)) return 'low'
  if (/\b(moderate|mid|middle|reasonable|sensible)\b/.test(lower)) return 'moderate'
  if (/\b(high|generous|splurge|no limit)\b/.test(lower)) return 'high'
  return undefined
}

/** Strips the trailing prose a place name is usually buried in. */
function placePhrase(raw: string): string {
  return raw
    .replace(/\b(on|during|for)\s+(?:the\s+)?(?:day\s*\d+|(?:last|final|first)\s+day).*$/i, '')
    .replace(/[.!?,;]+\s*$/, '')
    .replace(/\s+at some point$/i, '')
    .trim()
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Words too generic to identify a place on their own. A phrase made only of
 * these resolves to nothing, so "the park" does not silently become whichever
 * park happens to be first in the dataset.
 */
const GENERIC_PLACE_WORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'at', 'and',
  'market', 'park', 'garden', 'gardens', 'museum', 'gallery', 'cafe', 'coffee',
  'shop', 'store', 'street', 'books', 'bookstore', 'restaurant', 'bar', 'tokyo',
])

function tokens(value: string): string[] {
  return normalise(value).split(' ').filter((token) => token.length >= 3)
}

/**
 * Resolves a phrase to a placeId in the bounded dataset, in three widening
 * passes: exact name, substring either way, then a token-subset match so
 * "Tsukiji market" finds "Fish Market Tsukiji Outer Market".
 *
 * The token pass insists on at least one distinctive word. Without that guard
 * it would happily match a vague phrase to an arbitrary place, which is worse
 * than admitting it could not tell.
 */
export function resolvePlaceByName(phrase: string, catalogue: PlaceCatalogue): string | undefined {
  const wanted = normalise(phrase)
  if (wanted.length < 3) return undefined

  const places = catalogue.all().filter((place) => place.category !== 'accommodation')

  const exact = places.find((place) => normalise(place.name) === wanted)
  if (exact) return exact.placeId

  const contained = places
    .filter((place) => {
      const name = normalise(place.name)
      return name.includes(wanted) || wanted.includes(name)
    })
    // Longest name wins: "Ueno Park" should beat a one-word partial.
    .sort((a, b) => b.name.length - a.name.length)
  if (contained[0]) return contained[0].placeId

  const wantedTokens = tokens(phrase)
  if (!wantedTokens.some((token) => !GENERIC_PLACE_WORDS.has(token))) return undefined

  const overlapping = places
    .filter((place) => {
      const nameTokens = new Set(tokens(place.name))
      return wantedTokens.every((token) => nameTokens.has(token))
    })
    // The tightest name wins: fewer unmatched words means a closer match.
    .sort((a, b) => tokens(a.name).length - tokens(b.name).length)

  return overlapping[0]?.placeId
}

/**
 * A named place for a day: the trip's own place pinned to that day, a known area or
 * day-trip town, or — unresolved — the name, for the caller to geocode or report.
 */
export function placeForDay(phrase: string, dayIndex: number, catalogue: PlaceCatalogue): ConsideringTag {
  const cleaned = placePhrase(phrase)
  const asArea = (area: NonNullable<ReturnType<typeof findArea>>): ConsideringTag => ({
    kind: 'day_in_place', dayIndex, place: { name: area.name, center: area.center, radiusKm: area.radiusKm, areaId: area.id },
  })
  // A town named outright is the town, even if a shop's name contains it.
  const town = findArea(cleaned, { exact: true })
  const exactPlace = catalogue.all().find((place) => normalise(place.name) === normalise(cleaned))
  if (exactPlace) return { kind: 'must_visit', placeId: exactPlace.placeId, dayIndex }
  if (town) return asArea(town)
  const placeId = resolvePlaceByName(cleaned, catalogue)
  if (placeId) return { kind: 'must_visit', placeId, dayIndex }
  const area = findArea(cleaned)
  return area
    ? { kind: 'day_in_place', dayIndex, place: { name: area.name, center: area.center, radiusKm: area.radiusKm, areaId: area.id } }
    : { kind: 'day_in_place', dayIndex, place: { name: cleaned } }
}

export function tagConsidering(text: string, catalogue: PlaceCatalogue, days?: number): ConsideringTag | undefined {
  const dayIndex = dayIndexIn(text, days)

  if (dayIndex !== undefined && !SLOT_WORDS.some(([pattern]) => pattern.test(text)) && !MUST_VISIT.test(text)) {
    for (const pattern of DAY_IN_PLACE) {
      const match = text.match(pattern)
      if (match?.[1]) return placeForDay(match[1], dayIndex, catalogue)
    }
  }

  const mustVisit = text.match(MUST_VISIT)
  if (mustVisit) {
    const phrase = placePhrase(mustVisit[1])
    const placeId = resolvePlaceByName(phrase, catalogue)
    return {
      kind: 'must_visit',
      placeId: placeId ?? `${UNRESOLVED_PLACE_PREFIX}${normalise(phrase)}`,
      // "on Day 4" is stripped from the name, not from the constraint.
      ...(dayIndex !== undefined ? { dayIndex } : {}),
    }
  }

  const slot = slotCategory(text, dayIndex)
  if (slot) return slot

  // "At least one baseball game": needs a real game before it can be planned. An
  // avoid is not a request ("avoid festivals"), so the avoid rule is checked first.
  const activity = ACTIVITIES.find(([pattern]) => pattern.test(text))?.[1]
  if (activity && !AVOID.test(text)) return { kind: 'event_request', activity }

  const clearBy = text.match(CLEAR_BY)
  if (clearBy && dayIndex !== undefined) {
    return { kind: 'fixed_time', dayIndex, time: toClock(clearBy[1], clearBy[2], clearBy[3]) }
  }

  if (HALF_DAY.test(text) && dayIndex !== undefined) {
    return { kind: 'half_day', dayIndex }
  }

  const freeBlock = text.match(FREE_BLOCK)
  if (freeBlock && dayIndex !== undefined) {
    return { kind: 'time_block', dayIndex, minutes: Number(freeBlock[1]) * 60 }
  }

  if (BUDGET.test(text)) {
    const level = budgetLevel(text)
    if (level) return { kind: 'budget', level }
  }

  if (NO_TAXI.test(text)) return { kind: 'transport', avoid: 'taxi' }

  const avoid = text.match(AVOID)
  if (avoid) {
    const value = placePhrase(avoid[1])
    if (value.length >= 3) return { kind: 'avoid', value }
  }

  if (SLOW.test(text)) return { kind: 'pace', style: 'slow' }

  return undefined
}

/** Applies the tagger to a list, leaving text untouched. */
export function tagAll<T extends { text: string; tag?: ConsideringTag }>(
  items: T[],
  catalogue: PlaceCatalogue,
  days?: number,
): T[] {
  return items.map((item) => ({ ...item, tag: tagConsidering(item.text, catalogue, days) }))
}
