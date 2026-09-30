# UI / Interaction Spec

Derived from [`product_spec.md`](./product_spec.md) §5, §7, §14 and the UI
drafts in [`../UI/`](../UI/). Built at Gate 6; the design tokens that implement
it are in [`../src/styles/tokens.css`](../src/styles/tokens.css).

---

## Reference hierarchy

Use each reference for what it is strongest at. Do not visually blend them.

| Reference | Use for |
| --- | --- |
| iOS HIG | touch targets, navigation, sheets, back/close, hierarchy, motion restraint |
| Google Maps | map interaction, POI selection, marker hierarchy, map ↔ sheet sync, routes |
| Claude / ChatGPT / Gemini | conversation flow, concise responses, proposal cards |

The uploaded UI drafts in [`../UI/`](../UI/) are the primary interaction reference.

---

## Information architecture (drafts 01, 03, 05)

```text
Index (first run)  ──New Trip──▶  Stage A ──▶ Stage B ──Generate──▶  Trip
                                                                      │
Trip ─┬─ Plan   full-bleed map · caption · Itinerary · composer        │
      └─ State  Intent / Considering / Priorities, inline-editable     │
         reached from the Plan / State segmented control ─────────────┘

Overlays on the trip, never destinations:
  Index drawer (☰)        New Trip · trips · Profile
  Profile sheet           candidate and active Memory
  Chat sheet              conversation · proposals · conflicts · receipts
  Itinerary sheet         day tabs · timeline · Why this day
  POI sheet               detail ⇄ Alternatives, in place
```

One sheet is open at a time. Opening another replaces it.

---

## Deviations from the drafts

The drafts are the interaction reference, and the IA is preserved. Three points
are implemented differently because a product rule requires it — each is a rule
the drafts predate, not a preference.

| Draft | Built as | Why |
| --- | --- | --- |
| Long press on a day tab opens *Why this day*; long press on a POI opens *Alternatives* | Both have a visible button; long press still works as an accelerator | §14.5 and Gate 6 task 7: no critical action may depend on a long press |
| Profile splits memories at confidence 0.8 / 0.6–0.8 | Split by status: noticed vs in use | §10.2: numeric confidence is never displayed |
| Priority as a filled bar | Three discrete stops (low / medium / high) | §3.3: no numeric weight is exposed; a bar reads as a continuous value |
| Expected Impact as "Walking −28%", "Daily stops 3.8 → 2.4" | Counts and durations the domain can derive | §7.5: no false precision |

---

## Core patterns

| Situation | Pattern |
| --- | --- |
| New Trip — Setup | Full-height route from Index, trip details + two free-text inputs (§3.6.2) |
| New Trip — Review | Intent / Considering / Priority review, one primary CTA (§3.6.4) |
| Default Plan | Full-trip map + bottom controls, no day filter |
| POI | Map pin → bottom sheet |
| Alternatives | POI sheet → **in-sheet navigation**, never a stacked sheet |
| Day itinerary | Sheet + timeline + synchronized map |
| Why this day | Day info action → sheet |
| Chat | Bottom composer → expanded chat sheet |
| Replace | Compact Before / After card |
| Reorganize | Diff card + Expected Impact |
| Reframe | State diff → proposed Plan preview |
| State | Inline-editable rows |
| Priority | low / medium / high control |
| Memory candidate | Lightweight review row |
| Receipt | Read-only history detail |

---

## Transaction surfaces

User-facing language never exposes internal transaction names:

| Internal | User sees |
| --- | --- |
| Replace | **Change this place** |
| Reorganize | **Update this afternoon** / **Update Day 3** |
| Reframe | **Change the trip direction** |

Every decision surface has **one** primary CTA (`Confirm changes`) and one
secondary (`Keep current`). Never two equally prominent actions.

---

## Progressive disclosure

Default: title, short reason, key impact.
On demand: detail, rationale refs, receipt history.

Do not show all reasoning at once.

---

## Sheet depth

```text
POI sheet → Alternatives
```

must use content replacement, sheet navigation push, or a full-height
transition. Never `sheet → sheet → modal`.

---

## Accessibility floor

- primary touch targets ≥ ~44×44 CSS px
- visible focus states, sufficient contrast
- no long-press-only critical actions
- explicit loading / pending / error states

---

## Expected Impact display

Never display false precision. A metric with no reliable backing data is
omitted, not estimated. Cost is price-level and warnings only — no day cost
ranges.
