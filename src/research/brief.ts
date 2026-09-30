/**
 * The one brief both conditions are run against (product_spec §15.1: "using the
 * same Tokyo scenario").
 *
 * Also the neutral yardstick the metrics are measured with, which is the part
 * that has to be right for the comparison to mean anything.
 *
 * The constraints a plan is judged against are read from the brief's own text
 * by the product's tagger, ONCE, before either condition runs. They are not read
 * out of the full condition's State. If they were, the comparison would reduce
 * to "the full condition satisfies its own model", which is true by
 * construction and worth nothing. Read this way, the baseline is not marked down
 * for a parse it never performed — it is marked down for not honouring
 * something the traveller actually said.
 */

import { tagAll } from '../application/decompose/tagConsidering.ts'
import type { ConsideringItem, ConsideringTag } from '../domain/state/types.ts'
import type { PlaceCatalogue } from '../services/places/types.ts'
import type { ScenarioRequest } from './requests.ts'

export interface ResearchBrief {
  name: string
  /** YYYY-MM-DD */
  startDate: string
  /** YYYY-MM-DD */
  endDate: string
  baseLodgingPlaceId: string
  baseLodgingName: string
  /** "What kind of trip do you want?" */
  intentText: string
  /** "Anything the plan should consider?" — one clause per sentence. */
  consideringText: string
  /** Memories the participant confirmed in Profile before the trip was created. */
  activeMemoryIds: readonly string[]
  /** The scripted mid-trip requests, in order, as the scenario authored them. */
  requests: readonly ScenarioRequest[]
}

/** What the traveller asked for, structured — the yardstick, not either condition's State. */
export interface BriefConstraints {
  items: ConsideringItem[]
  mustVisitPlaceIds: string[]
  budgetLevel?: 'low' | 'moderate' | 'high'
  avoid: string[]
}

/** Splits Considering text the way the product's own decomposition would. */
export function consideringClauses(text: string): string[] {
  return text
    .split(/[.;\n]|,\s*(?=[a-z])/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 2)
    .map((clause) => clause.charAt(0).toUpperCase() + clause.slice(1))
}

export function readConstraints(
  brief: ResearchBrief,
  catalogue: PlaceCatalogue,
): BriefConstraints {
  const untagged: ConsideringItem[] = consideringClauses(brief.consideringText).map(
    (text, index) => ({ id: `cons_${index + 1}`, text }),
  )
  const items = tagAll(untagged, catalogue)

  const tags = items
    .map((item) => item.tag)
    .filter((tag): tag is ConsideringTag => tag !== undefined)

  const budget = tags.find((tag) => tag.kind === 'budget')

  return {
    items,
    mustVisitPlaceIds: tags
      .filter((tag): tag is Extract<ConsideringTag, { kind: 'must_visit' }> => tag.kind === 'must_visit')
      .map((tag) => tag.placeId)
      // A must-visit the dataset cannot satisfy is a Conflict, not a miss, so it
      // is not part of the yardstick either condition is scored against.
      .filter((placeId) => catalogue.has(placeId)),
    ...(budget?.kind === 'budget' ? { budgetLevel: budget.level } : {}),
    avoid: tags
      .filter((tag): tag is Extract<ConsideringTag, { kind: 'avoid' }> => tag.kind === 'avoid')
      .map((tag) => tag.value),
  }
}
