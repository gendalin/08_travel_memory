/**
 * How much a day moves (decided 2026-09-30).
 *
 * "Slow" is not a stop count. Six stops inside one kilometre is a slow day; five
 * stops each two kilometres apart is not, even though it has fewer. What tires a
 * traveller is getting between places and changing neighbourhood, so a slow day is
 * measured by exactly those two things:
 *
 *   moves  consecutive stops more than a short walk apart (> WALKABLE_KM)
 *   areas  groups of stops that are each within a short walk of another in the group
 *
 * The lodging legs at either end are not counted: going out to a neighbourhood and
 * coming back is the day's frame, not its pace.
 *
 * Pure and synchronous, like the rest of the domain.
 */

import { kmBetween, type Coordinates } from '../places/geo.ts'

/** Two stops closer than this are one walk, not a move. */
export const WALKABLE_KM = 1

/** A slow day moves at most once — out to a second neighbourhood — and no more. */
export const SLOW_MAX_MOVES = 1

/** A slow day stays within at most this many neighbourhoods. */
export const SLOW_MAX_AREAS = 2

export interface MovementBudget {
  maxMoves: number
  maxAreas: number
}

export const SLOW_BUDGET: MovementBudget = { maxMoves: SLOW_MAX_MOVES, maxAreas: SLOW_MAX_AREAS }

export interface DayMovement {
  /** Hops between consecutive stops longer than a walk. */
  moves: number
  /** Walkable clusters the day's stops fall into. */
  areas: number
  /** Longest hop between consecutive stops, km. */
  longestHopKm: number
}

/** Movement of a day's stops, given in visiting order. */
export function measureMovement(stops: readonly Coordinates[]): DayMovement {
  let moves = 0
  let longestHopKm = 0
  for (let i = 1; i < stops.length; i++) {
    const hop = kmBetween(stops[i - 1], stops[i])
    longestHopKm = Math.max(longestHopKm, hop)
    if (hop > WALKABLE_KM) moves++
  }

  // Single-linkage clusters at walking distance: union-find over the pairs.
  const parent = stops.map((_, index) => index)
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index])))
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      if (kmBetween(stops[i], stops[j]) <= WALKABLE_KM) parent[root(i)] = root(j)
    }
  }
  const areas = new Set(stops.map((_, index) => root(index))).size

  return { moves, areas, longestHopKm }
}

export function withinBudget(movement: DayMovement, budget: MovementBudget): boolean {
  return movement.moves <= budget.maxMoves && movement.areas <= budget.maxAreas
}
