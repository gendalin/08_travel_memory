# Gate 0 — Product / Architecture Freeze

Closes Gate 0 of [`product_spec.md`](./product_spec.md) §16.

---

## Confirmed frozen decisions

Per Gate 0 Task 4:

| Decision | Frozen as |
| --- | --- |
| Core Priorities | **Convenience / Cost / Novelty** only. Agent may *propose* more; it may never silently add one. |
| Lodging | **One base lodging per trip.** Every day starts and ends there. |
| Post-trip learning | **None.** No automatic learning from completed-trip traces. |
| Memory snapshot | **Immutable** for the life of the trip. Later Profile changes affect future trips only. |
| Undo | **None.** Receipts provide accountability, not rollback. |
| Plan manipulation | **No direct arbitrary editing.** All change flows through propose → confirm → commit. |

---

## What I should explicitly NOT build

Gate 0's Definition of Done requires this question to be answerable. It is:

### Not in the MVP at all (§1.3)

- user-facing photo import, map-link import, screenshot import UI
- any preprocessing UI
- post-trip learning; learning from completed-trip traces
- multi-user planning, payments, booking, hotel search
- multiple lodging locations in one trip
- itinerary drag-and-drop; arbitrary direct plan editing
- undo / rollback
- whole-trip explanation page — **State is the trip-level rationale**
- comprehensive real-time guarantees, proactive monitoring
- full cost accounting, live reservation inventory
- autonomous plan mutation without user confirmation

### Not yet, by gate order

- **UI of any kind** until Gate 3, and then only the thin vertical slice
- full Profile, research mode, edge cases, visual polish — explicitly deferred past Gate 3
- ranking / scoring (§12.2) — Gate 3+
- research harness — Gate 7

### Never, by architectural rule

- planning rules inside React components
- LLM deciding transaction type, inventing POI ids, or producing numeric route/cost facts
- silently merging State and Memory in either direction
- displaying numeric Memory confidence to users — use provenance labels
- auto-activating an inferred memory
- displaying an invalid itinerary as a proposal
- false precision in Expected Impact

---

## Product vs research separation

Done: research-only behaviour is documented in
[`research_eval.md`](./research_eval.md) and confined to `/dev` and `/research`.
Baseline mode is a flag, not a user choice.

---

## Gate 1 status — recorded

Gate 1 was accepted as complete on the basis that `npm run validate:data` passes
with zero errors, which it does.

Recorded for traceability: `tokyo_places.json` currently holds 0 places against
a target of 80–150, and the three `demo_scenario.json` events are not yet bound
to POIs. Two of Gate 1's listed tests — "every POI has coordinates" and "all
scripted scenario POIs exist" — therefore pass over empty sets. The validator
reports both as warnings.

This does not affect Gate 2, which the spec requires to pass "without UI or LLM
dependency" and which is tested entirely on fixtures. It does block **Gate 3**,
whose vertical slice depends on a real restaurant POI with viable alternatives.

### Gate 1 status — update (Gate 5)

`tokyo_places.json` now holds 34 curated POIs with coordinates, categories and
opening hours, and `evt_closed_restaurant` is bound to `ramen_nakiryu` with four
viable alternatives — so the two tests that once passed over empty sets now pass
over real data. The place count remains below the 80–150 target, which the
validator still reports as a warning.

`evt_rain` and `evt_tired` carry no `placeId` by design: they reshape a day
rather than swap a place. The validator no longer counts them as unbound.
