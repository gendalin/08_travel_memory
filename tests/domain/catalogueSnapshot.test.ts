/**
 * The places a trip was planned against, frozen (B4).
 *
 * Symmetric with the Memory snapshot, and holding the same guarantee for the same
 * reason: the set a decision was made from must still be there when someone asks why
 * that decision was made.
 */

import { describe, expect, it } from 'vitest'

import {
  createCatalogueSnapshot,
  placesAddedIn,
  supplementCatalogueSnapshot,
  type CatalogueProvenance,
} from '../../src/domain/places/catalogueSnapshot.ts'

const AT = '2026-09-21T09:00:00.000Z'
const LATER = '2026-09-23T14:00:00.000Z'

const provenance = (queries: string[]): CatalogueProvenance => ({
  queries,
  rejected: { no_opening_hours: 2 },
  lodging: { lat: 35.703164, lng: 139.790828, matchedAddress: 'Kuramae, Taito City' },
  radiusMetres: 5578,
})

const place = (placeId: string) => ({ placeId })

function snapshot(placeIds: string[] = ['a', 'b']) {
  return createCatalogueSnapshot({
    tripId: 'trip_1',
    places: placeIds.map(place),
    provenance: provenance(['sushi near Kuramae']),
    createdAt: AT,
  })
}

describe('freezing a catalogue onto a trip', () => {
  it('starts at version 1', () => {
    expect(snapshot().version).toBe(1)
  })

  it('keeps the places it was given', () => {
    expect(snapshot(['a', 'b']).places.map((entry) => entry.placeId)).toEqual(['a', 'b'])
  })

  /** A set holding a place twice would offer it twice as an alternative. */
  it('drops a place several searches returned', () => {
    expect(snapshot(['a', 'b', 'a']).places.map((entry) => entry.placeId)).toEqual(['a', 'b'])
  })

  /** The guarantee is worth nothing if a later caller can push a place in. */
  it('cannot be added to after the fact', () => {
    const frozen = snapshot()
    expect(Object.isFrozen(frozen)).toBe(true)
    expect(Object.isFrozen(frozen.places)).toBe(true)
    const mutable = frozen.places as unknown as { push: (value: unknown) => void }
    expect(() => mutable.push(place('c'))).toThrow()
  })

  it('records how it was obtained, so a plan built on it can be explained', () => {
    const [entry] = snapshot().provenance
    expect(entry.queries).toEqual(['sushi near Kuramae'])
    expect(entry.lodging.matchedAddress).toBe('Kuramae, Taito City')
    expect(entry.radiusMetres).toBe(5578)
    expect(entry.rejected).toEqual({ no_opening_hours: 2 })
  })
})

describe('supplementing it', () => {
  const first = snapshot(['a', 'b'])
  const second = supplementCatalogueSnapshot(first, {
    places: [place('c'), place('d')],
    provenance: provenance(['izakaya near Kuramae']),
    at: LATER,
  })

  it('adds a version rather than replacing one', () => {
    expect(second.version).toBe(2)
    expect(second.places.map((entry) => entry.placeId)).toEqual(['a', 'b', 'c', 'd'])
  })

  /**
   * The property this whole module exists to provide. A Replace that offered three
   * alternatives must offer the same three when asked again — so a supplement is an
   * explicit act at a new version, never a quiet widening behind the same one.
   */
  it('leaves the earlier version exactly as it was', () => {
    expect(first.version).toBe(1)
    expect(first.places.map((entry) => entry.placeId)).toEqual(['a', 'b'])
  })

  it('keeps the whole provenance history, oldest first', () => {
    expect(second.provenance).toHaveLength(2)
    expect(second.provenance[0].queries).toEqual(['sushi near Kuramae'])
    expect(second.provenance[1].queries).toEqual(['izakaya near Kuramae'])
  })

  it('ignores a place it already had', () => {
    const again = supplementCatalogueSnapshot(second, {
      places: [place('a'), place('e')],
      provenance: provenance(['ramen']),
      at: LATER,
    })
    expect(again.places.map((entry) => entry.placeId)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  /** A supplement that finds nothing new is a no-op at a new version, not a duplicate. */
  it('still advances the version when nothing new was found', () => {
    const empty = supplementCatalogueSnapshot(second, {
      places: [place('a')],
      provenance: provenance(['nothing new']),
      at: LATER,
    })
    expect(empty.version).toBe(3)
    expect(empty.places).toHaveLength(second.places.length)
  })

  it('says which places a version added, for explaining a late option', () => {
    expect(placesAddedIn(first, second).map((entry) => entry.placeId)).toEqual(['c', 'd'])
    expect(placesAddedIn(second, second)).toEqual([])
  })

  it('stays frozen at every version', () => {
    expect(Object.isFrozen(second)).toBe(true)
    expect(Object.isFrozen(second.places)).toBe(true)
  })
})
