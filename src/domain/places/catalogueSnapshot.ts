/**
 * The places a trip was planned against, frozen (B4).
 *
 * Symmetric with the Memory snapshot, and for the same reason. §10.5 freezes active
 * Memory at trip creation so a later Profile change cannot rewrite a trip that has
 * already been planned and explained; the catalogue needs the same guarantee for the
 * same guarantee's sake. Once a trip exists, the places it can reach are fixed — so
 * generation, Replace, Reorganize, Alternatives and Decision Receipts all read one
 * unchanging set, and none of them makes a network call.
 *
 * Three things follow from freezing it, and they are the point:
 *
 *   - **the same operation twice gives the same answer.** A Replace that offered
 *     three alternatives yesterday offers the same three today.
 *   - **no cost and no latency after creation.** Retrieval is paid for once.
 *   - **a Receipt stays true.** "Why this place and not another" can be answered six
 *     months later, because the set it was chosen from is still there.
 *
 * Unlike the Memory snapshot, this one is VERSIONED. A trip can run out of options —
 * a fifth izakaya to swap to may simply not be in the set — and the answer to that is
 * a deliberate supplement, not a silent live lookup. Each supplement produces a new
 * version, and a Receipt records which version it was made against, or "why this one"
 * becomes unanswerable the moment the set grows.
 */

import type { ID } from '../trip/types.ts'

/** The subset of a place this module needs. Kept narrow, like every domain view. */
export interface SnapshotPlace {
  placeId: string
}

/** How a snapshot was obtained, so a plan built on it can be explained. */
export interface CatalogueProvenance {
  /** The searches that produced it, verbatim. */
  queries: readonly string[]
  /** Results that failed the quality gate, counted by reason. */
  rejected: Readonly<Record<string, number>>
  /** The base lodging the searches were biased around. */
  lodging: { lat: number; lng: number; matchedAddress: string }
  /** Metres from the lodging the searches were bounded to, when a memory measured it. */
  radiusMetres?: number
}

export interface CatalogueSnapshot<TPlace extends SnapshotPlace = SnapshotPlace> {
  tripId: ID
  /** 1 is what the trip was created with; each supplement adds one. */
  version: number
  createdAt: string
  places: readonly TPlace[]
  /** One entry per version, oldest first, so the whole history stays readable. */
  provenance: readonly CatalogueProvenance[]
}

/**
 * Freezes a set of places onto a trip.
 *
 * Deep-frozen, like the Memory snapshot: the guarantee is worth nothing if a later
 * caller can push a place into the array. Duplicates are dropped rather than trusted —
 * the same place legitimately answers several searches, and a set holding it twice
 * would offer it twice as an alternative.
 */
export function createCatalogueSnapshot<TPlace extends SnapshotPlace>(input: {
  tripId: ID
  places: readonly TPlace[]
  provenance: CatalogueProvenance
  createdAt: string
}): CatalogueSnapshot<TPlace> {
  return Object.freeze({
    tripId: input.tripId,
    version: 1,
    createdAt: input.createdAt,
    places: Object.freeze(dedupe(input.places)),
    provenance: Object.freeze([Object.freeze(input.provenance)]),
  })
}

/**
 * Adds places to a snapshot, as a new version.
 *
 * An explicit act, never a fallback. A trip that has run out of somewhere to swap to
 * should say so and let the traveller decide to look further — quietly widening the
 * set behind a Replace would mean two identical requests getting different answers,
 * which is the property this whole module exists to provide.
 *
 * Places already present are ignored, so a supplement that finds nothing new is a
 * no-op at a new version rather than a duplicate-ridden set.
 */
export function supplementCatalogueSnapshot<TPlace extends SnapshotPlace>(
  snapshot: CatalogueSnapshot<TPlace>,
  input: { places: readonly TPlace[]; provenance: CatalogueProvenance; at: string },
): CatalogueSnapshot<TPlace> {
  const known = new Set(snapshot.places.map((place) => place.placeId))
  const added = dedupe(input.places).filter((place) => !known.has(place.placeId))

  return Object.freeze({
    tripId: snapshot.tripId,
    version: snapshot.version + 1,
    createdAt: input.at,
    places: Object.freeze([...snapshot.places, ...added]),
    provenance: Object.freeze([...snapshot.provenance, Object.freeze(input.provenance)]),
  })
}

/** Places added by a given version, for explaining where a late option came from. */
export function placesAddedIn<TPlace extends SnapshotPlace>(
  before: CatalogueSnapshot<TPlace>,
  after: CatalogueSnapshot<TPlace>,
): TPlace[] {
  const known = new Set(before.places.map((place) => place.placeId))
  return after.places.filter((place) => !known.has(place.placeId))
}

function dedupe<TPlace extends SnapshotPlace>(places: readonly TPlace[]): TPlace[] {
  const seen = new Set<string>()
  return places.filter((place) => {
    if (seen.has(place.placeId)) return false
    seen.add(place.placeId)
    return true
  })
}
