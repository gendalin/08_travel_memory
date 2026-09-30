/**
 * Profile -> searches -> a candidate set for one trip (B3).
 *
 * The one place the three retrieval steps meet: B1 decides what a day needs, B2 gives
 * each search its words, and this issues them, gates what comes back, and reports
 * what it could not use.
 *
 * Every number in the outcome is there so a thin candidate set explains itself. A
 * search that returns four places instead of twelve is a fact worth surfacing — it
 * means a role will be short, and the traveller will see it as a day with a gap or an
 * alternative that is not there. Coming back quietly short is how the catalogue
 * ceiling stayed invisible through all of Phase A.
 */

import { metresBetween } from '../../domain/places/geo.ts'
import type { DemoPlace } from '../../services/places/types.ts'
import {
  mapPlacesResults,
  type PlacesResult,
  type RejectionReason,
} from '../../services/places/retrieval.ts'
import type { ResolvedLodging } from '../../services/places/lodging.ts'
import type { ResolvedQuery } from './queryPlan.ts'

/** What a caller must provide to actually issue searches. */
export interface PlacesSearcher {
  search(
    requests: ReadonlyArray<{
      textQuery: string
      retrieve: number
      bias?: { lat: number; lng: number; radiusMetres: number }
    }>,
  ): Promise<{
    /** Grouped by search, so an empty one can be named rather than merely missed. */
    results: Array<{ textQuery: string; places: PlacesResult[] }>
    calls: number
    fromCache: number
  }>
}

export interface RetrievalReport {
  places: DemoPlace[]
  /** Results returned before the quality gate. */
  returned: number
  /** Why results were dropped, counted by reason. */
  rejected: Partial<Record<RejectionReason, number>>
  /** Billable calls made, and how many were answered from cache instead. */
  calls: number
  fromCache: number
  /** Searches that came back with nothing usable at all. */
  emptySearches: string[]
}

/**
 * Radius to bias searches to when no `pattern` memory measured the traveller's reach.
 *
 * Wide enough to cover a city centre without becoming a whole-metro search. A
 * fallback, and labelled as one: the measured figure is always better.
 *
 * A bias only. It is never used to REJECT a place, because it is a number picked
 * here rather than anything measured about this traveller, and throwing away real
 * places over a guess is the kind of silent narrowing this module exists to report.
 */
export const DEFAULT_BIAS_RADIUS_METRES = 5_000

/**
 * Keeps only what is within reach of the lodging (B7).
 *
 * A bias asks Places to prefer a circle; it does not hold it to one. Live runs came
 * back with results well outside it, and every day starts and ends at the lodging
 * (§4.2) — so a place farther out than the traveller's days have ever ranged cannot
 * be part of one of their days. That makes it a filter, not a preference.
 *
 * Applied ONLY to a measured radius. The fallback above is a guess, and hard-filtering
 * on a guess is how "eight stops a day" went wrong: an unmeasured default stated as
 * fact.
 */
function withinReach(
  places: DemoPlace[],
  lodging: ResolvedLodging,
  radiusMetres: number | undefined,
): { kept: DemoPlace[]; dropped: number } {
  if (radiusMetres === undefined) return { kept: places, dropped: 0 }

  const kept = places.filter(
    (place) => metresBetween(lodging, { lat: place.lat, lng: place.lng }) <= radiusMetres,
  )
  return { kept, dropped: places.length - kept.length }
}

export async function retrievePlaces(input: {
  queries: readonly ResolvedQuery[]
  lodging: ResolvedLodging
  /** From a `pattern` memory, when one measured how far a day ranges. */
  radiusMetres?: number
  searcher: PlacesSearcher
}): Promise<RetrievalReport> {
  const bias = {
    lat: input.lodging.lat,
    lng: input.lodging.lng,
    radiusMetres: input.radiusMetres ?? DEFAULT_BIAS_RADIUS_METRES,
  }

  // One request per query, in the order B2 resolved them: preferred categories first,
  // so a run cut short by a quota still spent it on what the traveller asked for.
  // An area search is centred on its area, not on the lodging (area discovery).
  const requests = input.queries.map((query) => ({
    textQuery: query.textQuery,
    retrieve: query.retrieve,
    bias: query.area ? { lat: query.area.lat, lng: query.area.lng, radiusMetres: query.area.radiusMetres } : bias,
  }))

  const result = await input.searcher.search(requests)

  // Gated as one set, so a place several searches found is kept once. Each result
  // carries the category its search was issued for, which is the fallback when the
  // place's own Google types name none.
  const categoryByQuery = new Map(input.queries.map((query) => [query.textQuery, query.category]))
  const returned = result.results.flatMap((entry) =>
    entry.places.map((place) => ({ result: place, searchedFor: categoryByQuery.get(entry.textQuery) })),
  )
  const { places: mapped, rejected } = mapPlacesResults(returned)

  // Which of the traveller's own words each place was found for. Collected across
  // every search that returned it, before de-duplication, so a place two searches
  // found carries both reasons.
  const servesByQuery = new Map(input.queries.map((query) => [query.textQuery, query.servesWords]))
  const foundFor = new Map<string, Set<string>>()
  for (const entry of result.results) {
    const words = servesByQuery.get(entry.textQuery) ?? []
    if (words.length === 0) continue
    for (const place of entry.places) {
      if (!place.id) continue
      const known = foundFor.get(place.id) ?? new Set<string>()
      for (const phrase of words) known.add(phrase)
      foundFor.set(place.id, known)
    }
  }
  const withWords = mapped.map((place) => {
    const words = foundFor.get(place.placeId)
    return words ? { ...place, foundFor: [...words] } : place
  })

  const { kept: places, dropped } = withinReach(withWords, input.lodging, input.radiusMetres)
  if (dropped > 0) rejected.out_of_reach = (rejected.out_of_reach ?? 0) + dropped

  // Named rather than counted: WHICH search found nothing is what tells you whether
  // to reword it or accept that the city has none. Counted after the reach filter,
  // so a search whose every result was too far out reads as empty — which is what it
  // is, for this trip.
  const usable = new Set(places.map((place) => place.placeId))
  const emptySearches = result.results
    .filter((entry) => !entry.places.some((place) => place.id && usable.has(place.id)))
    .map((entry) => entry.textQuery)

  return {
    places,
    returned: returned.length,
    rejected,
    calls: result.calls,
    fromCache: result.fromCache,
    emptySearches,
  }
}
