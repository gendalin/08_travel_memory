/**
 * Personal Memory (product_spec §10).
 *
 * Rules that this module exists to enforce:
 *   - status is only `candidate` or `active`; delete is a hard delete
 *   - confidence is independent from status, and is never shown to users
 *   - an inferred memory auto-activates only on first seed, and only when its
 *     photo / saved-place evidence clears `qualifiesForAutoActivation`; after
 *     that, only the user changes its status
 *   - a trip's memory snapshot is immutable for the life of that trip
 *
 * §10.4 defers "detailed evidence weighting" to a future `memory_system.md`.
 * `kind`, `subject`, `polarity`, `strength` and `scope` are that slot filled in,
 * and each one exists because the untyped model measurably could not carry
 * something the planner needed:
 *
 *   - **kind**, because a memory about PACE and a memory about SUSHI do not enter
 *     planning at the same place. Without it, `categoryPreferences` dropped every
 *     memory that had no category — which silently discarded the pace memory
 *     entirely, and there was a passing test asserting it did.
 *   - **subject**, because a bare category string can only ever say "schedule one
 *     of these". It cannot say which part of the day, which price band, or how
 *     long a stop — the facets places are now indexed by.
 *   - **polarity**, because the model could express attraction and nothing else.
 *     "Would rather not queue" is exactly the stable cross-trip fact §6.2 calls
 *     Memory, and it had nowhere to live.
 *   - **strength** separately from **confidence**, because they answer different
 *     questions: how much does the traveller care, versus how sure are we this is
 *     true. Ranking weight was taken from `confidence`, which §10.2 permits only
 *     for candidate ordering and inference quality — planning weight is a third
 *     use it does not list.
 *   - **scope**, because an unbounded claim let one confirmed memory take every
 *     eligible slot of every day: five premium sushi counters into a trip whose
 *     Considering said "moderate budget".
 */

import type { Popularity, PriceBand, StayLength, TimeBand } from '../places/facets.ts'
import type { AreaCharacter } from '../places/areas.ts'
import type { ID } from '../trip/types.ts'

export type MemoryStatus = 'candidate' | 'active'

export type MemoryProvenanceType =
  | 'explicit_statement'
  | 'historical_behavior'
  | 'saved_places'
  | 'agent_inference'

/**
 * Where a memory enters planning. Each kind has one place, and they are not
 * interchangeable.
 *
 *   - `preference` / `aversion` — ranking weight, drawing toward or away
 *   - `constraint` — validation; a plan that breaks one is invalid
 *   - `pattern` — the SHAPE of a day: how many stops, how far apart, how early
 *   - `context` — who is travelling, which biases retrieval rather than a stop
 *
 * `constraint` and `context` have no producer in the preprocessing pipeline yet:
 * nothing in photos, screenshots or saved places licenses inferring a dietary
 * rule or who someone travels with, and §10 forbids inferring sensitive traits.
 * They are named here because the precedence lattice needs the vocabulary, and
 * because the honest route to them is the user saying so in chat (§6.2).
 */
export type MemoryKind = 'preference' | 'aversion' | 'constraint' | 'pattern' | 'context'

/**
 * What the memory is about.
 *
 * Facet-valued subjects point into the same vocabulary places are indexed by, so
 * a memory and a place can be compared without a free-text guess. Measured
 * subjects carry a number instead, because a pace of three stops is a
 * measurement and calling it "short" would throw the measurement away.
 */
export type MemorySubject =
  /** A taxonomy category: "sushi", "izakaya". */
  | { facet: 'category'; value: string }
  | { facet: 'price_band'; value: PriceBand }
  | { facet: 'time_fit'; value: TimeBand }
  | { facet: 'stay_length'; value: StayLength }
  /** Typical distinct stops on a day. */
  | { facet: 'stops_per_day'; value: number }
  /** Typical distance between a day's furthest two points, in metres. */
  | { facet: 'day_span_metres'; value: number }
  /** Typical time the day starts, minutes since midnight. */
  | { facet: 'start_minutes'; value: number }
  /**
   * How well known a place is ("quiet, less crowded" is an aversion to `landmark`).
   * Added 2026-09-30: the eval found this, the commonest thing travellers say about
   * themselves, could not be stored at all.
   */
  | { facet: 'popularity'; value: Popularity }
  /** What kind of neighbourhood: "literary neighbourhoods" → `literary` (areas.ts). */
  | { facet: 'area_character'; value: AreaCharacter }

/** How much of a trip a memory may claim outright. */
export interface MemoryScope {
  /**
   * How often the behaviour appeared per travel day in the evidence.
   *
   * A trip of N days gives the memory `round(ratePerDay * N)` claims, at least
   * one. Derived from behaviour rather than chosen, which is the difference
   * between "you came back to sushi about twice a five-day trip" and a constant
   * someone picked.
   */
  ratePerDay?: number
}

export interface MemoryProvenance {
  type: MemoryProvenanceType
  /** Evidence ids. Must be non-empty for an inferred memory. */
  sourceRefs: ID[]
  createdAt: string
}

export interface Memory {
  id: ID
  text: string
  status: MemoryStatus
  kind: MemoryKind
  subject: MemorySubject
  /** `1` draws the plan toward the subject, `-1` away from it. */
  polarity: 1 | -1
  /**
   * 0-1: how much the traveller cares. This is the ranking weight.
   *
   * Separate from `confidence` on purpose. A behaviour we are almost certain
   * about may matter little, and one we are half sure of may matter a lot.
   */
  strength: number
  /** 0-1. Candidate ordering and inference quality only. Never displayed (§10.2). */
  confidence: number
  provenance: MemoryProvenance
  scope?: MemoryScope
  /**
   * Places behind this memory that the traveller saved on Maps, by name.
   *
   * What lets a recommendation say "you saved Sawada and Hakkoku" rather than "you
   * like sushi". Saved places only: a screenshot's "place name" is read off the
   * image and is as often an account handle as a restaurant. Frozen with the rest of
   * the memory into the trip snapshot, so the rationale stays reproducible.
   */
  examples?: string[]
  /** How many of each kind of evidence stand behind it — photo, screenshot, saved_place. */
  sourceCounts?: Partial<Record<'photo' | 'screenshot' | 'saved_place', number>>
}

/**
 * User-facing provenance label. Numeric confidence is never displayed (§10.2),
 * so this is what the UI shows instead.
 */
export function provenanceLabel(type: MemoryProvenanceType): string {
  switch (type) {
    case 'explicit_statement':
      return 'You told me this'
    case 'historical_behavior':
      return 'From past travel behavior'
    case 'saved_places':
      return 'From your saved places'
    case 'agent_inference':
      return 'Inferred from your trips'
  }
}

/** Immutable set of active memories attached to a trip at creation (§10.5). */
export interface MemorySnapshot {
  tripId: ID
  createdAt: string
  memories: readonly Memory[]
}
