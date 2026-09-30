/**
 * Memory and trip State -> a search plan (B1, B7).
 *
 * The single thing the query planner reads. It turns "these are the traveller's
 * preferences, with weights" into "search for these kinds of place, this many of
 * each, within this far of the hotel" — a different shape, and the one retrieval
 * actually needs.
 *
 * Memory comes from the trip's snapshot and nothing else — never from raw evidence,
 * which would steer a trip by something the traveller never agreed to (§10).
 *
 * State joins it at B7, and only through what it says structurally: an `avoid` names
 * a kind of place not to go looking for. Its free text needs no help from here — the
 * query planner is handed Intent and Considering verbatim (§12.1), which is what
 * makes two different Intents produce two different candidate pools.
 *
 * Priorities deliberately stay out. They decide which candidate WINS, which is
 * ranking's job (§12.2); retrieval decides what exists to choose between. Carrying
 * them here is Phase C1, and it needs the priority ladder to mean something at this
 * layer first.
 *
 * **Neighbourhoods are deliberately absent.** A taste for Ginza says nothing about
 * where to look in Kyoto, so the areas a past trip happened in cannot steer a new
 * one. What does transfer is the SHAPE of a day — how far it ranges — and that is
 * carried as a radius around this trip's own lodging instead.
 *
 * What the profile cannot carry is recorded in `gaps` rather than being quietly
 * missing, because a search that silently ignores the traveller's price bracket
 * looks the same as one that never knew it.
 */

import { slotCategories } from './tripContext.ts'
import {
  categoryPreferences,
  planShape,
  claimsAllowed,
  findInSnapshot,
} from '../../domain/memory/preferences.ts'
import type { MemorySnapshot } from '../../domain/memory/types.ts'
import {
  categoriesFor,
  DEFAULT_STOPS_PER_DAY as DEFAULT_PACE,
  rolesForPace,
  type DayRole,
  type DayRoleId,
} from '../../domain/plan/dayRoles.ts'
import { categoriesNamedBy } from '../../domain/places/taxonomy.ts'
import type { TripState } from '../../domain/state/types.ts'
import type { ID } from '../../domain/trip/types.ts'

/** One search: a category, and how deep to go in it. */
export interface CategoryTarget {
  category: string
  /** Places to fetch of this category. */
  retrieve: number
  /** True when a memory asked for this category rather than the role's gate. */
  preferred: boolean
}

/** What to search for, for one part of a day. */
export interface RetrievalTarget {
  role: DayRoleId
  /**
   * Categories to search, memory-preferred first, each with its own depth.
   *
   * Ordering is how Memory steers RETRIEVAL rather than only ranking: a category
   * the traveller keeps coming back to is searched first AND searched deeper, so
   * it is well represented in the candidate set. Ranking can only choose between
   * things that were fetched at all.
   *
   * Depth is proportionate: a category the traveller returned to twice in five
   * days is not searched as though it were wanted every day.
   */
  categories: CategoryTarget[]
  /** Categories left out because an aversion says not to look. */
  excluded: string[]
  /** Distinct places this role needs over the trip; a plan never repeats one. */
  needed: number
  /** Total places to fetch for this role, across its categories. */
  retrieve: number
}

export interface ProfileGap {
  /** The thing the profile would carry if it could. */
  what: string
  because: string
}

export interface RetrievalProfile {
  targets: RetrievalTarget[]
  /**
   * Metres from base lodging to search within, when a `pattern` memory measured
   * how far the traveller's days range.
   *
   * §4.2 puts base lodging in every day, so a day that spans S metres cannot hold
   * a stop more than S from the hotel — the same measurement serves as both.
   */
  radiusMetres?: number
  /** Stops a day, which decides how many roles are in play. */
  stopsPerDay: number
  /**
   * `avoid` values from Considering, verbatim.
   *
   * Carried so a thin candidate set can say a search was narrowed by the
   * traveller's own sentence rather than looking like the city having nothing.
   */
  avoid: string[]
  /** Memories behind this profile, so any search can be traced back to one. */
  memoryIds: ID[]
  gaps: ProfileGap[]
}

/**
 * Fetch more than are needed, because some results will be unusable.
 *
 * A place with no opening hours cannot be scheduled and a place with no
 * coordinates cannot be ranked, so both are dropped at the quality gate. Fetching
 * exactly `needed` would leave a role short the moment one result is thin.
 */
export const OVER_FETCH = 3

/** Minimum days' worth searched per category for the day's main stop. */
export const MAIN_STOP_MIN_SHARE = 2

