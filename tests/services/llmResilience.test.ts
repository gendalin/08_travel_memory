/**
 * What happens when the planning service does not answer (Gate 8, Phase C2).
 *
 * Three claims, and the product's failure mode rests on all three:
 *
 *   - nothing that arrives is trusted to be the shape it promised
 *   - asking again is bounded, and only for failures a retry could fix
 *   - when it still does not answer, the product finishes the job itself and SAYS so
 */

import { describe, expect, it, vi } from 'vitest'

import {
  LlmRequestError,
  LlmShapeError,
  isRetryable,
  retryableStatus,
} from '../../src/services/llm/errors.ts'
import { createFallbackLlm } from '../../src/services/llm/fallbackLlm.ts'
import {
  createResilientLlm,
  MAX_LLM_RETRIES,
  type Degradation,
} from '../../src/services/llm/resilientLlm.ts'
import {
  readDecomposedState,
  readQueryPlan,
  readReplacementChoice,
} from '../../src/services/llm/validate.ts'
import type { DemoPlace } from '../../src/services/places/types.ts'
import type { LlmService } from '../../src/services/llm/types.ts'

const place = (placeId: string, name = placeId): DemoPlace => ({
  placeId,
  name,
  lat: 35.7,
  lng: 139.79,
  category: 'ramen',
  neighborhood: 'Kuramae',
  typicalDurationMin: 45,
  tags: [],
  shortDescription: 'A counter.',
  source: 'places_api',
})

const SETUP = { intentText: 'Slow-paced. Local neighbourhoods.', consideringText: 'Moderate budget.', destination: 'Tokyo', days: 5 }
const SWAP = { message: 'closed today', outgoing: place('a'), candidates: [place('b', 'Best'), place('c')] }
const QUERIES = {
  destination: 'Tokyo',
  baseLodgingName: 'Kuramae',
  intentText: 'x',
  consideringText: 'y',
  searches: [{ category: 'ramen', preferred: false }],
  allowedCategories: ['ramen'],
}

/** An LlmService that fails a given number of times, then succeeds. */
function flaky(failures: number, error: unknown): LlmService & { calls: number } {
  const service = {
    calls: 0,
    async decomposeTripState() {
      service.calls++
      if (service.calls <= failures) throw error
      return { intent: ['from the model'], considering: [] }
    },
    async chooseReplacement() {
      service.calls++
      if (service.calls <= failures) throw error
      return { placeId: 'c', rationale: 'from the model' }
    },
    async planQueries() {
      service.calls++
      if (service.calls <= failures) throw error
      return { queries: [{ category: 'ramen', textQuery: 'from the model' }], alsoSearch: [] }
    },
  }
  return service
}

const resilient = (llm: LlmService, onDegraded?: (event: Degradation) => void) =>
  createResilientLlm({ llm, onDegraded, wait: async () => {} })

// --- reading what came back ---------------------------------------------------

describe('reading a response', () => {
  it('accepts what the contract promises', () => {
    expect(
      readDecomposedState({ intent: ['a'], considering: ['b'] }),
    ).toEqual({ intent: ['a'], considering: ['b'] })
  })

  it('refuses a body that is not an object at all', () => {
    // A proxy's HTML error page parsed as JSON, or a bare null.
    expect(() => readDecomposedState(null)).toThrow(LlmShapeError)
    expect(() => readReplacementChoice('nope')).toThrow(LlmShapeError)
  })

  it('refuses a missing list rather than defaulting it', () => {
    // Defaulting to [] would produce a trip with no Intent and no complaint.
    expect(() => readDecomposedState({ considering: [] })).toThrow(LlmShapeError)
    expect(() => readDecomposedState({ intent: [1, 2], considering: [] })).toThrow(LlmShapeError)
  })

  it('drops a malformed proposed Priority instead of failing the trip', () => {
    // §3.4 makes it a suggestion the user must accept; nothing depends on it.
    const read = readDecomposedState({ intent: [], considering: [], proposedPriority: { name: '' } })
    expect(read.proposedPriority).toBeUndefined()
  })

  it('refuses a replacement with no placeId, and tolerates no sentence', () => {
    expect(() => readReplacementChoice({ rationale: 'why' })).toThrow(LlmShapeError)
    expect(readReplacementChoice({ placeId: 'b' })).toEqual({ placeId: 'b', rationale: '' })
  })

  it('keeps the usable queries and drops the rest', () => {
    const read = readQueryPlan({
      queries: [
        { category: 'ramen', textQuery: 'ramen near Kuramae' },
        { category: 'sushi' },
        'nonsense',
      ],
      alsoSearch: ['izakaya'],
    })

    expect(read.queries).toEqual([{ category: 'ramen', textQuery: 'ramen near Kuramae' }])
    expect(read.alsoSearch).toEqual(['izakaya'])
  })
})

