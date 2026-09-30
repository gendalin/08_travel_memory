/**
 * Phrasing a scripted request against the plan it is being asked about.
 *
 * `demo_scenario.json` binds its closed-restaurant event both to a place and to
 * a day: "The ramen place on Day 2 is closed today." The day is a property of
 * the ITINERARY, not of the event — and the two conditions do not put that stop
 * on the same day, because deciding where things go is exactly what they differ
 * about. Asking both about Day 2 would score one of them on where its planner
 * happened to land, which is not what §15.2 removes.
 *
 * So the rule, and it is deliberately narrow:
 *
 *   - only a request the scenario BOUND TO A PLACE is touched at all
 *   - only its day reference changes, to the day that plan holds a stop of the
 *     bound place's kind
 *   - if the plan holds no such stop, the text is left exactly as authored, and
 *     the condition is free to report that it cannot resolve the request
 *
 * That last clause is what keeps this from sliding into rewriting requests until
 * they succeed. Every rewrite is recorded and exported, so a reader can see what
 * each condition was actually asked.
 */

import { allItems, type Plan } from '../domain/plan/types.ts'
import type { PlaceCatalogue } from '../services/places/types.ts'

export interface ScenarioRequest {
  /** Verbatim from demo_scenario.json. */
  text: string
  /** The place the event is about, when the scenario names one. */
  placeId?: string
}

const DAY_REFERENCE = /\bday\s*\d+\b/i

export interface PhrasedRequest {
  text: string
  /** The authored text, when it had to be reconciled with this plan. */
  rephrasedFrom?: string
}

export function phraseForPlan(
  request: ScenarioRequest,
  plan: Plan,
  catalogue: PlaceCatalogue,
): PhrasedRequest {
  if (!request.placeId || !DAY_REFERENCE.test(request.text)) return { text: request.text }

  const category = catalogue.get(request.placeId)?.category
  if (!category) return { text: request.text }

  // The message says "the ramen place", not a name, so the stop it refers to is
  // whichever stop of that kind the plan has.
  const target = allItems(plan).find((item) => catalogue.get(item.placeId)?.category === category)
  if (!target) return { text: request.text }

  const text = request.text.replace(DAY_REFERENCE, `Day ${target.dayIndex + 1}`)
  return text === request.text ? { text } : { text, rephrasedFrom: request.text }
}
