/**
 * The traveller's own words → what the plan does with them (2026-10-01).
 *
 * Every line of Intent and Considering is read, by the model where one answers and by
 * the rules in tagConsidering otherwise. The model names a KIND of instruction and the
 * words it hangs on; this module turns those into State the planner acts on, and it
 * is the only place that does:
 *
 *   - the day: "last" is the trip's last day, "7" on a five-day trip is a question
 *   - the place: the trip's own places first, then the area table, else unresolved
 *     for the caller to geocode or report — never a place the model made up
 *   - the category: only an id from the taxonomy
 *
 * And every reading is said back in words (`readAs`), so a misreading is visible on
 * the line it came from and the traveller can rephrase it.
 */

import { charactersIn, TOKYO_AREAS, type AreaCharacter } from '../../domain/places/areas.ts'
import { CATEGORY_BY_ID, INTEREST_CATEGORY_IDS } from '../../domain/places/taxonomy.ts'
import type { DayRoleId } from '../../domain/plan/dayRoles.ts'
import type { ConsideringTag, IntentReading } from '../../domain/state/types.ts'
import type { LineReading, LlmService } from '../../services/llm/types.ts'
import type { PlaceCatalogue } from '../../services/places/types.ts'
import { isUnresolvedPlaceId, placeForDay, tagConsidering } from './tagConsidering.ts'

export interface ConsideringInterpretation {
  tag?: ConsideringTag
  readAs: string
  question?: string
  readBy: 'model' | 'rules'
}

export interface IntentInterpretation {
  reading: IntentReading
  readAs: string
  readBy: 'model' | 'rules'
}

export type LineInterpretation = ConsideringInterpretation | IntentInterpretation

export interface InterpretContext {
  catalogue: PlaceCatalogue
  days: number
}

const ALL_CHARACTERS: AreaCharacter[] = [...new Set(TOKYO_AREAS.flatMap((area) => area.characters))]
const SLOW = /\b(?:slow|slowly|slower|slow-paced|unhurried|leisurely|relaxed|take it easy|no rush)\b|慢慢|悠閒|悠哉|ゆっくり|のんびり/i

const categoryWords = (category: string) =>
  (CATEGORY_BY_ID.get(category)?.labelEn ?? category.replace(/_/g, ' ')).replace(/\s*\/\s*/g, ' or ').toLowerCase()

/** A reading's day as a 0-based index on this trip, or undefined when it names none or one the trip has not got. */
function dayIndexOf(day: LineReading['day'], days: number): number | 'out_of_range' | undefined {
  if (day === null) return undefined
  if (day === 'first') return 0
  if (day === 'last') return days - 1
  return day >= 1 && day <= days ? day - 1 : 'out_of_range'
}

/** What a tag asks, said back in words. */
export function describeTag(tag: ConsideringTag | undefined, catalogue: PlaceCatalogue): string {
  const day = (index: number) => `Day ${index + 1}`
  if (!tag) return 'A general wish — used when choosing between places'
  switch (tag.kind) {
    case 'must_visit': {
      const name = isUnresolvedPlaceId(tag.placeId) ? `“${tag.placeId.slice('unresolved:'.length)}”` : catalogue.get(tag.placeId)?.name ?? tag.placeId
      return `Must visit ${name}${tag.dayIndex !== undefined ? ` on ${day(tag.dayIndex)}` : ''}`
    }
    case 'day_in_place':
      return `${day(tag.dayIndex)} → a day in ${tag.place.name}${tag.place.center ? '' : ' (location still to find)'}`
    case 'avoid':
      return `Avoid ${tag.value}`
    case 'budget':
      return `Budget: ${tag.level}`
    case 'pace':
      return tag.style === 'slow' ? 'Pace: slow — few moves and few neighbourhoods a day' : `Pace: ${tag.style}`
    case 'fixed_time':
      return `${day(tag.dayIndex)}: done by ${tag.time}`
    case 'half_day':
      return `${day(tag.dayIndex)}: a half day`
    case 'time_block':
      return `${day(tag.dayIndex)}: ${Math.round(tag.minutes / 60)} free hours`
    case 'slot_category':
      return `${day(tag.dayIndex)} ${tag.role} → ${categoryWords(tag.category)}`
    case 'event_request':
      return `Find a ${tag.activity} to go to`
    case 'event':
      return `${tag.event.title}, Day ${tag.event.dayIndex + 1} at ${tag.event.start}`
    case 'transport':
      return 'No taxis'
  }
}

