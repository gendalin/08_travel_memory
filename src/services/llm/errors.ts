/**
 * Why a call to the planning service failed, in the only two terms that change
 * what the product does about it (Gate 8).
 *
 * The distinction is retryability, and it is not cosmetic. A 502 from a provider is
 * worth asking again; a 400 means the request itself is wrong and asking again spends
 * the traveller's time to get the same answer. Before this, every failure was one
 * `Error` whose message went straight to the screen — including the URL, the status
 * and whatever body the provider returned.
 */

/** A call that did not come back, or came back as a failure. */
export class LlmRequestError extends Error {
  readonly status?: number
  readonly retryable: boolean

  constructor(input: { what: string; status?: number; detail?: string; retryable: boolean }) {
    super(
      `The planning service could not answer for ${input.what}` +
        (input.status === undefined ? '' : ` (${input.status})`),
    )
    this.name = 'LlmRequestError'
    this.status = input.status
    this.retryable = input.retryable
    // Kept off the message: a provider's body can carry request detail, and the
    // message is what reaches the screen.
    this.cause = input.detail
  }
}

/** Thrown when a response cannot be read as what the contract promises. */
export class LlmShapeError extends Error {
  constructor(what: string, detail: string) {
    super(`The planning service returned something unusable for ${what}`)
    this.name = 'LlmShapeError'
    this.cause = detail
  }
}

/**
 * Whether asking again could plausibly help.
 *
 * A shape failure counts: a provider mid-outage returning an error page, or one
 * truncated response, is the kind of thing a second attempt gets right. A refused
 * request is not.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof LlmRequestError) return error.retryable
  if (error instanceof LlmShapeError) return true
  // A network error — offline, DNS, connection reset — arrives as a plain TypeError
  // from fetch. Worth one more try.
  return error instanceof TypeError
}

/**
 * HTTP statuses worth a second attempt: server-side and rate limiting.
 *
 * 501 is the exception among the 5xx. It means the server will never do this — for
 * this product, a key it has not been given — so the answer is the same every time and
 * the retry budget is better spent not being spent. The deterministic stand-in takes
 * over on the first attempt instead of the third.
 */
export function retryableStatus(status: number): boolean {
  if (status === 501) return false
  return status >= 500 || status === 408 || status === 429
}
