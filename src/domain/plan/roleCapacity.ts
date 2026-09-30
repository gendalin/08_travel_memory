/**
 * Can a catalogue actually fill a day of roles? (B0)
 *
 * Every measurement in Phase A ran into the same wall from a different side:
 * alternatives fell below the three the spec asks for, half the candidate facets
 * had to be dropped, the day-span budget had nothing left to choose between by the
 * last day, and one stop sat over a stated budget because it was the only thing
 * open. Each time the answer was the same — thirty-three places cannot carry a
 * five-day trip.
 *
 * "Too few places" is not actionable, though. This turns it into a number per
 * role: how many places could fill each part of a day, against how many a trip of
 * N days needs, given that a plan never uses a place twice. That is the shopping
 * list per-trip retrieval has to satisfy.
 */

import { windowsOn, WEEKDAY_KEYS, type OpeningHours } from '../places/openingHours.ts'
import { categoriesFor, rolesForPace, type DayRole } from './dayRoles.ts'

/** The subset of a place this check reads. */
export interface CapacityPlace {
  placeId: string
  category: string
  openingHours?: OpeningHours
}

export interface RoleCapacity {
  role: DayRole
  /**
   * Places whose category fits the role and that open inside its window.
   *
   * An UPPER BOUND, not a reservation. Roles overlap — dinner and the nightcap
   * both accept izakaya — and a plan never uses a place twice, so two roles
   * cannot both draw on the same place. Read this next to the whole-trip total,
   * which is the constraint that actually binds.
   */
  available: number
  /** Places a trip of this length needs, since a plan never repeats one. */
  needed: number
  /** Positive when the catalogue cannot cover the trip. */
  short: number
}

/**
 * Whether the place is open for any part of the role's window, on any day.
 *
 * Any overlap at all: the exact stop length is the generator's problem, and a
 * capacity check that demanded the full window would understate the catalogue.
 */
function couldFill(place: CapacityPlace, role: DayRole): boolean {
  const from = toMinutes(role.window.from)
  const to = toMinutes(role.window.to)

  return WEEKDAY_KEYS.some((weekday) =>
    windowsOn(place.openingHours, weekday).some(
      (window) => window.opens < to && window.closes > from,
    ),
  )
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

/**
 * Capacity per role for a trip of `days`, worst shortfall first.
 *
 * `stopsPerDay` decides which optional roles are in play — a shortfall in a role
 * the traveller's pace never reaches is not a shortfall.
 */
export function roleCapacity(input: {
  places: readonly CapacityPlace[]
  days: number
  stopsPerDay: number
}): RoleCapacity[] {
  return rolesForPace(input.stopsPerDay)
    .map((role) => {
      const eligible = categoriesFor(role)
      const available = input.places.filter(
        (place) => eligible.includes(place.category) && couldFill(place, role),
      ).length

      return { role, available, needed: input.days, short: Math.max(0, input.days - available) }
    })
    .sort((a, b) => b.short - a.short || a.role.id.localeCompare(b.role.id))
}

export interface CapacitySummary {
  /** Stops a trip of this shape asks for: roles times days. */
  needed: number
  /** Distinct places the catalogue can offer at all. */
  available: number
  /**
   * Places missing overall, and the number that actually binds.
   *
   * Per-role shortfalls can all be zero while this is large, because the roles
   * were counted against the same places. A plan uses each place once, so the
   * whole trip needs as many distinct places as it has stops.
   */
  short: number
  /** Roles that cannot cover the trip even on their own. */
  rolesShort: number
  /** Worst per-role shortfall, summed. Always at most `short`. */
  shortByRole: number
}

/** What a trip of this shape needs against what the catalogue holds. */
export function capacitySummary(
  capacities: readonly RoleCapacity[],
  availablePlaces: number,
): CapacitySummary {
  const needed = capacities.reduce((sum, entry) => sum + entry.needed, 0)

  return {
    needed,
    available: availablePlaces,
    short: Math.max(0, needed - availablePlaces),
    rolesShort: capacities.filter((entry) => entry.short > 0).length,
    shortByRole: capacities.reduce((sum, entry) => sum + entry.short, 0),
  }
}
