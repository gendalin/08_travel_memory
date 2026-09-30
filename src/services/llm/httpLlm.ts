/**
 * Browser-side LLM client.
 *
 * Calls the local server, never OpenAI directly: no API key reaches the browser
 * (§13.1). The server holds the key and owns the structured-output schemas.
 *
 * Nothing that arrives is trusted on the strength of the server having promised it.
 * Every response is read through `validate.ts` before it leaves this file, and a
 * failure is typed by whether asking again could help — which is what lets
 * `createResilientLlm` spend its retry budget on the failures a retry fixes.
 */

import { LlmRequestError, LlmShapeError, retryableStatus } from './errors.ts'
import { readDecomposedState, readLineReadings, readMessageReading, readQueryPlan, readReplacementChoice } from './validate.ts'
import type { LlmService } from './types.ts'

async function postJson<T>(input: {
  path: string
  body: unknown
  what: string
  read: (body: unknown) => T
}): Promise<T> {
  // A network failure — offline, DNS, connection reset — throws out of `fetch` as a
  // TypeError, which `isRetryable` already treats as worth another attempt.
  const res = await fetch(input.path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input.body),
  })

  if (!res.ok) {
    throw new LlmRequestError({
      what: input.what,
      status: res.status,
      detail: (await res.text()).slice(0, 300),
      retryable: retryableStatus(res.status),
    })
  }

  let parsed: unknown
  try {
    parsed = await res.json()
  } catch (cause) {
    // A 200 whose body is not JSON: a proxy's error page, or a truncated response.
    throw new LlmShapeError(input.what, `body is not JSON (${String(cause)})`)
  }

  return input.read(parsed)
}

export function createHttpLlm(baseUrl = '/api'): LlmService {
  return {
    decomposeTripState: (input) =>
      postJson({
        path: `${baseUrl}/decompose`,
        what: 'the trip setup',
        read: readDecomposedState,
        body: input,
      }),

    chooseReplacement: ({ message, outgoing, candidates }) =>
      postJson({
        path: `${baseUrl}/replacement`,
        what: 'a replacement',
        read: readReplacementChoice,
        body: {
          message,
          outgoing,
          // Only ids and the facts needed to choose. The server re-checks anyway.
          candidates: candidates.map((place) => ({
            placeId: place.placeId,
            name: place.name,
            category: place.category,
            neighborhood: place.neighborhood,
            shortDescription: place.shortDescription,
            priceLevel: place.priceLevel,
          })),
        },
      }),

    planQueries: (input) =>
      postJson({
        path: `${baseUrl}/query-plan`,
        what: 'the search wording',
        read: readQueryPlan,
        body: {
          destination: input.destination,
          baseLodgingName: input.baseLodgingName,
          intentText: input.intentText,
          consideringText: input.consideringText,
          // Only what the model needs to write words with; the depths stay here.
          searches: input.searches.map((search) => ({
            category: search.category,
            preferred: search.preferred,
          })),
          allowedCategories: [...input.allowedCategories],
        },
      }),

    interpretLines: (input) =>
      postJson({ path: `${baseUrl}/interpret-lines`, what: 'your notes', read: readLineReadings, body: input }),

    interpretMessage: (input) =>
      postJson({ path: `${baseUrl}/interpret-message`, what: 'your message', read: readMessageReading, body: input }),
  }
}
