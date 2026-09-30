/**
 * A key the server has not got must not take the server down (Gate 8).
 *
 * The behaviour this replaces: `requireEnv` called `process.exit(1)`, which is right
 * for a CLI script and fatal inside the dev server — the first Generate without a key
 * killed the process serving the app, turning a configuration problem into a dead page
 * that no error state could report.
 */

import { describe, expect, it } from 'vitest'

import { MissingEnvError, envOrThrow } from '../../scripts/preprocess/env.ts'

describe('reading a key the server needs', () => {
  const NAME = 'A_KEY_NOTHING_WILL_EVER_SET'

  it('throws rather than exiting', () => {
    expect(() => envOrThrow(NAME, 'a test')).toThrow(MissingEnvError)
  })

  it('names the variable, so the log says what to add', () => {
    try {
      envOrThrow(NAME, 'a test')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(MissingEnvError)
      expect((error as MissingEnvError).variable).toBe(NAME)
      expect((error as MissingEnvError).message).toContain('a test')
    }
  })

  it('returns the value when there is one, and never logs it', () => {
    process.env[NAME] = 'a-secret-value'
    try {
      expect(envOrThrow(NAME, 'a test')).toBe('a-secret-value')
    } finally {
      delete process.env[NAME]
    }
  })
})