/** A model reading of a Considering line → the tag the planner acts on. */
export function considerFromReading(reading: LineReading, context: InterpretContext): ConsideringInterpretation {
  const { catalogue, days } = context
  const index = dayIndexOf(reading.day, days)
  const ask = (question: string): ConsideringInterpretation => ({ readAs: 'Not sure how to plan this yet', question, readBy: 'model' })
  if (index === 'out_of_range') return ask(`This trip has ${days} days — which day did you mean?`)
  const done = (tag: ConsideringTag | undefined): ConsideringInterpretation => ({ ...(tag ? { tag } : {}), readAs: describeTag(tag, catalogue), readBy: 'model' })
  const needDay = (what: string) => ask(`Which day should ${what}?`)

  switch (reading.kind) {
    case 'must_visit': {
      if (!reading.place) return ask('Which place do you mean?')
      if (index !== undefined) return done(placeForDay(reading.place, index, catalogue))
      const tag = tagConsidering(`We must visit ${reading.place}.`, catalogue, days)
      return done(tag)
    }
    case 'day_in_place':
      if (!reading.place) return ask('Where would you like to spend the day?')
      if (index === undefined) return needDay(`be spent in ${reading.place}`)
      return done(placeForDay(reading.place, index, catalogue))
    case 'avoid': {
      const value =
        reading.avoid === 'crowds'
          ? 'crowded tourist spots'
          : reading.avoid && INTEREST_CATEGORY_IDS.includes(reading.avoid)
            ? categoryWords(reading.avoid)
            : reading.avoid ?? (reading.category ? categoryWords(reading.category) : undefined)
      return value ? done({ kind: 'avoid', value }) : ask('What would you like to avoid?')
    }
    case 'budget':
      return reading.budget ? done({ kind: 'budget', level: reading.budget }) : ask('Low, moderate or high budget?')
    case 'pace':
      return done({ kind: 'pace', style: reading.pace ?? 'slow' })
    case 'finish_by':
      if (index === undefined) return needDay('finish early')
      return reading.time ? done({ kind: 'fixed_time', dayIndex: index, time: reading.time }) : ask('By what time?')
    case 'half_day':
      return index === undefined ? needDay('be a half day') : done({ kind: 'half_day', dayIndex: index })
    case 'free_time':
      if (index === undefined) return needDay('have free time')
      return done({ kind: 'time_block', dayIndex: index, minutes: reading.minutes ?? 120 })
    case 'slot_meal':
      if (index === undefined) return needDay(`have this ${reading.meal ?? 'meal'}`)
      if (!reading.meal || !reading.category || !INTEREST_CATEGORY_IDS.includes(reading.category)) return ask('Which meal, and what kind of food?')
      return done({ kind: 'slot_category', dayIndex: index, role: reading.meal as DayRoleId, category: reading.category })
    case 'event':
      return reading.activity ? done({ kind: 'event_request', activity: reading.activity }) : ask('What kind of event?')
    case 'transport':
      return done({ kind: 'transport', avoid: 'taxi' })
    case 'theme':
      return done(undefined)
    case 'unclear':
      return ask(reading.question ?? 'Could you say this another way — which day, and what should change?')
  }
}

/** The rules' reading of a Considering line. */
export function considerByRules(text: string, context: InterpretContext): ConsideringInterpretation {
  const tag = tagConsidering(text, context.catalogue, context.days)
  return { ...(tag ? { tag } : {}), readAs: describeTag(tag, context.catalogue), readBy: 'rules' }
}

