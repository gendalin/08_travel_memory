/**
 * Retry, then fall back, and say which (Gate 8, Phase C2).
 *
 * §8's retry budget is the shape of this: ask again at most twice, and then stop
 * asking. Two is the number because the failures a retry fixes — a provider blip, a
 * truncated body, one rate-limited request — are fixed by the second or third
 * attempt or not at all, and a traveller waiting on a plan should not be spending
 * that wait on a fourth identical request.
 *
 * What happens after the budget runs out is the part that matters. The product does
 * not stop: every one of the model's jobs has a deterministic stand-in
 * (`fallbackLlm`), so a trip can still be created, a closed restaurant can still be
 * swapped, and a plan can still be generated with no model reachable at all.
 *
 * And it is never silent. `onDegraded` fires with what degraded and how many attempts
 * it took, because a traveller told nothing would have no way to know that the
 * sentence explaining their new restaurant was written by a rule rather than read
 * off their request — and no reason to look twice at a decomposition that lost the
 * meaning of what they typed.
 */

import { createFallbackLlm } from './fallbackLlm.ts'
import { isRetryable } from './errors.ts'
import type { LlmService } from './types.ts'

/** §8: "maximum 2 LLM retries". Three attempts in total, then the stand-in. */
export const MAX_LLM_RETRIES = 2

/** Which of the model's jobs this was, in words the UI can use. */
export type LlmJob = 'trip setup' | 'a replacement' | 'search wording' | 'reading your notes' | 'reading your message'

export interface Degradation {
  job: LlmJob
  /** Attempts made before giving up, including the first. */
  attempts: number
  /** One line for the traveller. Never carries provider detail. */
  message: string
  /** True when the deterministic stand-in produced the answer instead. */
  handledWithoutModel: boolean
}

const SAID: Record<LlmJob, string> = {
  'trip setup':
    'I could not reach the planning service, so I split your notes up myself — check them over.',
  'a replacement':
    'I could not reach the planning service, so I picked the closest fit myself.',
  'search wording':
    'I could not reach the planning service, so I searched in plain terms rather than yours.',
  'reading your notes':
    'I could not reach the planning service, so I read your notes with simple rules — check how each line was read.',
  'reading your message':
    'I could not reach the planning service, so I read your message with simple rules.',
}

/** Backoff between attempts. Short: someone is watching a spinner. */
const BACKOFF_MS = [250, 500]

export interface ResilientOptions {
  llm: LlmService
  /** Overridable so a test can assert the stand-in was reached. */
  fallback?: LlmService
  onDegraded?: (degradation: Degradation) => void
  retries?: number
  /** Injected by tests so they do not actually wait. */
  wait?: (ms: number) => Promise<void>
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function createResilientLlm(options: ResilientOptions): LlmService {
  const fallback = options.fallback ?? createFallbackLlm()
  const retries = options.retries ?? MAX_LLM_RETRIES
  const wait = options.wait ?? sleep

  async function attempt<T>(job: LlmJob, call: () => Promise<T>, stand: () => Promise<T>): Promise<T> {
    let made = 0

    for (let index = 0; index <= retries; index++) {
      made = index + 1
      try {
        return await call()
      } catch (error) {
        // A request the service refused will be refused again. Stop here and let the
        // stand-in answer rather than spending two more attempts proving it.
        const worthRetrying = isRetryable(error) && index < retries
        if (!worthRetrying) break
        await wait(BACKOFF_MS[Math.min(index, BACKOFF_MS.length - 1)])
      }
    }

    const answer = await stand()
    options.onDegraded?.({
      job,
      attempts: made,
      message: SAID[job],
      handledWithoutModel: true,
    })
    return answer
  }

  return {
    decomposeTripState: (input) =>
      attempt('trip setup', () => options.llm.decomposeTripState(input), () =>
        fallback.decomposeTripState(input),
      ),

    chooseReplacement: (input) =>
      attempt('a replacement', () => options.llm.chooseReplacement(input), () =>
        fallback.chooseReplacement(input),
      ),

    interpretLines: (input) =>
      attempt('reading your notes', () => options.llm.interpretLines(input), () => fallback.interpretLines(input)),

    interpretMessage: (input) =>
      attempt('reading your message', () => options.llm.interpretMessage(input), () => fallback.interpretMessage(input)),

    planQueries: (input) =>
      attempt('search wording', () => options.llm.planQueries(input), () =>
        fallback.planQueries(input),
      ),
  }
}
