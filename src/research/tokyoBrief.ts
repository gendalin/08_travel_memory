/**
 * The Tokyo brief both conditions are run against (§15.1: "the same Tokyo
 * scenario").
 *
 * The mid-trip requests are read from `demo_scenario.json` rather than written
 * here, so the harness exercises the same scripted events the product demo does.
 *
 * The Considering text is authored, and chosen to be representative rather than
 * convenient: one budget level, one must-visit, one thing to avoid. Each is an
 * ordinary thing a traveller says, and each is something the full condition
 * turns into a structured constraint while the baseline can only hold as prose.
 * That asymmetry is the finding under test — it is not a trick, but it is worth
 * stating plainly, because a brief with no constraints in it would show nothing
 * either way.
 */

import type { BundledMemory } from '../application/manageMemory/manageMemory.ts'
import type { ResearchBrief } from './brief.ts'

export interface DemoScenario {
  trip: { name: string; days: number; baseLodging: string }
  events: Array<{ id: string; day: number; text: string; placeId?: string }>
}

/**
 * Memories the participant confirmed in Profile before the trip: the strongest
 * category preference, plus both measured patterns.
 *
 * Selected by facet rather than by id. Ids shift when the derivation changes —
 * mem_006 and mem_007 swapped when the spatial pattern started being emitted for
 * any span — and a brief pinned to a stale id would quietly test the wrong thing.
 */
function confirmedMemoryIds(memories: BundledMemory[]): string[] {
  const byFacet = (facet: string) =>
    memories.find((memory) => memory.subject.facet === facet)?.id

  const strongestPreference = memories
    .filter((memory) => memory.kind === 'preference')
    .sort((a, b) => b.strength - a.strength)[0]?.id

  return [strongestPreference, byFacet('stops_per_day'), byFacet('day_span_metres')].filter(
    (id): id is string => id !== undefined,
  )
}

export function tokyoBrief(
  scenario: DemoScenario,
  baseLodgingPlaceId: string,
  memories: BundledMemory[],
): ResearchBrief {
  return {
    name: scenario.trip.name,
    startDate: '2026-10-05',
    endDate: '2026-10-09',
    baseLodgingPlaceId,
    baseLodgingName: scenario.trip.baseLodging,
    intentText: 'Slow-paced. Time in local neighbourhoods.',
    consideringText: 'Moderate budget. We must visit Hamarikyu Gardens. Avoid queues.',
    activeMemoryIds: confirmedMemoryIds(memories),
    requests: scenario.events.map((event) => ({
      text: event.text,
      ...(event.placeId ? { placeId: event.placeId } : {}),
    })),
  }
}
