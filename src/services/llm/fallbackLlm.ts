/**
 * What the product does when the planning service cannot be reached (Phase C2).
 *
 * Not a stub and not a test seam: this is the production degradation path. The
 * product's failure mode changed when trip creation started depending on an outside
 * service, and "the planning service is unavailable" is not an acceptable end state
 * for a traveller mid-trip whose restaurant just closed.
 *
 * Each of the model's three jobs has a deterministic stand-in, and each is honest
 * about being one:
 *
 *   - **decomposition** splits the traveller's own sentences on punctuation. It
 *     loses the semantic reading — "slow-paced, time in local neighbourhoods" stays
 *     one clause per sentence rather than being understood — but every word is the
 *     traveller's, and Stage B is editable, which is where they fix it.
 *   - **a replacement** takes the best-ranked candidate. The ranking is code (§12.2)
 *     and it already put them in order; the model's contribution was choosing
 *     between the top few and writing the sentence, so what is lost is the sentence.
 *   - **search wording** returns nothing at all, deliberately. `resolveQueryPlan`
 *     writes plain wording for any category the model did not answer for, and marks
 *     it `source: 'default'`. Returning code-written text here would arrive labelled
 *     as the model's, which is the one thing worse than plain wording.
 *
 * Nothing here is silent. `createResilientLlm` reports every fall back so the UI can
 * tell the traveller which part of this the product did by itself.
 */

import type {
  DecomposedState,
  LlmService,
  QueryPlanResult,
  ReplacementChoice,
} from './types.ts'

/**
 * Splits free text the way a decomposition would, minus the understanding.
 *
 * Shared with the test stub so there is one implementation of "what a sentence
 * splitter does here" rather than two that drift.
 */
export function splitClauses(text: string): string[] {
  return text
    .split(/[.;\n]|,\s*(?=[a-z])/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 2)
    .map((clause) => clause.charAt(0).toUpperCase() + clause.slice(1))
}

export function decomposeWithoutModel(input: {
  intentText: string
  consideringText: string
}): DecomposedState {
  return {
    intent: splitClauses(input.intentText),
    considering: splitClauses(input.consideringText),
  }
}

export function chooseWithoutModel(input: {
  outgoing: { name: string }
  candidates: Array<{ placeId: string; name: string; neighborhood: string }>
}): ReplacementChoice {
  const chosen = input.candidates[0]
  return {
    placeId: chosen.placeId,
    // Says only what code can stand behind: it fits the slot and it ranked highest
    // against this trip. No claim about what the place is like.
    rationale: `${chosen.name} in ${chosen.neighborhood} is the closest fit for that part of the day.`,
  }
}

/** Nothing, so the caller writes its own wording and labels it as its own. */
export function planQueriesWithoutModel(): QueryPlanResult {
  return { queries: [], alsoSearch: [] }
}

export function createFallbackLlm(): LlmService {
  return {
    async decomposeTripState(input) {
      return decomposeWithoutModel(input)
    },
    async chooseReplacement(input) {
      return chooseWithoutModel(input)
    },
    async planQueries() {
      return planQueriesWithoutModel()
    },
  }
}
