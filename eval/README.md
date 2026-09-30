# Core product eval

Implements `the_next_trip_core_eval_spec.md` (suite `core-eval-1.0`). It does not change product code.

```bash
npm run eval:core      # all 10 Golden Scenarios, ~10 s
npm run eval:smoke     # M1 M2 H1 H3 H5 R1
npm run eval:compare   # diff the two latest core reports
```

Each run:

1. Records the build: the git sha, or a content hash of `src/` and `data/demo_tokyo_v1` when there is no git.
2. Runs `validate_demo_data.ts` and the full vitest suite.
3. Runs the scenarios.
4. Writes recommendation traces.
5. Scores Memory quality.
6. Classifies issues as P0/P1/P2.
7. Compares against the latest earlier report.
8. Writes `eval_reports/eval_<YYYYMMDD_HHMM>_<build>.{md,json}`. It never overwrites a report.

Sections 9–11 of the report (fixes, strengthening, next focus) are left as `<!-- … -->` placeholders for the reviewer to fill after reading the results.

| Path | What |
|---|---|
| `golden_scenarios/*.json` | Scenario definitions: setup, input, and the check ids. Record any change in the report. |
| `scenarios/` | Runs each scenario through the product's own use cases (`handleChatMessage`, `proposeStateEdit`, `confirmProposal`, `generateFirstPlan`). |
| `judges/` | Deterministic rubrics. `scenario_judge`: checks → 0/1/2 per dimension. `recommendation_judge`: relevance lexicon plus the recall proxy. `memory_judge`: the §16 rubric. |
| `lib/trace.ts` | Rebuilds a staged recommendation trace from the planner's pure functions. |
| `runners/` | Core, smoke, compare, and the Markdown renderer. |

Notes:

- No live model or Places call is made. R1/R2 plan from `data/demo_retrieved_v1`, the set live retrieval froze around Kuramae.
- The judges are rubric-based, not LLM-based, so runs are reproducible. Their inputs are only structured evidence, so an LLM judge can replace them behind the same §20 output schema.
- `eval_reports/_harness_dev/` holds runs made while the harness itself was being debugged. They are excluded from regression comparison.

## Changes to scenario definitions

Every run lists what changed in "Scenario definition changes" (report §8). The fix round on 2026-09-30 changed four things:

- **M1** stores the spec memory whole: two subjects, `category=bookstore` and `area_character=literary`.
- **M2** stores "quiet, less crowded" as itself: `popularity=landmark`, an aversion.
- **H2** keeps the spec sentence and expects "no change" when nothing is outdoors after the rain starts. A second variant brings rain on during an outdoor stop.
- **R1 `slow_pace`** judges "slow" by movement, not stop count: at most 1 move (a hop over 1 km) and at most 2 walkable areas per day. This is the user's definition.

Several harness bugs were also fixed. Each fix is labelled "harness fix" in the report's change list.
