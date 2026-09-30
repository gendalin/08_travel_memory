/**
 * What a day is made of (B0).
 *
 * Data only. Nothing here changes how a plan is generated yet — the generator
 * switches to these roles in B5, once per-trip retrieval can actually fill them.
 * The model has to exist first because the query planner needs to know what a day
 * asks for before it can go looking for it.
 *
 * The shape comes from how people describe a day rather than from a grid of equal
 * slots: one main thing you went out for, places near it or on the way, the two
 * meals, and somewhere to end up. Three stops a day — the previous structure —
 * could not express any of that; every slot was interchangeable and the day had no
 * anchor.
 *
 * Required versus optional is the other half. A day always has its anchor and its
 * two meals; how many of the rest get filled is what a `pattern` memory decides,
 * so an unhurried traveller gets a shorter day instead of every slot filled
 * regardless.
 */

import type { TimeBand } from '../places/facets.ts'
import { INTEREST_CATEGORY_IDS } from '../places/taxonomy.ts'

export type DayRoleId =
  | 'main_destination'
  | 'extension_1'
  | 'lunch'
  | 'extension_2'
  | 'extension_3'
  | 'extension_4'
  | 'dinner'
  | 'nightcap'

/**
 * Categories that ARE a meal — somewhere you sit down and eat.
 *
 * Kept as its own list because the meal roles own them: without that, an
 * afternoon "on the way" stop could pick a sushi counter and the day would have
 * two lunches. A cafe or a market is a stop rather than a meal, so neither is in
 * here.
 */
export const MEAL_CATEGORIES: readonly string[] = [
  'sushi',
  'ramen',
  'soba_udon',
  'teishoku',
  'tempura_tonkatsu',
  'yakiniku_grill',
  'izakaya',
]

/**
 * Everything a stop can be.
 *
 * Read from the shared taxonomy rather than listed again here. It WAS listed again,
 * and two lists that must agree with no way to check them against each other is how
 * a category quietly goes missing from half the product.
 */
export const INTEREST_CATEGORIES = INTEREST_CATEGORY_IDS

/** How a role decides which places are even eligible for it. */
export type RoleScope =
  /** A fixed set of categories. */
  | { kind: 'categories'; categories: readonly string[] }
  /**
   * Anything that is not a meal, near the day's anchor or on the way to it.
   *
   * Relational rather than categorical, because "on the way" is a fact about
   * geography and not about what kind of place it is.
   */
  | { kind: 'near_anchor'; anchorRole: DayRoleId }

export interface DayRole {
  id: DayRoleId
  /** User-facing name. The internal id never reaches a screen. */
  label: string
  band: TimeBand
  /** Earliest start and latest end, HH:MM. */
  window: { from: string; to: string }
  /** A day always has its anchor and its two meals. */
  required: boolean
  scope: RoleScope
  /** What a stop in this role usually takes, for sizing retrieval. */
  typicalMinutes: number
  /**
   * For an optional role, the order it gets filled in as the day grows. Lower
   * fills first. Absent on a required role, which is always filled.
   */
  fillOrder?: number
}

/**
 * The day, in order.
 *
 * Eight roles: three required and five optional, which is the seven-to-eight
 * stops a full day runs to.
 *
 * Two rules the windows keep, both of which the first draft broke and the tests
 * caught: every role sits wholly inside the time band it claims, and there is a
 * gap between one stop and the next for actually getting there. The previous
 * three-slot structure booked a stop the moment the last one ended, which is not
 * a day anyone has.
 *
 * The long gap between dinner and the nightcap is deliberate, not an oversight: an
 * evening meal runs on, and "somewhere after dinner" is somewhere you arrive later
 * rather than immediately.
 */
