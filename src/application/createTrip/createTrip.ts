/**
 * New Trip: Stage A input -> Stage B review -> State v1 (product_spec §3.5).
 *
 * Application layer. Components call these; they never call the domain directly.
 *
 * No Decision Receipt is created — trip creation is not a change transaction.
 */

import { createMemorySnapshot } from '../../domain/memory/snapshot.ts'
import type { CatalogueSnapshot } from '../../domain/places/catalogueSnapshot.ts'
import type { Memory } from '../../domain/memory/types.ts'
import {
  CORE_PRIORITIES,
  DEFAULT_PRIORITY_WEIGHT,
  type ConsideringItem,
  type IntentItem,
  type Priority,
  type TripState,
} from '../../domain/state/types.ts'
import type { Trip, TripFrame } from '../../domain/trip/types.ts'
import type { DecomposedState, LlmService } from '../../services/llm/types.ts'
import type { PlaceCatalogue } from '../../services/places/types.ts'
import { tagAll } from '../decompose/tagConsidering.ts'

export interface StageAInput {
  name: string
  startDate: string
  endDate: string
  baseLodgingPlaceId: string
  baseLodgingName: string
  /** "What kind of trip do you want?" */
  intentText: string
  /** "Anything the plan should consider?" */
  consideringText: string
}

/** Stage B working draft, before the user confirms. */
export interface ReviewDraft {
  intent: IntentItem[]
  considering: ConsideringItem[]
  priorities: Priority[]
  proposedPriority?: { name: string; reason: string }
}

export const DESTINATION = 'Tokyo'

export function tripDays(startDate: string, endDate: string): number {
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = endDate.split('-').map(Number)
  const start = Date.UTC(sy, sm - 1, sd)
  const end = Date.UTC(ey, em - 1, ed)
  return Math.round((end - start) / 86_400_000) + 1
}

export function toFrame(input: StageAInput): TripFrame {
  return {
    name: input.name,
    destination: DESTINATION,
    startDate: input.startDate,
    endDate: input.endDate,
    baseLodging: { placeId: input.baseLodgingPlaceId, name: input.baseLodgingName },
  }
}

/** Core priorities, every trip, at the default weight (§3.3). */
export function defaultPriorities(): Priority[] {
  return CORE_PRIORITIES.map((name) => ({
    id: `prio_${name}`,
    name,
    weight: DEFAULT_PRIORITY_WEIGHT,
  }))
}

/** Stage A -> Stage B. The LLM decomposes free text; it decides nothing else. */
export async function buildReviewDraft(
  input: StageAInput,
  llm: LlmService,
): Promise<ReviewDraft> {
  const decomposed: DecomposedState = await llm.decomposeTripState({
    intentText: input.intentText,
    consideringText: input.consideringText,
    destination: DESTINATION,
    days: tripDays(input.startDate, input.endDate),
  })

  return {
    intent: decomposed.intent.map((text, index) => ({ id: `intent_${index + 1}`, text })),
    considering: decomposed.considering.map((text, index) => ({
      id: `cons_${index + 1}`,
      text,
    })),
    priorities: defaultPriorities(),
    proposedPriority: decomposed.proposedPriority,
  }
}

/**
 * Stage B confirmation -> State v1 + immutable Memory snapshot.
 *
 * An agent-proposed Priority reaches State only through `acceptedPriorityName`,
 * which the UI sets when the user explicitly accepts it (§3.4).
 *
 * Considering items are tagged here, at the single point where free text
 * becomes State, so every structured constraint the validator checks comes from
 * the same deterministic pass — including items the user typed on Stage B.
 */
export function confirmReview(input: {
  tripId: string
  frame: TripFrame
  draft: ReviewDraft
  acceptedPriorityName?: string
  profileMemories: Memory[]
  catalogue: PlaceCatalogue
  /**
   * Places retrieved for this trip, frozen onto it (B4).
   *
   * Absent for a trip planned against a pre-loaded catalogue — the demo bundle, or a
   * fixture — which then has no snapshot and no catalogue version on its Receipts.
   */
  catalogueSnapshot?: CatalogueSnapshot<{ placeId: string }>
  createdAt: string
}): { trip: Trip; state: TripState } {
  const priorities = [...input.draft.priorities]

  if (input.acceptedPriorityName) {
    priorities.push({
      id: `prio_${input.acceptedPriorityName.toLowerCase().replace(/\s+/g, '_')}`,
      name: input.acceptedPriorityName,
      weight: DEFAULT_PRIORITY_WEIGHT,
      proposedByAgent: true,
    })
  }

  const state: TripState = {
    version: 1,
    intent: input.draft.intent,
    considering: tagAll(input.draft.considering, input.catalogue),
    priorities,
  }

  const trip: Trip = {
    id: input.tripId,
    frame: input.frame,
    memorySnapshot: createMemorySnapshot(input.tripId, input.profileMemories, input.createdAt),
    ...(input.catalogueSnapshot ? { catalogueSnapshot: input.catalogueSnapshot } : {}),
    createdAt: input.createdAt,
  }

  return { trip, state }
}

/** Count for the Stage A disclosure: "Using N memories from Profile". */
export function activeMemoryCount(memories: Memory[]): number {
  return memories.filter((memory) => memory.status === 'active').length
}
