/**
 * Browser entry.
 *
 * `?stub=1` swaps in the deterministic LLM so the E2E run is reproducible and
 * costs nothing. Everything else — application layer, domain, persistence — is
 * identical to a real run.
 *
 * `?reset=1` throws away what was kept before anything reads it. Two jobs: it is the
 * recovery hatch for a stored trip the app cannot load, and it is how the E2E suite
 * starts each test from a first run now that a trip survives a reload. It happens
 * here, before render, because by the time a component could ask, the store has
 * already restored.
 *
 * The stub flag also decides whether Generate RETRIEVES. A stubbed run plans from the
 * bundled thirty-four places: no lodging lookup, no Places calls, nothing billed, and
 * the same itinerary every time — which is what the E2E suite and the static review
 * build need. A real run searches Places for this traveller and freezes what it finds
 * onto the trip. One flag for both, because they are the same question: is this run
 * talking to the outside world?
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app/App.tsx'
import { PROTOTYPE_CATALOGUE } from './demo/prototypeCatalogue.ts'
import type { RetrievalDeps } from './app/store.ts'
import { clearPersisted } from './services/persistence/localStore.ts'
import { createPlaceCatalogue } from './services/places/catalogue.ts'
import { createHttpLodgingLocator } from './services/places/lodging.ts'
import { createHttpPlacesSearcher } from './services/places/httpSearcher.ts'
import { createHttpLlm } from './services/llm/httpLlm.ts'
import { createStubLlm } from './services/llm/stubLlm.ts'
import { installGradientCursor } from './ui/chrome/gradientCursor.ts'
import { createHttpEventFinder } from './services/events/httpEvents.ts'
import { createRecordedEventFinder, type EventRecording } from './services/events/recordedEvents.ts'
import baseballRecording from '../data/demo_events/tokyo_baseball.json'
import type { DemoPlace } from './services/places/types.ts'
import type { BundledEvidence, BundledMemory } from './application/manageMemory/manageMemory.ts'
import places from '../data/demo_tokyo_v1/tokyo_places.json'
import memories from '../data/demo_tokyo_v1/memories.json'
import evidence from '../data/demo_tokyo_v1/evidence.json'
import './styles/app.css'

/**
 * The stub also covers the static review build, which has no server to hold
 * the API key and so must not call one. Vite replaces the flag at build time;
 * it is absent (and so falsy) in the normal dev and production builds.
 */
declare const __STUB_ONLY__: boolean | undefined

const params = new URLSearchParams(window.location.search)

const useStub =
  params.has('stub') || (typeof __STUB_ONLY__ !== 'undefined' && __STUB_ONLY__ === true)

if (params.has('reset')) clearPersisted()

// The review build shows a Figma-style gradient cursor; the app keeps the system one.
if (typeof __STUB_ONLY__ !== 'undefined' && __STUB_ONLY__ === true) installGradientCursor()

const retrieval: RetrievalDeps | undefined = useStub
  ? undefined
  : { locator: createHttpLodgingLocator(), searcher: createHttpPlacesSearcher() }

/**
 * What the run plans from.
 *
 * The prototype carries a real retrieval, frozen and photographed, so the file a
 * reviewer opens shows the trip the product actually produces. Every other build uses
 * the bundled set: it is what the tests, the scripted scenario and the research
 * harness are all written against.
 */
const catalogue = PROTOTYPE_CATALOGUE ?? (places as DemoPlace[])

const deps = {
  catalogue: createPlaceCatalogue(catalogue),
  llm: useStub ? createStubLlm({ replacementPlaceId: 'ramen_afuri' }) : createHttpLlm(),
  ...(retrieval ? { retrieval } : {}),
  bundledMemories: memories as BundledMemory[],
  // Live search needs the server's keys; a stubbed run — the prototype, the E2E
  // suite — carries a dated recording of a real search instead (§7.8).
  events: useStub
    ? createRecordedEventFinder([baseballRecording as EventRecording])
    : createHttpEventFinder(),
  // Only what a memory's examples need is handed on. The JSON import itself still
  // puts the whole file in the bundle.
  bundledEvidence: (evidence as Array<BundledEvidence & Record<string, unknown>>).map(
    ({ id, kind, placeName }) => ({ id, kind, ...(placeName ? { placeName } : {}) }),
  ),
  now: () => new Date(),
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App deps={deps} />
  </StrictMode>,
)
