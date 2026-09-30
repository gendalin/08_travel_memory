/**
 * Straight-line distance between two points.
 *
 * One copy, because there were three: ranking worked in kilometres, Expected Impact
 * in metres, and the preprocessing script had its own. Three identical formulas
 * behind three different constants is a correction that only ever lands in one of
 * them.
 *
 * Straight-line, not travel time. Nothing here knows about trains, and a figure that
 * looked like a journey time would be a claim the product cannot support (§12.2: no
 * invented route facts).
 */

export interface Coordinates {
  lat: number
  lng: number
}

const EARTH_RADIUS_KM = 6_371
const EARTH_RADIUS_M = 6_371_000

function haversine(a: Coordinates, b: Coordinates, radius: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(h))
}

export function kmBetween(a: Coordinates, b: Coordinates): number {
  return haversine(a, b, EARTH_RADIUS_KM)
}

export function metresBetween(a: Coordinates, b: Coordinates): number {
  return haversine(a, b, EARTH_RADIUS_M)
}