/**
 * Pace to assume when no `pattern` memory measured it.
 *
 * Re-exported from the day model rather than chosen here: retrieval and planning have
 * to describe the same day, and they did not once — a trip retrieved for three roles
 * was planned against eight.
 */
export { DEFAULT_STOPS_PER_DAY } from '../../domain/plan/dayRoles.ts'

/**
 * Categories searched per role, at most.
 *
 * An "on the way" stop accepts sixteen categories, and searching all of them for
 * every such role would mean dozens of API calls per trip for candidates the plan
 * has five slots to put anywhere. Memory-preferred categories take the first
 * places, so the cap trims the tail the role's gate happened to list last, not
 * anything the traveller asked for.
 */
export const MAX_CATEGORIES_PER_ROLE = 6

function targetFor(input: {
  role: DayRole
  days: number
  snapshot?: MemorySnapshot
  /** Categories the trip's own `avoid` sentences name (B7). */
  avoided?: readonly string[]
}): RetrievalTarget {
  const eligible = slotCategories(input.role, input.snapshot)
  const preferences = categoryPreferences(input.snapshot)

  const unwanted = new Set([
    ...preferences
      .filter((preference) => preference.weight < 0)
      .map((preference) => preference.category),
    // A stated avoid is at least as strong as an inferred aversion: §0.2 puts what
    // the traveller said above what was inferred about them, so it excludes rather
    // than merely ranking down.
    ...(input.avoided ?? []),
  ])

  const excluded = eligible.filter((category) => unwanted.has(category))

  const preferred = preferences
    .filter((preference) => preference.weight > 0 && eligible.includes(preference.category))
    .map((preference) => preference.category)

  const rest = eligible.filter(
    (category) => !preferred.includes(category) && !excluded.includes(category),
  )

  // A role with nothing left to search is a part of the day that cannot be filled,
  // which is worse than searching something the traveller would rather skip —
  // ranking still pushes it to the bottom, and a Conflict is the honest outcome if
  // it is genuinely all there is.
  if (preferred.length === 0 && rest.length === 0) {
    return {
      role: input.role.id,
      categories: eligible.map((category) => ({
        category,
        retrieve: OVER_FETCH,
        preferred: false,
      })),
      excluded: [],
      needed: input.days,
      retrieve: eligible.length * OVER_FETCH,
    }
  }

  // Memory-preferred first, then the role's own order, then trimmed to the cap.
  const chosen = [...preferred, ...rest].slice(0, MAX_CATEGORIES_PER_ROLE)

  // How much of the role's need the traveller's own habits already account for.
  const claimedByMemory = Math.min(
    input.days,
    preferred.reduce(
      (sum, category) =>
        sum + expectedUses({ category, days: input.days, snapshot: input.snapshot }),
      0,
    ),
  )
  const unclaimed = Math.max(0, input.days - claimedByMemory)
  const restChosen = chosen.filter((category) => !preferred.includes(category))

  const categories: CategoryTarget[] = chosen.map((category) => {
    if (preferred.includes(category)) {
      const uses = expectedUses({ category, days: input.days, snapshot: input.snapshot })
      return { category, retrieve: Math.max(1, uses) * OVER_FETCH, preferred: true }
    }
    // What memory does not account for is spread over the remaining categories,
    // with a floor of one: a category searched to zero depth is not searched, and
    // a role needs somewhere to turn when its preferred options run out.
    const share = restChosen.length === 0 ? 0 : Math.ceil(unclaimed / restChosen.length)
    // The day's main stop gets two days' depth per category at least: at one, a live
    // run for a five-day trip came back with two days that had no main stop at all
    // (eval R1, 2026-09-30). Depth is results per call, not more calls.
    const floor = input.role.id === 'main_destination' ? MAIN_STOP_MIN_SHARE : 1
    return { category, retrieve: Math.max(floor, share) * OVER_FETCH, preferred: false }
  })

  return {
    role: input.role.id,
    categories,
    excluded,
    needed: input.days,
    retrieve: categories.reduce((sum, target) => sum + target.retrieve, 0),
  }
}

/**
 * What the profile could not derive, with the reason.
 *
 * Both gaps here are real and current: nothing in the preprocessing pipeline
 * produces a memory about a price bracket or a kind of venue, because those facets
 * were measured and dropped — one covered a single place in thirty-three, the other
 * carried a known false positive. Saved places cannot fill either gap, since a
 * Takeout export identifies a place by a Google feature id that resolves against
 * nothing in the catalogue.
 */
