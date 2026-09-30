/** In-memory PlaceCatalogue over the demo bundle. */

import type { CatalogueSnapshot } from '../../domain/places/catalogueSnapshot.ts'
import { isOpenFor } from '../../domain/places/openingHours.ts'
import { MAX_CANDIDATES, type CandidateFilter, type DemoPlace, type PlaceCatalogue } from './types.ts'

export function createPlaceCatalogue(places: DemoPlace[]): PlaceCatalogue {
  const byId = new Map(places.map((place) => [place.placeId, place]))

  return {
    all: () => [...places],
    get: (placeId) => byId.get(placeId),
    has: (placeId) => byId.has(placeId),

    candidates(filter: CandidateFilter) {
      const exclude = new Set(filter.excludePlaceIds ?? [])
      const matches = places.filter((place) => {
        if (exclude.has(place.placeId)) return false
        if (filter.category && place.category !== filter.category) return false
        if (filter.neighborhood && place.neighborhood !== filter.neighborhood) return false
        // A place that is shut for the slot is not a candidate for it. Filtering
        // here rather than only validating later is the difference between never
        // offering a closed door and offering one and then rejecting the plan
        // that took it (§12.1 lists opening hours as a retrieval filter).
        if (
          filter.openAt &&
          !isOpenFor(place.openingHours, filter.openAt.weekday, filter.openAt.startTime, filter.openAt.endTime)
        ) {
          return false
        }
        // Lodging is a trip anchor, never a candidate activity.
        return place.category !== 'accommodation'
      })
      return matches.slice(0, Math.min(filter.limit ?? MAX_CANDIDATES, MAX_CANDIDATES))
    },
  }
}

/** Validator view of the catalogue: id, hours, and where it is (for a day's place). */
export function toValidationPlaces(
  catalogue: PlaceCatalogue,
): Map<string, { placeId: string; openingHours?: Record<string, string>; lat?: number; lng?: number }> {
  return new Map(
    catalogue.all().map((place) => [
      place.placeId,
      { placeId: place.placeId, openingHours: place.openingHours, lat: place.lat, lng: place.lng },
    ]),
  )
}

/** Impact view (coordinates + price level). */
export function toPlaceFacts(
  catalogue: PlaceCatalogue,
): Map<string, { lat?: number; lng?: number; priceLevel?: 0 | 1 | 2 | 3 | 4 }> {
  return new Map(
    catalogue.all().map((place) => [
      place.placeId,
      { lat: place.lat, lng: place.lng, priceLevel: place.priceLevel },
    ]),
  )
}

/**
 * A catalogue over a trip's frozen snapshot (B4).
 *
 * The same `PlaceCatalogue` every use case already takes, so freezing the places
 * changes where they come from and nothing else — generation, Replace, Alternatives and
 * Expected Impact all carry on reading one interface. That the seam was already an
 * interface is what makes this a substitution rather than a rewrite.
 */
export function catalogueFromSnapshot(
  snapshot: CatalogueSnapshot<DemoPlace>,
): PlaceCatalogue {
  return createPlaceCatalogue([...snapshot.places])
}

/**
 * The places a trip can reach: its own frozen set, or the pre-loaded one.
 *
 * The one place the narrow domain view is widened back out. `Trip.catalogueSnapshot`
 * is typed `{ placeId: string }` because the domain has no business knowing what a
 * place looks like — but the objects in it are whole places, put there by retrieval,
 * and nothing in the domain ever rebuilds or strips them: the snapshot functions
 * spread arrays and filter by id. So reading them back as places is sound, and doing
 * it here means one documented cast rather than one per call site.
 *
 * A trip with no snapshot was planned against the bundle, and the bundle is its
 * catalogue — which is what keeps the demo, the fixtures and the E2E suite working
 * unchanged.
 */
export function catalogueForTrip(
  trip: { catalogueSnapshot?: CatalogueSnapshot<{ placeId: string }> } | null,
  preloaded: PlaceCatalogue,
): PlaceCatalogue {
  const snapshot = trip?.catalogueSnapshot
  if (!snapshot) return preloaded
  return catalogueFromSnapshot(snapshot as CatalogueSnapshot<DemoPlace>)
}