// --- what is worth asking again ----------------------------------------------

describe('which failures are worth retrying', () => {
  it('retries a server-side failure, a rate limit and a network error', () => {
    expect(isRetryable(new LlmRequestError({ what: 'x', status: 502, retryable: true }))).toBe(true)
    expect(isRetryable(new LlmRequestError({ what: 'x', status: 429, retryable: true }))).toBe(true)
    expect(isRetryable(new TypeError('Failed to fetch'))).toBe(true)
    expect(isRetryable(new LlmShapeError('x', 'truncated'))).toBe(true)
  })

  it('does not retry a request the service refused', () => {
    expect(isRetryable(new LlmRequestError({ what: 'x', status: 400, retryable: false }))).toBe(false)
  })

  it('does not retry a server that will never do it', () => {
    // 501 is what the API answers when it has no key for the job. The answer is the
    // same every time, and the stand-in should take over on the first attempt.
    expect(retryableStatus(501)).toBe(false)
    expect(retryableStatus(500)).toBe(true)
    expect(retryableStatus(503)).toBe(true)
  })
})

// --- the budget, and what is behind it ---------------------------------------

describe('the retry budget', () => {
  it('asks again and uses the answer when one arrives', async () => {
    const llm = flaky(1, new LlmShapeError('the trip setup', 'truncated'))
    const onDegraded = vi.fn()

    const result = await resilient(llm, onDegraded).decomposeTripState(SETUP)

    expect(llm.calls).toBe(2)
    expect(result.intent).toEqual(['from the model'])
    expect(onDegraded).not.toHaveBeenCalled()
  })

  it('stops at two retries — three attempts in all', async () => {
    const llm = flaky(99, new LlmShapeError('the trip setup', 'truncated'))
    await resilient(llm).decomposeTripState(SETUP)

    expect(llm.calls).toBe(MAX_LLM_RETRIES + 1)
  })

  it('spends no attempts on a refusal', async () => {
    // A 400 is the same 400 the second time. Falling straight through leaves the
    // traveller waiting once instead of three times for the same answer.
    const llm = flaky(99, new LlmRequestError({ what: 'the trip setup', status: 400, retryable: false }))
    await resilient(llm).decomposeTripState(SETUP)

    expect(llm.calls).toBe(1)
  })
})

describe('when it never answers', () => {
  const dead = () => flaky(99, new LlmRequestError({ what: 'x', status: 503, retryable: true }))

  it('splits the notes up itself, in the traveller own words', async () => {
    const events: Degradation[] = []
    const result = await resilient(dead(), (event) => events.push(event)).decomposeTripState(SETUP)

    expect(result.intent).toEqual(['Slow-paced', 'Local neighbourhoods'])
    expect(events).toHaveLength(1)
    expect(events[0].job).toBe('trip setup')
    expect(events[0].attempts).toBe(MAX_LLM_RETRIES + 1)
    expect(events[0].handledWithoutModel).toBe(true)
    // Nothing a provider said reaches the traveller.
    expect(events[0].message).not.toMatch(/503|http|fetch/i)
  })

  it('takes the best-ranked candidate for a replacement', async () => {
    // Ranking (§12.2) already put them in order; the model chose between the top
    // few and wrote the sentence, so what is lost is the sentence.
    const events: Degradation[] = []
    const choice = await resilient(dead(), (event) => events.push(event)).chooseReplacement(SWAP)

    expect(choice.placeId).toBe('b')
    expect(choice.rationale).toContain('Best')
    expect(events[0].job).toBe('a replacement')
  })

  it('writes no search wording at all, so the caller labels its own', async () => {
    // Code-written text returned here would arrive marked as the model's.
    const plan = await resilient(dead()).planQueries(QUERIES)
    expect(plan).toEqual({ queries: [], alsoSearch: [] })
  })

  it('reaches the stand-in even when the fallback is injected', async () => {
    const fallback = createFallbackLlm()
    const spy = vi.spyOn(fallback, 'decomposeTripState')

    await createResilientLlm({ llm: dead(), fallback, wait: async () => {} }).decomposeTripState(SETUP)

    expect(spy).toHaveBeenCalledOnce()
  })
})
