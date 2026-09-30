/** Demo place contract, mirroring data/demo_tokyo_v1/tokyo_places.json (§11.7). */

import type { PoiBrief } from './poiBrief.ts'

import type { WeekdayKey } from '../../domain/places/openingHours.ts'

/**
 * One photo of a place, as Places hands it over.
 *
 * A REFERENCE, not an image. The bytes come from a second, separately billed call
 * that needs the key, so fetching them is the server's job — and `attribution` comes
 * with the reference because Google's terms require it to be shown wherever the photo
 * is, which makes it part of the photo rather than metadata about it.
 */
export interface PlacePhoto {
  /** Resource name: `places/<place id>/photos/<reference>`. */
  name: string
  /** Who took it. Shown with the photo, per the Places policy. */
  attribution?: { name: string; uri?: string }
  /**
   * The image itself, inlined.
   *
   * Only the single-file prototype sets this: it has no server to fetch a reference
   * through, and a reviewer opening it from disk should still see the trip the
   * product actually produces. Everywhere else the reference is resolved through
   * `/api/photo`, which caches and keeps the key server-side.
   */
  src?: string
}

export interface DemoPlace {
  placeId: string
  name: string
  lat: number
  lng: number
  category: string
  neighborhood: string
  priceLevel?: 0 | 1 | 2 | 3 | 4
  openingHours?: Record<string, string>
  typicalDurationMin: number
  tags: string[]
  shortDescription: string
  /** `live_event`: a picked event, placed at its venue for its hours (§7.8). */
  source: 'places_api' | 'map_source' | 'screenshot' | 'manual_demo' | 'live_event'
  /**
   * How many people have reviewed the place.
   *
   * A measure of FAME, not of quality — ranking by rating would push every trip
   * toward crowd-pleasers, which is the definition of generic. Fifty thousand
   * reviews means a place is not a discovery, which is what `novelty` is about.
   * Absent when Places did not supply it.
   */
  userRatingCount?: number
  /**
   * Whether the category came from the place's own Google types or from the search
   * that found it. Absent for a place that was not retrieved.
   *
   * Recorded because the two are not equally good: a type is what the place IS, a
   * search is what we were looking for when it turned up.
   */
  categoryFrom?: 'place_type' | 'search' | 'name'
  /**
   * The first photo Places offered, when it offered one.
   *
   * Frozen onto the trip with the rest of the place (B4), so the itinerary shows the
   * same picture tomorrow as today. Absent for the bundled demo set, which was built
   * before photos were asked for — those stops keep their monogram.
   */
  photo?: PlacePhoto
  /**
   * The traveller's own words the search that found this place was written for.
   *
   * Verified spans of their Intent or Considering (`resolveQueryPlan`), recorded at
   * retrieval and frozen with the place. Absent for the bundled set and for a place
   * only a plain, code-worded search found.
   */
  foundFor?: string[]
  /**
   * What the place is, from its own website and trusted sources, structured
   * (poi_enrichment_spec). Reusable across trips: nothing in it is about this
   * traveller. Absent until the place has been enriched.
   */
  poiBrief?: PoiBrief
}

/**
 * The bounded POI set. Every place the product may reference lives here — the
 * LLM is only ever given ids from this catalogue, and the validator rejects
 * anything else (§8: "no invented POI ids").
 */
export interface PlaceCatalogue {
  all(): DemoPlace[]
  get(placeId: string): DemoPlace | undefined
  has(placeId: string): boolean
  /** Bounded candidate set for one planning decision — 10-30, never the lot (§12.1). */
  candidates(filter: CandidateFilter): DemoPlace[]
}

export interface CandidateFilter {
  category?: string
  neighborhood?: string
  excludePlaceIds?: string[]
  limit?: number
  /**
   * Keep only places open for this whole window. §12.1 lists opening hours as a
   * retrieval filter; without it a closed place is a candidate, gets scheduled,
   * and is only caught — if at all — after the plan exists.
   */
  openAt?: { weekday: WeekdayKey; startTime: string; endTime: string }
}

export const MAX_CANDIDATES = 30
