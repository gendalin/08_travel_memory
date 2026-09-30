# Interest Trends & Category Coverage

How saved places, photos and screenshots turn into interest points, and what
the planner is expected to do with them.

Category vocabulary: [`../scripts/preprocess/taxonomy.ts`](../scripts/preprocess/taxonomy.ts).

---

## Why one shared vocabulary

Photos, screenshots and saved places must resolve to the *same* category ids.
"Mostly izakaya" has to be able to count a screenshot, a saved place and a
photo as the same thing, or the trend cannot be aggregated across sources.

Google Places types are an **input** to classification, not the vocabulary.
They are coarser than this product needs: `sushi_restaurant` and
`ramen_restaurant` exist, but there is no izakaya, kissaten, sentō or
craft/stationery type — precisely the distinctions carrying the personal signal.

---

## Signals, in descending order of trust

| | Signal | Needs | Notes |
| --- | --- | --- | --- |
| 1 | Google Places type | `GOOGLE_MAPS_API_KEY` | Authoritative where a type exists |
| 2 | Vision / OCR | `OPENAI_API_KEY` | Only route for izakaya, sentō, kissaten |
| 3 | Name + note keywords | — | Fallback only; misses most of the signal |

Measured on the 14-place Tokyo list, keyword-only classification resolved 8 and
missed 6 — all of them sushi restaurants whose names contain no category word
(Sawada, Hakkoku, Kizaki, 銀座 稲葉, 多仁本, 西麻布 野口). The strongest trend in
the data was invisible to the fallback. Signals 1 and 2 are not optional.

---

## Trend thresholds

```text
MIN_CATEGORY_SUPPORT = 3    # a category needs 3 evidence items to count
TOP_CATEGORIES       = 5    # at most 5 categories reported as trends
```

`context` categories (street, transit, accommodation) never become interest
points. They describe how a day moved, not what the user likes.

---

## Planner rule — category coverage

> If it does not conflict with the profile, a trending category should be
> scheduled at least once.

A conditional constraint, not a hard one:

- **Default:** try to place at least one item from each trending category.
- **Veto:** drop the attempt when it conflicts with profile or current state —
  pace, walking tolerance, a tired day, weather, opening hours, budget.
- **Never:** force a place in against an active constraint just to satisfy
  coverage, and never report coverage as met when the veto fired.

Coverage is an objective the planner tries to satisfy, and a vetoed category
should be surfaced with its reason rather than silently skipped.

*This rule lives in the product planner, not in preprocessing. Preprocessing
only supplies the trends and their support counts.*

---

## Scope rule

Everything in the saved list belongs to the trip, including places outside the
destination city (`江之浦測候所` is ~80 km from Tokyo). No geographic filtering
is applied; the planner handles such places as day trips.

---

## Privacy constraints

Binding on every classification stage:

- **No face description, no identity inference.** Scenes, settings and object
  categories only.
- No relationships, no sensitive traits.
- A photographed subject is not automatically a stable preference.
- A screenshot indicates interest, never a visit.

---

## Memory rule

Trends produce **candidate** memories only, each carrying every supporting
evidence id in `provenance.sourceRefs`. Confidence is independent of status.
Activation is a product-runtime decision made with the user.
