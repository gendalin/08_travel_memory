/**
 * Spatial helpers shared by build_user_context.ts and build_candidate_memories.ts.
 *
 * Deliberately simple: photo GPS is accurate to tens of metres at best, so
 * planar shortcuts would be false precision in the other direction.
 */

import type { GeoPoint } from './types.ts'

const EARTH_RADIUS_M = 6_371_000

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

/** Two photos within this distance are treated as the same stop. */
export const STOP_RADIUS_M = 250

export interface Cluster {
  center: GeoPoint
  count: number
}

/**
 * Greedy single-pass clustering in capture order. Points are visited
 * chronologically, so a place revisited later in the day folds back into the
 * existing cluster rather than counting as a new stop.
 */
export function clusterPoints(points: GeoPoint[], radiusM = STOP_RADIUS_M): Cluster[] {
  const clusters: Cluster[] = []

  for (const point of points) {
    const hit = clusters.find((cluster) => haversineMeters(cluster.center, point) <= radiusM)
    if (hit) {
      // Running mean keeps the centre honest as a cluster grows.
      hit.center = {
        lat: (hit.center.lat * hit.count + point.lat) / (hit.count + 1),
        lng: (hit.center.lng * hit.count + point.lng) / (hit.count + 1),
      }
      hit.count++
    } else {
      clusters.push({ center: { ...point }, count: 1 })
    }
  }

  return clusters
}

/** Greatest distance between any two points, in metres. 0 for fewer than 2 points. */
export function maxSpanMeters(points: GeoPoint[]): number {
  let max = 0
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      max = Math.max(max, haversineMeters(points[i], points[j]))
    }
  }
  return max
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}
