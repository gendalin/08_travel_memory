/**
 * Secret loading for the Node side.
 *
 * Keys live in .env at the repo root, which is git-ignored. They are never
 * written into source, into data/demo_tokyo_v1/, or into any log line — the
 * accessors below return values but never print them.
 *
 * Node only. No key reaches the browser (see §13.1 of the implementation spec).
 *
 * Two accessors, because a missing key means two different things depending on who is
 * asking. A CLI script should stop with an actionable message; the dev server must NOT
 * — it serves the app, and exiting takes the whole product down with it, turning a
 * configuration problem into a dead page. `requireEnv` is for the first,
 * `envOrThrow` for the second.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { REPO_ROOT } from './types.ts'

export const ENV_PATH = resolve(REPO_ROOT, '.env')

let loaded = false

/** Loads .env once. Silent no-op when the file is absent. */
export function loadEnv(): void {
  if (loaded) return
  loaded = true
  if (existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH)
}

export function hasEnv(name: string): boolean {
  loadEnv()
  return Boolean(process.env[name])
}

/** A key the server needs and has not got. Carries no value, only the name. */
export class MissingEnvError extends Error {
  readonly name = 'MissingEnvError'
  readonly variable: string

  constructor(variable: string, purpose: string) {
    super(`Missing ${variable} — needed for ${purpose}.`)
    this.variable = variable
  }
}

/**
 * Returns the value, or throws.
 *
 * For anything running inside the dev server. `routes.ts` turns this into a response
 * the app can degrade from — it retries nothing, falls back to what it can do without
 * the service, and tells the traveller. `process.exit` would instead kill the server
 * mid-request, which is the one failure the product cannot report on.
 */
export function envOrThrow(name: string, purpose: string): string {
  loadEnv()
  const value = process.env[name]
  if (!value) throw new MissingEnvError(name, purpose)
  return value
}

/**
 * Returns the value, or exits with an actionable message rather than a stack trace.
 *
 * For CLI scripts ONLY. Never reachable from a request: see `envOrThrow`.
 */
export function requireEnv(name: string, purpose: string): string {
  loadEnv()
  const value = process.env[name]
  if (!value) {
    console.error(`Missing ${name} — needed for ${purpose}.`)
    console.error(`Add it to ${ENV_PATH} (git-ignored):`)
    console.error(`  ${name}=...`)
    console.error('See .env.example for the full list.')
    process.exit(1)
  }
  return value
}
