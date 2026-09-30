/**
 * Turning active Memory into planning input (product_spec §10, §12.2).
 *
 * This is the load-bearing half of "Memory -> recommendation -> rationale": it
 * is what makes an active memory materially change a plan, rather than being a
 * label the UI shows after the fact.
 *
 * Each memory kind leaves by its own door, because they do not act in the same
 * place. `preference` and `aversion` become ranking weight; `pattern` becomes the
 * SHAPE of a day. The previous version had one door — category preferences — and
 * so dropped every memory without a category, which silently discarded the pace
 * memory in its entirety.
 *
 * Weight comes from `strength`, not `confidence`. They answer different questions,
 * and §10.2 permits confidence for candidate ordering and inference quality only
 * — planning weight is a third use it does not list.
 *
 * Only the trip's immutable snapshot is read. A memory the user activates after
 * the trip was created cannot reach back and alter that trip (§10.5).
 */

import type { ID } from '../trip/types.ts'
import type { Memory, MemorySnapshot } from './types.ts'
import type { Popularity } from '../places/facets.ts'
import type { AreaCharacter } from '../places/areas.ts'

export interface CategoryPreference {
  category: string
  /** The memory this came from, for rationaleRefs and inspection. */
  memoryId: ID
  /**
   * Signed strength, -1 to 1. Positive draws the plan toward the category,
   * negative away from it, so an aversion needs no separate mechanism — it is
   * the same weight with the other sign.
   *
   * Ordering strength only. Never displayed (§10.2).
   */
  weight: number
}

/**
 * What a `pattern` memory says a day should look like.
 *
 * Each entry carries the memory behind it so a plan built from it can cite the
 * memory the same way a recommendation does.
 */
export interface PatternValue {
  value: number
  memoryId: ID
  /** How consistently the pattern held in the evidence, 0-1. */
  strength: number
}

export interface PlanShape {
  /** Distinct stops on a typical day. */
  stopsPerDay?: PatternValue
  /** Typical distance between a day's furthest two points, in metres. */
  daySpanMetres?: PatternValue
  /** Typical start of the day, minutes since midnight. */
  startMinutes?: PatternValue
}

/**
 * Category preferences and aversions carried by a trip's snapshot, strongest
 * first.
 *
 * Every memory in a snapshot is active by construction — `createMemorySnapshot`
 * filters to active — so there is no status check here.
 */
export function categoryPreferences(snapshot: MemorySnapshot | undefined): CategoryPreference[] {
  if (!snapshot) return []

  return snapshot.memories
    .map((memory) => {
      if (memory.kind !== 'preference' && memory.kind !== 'aversion') return undefined
      if (memory.subject.facet !== 'category') return undefined
      return {
        category: memory.subject.value,
        memoryId: memory.id,
        weight: memory.polarity * memory.strength,
      }
    })
    .filter((preference): preference is CategoryPreference => preference !== undefined)
    // By absolute weight: a strong aversion is as decisive as a strong liking.
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
}

/**
 * The day shape carried by a trip's snapshot.
 *
 * Where two pattern memories describe the same thing, the more consistent one
 * wins — strength is how reliably the pattern held, so it is the right
 * tie-breaker for a measurement.
 */
export function planShape(snapshot: MemorySnapshot | undefined): PlanShape {
  const shape: PlanShape = {}
  if (!snapshot) return shape

  const consider = (key: keyof PlanShape, candidate: PatternValue) => {
    const existing = shape[key]
    if (!existing || candidate.strength > existing.strength) shape[key] = candidate
  }

  for (const memory of snapshot.memories) {
    if (memory.kind !== 'pattern') continue

    const candidate: PatternValue = {
      value: Number(memory.subject.value),
      memoryId: memory.id,
      strength: memory.strength,
    }

    switch (memory.subject.facet) {
      case 'stops_per_day':
        consider('stopsPerDay', candidate)
        break
      case 'day_span_metres':
        consider('daySpanMetres', candidate)
        break
      case 'start_minutes':
        consider('startMinutes', candidate)
        break
      default:
        // A pattern memory about a facet the plan shape does not use yet.
        break
    }
  }

  return shape
}

/**
 * Slots one memory may claim outright over a trip of `days`.
 *
 * Derived from the memory's own observed rate where it has one, so the bound is
 * a measurement rather than a constant: "you came back to sushi about twice in
 * five days" instead of a number someone picked. Without a rate it falls back to
 * a shared heuristic, which is honestly a guess and is labelled as one.
 *
 * At least one, always: a confirmed memory that never gets a slot is a memory
 * confirming nothing.
 */
export function claimsAllowed(memory: Memory, days: number): number {
  const rate = memory.scope?.ratePerDay
  if (rate !== undefined) return Math.max(1, Math.round(rate * days))
  return Math.max(1, Math.round(days / DEFAULT_CLAIM_DAYS))
}

/**
 * Fallback claim spacing: roughly one slot per this many trip days.
 *
 * A guess, and the reason `scope.ratePerDay` exists to replace it. Kept until
 * every memory carries a rate derived from its own evidence.
 */
export const DEFAULT_CLAIM_DAYS = 3

/**
 * A preference about what a place is LIKE rather than what kind it is — how well
 * known, what kind of neighbourhood (added 2026-09-30). Same signed weight as a
 * category preference; it enters ranking through the same memoryMatch.
 */
export type TraitPreference =
  | { trait: 'popularity'; value: Popularity; memoryId: ID; weight: number }
  | { trait: 'area_character'; value: AreaCharacter; memoryId: ID; weight: number }

export function traitPreferences(snapshot: MemorySnapshot | undefined): TraitPreference[] {
  if (!snapshot) return []
  return snapshot.memories.flatMap((memory): TraitPreference[] => {
    if (memory.kind !== 'preference' && memory.kind !== 'aversion') return []
    const weight = memory.polarity * memory.strength
    if (memory.subject.facet === 'popularity') {
      return [{ trait: 'popularity', value: memory.subject.value, memoryId: memory.id, weight }]
    }
    if (memory.subject.facet === 'area_character') {
      return [{ trait: 'area_character', value: memory.subject.value, memoryId: memory.id, weight }]
    }
    return []
  })
}

/** Looks up a memory inside a snapshot, for rendering rationale provenance. */
export function findInSnapshot(
  snapshot: MemorySnapshot | undefined,
  memoryId: ID,
): Memory | undefined {
  return snapshot?.memories.find((memory) => memory.id === memoryId)
}
