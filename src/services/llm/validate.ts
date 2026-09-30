/**
 * Checking what came back is the shape it was promised (Gate 8).
 *
 * The server pins every response with a strict JSON schema, so why check again in
 * the browser: because the schema is enforced at the far end of a network hop the
 * browser cannot see. What actually arrives here is a JSON body from a fetch —
 * which can be a proxy's error page, a truncated response, a provider outage
 * rendered as `{}`, or a server that was redeployed mid-call with a different
 * contract. Trusting the field to be there because it should be there is how
 * `undefined` reaches the domain and comes back out as a plan item with no place.
 *
 * Narrow on purpose. This checks the SHAPE and nothing else: whether a placeId is
 * one the model was allowed to pick, whether a category exists, whether a query is
 * usable at all — those are the callers' checks, already written, and doubling them
 * here would mean two rules to keep in step.
 */

import { LlmShapeError } from './errors.ts'
import type { DecomposedState, LineKind, LineReading, MessageAction, MessageReading, QueryPlanResult, ReplacementChoice } from './types.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (!value.every((entry) => typeof entry === 'string')) return undefined
  return value as string[]
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

export function readDecomposedState(body: unknown): DecomposedState {
  if (!isRecord(body)) throw new LlmShapeError('the trip setup', 'not an object')

  const intent = stringArray(body.intent)
  const considering = stringArray(body.considering)
  if (!intent) throw new LlmShapeError('the trip setup', 'intent is not a list of sentences')
  if (!considering) {
    throw new LlmShapeError('the trip setup', 'considering is not a list of sentences')
  }

  // A proposed Priority is optional, and a malformed one is dropped rather than
  // failing the call: the trip does not depend on it, and §3.4 requires the user to
  // accept it anyway.
  const proposed = isRecord(body.proposedPriority) ? body.proposedPriority : undefined
  const name = nonEmptyString(proposed?.name)
  const reason = nonEmptyString(proposed?.reason)

  return {
    intent,
    considering,
    ...(name && reason ? { proposedPriority: { name, reason } } : {}),
  }
}

export function readReplacementChoice(body: unknown): ReplacementChoice {
  if (!isRecord(body)) throw new LlmShapeError('a replacement', 'not an object')

  const placeId = nonEmptyString(body.placeId)
  if (!placeId) throw new LlmShapeError('a replacement', 'no placeId')

  // Prose only, and a missing one is not worth failing over — the caller writes the
  // change; this sentence only explains it. An empty reason is better than no
  // replacement at all.
  return { placeId, rationale: nonEmptyString(body.rationale) ?? '' }
}

export function readQueryPlan(body: unknown): QueryPlanResult {
  if (!isRecord(body)) throw new LlmShapeError('the search wording', 'not an object')
  if (!Array.isArray(body.queries)) {
    throw new LlmShapeError('the search wording', 'queries is not a list')
  }

  // Entry by entry: one unusable query should not cost the other nineteen, and the
  // caller writes its own wording for anything missing.
  const queries = body.queries.filter(isRecord).flatMap((entry) => {
    const category = nonEmptyString(entry.category)
    const textQuery = nonEmptyString(entry.textQuery)
    const servesWords = nonEmptyString(entry.servesWords)
    return category && textQuery
      ? [{ category, textQuery, ...(servesWords ? { servesWords } : {}) }]
      : []
  })

  return { queries, alsoSearch: stringArray(body.alsoSearch) ?? [] }
}

const LINE_KINDS = new Set<LineKind>([
  'must_visit', 'day_in_place', 'avoid', 'budget', 'pace', 'finish_by', 'half_day',
  'free_time', 'slot_meal', 'event', 'transport', 'theme', 'unclear',
])
const MESSAGE_ACTIONS = new Set<MessageAction>([
  'replace_stop', 'weather', 'finish_by', 'lighter', 'preference', 'state_line', 'unclear',
])

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null
const stringOrNull = (value: unknown): string | null => nonEmptyString(value)?.trim() ?? null
const dayOrNull = (value: unknown, words: readonly string[]): number | string | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : oneOf(value, words)

/**
 * Line readings, entry by entry: an unreadable entry is dropped, and its line falls
 * back to the rules rather than failing the whole save.
 */
export function readLineReadings(body: unknown): { readings: LineReading[] } {
  if (!isRecord(body) || !Array.isArray(body.readings)) {
    throw new LlmShapeError('your notes', 'readings is not a list')
  }
  const readings = body.readings.filter(isRecord).flatMap((entry): LineReading[] => {
    const id = nonEmptyString(entry.id)
    const kind = typeof entry.kind === 'string' && LINE_KINDS.has(entry.kind as LineKind) ? (entry.kind as LineKind) : undefined
    if (!id || !kind) return []
    return [{
      id,
      kind,
      day: dayOrNull(entry.day, ['first', 'last']) as LineReading['day'],
      place: stringOrNull(entry.place),
      category: stringOrNull(entry.category),
      meal: oneOf(entry.meal, ['lunch', 'dinner', 'nightcap'] as const),
      time: typeof entry.time === 'string' && /^\d{1,2}:\d{2}$/.test(entry.time) ? entry.time.padStart(5, '0') : null,
      minutes: typeof entry.minutes === 'number' && entry.minutes > 0 ? Math.round(entry.minutes) : null,
      budget: oneOf(entry.budget, ['low', 'moderate', 'high'] as const),
      avoid: stringOrNull(entry.avoid),
      activity: stringOrNull(entry.activity),
      pace: oneOf(entry.pace, ['slow', 'normal', 'packed'] as const),
      characters: stringArray(entry.characters) ?? [],
      question: stringOrNull(entry.question),
    }]
  })
  return { readings }
}

/** A message reading, or null when there is none — the rules then route it. */
export function readMessageReading(body: unknown): MessageReading | null {
  if (!isRecord(body)) throw new LlmShapeError('your message', 'not an object')
  if (body.reading === null) return null
  const entry = isRecord(body.reading) ? body.reading : undefined
  const action = entry && typeof entry.action === 'string' && MESSAGE_ACTIONS.has(entry.action as MessageAction)
    ? (entry.action as MessageAction)
    : undefined
  if (!entry || !action) throw new LlmShapeError('your message', 'no action')
  return {
    action,
    day: dayOrNull(entry.day, ['first', 'last', 'today']) as MessageReading['day'],
    stop: stringOrNull(entry.stop),
    time: typeof entry.time === 'string' && /^\d{1,2}:\d{2}$/.test(entry.time) ? entry.time.padStart(5, '0') : null,
    polarity: entry.polarity === 1 || entry.polarity === -1 ? entry.polarity : null,
    stateLine: stringOrNull(entry.stateLine),
    section: oneOf(entry.section, ['intent', 'considering'] as const),
    question: stringOrNull(entry.question),
  }
}