export const DAY_ROLES: readonly DayRole[] = [
  {
    id: 'main_destination',
    label: 'The main thing',
    band: 'morning',
    window: { from: '10:00', to: '11:30' },
    required: true,
    scope: {
      kind: 'categories',
      categories: [
        'museum_gallery',
        'architecture_design',
        'temple_shrine',
        'exhibition_event',
        'park_garden',
        'viewpoint_scenic',
      ],
    },
    typicalMinutes: 90,
  },
  {
    id: 'extension_1',
    fillOrder: 4,
    label: 'Nearby',
    band: 'lunch',
    window: { from: '11:45', to: '12:30' },
    required: false,
    scope: { kind: 'near_anchor', anchorRole: 'main_destination' },
    typicalMinutes: 45,
  },
  {
    id: 'lunch',
    label: 'Lunch',
    band: 'lunch',
    required: true,
    window: { from: '12:45', to: '13:45' },
    /**
     * Somewhere you can actually eat lunch.
     *
     * `grocery_market` was in this gate, and a live run showed what that means in
     * practice: a convenience supermarket and a coffee stand typed `food_store` both
     * became the lunch of a day. A market is somewhere you browse — the extension
     * roles take it, and `MEAL_CATEGORIES` twenty lines above already says a market
     * is a stop rather than a meal.
     *
     * A kissaten stays. It was not the problem, and lunch at one is a real thing
     * rather than a gap in the model — the measured offenders were both markets.
     */
    scope: {
      kind: 'categories',
      categories: [
        'sushi',
        'ramen',
        'soba_udon',
        'teishoku',
        'tempura_tonkatsu',
        'cafe_kissaten',
      ],
    },
    typicalMinutes: 60,
  },
  {
    id: 'extension_2',
    fillOrder: 1,
    label: 'On the way',
    band: 'afternoon',
    window: { from: '14:00', to: '15:00' },
    required: false,
    scope: { kind: 'near_anchor', anchorRole: 'main_destination' },
    typicalMinutes: 60,
  },
  {
    id: 'extension_3',
    fillOrder: 3,
    label: 'On the way',
    band: 'afternoon',
    window: { from: '15:15', to: '16:15' },
    required: false,
    scope: { kind: 'near_anchor', anchorRole: 'main_destination' },
    typicalMinutes: 60,
  },
  {
    id: 'extension_4',
    fillOrder: 5,
    label: 'Before dinner',
    band: 'afternoon',
    window: { from: '16:30', to: '17:30' },
    required: false,
    scope: { kind: 'near_anchor', anchorRole: 'dinner' },
    typicalMinutes: 60,
  },
  {
    id: 'dinner',
    label: 'Dinner',
    band: 'evening',
    window: { from: '18:00', to: '19:45' },
    required: true,
    scope: {
      kind: 'categories',
      categories: [
        'sushi',
        'ramen',
        'izakaya',
        'yakiniku_grill',
        'soba_udon',
        'teishoku',
        'tempura_tonkatsu',
      ],
    },
    typicalMinutes: 105,
  },
  {
    id: 'nightcap',
    fillOrder: 2,
    label: 'One more',
    band: 'late',
    window: { from: '21:00', to: '22:30' },
    required: false,
    scope: { kind: 'categories', categories: ['izakaya', 'bar_cocktail', 'yakiniku_grill'] },
    typicalMinutes: 90,
  },
]

/**
 * Stops a day when nothing has measured the traveller's pace.
 *
 * The three required roles plus the first two optional ones: an anchor, both meals,
 * somewhere in the early afternoon, and somewhere after dinner. A real day, and not a
 * claim about someone we know nothing about — eight stops from ten in the morning to
 * half past ten at night is a schedule, not a default.
 *
 * Shared with retrieval, so the searches issued and the roles planned describe the
 * same day. They disagreed once, and the result was a trip retrieved for three roles
 * being planned against eight.
 */
export const DEFAULT_STOPS_PER_DAY = 5

export const REQUIRED_ROLES: readonly DayRole[] = DAY_ROLES.filter((role) => role.required)
export const OPTIONAL_ROLES: readonly DayRole[] = DAY_ROLES.filter((role) => !role.required)

