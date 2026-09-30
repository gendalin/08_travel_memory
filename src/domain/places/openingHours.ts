/**
 * Opening hours, as a rule rather than as a caption (product_spec §8).
 *
 * The catalogue has carried real per-weekday hours since Gate 1, and
 * `explainDay` already reads them to tell a user "this one is shut on Day 1, so
 * it sits here instead". Nothing, however, ever stopped a plan from scheduling a
 * stop while the place was closed: the validator only checked that the hours
 * FIELD existed. A measured run of the default demo trip put three of fifteen
 * stops outside opening hours — a ramen counter nearly four hours after it shut,
 * an izakaya half an hour before it opened, a market half an hour before it
 * packed up — and reported the plan as valid.
 *
 * So this module exists to be the single place that answers "is it open then",
 * used by BOTH the validator and candidate retrieval. Two copies of this rule
 * would drift, and the pair that must agree is exactly retrieval and validation:
 * retrieval keeps a closed place out, validation catches anything that got
 * through another route.
 *
 * A day can have SEVERAL spans, written comma-separated: "12:00-14:00,18:00-20:30".
 * Most counters in Tokyo shut between lunch and dinner, and the first version of
 * this kept only a day's first span — which recorded a sushi counter open for both
 * services as lunch-only, and a ramen shop open 10:00-23:00 as a breakfast place.
 * Eight of twenty-nine places in the demo catalogue were affected. A single span
 * per day cannot express a lunch break, and pretending the gap is open hours would
 * reintroduce exactly the closed-door scheduling this module exists to stop.
 *
 * Pure, and takes the weekday rather than a Date, so the domain does no
 * calendar work it does not have to.
 */

/** Sunday-first, matching `Date.getDay()`. */
export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

export type WeekdayKey = (typeof WEEKDAY_KEYS)[number]

export function weekdayKey(date: Date): WeekdayKey {
  return WEEKDAY_KEYS[date.getDay()]
}

/**
 * A day's hours as the bundle spells them.
 *
 * One span ("11:00-15:00"), several comma-separated ("12:00-14:00,18:00-20:30"),
 * or "closed".
 */
export type OpeningHours = Record<string, string>

export interface OpenWindow {
  /** Minutes since midnight. */
  opens: number
  closes: number
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

/** One span, or null when it cannot be read. */
function parseSpan(span: string): OpenWindow | null {
  const [open, close] = span.trim().split('-')
  if (!open || !close) return null

  const opens = toMinutes(open)
  const closes = toMinutes(close)
  if (Number.isNaN(opens) || Number.isNaN(closes) || closes <= opens) return null

  return { opens, closes }
}

/**
 * Every window the place is open for that day, earliest first.
 *
 * Empty means "not open", never "unknown" — an unreadable span is dropped rather
 * than waved through, because the failure that matters here is standing outside a
 * locked door. A day where every span is unreadable therefore reads as closed.
 */
export function windowsOn(hours: OpeningHours | undefined, weekday: WeekdayKey): OpenWindow[] {
  const value = hours?.[weekday]
  if (!value || value === 'closed') return []

  return value
    .split(',')
    .map(parseSpan)
    .filter((window): window is OpenWindow => window !== null)
    .sort((a, b) => a.opens - b.opens)
}

/**
 * The day's first window, for callers that only need to know when it opens.
 *
 * Prefer `windowsOn` where a lunch break matters: this reports 12:00-14:00 for a
 * counter that also serves 18:00-20:30, which is true but incomplete.
 */
export function windowOn(hours: OpeningHours | undefined, weekday: WeekdayKey): OpenWindow | null {
  return windowsOn(hours, weekday)[0] ?? null
}

export function isClosedOn(hours: OpeningHours | undefined, weekday: WeekdayKey): boolean {
  return windowsOn(hours, weekday).length === 0
}

/** The window a visit starting at this time would fall in, if any. */
export function windowCovering(
  hours: OpeningHours | undefined,
  weekday: WeekdayKey,
  startTime: string,
): OpenWindow | null {
  const start = toMinutes(startTime)
  return windowsOn(hours, weekday).find((window) => start >= window.opens && start < window.closes) ?? null
}

/**
 * Whether a visit from `startTime` to `endTime` fits inside the day's window.
 *
 * The whole visit has to fit, not just its start: arriving twenty minutes
 * before closing is the same failure as arriving after.
 */
export function isOpenFor(
  hours: OpeningHours | undefined,
  weekday: WeekdayKey,
  startTime: string,
  endTime: string,
): boolean {
  const start = toMinutes(startTime)
  const end = toMinutes(endTime)
  // ONE window has to hold the whole visit. Spanning a lunch break would mean
  // sitting in a shut restaurant for an hour in the middle.
  return windowsOn(hours, weekday).some((window) => start >= window.opens && end <= window.closes)
}

/** "11:00-15:00", or "12:00-14:00 and 18:00-20:30", or "closed". */
export function describeHours(hours: OpeningHours | undefined, weekday: WeekdayKey): string {
  const windows = windowsOn(hours, weekday)
  if (windows.length === 0) return 'closed'

  const pad = (value: number) => String(value).padStart(2, '0')
  const spans = windows.map(
    (window) =>
      `${pad(Math.floor(window.opens / 60))}:${pad(window.opens % 60)}-` +
      `${pad(Math.floor(window.closes / 60))}:${pad(window.closes % 60)}`,
  )

  return spans.length === 1 ? spans[0] : `${spans.slice(0, -1).join(', ')} and ${spans[spans.length - 1]}`
}
