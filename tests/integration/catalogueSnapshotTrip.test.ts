/**
 * A trip planned against a frozen catalogue (B4).
 *
 * Uses the snapshot a LIVE retrieval actually produced, so this is the real path: 39
 * places fetched from Places, gated, frozen, and planned against with no further
 * lookup. Skipped when that snapshot has not been produced, since it costs money to
 * make and is not checked in.
 */

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { confirmReview, defaultPriorities, toFrame } from '../../src/application/createTrip/createTrip.ts'
import { generateFirstPlan } from '../../src/application/generatePlan/generatePlan.ts'
import { listAlternatives } from '../../src/application/alternatives/alternatives.ts'
import {
  supplementCatalogueSnapshot,
  type CatalogueSnapshot,
} from '../../src/domain/places/catalogueSnapshot.ts'
import { allItems } from '../../src/domain/plan/types.ts'
import { catalogueFromSnapshot } from '../../src/services/places/catalogue.ts'
import type { DemoPlace } from '../../src/services/places/types.ts'

const PATH = 'research-out/catalogue_snapshot.json'
const available = existsSync(PATH)

const snapshot = available
  ? (JSON.parse(readFileSync(PATH, 'utf8')) as CatalogueSnapshot<DemoPlace>)
  : undefined

const NOW = new Date('2026-09-21T09:00:00Z')

const SETUP = {
  name: 'Tokyo Slow Week',
  startDate: '2026-10-05',
  endDate: '2026-10-09',
  baseLodgingPlaceId: 'kuramae_base',
  baseLodgingName: 'Kuramae',
  intentText: 'Slow-paced. Time in local neighbourhoods.',
  consideringText: 'Moderate budget.',
}

describe.skipIf(!available)('a trip on a live-retrieved snapshot', () => {
  const frozen = snapshot!

  /**
   * The lodging is not one of the retrieved places — it is where the trip is based, and
   * §4.2 anchors every day to it — so it is added alongside them, exactly as the
   * application will have to.
   */
  function catalogueWithLodging() {
    const lodgingPlace: DemoPlace = {
      placeId: 'kuramae_base',
      name: 'Kuramae',
      lat: frozen.provenance[0].lodging.lat,
      lng: frozen.provenance[0].lodging.lng,
      category: 'accommodation',
      neighborhood: 'Kuramae',
      typicalDurationMin: 0,
      tags: [],
      shortDescription: 'Base lodging for the trip.',
      source: 'manual_demo',
      openingHours: {
        mon: '00:00-23:59', tue: '00:00-23:59', wed: '00:00-23:59', thu: '00:00-23:59',
        fri: '00:00-23:59', sat: '00:00-23:59', sun: '00:00-23:59',
      },
    }
    return catalogueFromSnapshot({ ...frozen, places: [lodgingPlace, ...frozen.places] })
  }

  function tripOn(source: CatalogueSnapshot<DemoPlace>) {
    const catalogue = catalogueWithLodging()
    const frame = toFrame(SETUP)
    const { trip, state } = confirmReview({
      tripId: 'trip_live',
      frame,
      draft: { intent: [{ id: 'intent_1', text: 'Slow-paced' }], considering: [], priorities: defaultPriorities() },
      profileMemories: [],
      catalogue,
      catalogueSnapshot: source,
      createdAt: NOW.toISOString(),
    })
    const generated = generateFirstPlan({
      frame, state, catalogue, days: 5, now: NOW, memorySnapshot: trip.memorySnapshot,
    })
    return { trip, state, frame, catalogue, ...generated }
  }

  it('was produced by a real retrieval', () => {
    expect(frozen.places.length).toBeGreaterThan(20)
    expect(frozen.version).toBe(1)
    expect(frozen.provenance[0].queries.length).toBeGreaterThan(5)
    expect(frozen.places.every((place) => place.source === 'places_api')).toBe(true)
  })

  it('plans a valid trip from it', () => {
    const { plan, validation } = tripOn(frozen)
    expect(validation.valid).toBe(true)
    expect(allItems(plan).length).toBeGreaterThan(0)
  })

  it('only ever schedules places the snapshot holds', () => {
    const { plan } = tripOn(frozen)
    const held = new Set(frozen.places.map((place) => place.placeId))
    for (const item of allItems(plan)) {
      if (item.placeId === 'kuramae_base') continue
      expect(held.has(item.placeId)).toBe(true)
    }
  })

  it('carries the snapshot on the trip, so the version reaches a Receipt', () => {
    const { trip } = tripOn(frozen)
    expect(trip.catalogueSnapshot?.version).toBe(1)
  })

  /** The reason for freezing: the same operation twice gives the same answer. */
  it('is reproducible — the same snapshot plans the same trip', () => {
    expect(JSON.stringify(tripOn(frozen).plan)).toBe(JSON.stringify(tripOn(frozen).plan))
  })

  it('offers alternatives without reaching for anything new', () => {
    const { trip, state, frame, catalogue, plan } = tripOn(frozen)
    const held = new Set(frozen.places.map((place) => place.placeId))

    const offered = allItems(plan).flatMap((item) =>
      listAlternatives({
        itemId: item.id, frame, state, plan, catalogue, memorySnapshot: trip.memorySnapshot,
      }),
    )

    expect(offered.length).toBeGreaterThan(0)
    for (const option of offered) expect(held.has(option.place.placeId)).toBe(true)
  })

  /**
   * A supplement is a new version, and the old one still plans the old trip — which is
   * what stops a later widening from rewriting an answer already given.
   */
  it('leaves an earlier version planning exactly what it planned', () => {
    const before = JSON.stringify(tripOn(frozen).plan)

    const widened = supplementCatalogueSnapshot(frozen, {
      places: [
        {
          ...frozen.places[0],
          placeId: 'extra_place',
          name: 'Somewhere New',
        },
      ],
      provenance: frozen.provenance[0],
      at: '2026-09-23T10:00:00.000Z',
    })

    expect(widened.version).toBe(2)
    expect(widened.places.length).toBe(frozen.places.length + 1)
    expect(JSON.stringify(tripOn(frozen).plan)).toBe(before)
  })
})