/** Categories eligible for a role, resolved through its scope. */
export function categoriesFor(role: DayRole): readonly string[] {
  if (role.scope.kind === 'categories') return role.scope.categories
  // An "on the way" stop can be anything that is not itself a meal — the meal
  // roles own those, so allowing them here would put two lunches in one day.
  return INTEREST_CATEGORIES.filter((category) => !MEAL_CATEGORIES.includes(category))
}

/**
 * The role a `DayRoleId` names.
 *
 * Needed wherever a stop is read back rather than built: a Replace has the item and
 * has to find out what part of the day it is, and that answer belongs to the role
 * model rather than to a lookup each caller writes again.
 */
/**
 * A role's categories on a given trip: its own, plus — for the day's main stop only —
 * any interest the traveller confirmed that no role at this pace could otherwise hold
 * (decided 2026-09-30).
 *
 * At three stops a day the roles are the main stop, lunch and dinner, and none of them
 * takes a bookstore, a market or a shop. A confirmed memory for one of those was
 * therefore inert for exactly the traveller whose measured pace is three stops: the
 * eval measured zero changed stops. Letting the main stop take it is the smallest
 * change that gives such a memory somewhere to land; meals are never widened.
 */
export function categoriesForTrip(
  role: DayRole,
  stopsPerDay: number,
  interests: readonly string[],
): readonly string[] {
  const own = categoriesFor(role)
  if (role.id !== 'main_destination') return own
  const inPlay = rolesForPace(stopsPerDay)
  const orphaned = interests.filter(
    (category) =>
      !MEAL_CATEGORIES.includes(category) &&
      INTEREST_CATEGORIES.includes(category) &&
      !inPlay.some((other) => categoriesFor(other).includes(category)),
  )
  return orphaned.length === 0 ? own : [...own, ...orphaned.filter((category) => !own.includes(category))]
}

export function roleById(id: DayRoleId): DayRole | undefined {
  return DAY_ROLES.find((role) => role.id === id)
}

/**
 * Which roles a day fills, given how many stops the traveller usually makes.
 *
 * Every required role, then optional ones by `fillOrder` until the target is
 * reached. The order is stated rather than chronological on purpose: filling the
 * day front-to-back would make a five-stop day three afternoon stops that end at
 * dinner, and never reach a nightcap at all — which is not what someone who names
 * "somewhere after dinner" as part of their day is asking for.
 *
 * So the first stop a day gains is the early afternoon, the second is the
 * nightcap, and the rest of the afternoon fills in after that.
 *
 * Fewer stops than there are required roles still fills all three: a day without
 * lunch is not a shorter day, it is a broken one.
 */
export function rolesForPace(stopsPerDay: number): readonly DayRole[] {
  const optionalWanted = Math.max(0, stopsPerDay - REQUIRED_ROLES.length)

  const chosenOptional = new Set(
    [...OPTIONAL_ROLES]
      .sort((a, b) => (a.fillOrder ?? 0) - (b.fillOrder ?? 0))
      .slice(0, optionalWanted)
      .map((role) => role.id),
  )

  // Returned in day order whatever the fill order was: a caller reads a day
  // forwards.
  return DAY_ROLES.filter((role) => role.required || chosenOptional.has(role.id))
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

/**
 * How long a day is, from the first role's opening to the last one's close.
 *
 * Derived rather than stated, so the figures that measure a day against it — free
 * time, a half day — cannot drift from the day the roles actually lay out.
 */
export function dayWindowMinutes(): number {
  const starts = DAY_ROLES.map((role) => toMinutes(role.window.from))
  const ends = DAY_ROLES.map((role) => toMinutes(role.window.to))
  return Math.max(...ends) - Math.min(...starts)
}

/**
 * How long half a day is, for the `half_day` Considering constraint (§8).
 *
 * Literally half the day the roles describe. It was a flat five hours, which was half
 * of the old three-stop day and would now let a "half day" run to the evening meal.
 */
export function halfDayMinutes(): number {
  return Math.round(dayWindowMinutes() / 2)
}
