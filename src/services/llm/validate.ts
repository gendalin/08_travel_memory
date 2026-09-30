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
import type { DecomposedState, QueryPlanResult, ReplacementChoice } from './types.ts'

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
