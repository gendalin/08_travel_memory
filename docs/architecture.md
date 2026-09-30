# Architecture

Derived from [`product_spec.md`](./product_spec.md) §13. This document is the
working reference; the spec is normative.

---

## Layering

```text
UI
↓
Application / Use Cases
↓
Domain
↓
Services / Adapters
↓
External APIs / Persistence
```

**Planning rules never live in React components.** The domain layer has no
imports from `ui/`, `services/`, or any framework.

### Dependency rule

| Layer | May import from |
| --- | --- |
| `domain/` | `domain/` only — no UI, no services, no LLM, no I/O |
| `application/` | `domain/`, service *interfaces* |
| `services/` | service interfaces, external SDKs |
| `ui/` | `application/`, `domain/` types |

The domain layer is pure and synchronous. This is what makes Gate 2 testable
with no UI and no LLM.

---

## Stack

- React + TypeScript + Vite, mobile-web SPA
- Node local/API server
- OpenAI API with structured outputs
- IndexedDB for local app persistence
- Google Maps / Places / Routes **behind adapters**
- Vitest for domain tests, Playwright for E2E

**No API key reaches the browser.** Keys live in `.env`, are read server-side
only (see [`../scripts/preprocess/env.ts`](../scripts/preprocess/env.ts) for the
preprocessing equivalent).

---

## Domain modules

| Module | Owns |
| --- | --- |
| `domain/trip` | `TripFrame`, `Trip`, time phase (pre/in/post-trip), locking |
| `domain/state` | Intent, Considering, Priorities, `TripState`, state diff |
| `domain/plan` | `Plan`, `PlanDay`, `PlanItem`, plan diff, reschedule transforms |
| `domain/memory` | Memory status, provenance, immutable trip snapshot |
| `domain/proposals` | Change classifier, Expected Impact, proposal lifecycle, atomic commit |
| `domain/receipts` | Decision Receipt construction |
| `domain/validation` | Validation engine (§8) |
| `domain/ranking` | Scoring (Gate 3+, not built yet) |

---

## The central transaction

```text
Trigger
→ Candidate State / Plan
→ Validate
→ Diff
→ Classify
→ Preview
→ Confirm
→ Atomic commit
→ Receipt
```

Two invariants hold this together:

1. **Classification is computed from the diff, never asserted by the LLM.**
   `classifyChange()` is a pure function of `(stateDiff, planDiff)`.
2. **State and Plan commit atomically or not at all.** One committed
   transaction produces exactly one Receipt.

---

## Deterministic before LLM

Code — not the model — owns: diffing, classification, validation, Expected
Impact, versioning, locking, and proposal lifecycle. The LLM proposes candidate
content and writes prose. It never decides transaction type, never invents POI
ids, and never produces numeric route or cost facts.

---

## Where places come from

A trip is planned against a **frozen set of places**, and which set depends on the
run.

```text
Generate itinerary
↓
Memory snapshot + Considering  →  retrieval profile   (what a day needs, how far out)
↓
profile + the traveller's words →  search wording      (the model writes it; code has a fallback)
↓
Places API                      →  quality gate        (hours, coordinates, category, reach)
↓
catalogue snapshot frozen onto the trip
```

Frozen is the point: after creation, generation, Replace, Alternatives and Expected
Impact all read one unchanging set, make no network call, and give the same answer
tomorrow as today. A Receipt records the snapshot version it was decided against.

Retrieval is the app's only outward call at Generate, and it is **optional by
construction**. The store takes `retrieval` in its deps; absent, the trip is planned
from the bundled set — which is what the scripted demo, the static review build and
every E2E run do. A live run that cannot retrieve (no lodging match, no search
service, or too little to furnish a day) falls back to the same bundled set and
**says so on screen**.

Running out is a state, not a bug: `widenTripCatalogue` adds a new snapshot version
at the traveller's explicit request. Nothing widens the set silently.

---

## Persistence

The domain declares repository *interfaces* only. `inMemory.ts` is what the tests run
on. `localStore.ts` is what the app runs on: it wraps the in-memory store and flushes
the whole thing to `localStorage` as **one value**, so a committed transaction reaches
storage together or not at all. A browser that refuses to store anything keeps
working and says it is not saving.

---

## Scope boundary

The product reads `data/demo_tokyo_v1/` as its seed set, plus the Places API at trip
creation on a live run. It never reads `source_inputs/`. See
[`preprocessing_spec.md`](./preprocessing_spec.md).