function gapsIn(snapshot: MemorySnapshot | undefined): ProfileGap[] {
  const gaps: ProfileGap[] = []
  const has = (facet: string) =>
    snapshot?.memories.some((memory) => memory.subject.facet === facet) ?? false

  if (!has('price_band')) {
    gaps.push({
      what: 'price bracket',
      because:
        'no memory carries one — preprocessing derives category trends and behavioural patterns, ' +
        'and a saved place cannot supply a price level because its id resolves against no catalogue',
    })
  }
  if (!has('stay_length')) {
    gaps.push({
      what: 'kind of venue',
      because:
        'the venue-form facet was dropped for coverage: from tags it described about half the ' +
        'catalogue, and from category it was a rename of category',
    })
  }
  if (planShape(snapshot).daySpanMetres === undefined) {
    gaps.push({
      what: 'how far a day ranges',
      because: 'no pattern memory measured it, so retrieval cannot bound itself to the traveller’s own reach',
    })
  }
  return gaps
}

/** `avoid` values from Considering, in the traveller's own words. */
export function avoidValues(state: TripState | undefined): string[] {
  return (state?.considering ?? [])
    .map((item) => (item.tag?.kind === 'avoid' ? item.tag.value : undefined))
    .filter((value): value is string => value !== undefined)
}

export function buildRetrievalProfile(input: {
  days: number
  /** Absent means no Memory is active: the profile is then role structure alone. */
  snapshot?: MemorySnapshot
  /** The trip's State, for the constraints it states structurally (B7). */
  state?: TripState
}): RetrievalProfile {
  const shape = planShape(input.snapshot)
  const stopsPerDay = shape.stopsPerDay?.value ?? DEFAULT_PACE

  const avoid = avoidValues(input.state)
  // One sentence can name more than one category, and several can name the same.
  const avoided = [...new Set(avoid.flatMap((value) => categoriesNamedBy(value)))]

  const targets = rolesForPace(stopsPerDay).map((role) =>
    targetFor({ role, days: input.days, snapshot: input.snapshot, avoided }),
  )

  return {
    targets,
    ...(shape.daySpanMetres ? { radiusMetres: shape.daySpanMetres.value } : {}),
    stopsPerDay,
    avoid,
    memoryIds: (input.snapshot?.memories ?? []).map((memory) => memory.id),
    gaps: gapsIn(input.snapshot),
  }
}

/**
 * How many places of one category the trip is likely to want.
 *
 * Read off the memory's own observed rate where it has one, so a category the
 * traveller returned to twice in five days is not searched for as though it were
 * wanted every day. This is what keeps retrieval proportionate rather than
 * fetching the same depth for everything.
 */
export function expectedUses(input: {
  category: string
  days: number
  snapshot?: MemorySnapshot
}): number {
  const preference = categoryPreferences(input.snapshot).find(
    (entry) => entry.category === input.category && entry.weight > 0,
  )
  if (!preference) return 0

  const memory = findInSnapshot(input.snapshot, preference.memoryId)
  return memory ? claimsAllowed(memory, input.days) : 1
}

/** One search to issue: a category, and the depth the deepest role needs. */
export interface CategorySearch {
  category: string
  retrieve: number
  /** Roles that will draw on it, so a thin result can be reported usefully. */
  roles: DayRoleId[]
  preferred: boolean
}

/**
 * The profile's targets, merged into the searches actually worth issuing.
 *
 * Roles overlap heavily — the four "on the way" slots have identical scopes, and
 * lunch and dinner share most of their categories — so issuing one search per role
 * would repeat the same query four times over. Merging by category turns
 * forty-eight role-category pairs into about twenty searches, and each is asked for
 * the depth its hungriest role needs rather than the sum of all of them.
 *
 * This is the shape retrieval consumes: one line per call to make.
 */
export function searchPlan(profile: RetrievalProfile): CategorySearch[] {
  const merged = new Map<string, CategorySearch>()

  for (const target of profile.targets) {
    for (const entry of target.categories) {
      const existing = merged.get(entry.category)
      if (existing) {
        existing.retrieve = Math.max(existing.retrieve, entry.retrieve)
        existing.roles.push(target.role)
        existing.preferred = existing.preferred || entry.preferred
      } else {
        merged.set(entry.category, {
          category: entry.category,
          retrieve: entry.retrieve,
          roles: [target.role],
          preferred: entry.preferred,
        })
      }
    }
  }

  // Preferred categories first, then by depth: a thin budget should be spent on
  // what the traveller actually asked for.
  return [...merged.values()].sort(
    (a, b) =>
      Number(b.preferred) - Number(a.preferred) ||
      b.retrieve - a.retrieve ||
      a.category.localeCompare(b.category),
  )
}
