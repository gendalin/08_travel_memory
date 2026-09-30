/**
 * Retrieval, at the moment a trip is created.
 *
 * This is where B1–B4 meet the product. Until now the chain existed and only a
 * research script ran it: the app planned every trip from the bundled thirty-four
 * places, so two different Intents produced the same candidate pool and the day
 * structure ran out of somewhere to put a nightcap by Day 4.
 *
 * **Why at Generate.** §3.6.10 says nothing is persisted before it, and §3.6.7 already
 * has a generating state to wait in — so this is the one point where Intent,
 * Considering and Priorities are all settled and nothing has been written yet. Earlier
 * would search on text the traveller had not confirmed; later would mean a trip whose
 * places arrived after the plan that needed them.
 *
 * **Why once.** What comes back is frozen onto the trip (B4). Every later operation —
 * Replace, Alternatives, Expected Impact — reads the frozen set, makes no network
 * call, and gives the same answer tomorrow as today. The traveller pays for retrieval
 * at creation and never again.
 *
 * **What happens when it cannot.** Falling back to the bundled set is Phase C2, and it
 * is reported rather than hidden: a trip planned from the seed set is a different trip
 * from one planned for this traveller, and the difference is the product's whole
 * claim. Three things send it there, each named in the outcome:
 *
 *   - the lodging cannot be resolved, so there is no centre to search around
 *   - the search service cannot be reached
 *   - what came back cannot fill the parts of a day that a day is made of
 *
 * The last one is deliberately narrow. Only the REQUIRED roles count: a day without
 * lunch is broken rather than shorter, but an afternoon stop the city could not supply
 * is a thin day the generator already reports (`unfilled`) — and throwing away real
 * retrieved places over it, to fall back to a set that is thinner still, would make
 * the product worse in the name of a rule.
 */

import { areaQueries } from '../planning/queryPlan.ts'
import { traitPreferences } from '../../domain/memory/preferences.ts'
import { categoriesNamedBy } from '../../domain/places/taxonomy.ts'
import type { AreaCharacter } from '../../domain/places/areas.ts'
import { createCatalogueSnapshot, type CatalogueSnapshot } from '../../domain/places/catalogueSnapshot.ts'
import type { MemorySnapshot } from '../../domain/memory/types.ts'
import { roleCapacity } from '../../domain/plan/roleCapacity.ts'
import { INTEREST_CATEGORY_IDS } from '../../domain/places/taxonomy.ts'
import type { ConsideringItem, TripState } from '../../domain/state/types.ts'
import type { LodgingLocator, ResolvedLodging } from '../../services/places/lodging.ts'
import { createPlaceCatalogue } from '../../services/places/catalogue.ts'
import type { DemoPlace } from '../../services/places/types.ts'
import type { LlmService } from '../../services/llm/types.ts'
import { tagAll } from '../decompose/tagConsidering.ts'
import { resolveQueryPlan } from '../planning/queryPlan.ts'
import { buildRetrievalProfile, searchPlan } from '../planning/retrievalProfile.ts'
import { retrievePlaces, type PlacesSearcher, type RetrievalReport } from '../planning/retrievePlaces.ts'

export type RetrieveForTripOutcome =
  | {
      kind: 'retrieved'
      snapshot: CatalogueSnapshot<DemoPlace>
      lodging: ResolvedLodging
      report: RetrievalReport
    }
  | {
      kind: 'fell_back'
      /** One line for the traveller, in the product's voice. Never provider detail. */
      because: string
      /** Present when searches ran and simply did not yield enough. */
      report?: RetrievalReport
    }

export interface RetrieveProgress {
  (message: string): void
}

/**
 * A provisional State, for the one thing retrieval reads from it.
 *
 * The real State v1 is built by `confirmReview`, which needs a catalogue — and the
 * catalogue is what this function produces. Rather than untangle that, the only
 * structured constraint retrieval uses is derived here: an `avoid` names a kind of
 * place not to go looking for (B7), and reading it needs no catalogue.
 *
 * Tagged against an EMPTY catalogue on purpose. A must-visit cannot be resolved before
 * a single place has been fetched, and an unresolved one is the honest answer at this
 * point — `confirmReview` tags the real State against the real set a moment later.
 */
function provisionalState(considering: readonly string[]): TripState {
  const items: ConsideringItem[] = considering.map((text, index) => ({
    id: `cons_${index + 1}`,
    text,
  }))

  return {
    version: 0,
    intent: [],
    considering: tagAll(items, createPlaceCatalogue([])),
    priorities: [],
  }
}

