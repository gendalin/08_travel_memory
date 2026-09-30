/**
 * Trip frame and identity.
 *
 * Trip metadata is NOT State (product_spec §4.1). The frame is what the trip
 * *is*; State is what the agent is planning *against*.
 */

import type { MemorySnapshot } from '../memory/types.ts'
import type { CatalogueSnapshot } from '../places/catalogueSnapshot.ts'

export type ID = string

/** Stable place identity, shared across map, routing, itinerary and evidence. */
export interface PlaceRef {
  placeId: string
  name: string
}

export interface TripFrame {
  name: string
  destination: string
  /** YYYY-MM-DD */
  startDate: string
  /** YYYY-MM-DD */
  endDate: string
  /** MVP: exactly one base lodging per trip. Every day starts and ends here. */
  baseLodging: PlaceRef
}

export interface Trip {
  id: ID
  frame: TripFrame
  /** Immutable for the life of the trip (§10.5). */
  memorySnapshot: MemorySnapshot
  /**
   * The places this trip can reach, frozen at creation (B4).
   *
   * Versioned rather than immutable: a trip can run out of somewhere to swap to, and
   * the answer is a deliberate supplement at a new version, never a silent live
   * lookup.
   *
   * Absent for a trip planned against a pre-loaded catalogue: the bundled demo set, a
   * test fixture, or a live run that had to fall back to one because the lodging could
   * not be resolved, the search could not be reached, or what came back could not
   * furnish a day.
   */
  catalogueSnapshot?: CatalogueSnapshot<{ placeId: string }>
  createdAt: string
}

export type TimePhase = 'pre_trip' | 'in_trip' | 'post_trip'
