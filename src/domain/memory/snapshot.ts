/**
 * Memory lifecycle and the immutable trip snapshot (product_spec §10.3, §10.5).
 */

import type { ID } from '../trip/types.ts'
import type { Memory, MemorySnapshot } from './types.ts'

/**
 * Snapshots the currently active memories for a trip.
 *
 * Deep-frozen: the whole point of the snapshot is that a later Profile change
 * cannot alter what this trip was planned against, which is what keeps
 * recommendation rationale and Decision Receipts reproducible.
 */
export function createMemorySnapshot(
  tripId: ID,
  memories: readonly Memory[],
  createdAt: string,
): MemorySnapshot {
  const active = memories
    .filter((memory) => memory.status === 'active')
    .map((memory) =>
      Object.freeze({
        ...memory,
        provenance: Object.freeze({
          ...memory.provenance,
          sourceRefs: Object.freeze([...memory.provenance.sourceRefs]) as unknown as ID[],
        }),
      }),
    )

  return Object.freeze({
    tripId,
    createdAt,
    memories: Object.freeze(active),
  })
}

/**
 * Confidence at or above which a memory inferred from photos or saved places is
 * active from the moment it enters the Profile (§10.3). Below it, the memory
 * waits for the user.
 */
export const AUTO_ACTIVATE_CONFIDENCE = 0.65

/** Evidence items a memory needs before it may activate without the user. */
export const AUTO_ACTIVATE_MIN_SOURCES = 3

/**
 * Whether a freshly inferred memory is strong enough to be used without review.
 *
 * Narrow on purpose. Only what photos and saved places show directly qualifies,
 * and only memories that draw a plan toward something or shape its day: an
 * aversion removes places, and a constraint or context is not something this
 * evidence can license (§10), so those always wait for the user.
 */
export function qualifiesForAutoActivation(memory: Memory): boolean {
  return (
    (memory.kind === 'preference' || memory.kind === 'pattern') &&
    (memory.provenance.type === 'saved_places' || memory.provenance.type === 'historical_behavior') &&
    memory.provenance.sourceRefs.length >= AUTO_ACTIVATE_MIN_SOURCES &&
    memory.confidence >= AUTO_ACTIVATE_CONFIDENCE
  )
}

/** Explicit activation: the user confirmed a candidate. */
export function activateMemory(memory: Memory): Memory {
  return { ...memory, status: 'active' }
}

export function deactivateMemory(memory: Memory): Memory {
  return { ...memory, status: 'candidate' }
}

/**
 * Maps a preprocessing provenance type onto the domain's four types.
 *
 * The preprocessing bundle emits richer strings ("category_trend:sushi",
 * "photo_gps", "photo_timestamps") than the product model accepts, so the
 * boundary has to normalise rather than trust the bundle.
 */
export function normalizeProvenanceType(raw: string): Memory['provenance']['type'] {
  if (raw.startsWith('category_trend:')) return 'saved_places'
  if (raw.startsWith('photo_')) return 'historical_behavior'
  if (raw === 'saved_places') return 'saved_places'
  if (raw === 'explicit_statement') return 'explicit_statement'
  if (raw === 'historical_behavior') return 'historical_behavior'
  return 'agent_inference'
}
