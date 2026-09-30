/**
 * "Why this day?" (product_spec §5.5, UI draft 08).
 *
 * Assembled from facts the system already holds — opening hours, the day's own
 * shape, the State lines the stops cite, the trip's Memory snapshot — and from
 * nothing else. No model writes this.
 *
 * That constraint is the point: an explanation a user can check is worth
 * something, and a fluent one they cannot is worth less than silence. Where
 * there is no reason to give, the section is simply absent.
 */

import { overBudget } from '../../domain/places/facets.ts'
import { dateOfDay } from '../../domain/trip/phase.ts'
import type { TripFrame } from '../../domain/trip/types.ts'
import { durationMinutes, type Plan, type PlanDay } from '../../domain/plan/types.ts'
import type { MemorySnapshot } from '../../domain/memory/types.ts'
import { provenanceLabel } from '../../domain/memory/types.ts'
import type { TripState } from '../../domain/state/types.ts'
import type { PlaceCatalogue } from '../../services/places/types.ts'
import { budgetOf } from '../planning/tripContext.ts'

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export interface DayExplanation {
  dayIndex: number
  /** "Tuesday, 6 October" */
  dateLabel: string
  /** How the day is put together. Always present. */
  shape: string
  /** Opening-hours facts that tie a stop to this day. Often empty. */
  whyToday: string[]
  /** What the plan was working from, labelled. */
  considerations: Array<{ label: string; value: string }>
  /** Memories the day's stops cite, resolved from the trip snapshot. */
  memories: Array<{ id: string; text: string; provenance: string }>
}

function weekdayOf(frame: TripFrame, dayIndex: number): number {
  return dateOfDay(frame, dayIndex).getDay()
}

function closedOn(hours: Record<string, string> | undefined, weekday: number): boolean {
  if (!hours) return false
  const value = hours[WEEKDAY_KEYS[weekday]]
  return !value || value === 'closed'
}

/** Trip days, 1-based, on which a place would be shut. */
function shutDays(
  frame: TripFrame,
  plan: Plan,
  hours: Record<string, string> | undefined,
): number[] {
  return plan.days
    .filter((day) => closedOn(hours, weekdayOf(frame, day.dayIndex)))
    .map((day) => day.dayIndex + 1)
}

/** "It is" / "They are" / "2 of them are" — the subject of the reason sentence. */
function describeSubset(some: number, total: number): string {
  if (some === total) return some === 1 ? 'It is' : 'They are'
  return `${some} of them ${some === 1 ? 'is' : 'are'}`
}

function listPhrase(values: string[]): string {
  if (values.length <= 1) return values[0] ?? ''
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`
}

function shapeOf(day: PlanDay, catalogue: PlaceCatalogue): string {
  if (day.items.length === 0) return 'Nothing is scheduled on this day yet.'

  const ordered = [...day.items].sort((a, b) => a.startTime.localeCompare(b.startTime))
  const areas = [
    ...new Set(
      ordered
        .map((item) => catalogue.get(item.placeId)?.neighborhood)
        .filter((area): area is string => Boolean(area)),
    ),
  ]
  const committed = ordered.reduce((total, item) => total + durationMinutes(item), 0)
  const hours = Math.round((committed / 60) * 10) / 10

  const count = `${ordered.length} stop${ordered.length === 1 ? '' : 's'}`
  const window = `${ordered[0].startTime} to ${ordered[ordered.length - 1].endTime}`
  const where = areas.length === 1 ? `all in ${areas[0]}` : `across ${listPhrase(areas)}`

  return `${count}, ${where}, ${window} — about ${hours} hours booked.`
}

export function explainDay(input: {
  frame: TripFrame
  plan: Plan
  state: TripState
  dayIndex: number
  catalogue: PlaceCatalogue
  memorySnapshot?: MemorySnapshot
}): DayExplanation {
  const day =
    input.plan.days.find((entry) => entry.dayIndex === input.dayIndex) ?? input.plan.days[0]
  const date = dateOfDay(input.frame, day.dayIndex)

  // --- why this stop sits on this day, per opening hours --------------------
  const whyToday: string[] = []
  for (const item of day.items) {
    const place = input.catalogue.get(item.placeId)
    if (!place) continue

    const shut = shutDays(input.frame, input.plan, place.openingHours)
    if (shut.length === 0) continue

    const open = input.plan.days.length - shut.length
    whyToday.push(
      open === 1
        ? `${place.name} is open on only one day of this trip, and this is it.`
        : `${place.name} is closed on Day ${listPhrase(shut.map(String))} of this trip.`,
    )
  }

  // --- what the day was planned from ----------------------------------------
  const considerations: Array<{ label: string; value: string }> = []

  const citedIntentIds = new Set(
    day.items.flatMap((item) => item.rationaleRefs?.stateItemIds ?? []),
  )
  const intent = input.state.intent.filter((line) => citedIntentIds.has(line.id))
  if (intent.length > 0) {
    considerations.push({ label: 'Intent', value: listPhrase(intent.map((line) => line.text)) })
  }

  const committed = day.items.reduce((total, item) => total + durationMinutes(item), 0)
  considerations.push({
    label: 'Pace',
    value: `${day.items.length} stop${day.items.length === 1 ? '' : 's'}, ${Math.round(committed / 6) / 10} hours booked`,
  })

  const budget = budgetOf(input.state)
  if (budget) {
    // The ceiling comes from the shared definition rather than being restated
    // here, so a day cannot be explained against one ceiling and ranked against
    // another.
    const dear = day.items.filter((item) => {
      const place = input.catalogue.get(item.placeId)
      return place !== undefined && overBudget(place, budget.level)
    })

    // Which of them a memory put there. §0.2 puts what the traveller stated above
    // what was inferred about them, so when the inferred side wins anyway the day
    // says so plainly instead of reporting a number and leaving them to wonder.
    const viaMemory = dear.filter((item) => (item.rationaleRefs?.memoryIds.length ?? 0) > 0)

    considerations.push({
      label: 'Cost',
      value:
        dear.length === 0
          ? `Within the ${budget.level} budget you set.`
          : [
              `${dear.length} stop${dear.length === 1 ? '' : 's'} above the ${budget.level} budget you set.`,
              viaMemory.length > 0 &&
                `${describeSubset(viaMemory.length, dear.length)} there because you keep coming back to ${listPhrase(
                  [
                    ...new Set(
                      viaMemory
                        .map((item) => input.catalogue.get(item.placeId)?.category)
                        .filter((category): category is string => category !== undefined)
                        .map((category) => category.replace(/_/g, ' ')),
                    ),
                  ],
                )}.`,
            ]
              .filter(Boolean)
              .join(' '),
    })
  }

  // --- memories this day leans on -------------------------------------------
  const citedMemoryIds = [
    ...new Set(day.items.flatMap((item) => item.rationaleRefs?.memoryIds ?? [])),
  ]
  const memories = citedMemoryIds
    .map((id) => input.memorySnapshot?.memories.find((memory) => memory.id === id))
    .filter((memory): memory is NonNullable<typeof memory> => memory !== undefined)
    .map((memory) => ({
      id: memory.id,
      text: memory.text,
      provenance: provenanceLabel(memory.provenance.type),
    }))

  return {
    dayIndex: day.dayIndex,
    dateLabel: `${WEEKDAY_NAMES[date.getDay()]}, ${date.getDate()} ${date.toLocaleString('en', { month: 'long' })}`,
    shape: shapeOf(day, input.catalogue),
    whyToday,
    considerations,
    memories,
  }
}