function describeIntent(reading: IntentReading): string {
  const parts = [
    ...(reading.pace === 'slow' ? ['Pace: slow — few moves and few neighbourhoods a day'] : reading.pace ? [`Pace: ${reading.pace}`] : []),
    ...(reading.characters?.length ? [`Neighbourhoods: ${reading.characters.join(', ').replace(/_/g, ' ')}`] : []),
  ]
  return parts.length > 0 ? parts.join(' · ') : 'A mood for the trip — used when choosing between places'
}

export function intentFromReading(reading: LineReading): IntentInterpretation {
  const characters = reading.characters.filter((character): character is AreaCharacter => ALL_CHARACTERS.includes(character as AreaCharacter))
  const intent: IntentReading = { ...(reading.pace ? { pace: reading.pace } : {}), ...(characters.length ? { characters } : {}) }
  return { reading: intent, readAs: describeIntent(intent), readBy: 'model' }
}

export function intentByRules(text: string): IntentInterpretation {
  const characters = charactersIn(text)
  const intent: IntentReading = { ...(SLOW.test(text) ? { pace: 'slow' as const } : {}), ...(characters.length ? { characters } : {}) }
  return { reading: intent, readAs: describeIntent(intent), readBy: 'rules' }
}

/** A model reading per line, keyed by `interpretationKey`; a line with none is read by rules. */
export type RawReadings = Map<string, LineReading>

/**
 * Asks the model once for every line. Kept apart from resolving them, because the
 * reading does not depend on which places the trip has — resolving does, and at trip
 * creation the places arrive only after the lines were read.
 */
export async function fetchReadings(input: {
  llm: LlmService
  lines: ReadonlyArray<{ text: string; section: 'intent' | 'considering' }>
  destination: string
  startDate: string
  days: number
}): Promise<RawReadings> {
  const unique = [...new Map(input.lines.filter((line) => line.text.trim()).map((line) => [interpretationKey(line.section, line.text), line])).values()]
  const out: RawReadings = new Map()
  if (unique.length === 0) return out
  const withIds = unique.map((line, index) => ({ id: `l${index + 1}`, ...line }))
  let readings: LineReading[] = []
  try {
    readings = (await input.llm.interpretLines({
      destination: input.destination,
      days: input.days,
      startDate: input.startDate,
      lines: withIds,
      allowedCategories: INTEREST_CATEGORY_IDS,
      allowedCharacters: ALL_CHARACTERS,
    })).readings
  } catch {
    readings = []
  }
  const byId = new Map(readings.map((reading) => [reading.id, reading]))
  for (const line of withIds) {
    const reading = byId.get(line.id)
    if (reading) out.set(interpretationKey(line.section, line.text), reading)
  }
  return out
}

/** Readings → what the planner acts on, against this trip's places. */
export function resolveReadings(
  lines: ReadonlyArray<{ text: string; section: 'intent' | 'considering' }>,
  raw: RawReadings,
  context: InterpretContext,
): Map<string, LineInterpretation> {
  const out = new Map<string, LineInterpretation>()
  for (const line of lines) {
    if (!line.text.trim()) continue
    const key = interpretationKey(line.section, line.text)
    const reading = raw.get(key)
    if (line.section === 'intent') {
      out.set(key, reading ? intentFromReading(reading) : intentByRules(line.text))
      continue
    }
    let read = reading ? considerFromReading(reading, context) : considerByRules(line.text, context)
    // A model that could not place a line the rules can: the rules' reading wins.
    if (reading && !read.tag && reading.kind !== 'theme') {
      const rules = considerByRules(line.text, context)
      if (rules.tag) read = rules
    }
    out.set(key, read)
  }
  return out
}

/** Reads and resolves lines, keyed by `interpretationKey`. */
export async function interpretLines(input: {
  llm: LlmService
  lines: ReadonlyArray<{ text: string; section: 'intent' | 'considering' }>
  destination: string
  startDate: string
  context: InterpretContext
}): Promise<Map<string, LineInterpretation>> {
  const raw = await fetchReadings({ ...input, days: input.context.days })
  return resolveReadings(input.lines, raw, input.context)
}

export function interpretationKey(section: 'intent' | 'considering', text: string): string {
  return `${section}:${text.trim()}`
}
