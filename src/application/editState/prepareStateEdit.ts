/**
 * Everything a State edit needs that takes a network call, done before the (pure,
 * synchronous) proposeStateEdit runs (2026-10-01).
 *
 *   1. read the new and edited lines — the model where one answers, rules otherwise
 *   2. locate a place a day was named for, when the trip does not know where it is
 *   3. fetch places there when the trip has too few to spend a day in it
 *
 * Steps 2 and 3 need live search. Without it (the offline build, the E2E suite) the
 * line is still read and kept, and the validator reports what could not be planned —
 * as a Conflict with options, never a silently ignored line.
 */

import { createCatalogueSnapshot, supplementCatalogueSnapshot, type CatalogueSnapshot } from '../../domain/places/catalogueSnapshot.ts'
import type { Trip, TripFrame } from '../../domain/trip/types.ts'
import type { TripState } from '../../domain/state/types.ts'
import type { LlmService } from '../../services/llm/types.ts'
import type { LodgingLocator } from '../../services/places/lodging.ts'
import type { DemoPlace, PlaceCatalogue } from '../../services/places/types.ts'
import { catalogueFromSnapshot } from '../../services/places/catalogue.ts'
import { interpretLines, interpretationKey, type ConsideringInterpretation, type LineInterpretation } from '../decompose/interpret.ts'
import { inArea, MIN_PLACES_FOR_AREA_DAY } from '../planning/areaDays.ts'
import { categoryWords, type ResolvedQuery } from '../planning/queryPlan.ts'
import { retrievePlaces, type PlacesSearcher } from '../planning/retrievePlaces.ts'
import type { StateDraft } from './proposeStateEdit.ts'

/** What a day somewhere needs: a main stop, lunch and dinner. */
export const DAY_PLACE_CATEGORIES = ['museum_gallery', 'park_garden', 'temple_shrine', 'cafe_kissaten', 'ramen', 'izakaya'] as const
/** How near a located name's centre a day there stays, km. */
const LOCATED_RADIUS_KM = 1.5

export interface Retrieval {
  locator: LodgingLocator
  searcher: PlacesSearcher
}

export interface PreparedEdit {
  interpretations: Map<string, LineInterpretation>
  /** The trip's places, widened when a named day needed some. */
  catalogue: PlaceCatalogue
  /** Set when the trip's catalogue snapshot grew; the caller saves it with the trip. */
  snapshot?: CatalogueSnapshot<DemoPlace>
  /** What was looked up, for the traveller. */
  notes: string[]
}

export async function prepareStateEdit(input: {
  llm: LlmService
  draft: StateDraft
  state: TripState
  trip: Trip
  frame: TripFrame
  catalogue: PlaceCatalogue
  days: number
  retrieval?: Retrieval
  at: string
}): Promise<PreparedEdit> {
  const kept = (section: 'intent' | 'considering', id: string, text: string) =>
    (section === 'intent' ? input.state.intent : input.state.considering).some((item) => item.id === id && item.text === text.trim())
  const lines = [
    ...input.draft.intent.filter((item) => item.text.trim() && !kept('intent', item.id, item.text)).map((item) => ({ text: item.text.trim(), section: 'intent' as const })),
    ...input.draft.considering.filter((item) => item.text.trim() && !item.event && !kept('considering', item.id, item.text)).map((item) => ({ text: item.text.trim(), section: 'considering' as const })),
  ]

  const interpretations = await interpretLines({
    llm: input.llm,
    lines,
    destination: input.frame.destination,
    startDate: input.frame.startDate,
    context: { catalogue: input.catalogue, days: input.days },
  })

  const snapshot = input.trip.catalogueSnapshot as CatalogueSnapshot<DemoPlace> | undefined
  const furnished = await furnishNamedPlaces({
    interpretations,
    keys: lines.filter((line) => line.section === 'considering').map((line) => interpretationKey('considering', line.text)),
    catalogue: input.catalogue,
    ...(snapshot ? { snapshot } : {}),
    tripId: input.trip.id,
    destination: input.frame.destination,
    ...(input.retrieval ? { retrieval: input.retrieval } : {}),
    at: input.at,
  })

  return {
    interpretations,
    catalogue: furnished.catalogue,
    ...(furnished.snapshot && furnished.snapshot !== snapshot ? { snapshot: furnished.snapshot } : {}),
    notes: furnished.notes,
  }
}

/**
 * For each line read as a day somewhere: locate the place if the area table does not
 * know it, and fetch places there when the trip has too few to spend a day in it.
 * Updates `interpretations` in place with the located place. Shared by trip creation
 * and a State edit, so a named day is furnished the same way on both.
 */
export async function furnishNamedPlaces(input: {
  interpretations: Map<string, LineInterpretation>
  keys: readonly string[]
  catalogue: PlaceCatalogue
  snapshot?: CatalogueSnapshot<DemoPlace>
  tripId: string
  destination: string
  retrieval?: Retrieval
  at: string
}): Promise<{ catalogue: PlaceCatalogue; snapshot?: CatalogueSnapshot<DemoPlace>; notes: string[] }> {
  let catalogue = input.catalogue
  let snapshot = input.snapshot
  const notes: string[] = []

  for (const key of input.keys) {
    const read = input.interpretations.get(key) as ConsideringInterpretation | undefined
    const tag = read?.tag
    if (tag?.kind !== 'day_in_place' || !input.retrieval) continue

    // Where is it?
    let place = tag.place
    if (!place.center) {
      const found = await input.retrieval.locator.locate({ name: place.name, destination: input.destination }).catch(() => null)
      if (!found) continue
      place = { ...place, center: { lat: found.lat, lng: found.lng }, radiusKm: LOCATED_RADIUS_KM }
      notes.push(`Found ${place.name} at ${found.matchedAddress || 'its centre'}.`)
    }
    const center = place.center!
    const radiusKm = place.radiusKm ?? LOCATED_RADIUS_KM

    // Enough places there to spend a day?
    const there = catalogue.all().filter((entry) => entry.category !== 'accommodation' && inArea(entry, { center, radiusKm })).length
    if (there < MIN_PLACES_FOR_AREA_DAY) {
      const queries: ResolvedQuery[] = DAY_PLACE_CATEGORIES.map((category) => ({
        category,
        retrieve: 4,
        textQuery: `${place.name} ${categoryWords(category)}`,
        source: 'default',
        preferred: true,
        addedByModel: false,
        area: { id: place.areaId ?? place.name, name: place.name, lat: center.lat, lng: center.lng, radiusMetres: Math.round(radiusKm * 1000) },
      }))
      const lodging = { lat: center.lat, lng: center.lng, matchedAddress: place.name }
      const report = await retrievePlaces({ queries, lodging, searcher: input.retrieval.searcher }).catch(() => undefined)
      if (report && report.places.length > 0) {
        const provenance = { queries: queries.map((query) => query.textQuery), rejected: report.rejected as Record<string, number>, lodging }
        const base = snapshot ?? createCatalogueSnapshot<DemoPlace>({
          tripId: input.tripId,
          places: catalogue.all(),
          provenance: { queries: [], rejected: {}, lodging },
          createdAt: input.at,
        })
        snapshot = supplementCatalogueSnapshot(base, { places: report.places, provenance, at: input.at })
        catalogue = catalogueFromSnapshot(snapshot)
        notes.push(`Found ${report.places.length} places in ${place.name} to plan the day around.`)
      }
    }

    input.interpretations.set(key, { ...read!, tag: { ...tag, place } })
  }

  return { catalogue, ...(snapshot ? { snapshot } : {}), notes }
}
