/**
 * A Conflict in the traveller's terms, with the ways out of it (product_spec §8,
 * eval spec §13).
 *
 * A Conflict used to be one sentence. "I couldn't fit it into any day" names neither
 * what blocks it nor what the traveller could do about it, so the only way forward
 * was to guess at a rewrite. Each Conflict now says what is in the way — closed that
 * weekday, no room, locked — and carries the resolutions code can vouch for: the days
 * the place is actually open, dropping the requirement, or editing it.
 *
 * Shared by trip creation (Stage B) and a State edit, so the same constraint fails
 * the same way on both paths.
 */

import { windowOn, weekdayKey } from '../../domain/places/openingHours.ts'
import type { TripState } from '../../domain/state/types.ts'
import { dateOfDay } from '../../domain/trip/phase.ts'
import type { TripFrame } from '../../domain/trip/types.ts'
import type { ValidationError } from '../../domain/validation/types.ts'
import type { PlaceCatalogue } from '../../services/places/types.ts'
import { isUnresolvedPlaceId } from '../decompose/tagConsidering.ts'

export type ConflictOption =
  /** Pin it to another day. `text` is the Considering line rewritten for that day. */
  | { kind: 'move_day'; dayIndex: number; label: string; text: string }
  /** Drop the requirement. */
  | { kind: 'remove'; label: string }
  /** Rewrite the requirement by hand. */
  | { kind: 'edit'; label: string }

export interface ConflictDetail {
  message: string
  consideringId?: string
  /** Ways out, computed by code. Absent when none apply. */
  options?: ConflictOption[]
}

const WEEKDAY_NAME: Record<string, string> = {
  mon: 'Mondays', tue: 'Tuesdays', wed: 'Wednesdays', thu: 'Thursdays',
  fri: 'Fridays', sat: 'Saturdays', sun: 'Sundays',
}

function tripDayCount(frame: TripFrame): number {
  const start = new Date(`${frame.startDate}T12:00:00`)
  const end = new Date(`${frame.endDate}T12:00:00`)
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
}

/** The name the traveller used, lifted back out of their sentence. */
function namedIn(text: string): string {
  return text
    .replace(/^.*?(?:visit|see|go to|eat at|get to|stop at)\s+(?:the\s+)?/i, '')
    .replace(/\b(on|during|for)\s+day\s*\d+.*$/i, '')
    .replace(/[.!?,;]+\s*$/, '')
    .trim()
}

/** A pinned place the plan cannot hold, explained, with the days it could go instead. */
export function pinConflict(input: {
  placeId: string
  dayIndex?: number
  because: 'closed_that_day' | 'no_room' | 'locked'
  sourceText: string
  consideringId?: string
  frame: TripFrame
  catalogue: PlaceCatalogue
}): ConflictDetail {
  const place = input.catalogue.get(input.placeId)
  const name = place?.name ?? namedIn(input.sourceText)
  const days = tripDayCount(input.frame)
  const weekday = input.dayIndex !== undefined ? weekdayKey(dateOfDay(input.frame, input.dayIndex)) : undefined

  const openDays = Array.from({ length: days }, (_, index) => index).filter(
    (index) =>
      index !== input.dayIndex &&
      windowOn(place?.openingHours, weekdayKey(dateOfDay(input.frame, index))) !== null,
  )

  const openAnyDay = Array.from({ length: days }, (_, index) => index).some(
    (index) => windowOn(place?.openingHours, weekdayKey(dateOfDay(input.frame, index))) !== null,
  )

  const message =
    !openAnyDay && place
      ? `${name} is closed on every day of this trip, so it can't be planned.`
      : input.because === 'closed_that_day' && input.dayIndex !== undefined && weekday
      ? `${name} is closed on ${WEEKDAY_NAME[weekday]}, so it can't be on Day ${input.dayIndex + 1}.`
      : input.because === 'locked'
        ? `${name} is already fixed on another day that has started, so it can't move to Day ${(input.dayIndex ?? 0) + 1}.`
        : input.dayIndex !== undefined
          ? `Day ${input.dayIndex + 1} has no room for ${name} while it is open.`
          : `I know “${name}”, but no day has room for it while it is open.`

  const rewrite = (dayIndex: number) =>
    /\bday\s*\d+/i.test(input.sourceText)
      ? input.sourceText.replace(/\bday\s*\d+/i, `Day ${dayIndex + 1}`)
      : `${input.sourceText.replace(/[.!?]+\s*$/, '')} on Day ${dayIndex + 1}.`

  const options: ConflictOption[] = [
    ...openDays.map((dayIndex) => ({
      kind: 'move_day' as const,
      dayIndex,
      label: `Move to Day ${dayIndex + 1}`,
      text: rewrite(dayIndex),
    })),
    { kind: 'remove', label: 'Drop this requirement' },
    { kind: 'edit', label: 'Edit it' },
  ]

  return { message, ...(input.consideringId ? { consideringId: input.consideringId } : {}), options }
}

/**
 * A validation error read back in the traveller's own words, where they have any.
 *
 * `must_visit_missing` covers two failures the traveller is owed the difference
 * between: a place the dataset has never heard of, and one it knows but cannot fit.
 */
export function explainValidationError(
  error: ValidationError,
  state: TripState,
  frame: TripFrame,
  catalogue: PlaceCatalogue,
): ConflictDetail {
  const source = state.considering.find((item) => item.id === error.consideringId)
  const tag = source?.tag
  if (source && tag?.kind === 'must_visit' && (error.code === 'must_visit_missing' || error.code === 'must_visit_wrong_day')) {
    if (isUnresolvedPlaceId(tag.placeId)) {
      return {
        message: `I don't have “${namedIn(source.text)}” in my Tokyo data, so I can't put it in the plan.`,
        consideringId: source.id,
        options: [{ kind: 'remove', label: 'Drop this requirement' }, { kind: 'edit', label: 'Edit it' }],
      }
    }
    const place = catalogue.get(tag.placeId)
    const closed =
      tag.dayIndex !== undefined && windowOn(place?.openingHours, weekdayKey(dateOfDay(frame, tag.dayIndex))) === null
    return pinConflict({
      placeId: tag.placeId,
      dayIndex: tag.dayIndex,
      because: closed ? 'closed_that_day' : 'no_room',
      sourceText: source.text,
      consideringId: source.id,
      frame,
      catalogue,
    })
  }
  return { message: error.message, ...(error.consideringId ? { consideringId: error.consideringId } : {}) }
}
