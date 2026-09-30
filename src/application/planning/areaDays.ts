/**
 * Area days (decided 2026-09-30).
 *
 * Area discovery (queryPlan.areaQueries) brings places from Jimbocho or Koenji into a
 * trip's pool. On its own that changed nothing a traveller could see: every day
 * started at the lodging, the day's main stop could only be a museum, park or
 * temple, and a bookstore or kissaten two stations away was always "too far" from
 * whatever the day had already become. A live run put ten literary-quarter places in
 * the pool and none in the plan.
 *
 * An area day is a day spent IN one such neighbourhood. Its stops are chosen from
 * places inside the area first; its main stop may be one of the kinds of place that
 * make the area what it is; only the late "one more" is left free, so the evening can
 * end near the lodging. The legs out and back are not moves (movement.ts), so a whole
 * day in Jimbocho is exactly the slow day the traveller asked for.
 *
 * Which areas: the ones the traveller's words and confirmed neighbourhood memories
 * point at (areas.ts), within reach, that the trip's own pool can actually furnish.
 * An area with two places in the pool is not a day.
 */

import { traitPreferences } from '../../domain/memory/preferences.ts'
import type { MemorySnapshot } from '../../domain/memory/types.ts'
import {
  areasFor,
  charactersIn,
  CHARACTER_CATEGORIES,
  type AreaCharacter,
  type TokyoArea,
} from '../../domain/places/areas.ts'
import { kmBetween, type Coordinates } from '../../domain/places/geo.ts'
import type { TripState } from '../../domain/state/types.ts'
import type { DemoPlace } from '../../services/places/types.ts'
import { DEFAULT_AREA_REACH_KM, MAX_DISCOVERY_AREAS } from './queryPlan.ts'

/** Places the pool must hold inside an area before a day can be spent there. */
export const MIN_PLACES_FOR_AREA_DAY = 3
/** How far past an area's own radius a place still counts as in it, km. */
const AREA_EDGE_KM = 0.3

export interface AreaDay {
  dayIndex: number
  area: Pick<TokyoArea, 'id' | 'name' | 'center' | 'radiusKm'>
  /** The kinds of place that make it what it is: its main stop may be one of these. */
  categories: readonly string[]
  /** The State line or memory it was chosen for, for the reason a stop cites. */
  because: { text: string; stateItemIds: string[]; memoryIds: string[] }
}

export function inArea(place: Coordinates, area: AreaDay['area']): boolean {
  return kmBetween(place, area.center) <= area.radiusKm + AREA_EDGE_KM
}

/** The candidates inside the area, or all of them when none are. */
export function preferInArea<T extends Coordinates>(pool: readonly T[], area: AreaDay['area'] | undefined): T[] {
  if (!area) return [...pool]
  const inside = pool.filter((place) => inArea(place, area))
  return inside.length > 0 ? inside : [...pool]
}

/**
 * Which days of the trip are spent in which area.
 *
 * Spread through the trip rather than front-loaded — Day 2, then Day 4 — so the first
 * day starts where the traveller is staying and the area days sit between ordinary
 * ones. A trip of fewer than three days gets none: there is no ordinary day to anchor.
 */
export function areaDaysFor(input: {
  state: TripState
  snapshot?: MemorySnapshot
  pool: readonly DemoPlace[]
  lodging: Coordinates
  days: number
  /** A measured reach; areas beyond it are not days out. */
  radiusMetres?: number
}): AreaDay[] {
  if (input.days < 3) return []

  const lines = [...input.state.intent, ...input.state.considering]
  const spoken = lines.flatMap((line) => charactersIn(line.text).map((character) => ({ character, line })))
  const remembered = traitPreferences(input.snapshot).filter(
    (trait) => trait.trait === 'area_character' && trait.weight > 0,
  )
  const characters = [
    ...new Set([...spoken.map((entry) => entry.character), ...remembered.map((trait) => trait.value as AreaCharacter)]),
  ]
  if (characters.length === 0) return []

  const reachKm = input.radiusMetres !== undefined ? input.radiusMetres / 1000 : DEFAULT_AREA_REACH_KM
  const chosen = areasFor(characters, input.lodging)
    .filter(({ area }) => kmBetween(area.center, input.lodging) > area.radiusKm)
    .filter(({ area }) => kmBetween(area.center, input.lodging) <= reachKm)
    .filter(({ area }) => input.pool.filter((place) => place.category !== 'accommodation' && inArea(place, area)).length >= MIN_PLACES_FOR_AREA_DAY)
    .slice(0, MAX_DISCOVERY_AREAS)

  return chosen.map(({ area, matched }, index) => {
    const lineIds = [...new Set(spoken.filter((entry) => matched.includes(entry.character)).map((entry) => entry.line))]
    const memoryIds = remembered.filter((trait) => matched.includes(trait.value as AreaCharacter)).map((trait) => trait.memoryId)
    return {
      dayIndex: Math.min(input.days - 1, 1 + 2 * index),
      area: { id: area.id, name: area.name, center: area.center, radiusKm: area.radiusKm },
      categories: [...new Set(matched.flatMap((character) => CHARACTER_CATEGORIES[character]))],
      because: {
        text: lineIds[0]?.text ?? 'a neighbourhood you like',
        stateItemIds: lineIds.map((line) => line.id),
        memoryIds,
      },
    }
  })
}
