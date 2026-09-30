/**
 * Looking further, when a trip has run out of options (B8).
 *
 * A trip is planned against a frozen set of places (B4), and freezing it is what
 * makes the same question give the same answer twice. The cost is that a trip can
 * genuinely run out: the fifth izakaya to swap to may simply not be in the set.
 *
 * The answer to that is this — never a silent live lookup behind a Replace. Two
 * identical requests returning different answers would give away the one property
 * the snapshot exists to provide, and the traveller would have no way to know the
 * ground had moved. So widening is an ACT: the product says it has run out, the
 * traveller decides to look further, and the set grows by one version with the
 * searches that grew it recorded on it.
 *
 * That provenance entry IS the event record. It carries the queries, what the
 * quality gate rejected and the radius they were bounded to, it is ordered oldest
 * first, and every Receipt written afterwards names the version it was decided
 * against — so "where did this late option come from" stays answerable without a
 * second log to keep in step.
 *
 * Deterministic wording. The model writes search text when a trip is created, from a
 * brief; here there is no new brief, only a category the traveller ran out of, and
 * §0.3 puts code ahead of model judgment wherever code will do.
 */

import {
  placesAddedIn,
  supplementCatalogueSnapshot,
  type CatalogueSnapshot,
} from '../../domain/places/catalogueSnapshot.ts'
import type { ResolvedLodging } from '../../services/places/lodging.ts'
import type { DemoPlace } from '../../services/places/types.ts'
import { defaultTextQuery, type ResolvedQuery } from '../planning/queryPlan.ts'
import { retrievePlaces, type PlacesSearcher, type RetrievalReport } from '../planning/retrievePlaces.ts'

/**
 * Places to fetch per category.
 *
 * Smaller than trip creation asks for. This is a top-up for one part of one day, not
 * a second trip's worth of retrieval, and every call is billed.
 */
export const WIDEN_RETRIEVE = 8

export interface WidenOutcome {
  /** The new version. The old one is untouched, as a frozen snapshot must be. */
  snapshot: CatalogueSnapshot<DemoPlace>
  /** What this act actually added. Empty means the search found nothing new. */
  added: DemoPlace[]
  report: RetrievalReport
}

export async function widenTripCatalogue(input: {
  snapshot: CatalogueSnapshot<DemoPlace>
  /** The categories the traveller ran out of — usually one slot's role gate. */
  categories: readonly string[]
  destination: string
  lodging: ResolvedLodging
  baseLodgingName: string
  /** The trip's own reach, when a memory measured it. Still a hard bound here (B7). */
  radiusMetres?: number
  searcher: PlacesSearcher
  at: string
}): Promise<WidenOutcome> {
  const queries: ResolvedQuery[] = [...new Set(input.categories)].map((category) => ({
    category,
    retrieve: WIDEN_RETRIEVE,
    textQuery: defaultTextQuery({
      category,
      destination: input.destination,
      baseLodgingName: input.baseLodgingName,
    }),
    source: 'default',
    preferred: false,
    addedByModel: false,
  }))

  const report = await retrievePlaces({
    queries,
    lodging: input.lodging,
    ...(input.radiusMetres === undefined ? {} : { radiusMetres: input.radiusMetres }),
    searcher: input.searcher,
  })

  const snapshot = supplementCatalogueSnapshot(input.snapshot, {
    places: report.places,
    provenance: {
      queries: queries.map((query) => query.textQuery),
      rejected: report.rejected as Record<string, number>,
      lodging: {
        lat: input.lodging.lat,
        lng: input.lodging.lng,
        matchedAddress: input.lodging.matchedAddress,
      },
      ...(input.radiusMetres === undefined ? {} : { radiusMetres: input.radiusMetres }),
    },
    at: input.at,
  })

  return { snapshot, added: placesAddedIn(input.snapshot, snapshot), report }
}