export async function retrieveForTrip(input: {
  tripId: string
  days: number
  destination: string
  baseLodgingName: string
  /** The traveller's own words, verbatim, for the model to write searches from. */
  intentText: string
  consideringText: string
  /** The decomposed Considering sentences, for the constraints they state (B7). */
  considering: readonly string[]
  /** The trip's immutable Memory snapshot, which decides what to look for (B1). */
  memorySnapshot?: MemorySnapshot
  llm: LlmService
  locator: LodgingLocator
  searcher: PlacesSearcher
  createdAt: string
  onProgress?: RetrieveProgress
}): Promise<RetrieveForTripOutcome> {
  // --- where to search around ------------------------------------------------
  input.onProgress?.(`Finding ${input.baseLodgingName}…`)

  let lodging: ResolvedLodging | null
  try {
    lodging = await input.locator.locate({
      name: input.baseLodgingName,
      destination: input.destination,
    })
  } catch {
    lodging = null
  }

  if (!lodging) {
    return {
      kind: 'fell_back',
      because:
        `I could not find “${input.baseLodgingName}” in ${input.destination}, so I planned ` +
        `from the places I already know rather than searching around a guess.`,
    }
  }

  // --- what to search for ----------------------------------------------------
  const profile = buildRetrievalProfile({
    days: input.days,
    ...(input.memorySnapshot ? { snapshot: input.memorySnapshot } : {}),
    state: provisionalState(input.considering),
  })

  // Wording from the model, or written here when it does not answer. `planQueries` is
  // already behind the retry budget and the stand-in, so a failure arrives as an empty
  // plan rather than an exception, and `resolveQueryPlan` labels what it wrote itself.
  const planned = await input.llm.planQueries({
    destination: input.destination,
    baseLodgingName: input.baseLodgingName,
    intentText: input.intentText,
    consideringText: input.consideringText,
    searches: searchPlan(profile).map((entry) => ({
      category: entry.category,
      preferred: entry.preferred,
    })),
    allowedCategories: INTEREST_CATEGORY_IDS,
  })

  const lodgingQueries = resolveQueryPlan({
    profile,
    destination: input.destination,
    baseLodgingName: input.baseLodgingName,
    planned,
    ownWords: `${input.intentText}\n${input.consideringText}`,
  })

  // Beyond the lodging: the neighbourhoods the traveller's words and confirmed
  // memories point at (areas.ts), within reach.
  const discovery = areaQueries({
    ownWords: `${input.intentText}\n${input.consideringText}`,
    remembered: traitPreferences(input.memorySnapshot)
      .filter((trait) => trait.trait === 'area_character' && trait.weight > 0)
      .map((trait) => trait.value as AreaCharacter),
    lodging,
    ...(profile.radiusMetres === undefined ? {} : { radiusMetres: profile.radiusMetres }),
    excluded: profile.avoid.flatMap((value) => categoriesNamedBy(value)),
  })
  const queries = [
    ...lodgingQueries,
    ...discovery.filter((query) => !lodgingQueries.some((existing) => existing.textQuery === query.textQuery)),
  ]

  // --- the searches ----------------------------------------------------------
  input.onProgress?.(`Looking for places near ${lodging.matchedAddress || input.baseLodgingName}…`)

  let report: RetrievalReport
  try {
    report = await retrievePlaces({
      queries,
      lodging,
      ...(profile.radiusMetres === undefined ? {} : { radiusMetres: profile.radiusMetres }),
      searcher: input.searcher,
    })
  } catch {
    return {
      kind: 'fell_back',
      because:
        'I could not reach the place search, so I planned from the places I already know.',
    }
  }

  // --- is it a day? ----------------------------------------------------------
  const missing = roleCapacity({
    places: report.places,
    days: input.days,
    stopsPerDay: profile.stopsPerDay,
  }).filter((capacity) => capacity.role.required && capacity.short > 0)

  if (missing.length > 0) {
    const named = missing.map((capacity) => capacity.role.label.toLowerCase()).join(' or ')
    return {
      kind: 'fell_back',
      report,
      because:
        `The search did not turn up enough near ${lodging.matchedAddress || input.baseLodgingName} ` +
        `to give every day a ${named}, so I planned from the places I already know.`,
    }
  }

  input.onProgress?.(`Found ${report.places.length} places. Building your itinerary…`)

  return {
    kind: 'retrieved',
    lodging,
    report,
    snapshot: createCatalogueSnapshot<DemoPlace>({
      tripId: input.tripId,
      places: report.places,
      provenance: {
        queries: queries.map((query) => query.textQuery),
        rejected: report.rejected as Record<string, number>,
        lodging: {
          lat: lodging.lat,
          lng: lodging.lng,
          matchedAddress: lodging.matchedAddress,
        },
        ...(profile.radiusMetres === undefined ? {} : { radiusMetres: profile.radiusMetres }),
      },
      createdAt: input.createdAt,
    }),
  }
}
