/**
 * Browser-side Places search (B3).
 *
 * Posts to the local server, which holds the key, caches every response on disk and
 * keeps the searches sequential so a burst cannot trip a rate limit (§13.1). Nothing
 * about Places reaches the browser except the results.
 *
 * Every call here is billable on a first run, which is why the shape of this module is
 * a plain pass-through: the decisions about HOW MANY searches to issue and how deep to
 * go are made in the retrieval profile, where they can be reasoned about, not spread
 * across a client.
 */

import type { PlacesSearcher } from '../../application/planning/retrievePlaces.ts'
import type { PlacesResult } from './retrieval.ts'

/** Thrown when the search service could not answer. Carries no provider detail. */
export class PlacesUnavailableError extends Error {
  constructor(detail: string) {
    super('The place search service could not answer.')
    this.name = 'PlacesUnavailableError'
    this.cause = detail
  }
}

interface SearchResponse {
  results: Array<{ textQuery: string; places: PlacesResult[] }>
  calls: number
  fromCache: number
}

export function createHttpPlacesSearcher(baseUrl = '/api'): PlacesSearcher {
  return {
    async search(requests) {
      const res = await fetch(`${baseUrl}/places`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searches: requests }),
      })

      if (!res.ok) {
        throw new PlacesUnavailableError(`${res.status} ${(await res.text()).slice(0, 200)}`)
      }

      let body: unknown
      try {
        body = await res.json()
      } catch (cause) {
        throw new PlacesUnavailableError(`body is not JSON (${String(cause)})`)
      }

      // Checked rather than trusted, for the same reason the LLM responses are: what
      // arrives is a body from a fetch, and a missing `results` would reach the
      // quality gate as "the city has nothing".
      const parsed = body as Partial<SearchResponse>
      if (!Array.isArray(parsed.results)) {
        throw new PlacesUnavailableError('no results array in the response')
      }

      return {
        results: parsed.results.map((entry) => ({
          textQuery: String(entry.textQuery ?? ''),
          places: Array.isArray(entry.places) ? entry.places : [],
        })),
        calls: typeof parsed.calls === 'number' ? parsed.calls : 0,
        fromCache: typeof parsed.fromCache === 'number' ? parsed.fromCache : 0,
      }
    },
  }
}
