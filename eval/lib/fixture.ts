/**
 * Trips and catalogues for the Golden Scenarios.
 *
 * Reuses the Gate 5 fixture (tests/scenarios/tokyoTrip.ts) rather than building a
 * second one: same dates, same lodging, same stub model. What this adds is the
 * variation the eval spec needs — arbitrary Intent / Considering / Memory, and the
 * retrieved catalogue — without touching product code.
 */

import { readFileSync } from 'node:fs'

import {
  confirmReview,
  defaultPriorities,
  toFrame,
} from '../../src/application/createTrip/createTrip.ts'
import { generateFirstPlan } from '../../src/application/generatePlan/generatePlan.ts'
import { createPlaceCatalogue } from '../../src/services/places/catalogue.ts'
import type { Memory, MemoryKind, MemorySubject } from '../../src/domain/memory/types.ts'
import type { Priority } from '../../src/domain/state/types.ts'
import type { DemoPlace, PlaceCatalogue } from '../../src/services/places/types.ts'
import { NOW, SETUP, pacePattern, places as bundledPlaces } from '../../tests/scenarios/tokyoTrip.ts'

export { NOW, SETUP, pacePattern }
export { bundledPlaces }

/** The 104 places live retrieval froze for the demo brief, plus the bundle's lodging. */
export function retrievedPlaces(): DemoPlace[] {
  const retrieved = JSON.parse(
    readFileSync('data/demo_retrieved_v1/places.json', 'utf8'),
  ) as DemoPlace[]
  const lodging = bundledPlaces.find((place) => place.category === 'accommodation')!
  // Photos are inlined as base64 and irrelevant to every assertion; dropped so traces stay small.
  return [lodging, ...retrieved.map(({ photo: _photo, ...rest }) => rest as DemoPlace)]
}

/** A frozen live-retrieval run (live_discovery.ts), plus the bundle's lodging. */
export function livePlaces(path: string): DemoPlace[] {
  const lodging = bundledPlaces.find((place) => place.category === 'accommodation')!
  return [lodging, ...(JSON.parse(readFileSync(path, 'utf8')) as DemoPlace[])]
}

export const catalogues = {
  bundled: () => createPlaceCatalogue(bundledPlaces),
  retrieved: () => createPlaceCatalogue(retrievedPlaces()),
}

/** An eval-authored memory, with provenance pointing at the scenario turn that states it. */
export function evalMemory(input: {
  id: string
  text: string
  kind: MemoryKind
  subject: MemorySubject
  polarity?: 1 | -1
  strength: number
  confidence?: number
  status?: Memory['status']
  sourceRef: string
}): Memory {
  return {
    id: input.id,
    text: input.text,
    status: input.status ?? 'active',
    kind: input.kind,
    subject: input.subject,
    polarity: input.polarity ?? 1,
    strength: input.strength,
    confidence: input.confidence ?? 0.8,
    provenance: {
      type: 'explicit_statement',
      sourceRefs: [input.sourceRef],
      createdAt: NOW.toISOString(),
    },
  }
}

export interface EvalTrip {
  trip: ReturnType<typeof confirmReview>['trip']
  frame: ReturnType<typeof toFrame>
  state: ReturnType<typeof confirmReview>['state']
  plan: ReturnType<typeof generateFirstPlan>['plan']
  generated: ReturnType<typeof generateFirstPlan>
  catalogue: PlaceCatalogue
}

/** A trip built through the product's own create → first-plan path. */
export function buildTrip(input: {
  catalogue: PlaceCatalogue
  intent: string[]
  considering?: string[]
  memories?: Memory[]
  priorities?: Priority[]
  days?: number
}): EvalTrip {
  const frame = toFrame(SETUP)
  const { trip, state } = confirmReview({
    tripId: 'trip_eval',
    frame,
    draft: {
      intent: input.intent.map((text, index) => ({ id: `intent_${index + 1}`, text })),
      considering: (input.considering ?? []).map((text, index) => ({ id: `cons_${index + 1}`, text })),
      priorities: input.priorities ?? defaultPriorities(),
    },
    profileMemories: input.memories ?? [],
    catalogue: input.catalogue,
    createdAt: NOW.toISOString(),
  })

  const generated = generateFirstPlan({
    frame,
    state,
    catalogue: input.catalogue,
    days: input.days ?? 5,
    now: NOW,
    memorySnapshot: trip.memorySnapshot,
  })

  return { trip, frame, state, plan: generated.plan, generated, catalogue: input.catalogue }
}
