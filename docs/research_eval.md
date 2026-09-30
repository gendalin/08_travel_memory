# Research & Evaluation

Derived from [`product_spec.md`](./product_spec.md) §15, §20.

**Research functionality is not part of normal user navigation.** Gate 0 Task 3
requires research-only behaviour to be visibly separated from the product model.
This document is that separation.

---

## Placement

Everything here lives behind:

```text
/dev
/research
```

Nothing in this document may appear in the normal product flow, be linked from
product navigation, or be offered to a user on New Trip.

---

## Conditions

| | Full condition | Baseline condition |
| --- | --- | --- |
| Memory use | yes | **removed** |
| State UI | yes | **removed** |
| Rationale UI | yes | **removed** |
| Proposal / Receipt model | yes | **removed** |
| Chat behaviour | proposal → confirm → commit | conventional regeneration |
| LLM | same | same |
| Tokyo places | same | same |
| Route engine | same | same |
| Validation | same | same |

Baseline is a **research flag**, never a user-facing choice.

---

## Logging

Event logging is local and exportable. **Export Log must not appear in normal
product navigation** — it belongs in `/research` or `/dev`.

---

## Survey

The end-of-session survey belongs to research mode only.

---

## What the research is trying to show

From §20, the two product themes:

**Personal Memory** — that `Memory → recommendation → rationale` is visible and
traceable: a recommendation can be traced to an active memory, and that memory
to its provenance and source evidence.

**Human–Agent Collaboration** — that
`user input → proposed change → understandable diff → confirm → commit → receipt`
keeps the user in control: no plan mutates without confirmation, and every
committed change leaves a receipt.

---

## Gate ordering

The research harness is **Gate 7**, after the product is stable. Do not
instrument before the core product works — §0.2 ranks research instrumentation
seventh of eight priorities.

---

## The harness, as built

Gate 7's Definition of Done is that a researcher can run both conditions over
the same Tokyo scenario and export comparable logs.

```bash
npm run research:eval
```

Writes to `research-out/` (git-ignored):

| File | Contents |
| --- | --- |
| `comparison.json` | the whole report: both runs, both plans, every metric |
| `events.jsonl` | one research event per line, both conditions, one clock |
| `itineraries.txt` | the two final itineraries side by side, for reading |

### Where it lives

`src/research/` and `scripts/research/`, and nothing else. The direction of
dependency is one-way and enforced by a test: research imports the product, the
product never imports research. `src/main.tsx` contains no mention of baseline,
so there is no path by which a user could select it (§15.1).

The spec's tree (§13.3) puts dev surfaces under `src/app/dev/`. The baseline
planner is a planning rule, and §13.2 keeps planning rules out of the app layer,
so the harness sits beside `application/` instead of inside `app/`. One
top-level directory also makes the import rule checkable with one test rather
than a convention.

### Fairness rules

These matter more than any number the harness prints. A harness that flatters
the condition it was built to support is worse than no harness.

1. **The baseline is not a straw man.** It gets the same real Tokyo places with
   the same real opening hours, the same slot times and daily category
   structure, and the same validation engine. Its itineraries are valid.
   Within a category it takes the first place the dataset offers — which is not
   a handicap invented for the comparison but exactly what this product did
   before the ranking layer, and what any unranked retrieval does.

2. **The baseline is given the product's own comprehension.** It routes messages
   with the same `routeMessage` and applies the same deterministic transforms.
   Otherwise the comparison would measure parsing, which is not what §15.2
   removes.

3. **Time-phase locking is not removed.** §4.3 locking comes from the trip frame
   and the clock, not from State, so baseline keeps it.

4. **The yardstick is neutral.** What the plans are judged against — must-visit,
   budget, avoid — is read from the brief's own text by the product's tagger,
   once, before either condition runs. It is never read out of the full
   condition's State; that would reduce the comparison to "the full condition
   satisfies its own model", which is true by construction and worth nothing.

5. **A place-bound request is phrased against the plan under test.**
   `demo_scenario.json`'s closed-restaurant event names both a place and a day,
   but the day is a property of the itinerary, and the two conditions do not put
   that stop on the same day — deciding where things go is what they differ
   about. So only the day reference is reconciled, only for a request the
   scenario bound to a place, and only when the plan actually holds a stop of
   that kind. When it does not, the text stays exactly as authored and the
   condition is free to report that it cannot resolve it. Every rewrite is
   exported. Without that last clause the rule would slide into rewording
   requests until something works, which measures the harness, not the product.

6. **Every number is measured, not stipulated.** Distances come from
   `computeExpectedImpact`, the same arithmetic the product shows a user. Blast
   radius comes from `diffPlans`. The baseline's zeros are consequences of what
   was removed, computed the same way the full condition's numbers are.

7. **Reproducible.** Stub LLM, fixed clock, one clock for both runs. A change in
   the numbers is a change in behaviour.

### Still outstanding for Gate 7

The harness covers full vs baseline, the event log and export. Gate 7 also lists
a `/research` UI surface, the end-of-session survey (§15.4), a demo clock and a
prompt-logging toggle. The clock is already injected everywhere the harness
needs it, so the demo clock is a surface, not a rework.
