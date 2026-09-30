/**
 * Deterministic LLM stub.
 *
 * Used by scenario and E2E tests so the run is reproducible and free. The code
 * path under test is identical — the same application layer, the same domain
 * classifier. Only the source of the model's judgments changes.
 */

import { splitClauses } from './fallbackLlm.ts'
import type {
  DecomposedState,
  LlmService,
  QueryPlanRequest,
  QueryPlanResult,
  ReplacementChoice,
} from './types.ts'

export interface StubOptions {
  /** Force a specific replacement id. Default: the first offered candidate. */
  replacementPlaceId?: string
  /** Return an id that is not in the candidate set, to test the id guard. */
  hallucinatePlaceId?: string
  proposedPriority?: { name: string; reason: string }
  /** Name a category nobody asked for, to test the query-plan guard. */
  hallucinateCategory?: string
  /** Extra categories to suggest, as a real model might. */
  alsoSearch?: string[]
}

export function createStubLlm(options: StubOptions = {}): LlmService {
  return {
    async decomposeTripState({ intentText, consideringText }): Promise<DecomposedState> {
      return {
        intent: splitClauses(intentText),
        considering: splitClauses(consideringText),
        ...(options.proposedPriority ? { proposedPriority: options.proposedPriority } : {}),
      }
    },

    async chooseReplacement({ outgoing, candidates }): Promise<ReplacementChoice> {
      if (options.hallucinatePlaceId) {
        return {
          placeId: options.hallucinatePlaceId,
          rationale: 'A place that is not in the candidate set.',
        }
      }

      const chosen =
        candidates.find((place) => place.placeId === options.replacementPlaceId) ?? candidates[0]

      return {
        placeId: chosen.placeId,
        rationale: `${chosen.name} is open at that time and fits the same part of the day as ${outgoing.name}, in ${chosen.neighborhood}.`,
      }
    },

    /**
     * Deterministic search wording.
     *
     * Shaped like a real answer rather than echoing the default: it works the
     * traveller's first few words in, so a test can tell a model-written query from
     * the fallback one the application writes when there is no model.
     */
    async planQueries(input: QueryPlanRequest): Promise<QueryPlanResult> {
      const flavour = input.intentText
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length >= 4)
        .slice(0, 2)
        .join(' ')

      // The first clause of the Intent, verbatim, as a model would quote it.
      const firstClause = input.intentText.split('.')[0]?.trim() ?? ''

      const queries = input.searches.map((search) => ({
        category: options.hallucinateCategory ?? search.category,
        ...(flavour && firstClause ? { servesWords: firstClause } : {}),
        textQuery: [
          flavour,
          search.category.replace(/_/g, ' '),
          `near ${input.baseLodgingName}`,
        ]
          .filter(Boolean)
          .join(' '),
      }))

      return { queries, alsoSearch: options.alsoSearch ?? [] }
    },
  }
}
