# The Next Trip — Core Eval Report

Build: src-9deb1bc
Commit: no-git (content hash 9deb1bc)
Date: 2026-09-30T12:34:27.525Z
Eval suite version: core-eval-1.0 (smoke)
Run duration: 8s

## 1. Executive Status

Overall status: **FAIL**

P0: 3
P1: 14
P2: 3

Core summary:
- Memory: M1 7/10, M2 8/10
- Collaboration: H1 9/10, H3 8/10, H5 6/10
- Recommendation: R1 7/10

## 2. Scoreboard

| Scenario | Correctness | Relevance | Explainability | Control | Efficiency | Total | Status |
|---|---:|---:|---:|---:|---:|---:|---|
| M1 Memory influence | 2 | 1 | 1 | 2 | 1 | 7/10 | PASS |
| M2 State override | 2 | 1 | 1 | 2 | 2 | 8/10 | PASS |
| M3 Candidate Memory | – | – | – | – | – | – | not run |
| H1 Replace | 2 | 2 | 2 | 2 | 1 | 9/10 | PASS |
| H2 Reorganize | – | – | – | – | – | – | not run |
| H3 Reframe | 2 | 1 | 2 | 2 | 1 | 8/10 | PASS |
| H4 State edit | – | – | – | – | – | – | not run |
| H5 Conflict | 0 | 2 | 0 | 2 | 2 | 6/10 | FAIL |
| R1 Discovery/ranking | 1 | 1 | 2 | 2 | 1 | 7/10 | PASS |
| R2 Diversity/feasibility | – | – | – | – | – | – | not run |

## 3. Functional Test Status

Tests passed: 674
Tests failed: 0
Blocked tests: 0
Data validation: ok (0 errors; warnings: !   nightcap: only 3 could fill it, needs 5 — short 2 even before competing with other roles)

| Category (spec §19) | Passed | Failed |
|---|---:|---:|
| proposal lifecycle tests | 12 | 0 |
| State / Plan consistency tests | 40 | 0 |
| Receipt tests | 16 | 0 |
| Memory snapshot tests | 34 | 0 |
| candidate Memory tests | 109 | 0 |
| constraint tests | 68 | 0 |
| locked item tests | 15 | 0 |
| recommendation validation tests | 227 | 0 |
| schema validation tests | 46 | 0 |
| domain tests | 269 | 0 |

Critical invariant status:
- State / Plan consistency: **PASS** — versions + pending proposals never mutate active State/Plan
- atomic Reframe: **PASS** — H3 commit + failure injection; H4 invariant probe (State edit → single swap)
- one Receipt per commit: **PASS** — receipt count after confirm = 1, after reject = 0
- Memory snapshot immutability: **NOT_RUN** — deep-frozen snapshot; snapshot tests 34 passed
- constraint violation: **FAIL** — H5 day-bound must-visit; planner validation on R1/R2
- locked item protection: **PASS** — deterministic locked-item tests: 15 passed, 0 failed (no Golden Scenario runs in-trip)
- Candidate Registry enforcement: **PASS** — hallucinated id refused; every planned id resolves

## 4. Memory Evaluation

Active memories evaluated: 2
Candidate memories evaluated: 8

| Memory | Accuracy | Specificity | Stability | Provenance | Actionability | Total | Issue |
|---|---:|---:|---:|---:|---:|---:|---|
| mem_001 — Repeatedly drawn to sushi — 18 items (9 saved screenshots, 5 | 2 | 2 | 2 | 2 | 2 | 10/10 | — |
| mem_002 — Repeatedly drawn to izakaya — 10 items (7 saved screenshots, | 2 | 2 | 2 | 2 | 2 | 10/10 | — |
| mem_003 — Repeatedly drawn to market / grocery — 6 items (3 photos, 3  | 1 | 2 | 2 | 2 | 1 | 8/10 | confidence 0.53 on 6 refs; no role at the evaluated pace admits this category — cannot claim a slot |
| mem_004 — Repeatedly drawn to discount / variety store — 3 items (2 ph | 1 | 2 | 2 | 2 | 1 | 8/10 | confidence 0.52 on 3 refs; no role at the evaluated pace admits this category — cannot claim a slot |
| mem_005 — Repeatedly drawn to ramen — 3 items (3 photos) | 1 | 2 | 2 | 2 | 2 | 9/10 | confidence 0.51 on 3 refs |
| mem_006 — Ranges across the city within a day — median 5.6 km between  | 1 | 2 | 1 | 2 | 2 | 8/10 | confidence 0.38 on 26 refs; cross-trip stability uncertain (low-confidence behaviour) |
| mem_007 — Moves at an unhurried pace — around 3 distinct stops on a ty | 1 | 2 | 2 | 2 | 2 | 9/10 | active in every H-scenario fixture (3 stops/day); confidence 0.53 on 3 refs |
| mem_eval_m1_bookstores — Prefers independent bookstores and literary neighborhoods. | 2 | 2 | 2 | 2 | 1 | 9/10 | "literary neighborhoods" half dropped — only category=bookstore stored; no role at the evaluated pace admits this category — cannot claim a slot |
| mem_eval_m2_quiet — Prefers quiet, less crowded places. | 1 | 1 | 1 | 2 | 0 | 5/10 | No MemorySubject facet can express it (no crowd/quiet or neighbourhood facet); the planner cannot read it |
| (none created) — M3: "I never enjoy crowded tourist spots." → no candidate Me | 1 | 1 | 1 | 0 | 0 | 3/10 | chat path never creates Memory candidates; No MemorySubject facet can express it (no crowd/quiet or neighbourhood facet); the planner cannot read it |

Memory influence comparison (M1, same State, Memory on vs off):

```json
{
  "memoryInfluence": {
    "movedUp": 5,
    "movedDown": 73,
    "finalSelectionsChanged": 10,
    "memoryScoreContribution": "memoryMatch = 0.8 for bookstores (weight 1.5 of Σ≈7.25 → ≈ +0.17 total); 0 elsewhere",
    "bookstoreRanks": [
      {
        "name": "Okuramae Shobō",
        "withMemory": 1,
        "without": 14
      },
      {
        "name": "Tōmei Bookstore",
        "withMemory": 2,
        "without": 39
      },
      {
        "name": "Kamifuku Books",
        "withMemory": 3,
        "without": 26
      },
      {
        "name": "Infinity Books Japan",
        "withMemory": 4,
        "without": 70
      },
      {
        "name": "Kumazawa Book Store",
        "withMemory": 5,
        "without": 78
      }
    ]
  },
  "finalWithMemory": [
    "D1 main_destination: Kuramae Park [park_garden]",
    "D1 lunch: snaq.me stand Kuramae [cafe_kissaten]",
    "D1 extension_2: Okuramae Shobō [bookstore]",
    "D1 dinner: 鶏焼肉専門店 とり鮮 [yakiniku_grill]",
    "D1 nightcap: Bar Boushu 蔵前 & Hotel Villa Kuramae（バー ボウシュ & ホテル ヴィラ クラマエ) Whisky & Wine & Cocktail [bar_cocktail]",
    "D2 main_destination: Tokyo Origami Museum [museum_gallery]",
    "D2 lunch: Sunaba [soba_udon]",
    "D2 extension_2: Infinity Books Japan [bookstore]",
    "D2 dinner: Gatsun [ramen]",
    "D2 nightcap: Soba Udon Monju Asakusa Branch [bar_cocktail]",
    "D3 main_destination: Former Yasuda Garden [park_garden]",
    "D3 lunch: Icchome Sabou [cafe_kissaten]",
    "D3 extension_2: Kumazawa Book Store [bookstore]",
    "D3 dinner: Ult II House-made Noodles [ramen]",
    "D3 nightcap: Ougiya [izakaya]",
    "D4 main_destination: The Yogodo Hall [temple_shrine]",
    "D4 lunch: Asakusa Udon Main Store [soba_udon]",
    "D4 extension_2: Kamifuku Books [bookstore]",
    "D4 dinner: Kura Sushi Global Flagship Store Asakusa [sushi]",
    "D4 nightcap: Minatsuki [izakaya]",
    "D5 main_destination: SKYTREE GALLERY [museum_gallery]",
    "D5 lunch: Coffee Wrights Kuramae [cafe_kissaten]",
    "D5 extension_2: WESTSIDE COFFEE KURAMAE [grocery_market]",
    "D5 dinner: Okuman [izakaya]",
    "D5 nightcap: Stage [bar_cocktail]"
  ],
  "finalWithoutMemory": [
    "D1 main_destination: Kuramae Park [park_garden]",
    "D1 lunch: snaq.me stand Kuramae [cafe_kissaten]",
    "D1 extension_2: Koshoku [museum_gallery]",
    "D1 dinner: 鶏焼肉専門店 とり鮮 [yakiniku_grill]",
    "D1 nightcap: Bar Boushu 蔵前 & Hotel Villa Kuramae（バー ボウシュ & ホテル ヴィラ クラマエ) Whisky & Wine & Cocktail [bar_cocktail]",
    "D2 main_destination: Tokyo Origami Museum [museum_gallery]",
    "D2 lunch: Sunaba [soba_udon]",
    "D2 extension_2: WESTSIDE COFFEE KURAMAE [grocery_market]",
    "D2 dinner: Gatsun [ramen]",
    "D2 nightcap: Stage [bar_cocktail]",
    "D3 main_destination: Former Yasuda Garden [park_garden]",
    "D3 lunch: Icchome Sabou [cafe_kissaten]",
    "D3 extension_2: Ends Vintage Clothing [fashion_vintage]",
    "D3 dinner: Ult II House-made Noodles [ramen]",
    "D3 nightcap: Minatsuki [izakaya]",
    "D4 main_destination: The Yogodo Hall [temple_shrine]",
    "D4 lunch: Asakusa Udon Main Store [soba_udon]",
    "D4 extension_2: Soba Udon Monju Asakusa Branch [bar_cocktail]",
    "D4 dinner: Ougiya [izakaya]",
    "D4 nightcap: Pub Shamrock Asakusa [bar_cocktail]",
    "D5 main_destination: SKYTREE GALLERY [museum_gallery]",
    "D5 lunch: Coffee Wrights Kuramae [cafe_kissaten]",
    "D5 extension_2: Infinity Books Japan [bookstore]",
    "D5 dinner: Okuman [izakaya]",
    "D5 nightcap: Living Room Asakusa Cocktail Bar [bar_cocktail]"
  ],
  "atOwnPace": {
    "bookstores": 0,
    "changedStops": 0
  }
}
```

## 5. Recommendation Evaluation

Candidate recall proxy: 1 / 2
Top-10 relevance: 1.5 / 2 (final R1 selection: 1.4)
Memory influence: `{"movedUp":5,"movedDown":73,"finalSelectionsChanged":10}`
Constraint violation rate: non-zero (H5)
Diversity: `null`
Route/time feasibility: `null`

Top 10 (R1, neutral context):

| # | Place | Category | Score | stateMatch | Relevance |
|---:|---|---|---:|---:|---:|
| 1 | snaq.me stand Kuramae | cafe_kissaten | 0.613 | 0.7 | 1 |
| 2 | Okuramae Shobō | bookstore | 0.58 | 0.7 | 2 |
| 3 | Kuramae Park | park_garden | 0.576 | 0.7 | 1 |
| 4 | Coffee Wrights Kuramae | cafe_kissaten | 0.573 | 0.7 | 1 |
| 5 | SUNDAE APART | cafe_kissaten | 0.573 | 0.7 | 1 |
| 6 | KURAMAE CANNELE | cafe_kissaten | 0.572 | 0.7 | 1 |
| 7 | Square Cafe | cafe_kissaten | 0.572 | 0.7 | 2 |
| 8 | Kamifuku Books | bookstore | 0.553 | 0.7 | 2 |
| 9 | Tōmei Bookstore | bookstore | 0.545 | 0.7 | 2 |
| 10 | Kissa Hangetsu | cafe_kissaten | 0.538 | 0.7 | 2 |

Selected POIs audited:
1. **Kuramae Park** (Day 1 main_destination, neutral rank 3) — For “small independent cultural places”: its description mentions “small”. A 1-minute walk from Kuramae. Chosen over The Yogodo Hall, which is farther from Kuramae. Beat The Yogodo Hall (0.466), which lost most on convenience.
2. **snaq.me stand Kuramae** (Day 1 lunch, neutral rank 1) — For “kissaten”: it is a cafe or kissaten. A 2-minute walk from Kuramae Park. Chosen over SUNDAE APART, which is pricier. Beat SUNDAE APART (0.569), which lost most on cost.
3. **Okuramae Shobō** (Day 1 extension_2, neutral rank 2) — For “old bookstores”: its description mentions “bookstore”. A 2-minute walk from Kuramae Park. Chosen over Square Cafe, which is better known. Beat Square Cafe (0.57), which lost most on novelty.

Rejected POIs audited:
1. **SUNDAE APART** [cafe_kissaten] (neutral rank 5, score 0.573) — RANKING: runner-up for Day 1 lunch, lost to snaq.me stand Kuramae on cost (0.569 vs winner)
2. **Kamifuku Books** [bookstore] (neutral rank 8, score 0.553) — RANKING: runner-up for Day 4 extension_2, lost to Ryōgoku Edo NOREN on convenience (0.488 vs winner)
3. **Tōmei Bookstore** [bookstore] (neutral rank 9, score 0.545) — RANKING/CONTEXT: eligible for extension_2 but never in a slot's top 6 once day geography, hours and used places applied

Failure category counts:
- DISCOVERY_FAILURE: 3
- RANKING_FAILURE: 5
- FILTER_FAILURE: 1
- DIVERSITY_FAILURE: 0
- ROUTE_FAILURE: 1
- EVIDENCE_FAILURE: 4
- (other: CONSTRAINT_FAILURE 4, CLASSIFICATION_FAILURE 1, MEMORY_FAILURE 1)

Traces: artifacts/recommendation_runs/20260930_2034_src-9deb1bc_R1

## 6. Human–Agent Collaboration Evaluation

Replace: 9/10 PASS — failed: route_cost
Reorganize: not run
Reframe: 8/10 PASS — failed: removes_least_valuable, scope_asked
Direct State edit: not run
Conflict: 6/10 FAIL — failed: tag_keeps_day, conflict_returned, not_silently_dropped, concrete_reason, resolution_options

Proposal lifecycle: pending proposals never mutated active State/Plan in H1-H5; reject writes no Receipt.
Receipt behavior: invariant "one Receipt per commit" = PASS.
State / Plan consistency: PASS; atomic Reframe: PASS.

## 7. Issues

### P0

- **[H5.tag_keeps_day]** CONSTRAINT_FAILURE — The Considering tag keeps "Day 4" (must_visit carries a day)  
  Evidence: {"tag":{"kind":"must_visit","placeId":"nezu_museum"}}
- **[H5.conflict_returned]** CONSTRAINT_FAILURE — State edit returns a Conflict (Day 4 closed)  
  Evidence: {"outcome":"proposal","nezuPlacedOn":"Day 2"}
- **[H5.not_silently_dropped]** CONSTRAINT_FAILURE — Constraint is never silently dropped or weakened (create and edit paths)  
  Evidence: {"create":{"valid":true,"nezuOn":"Day 2"},"edit":{"outcome":"proposal","nezuOn":"Day 2"}}

### P1

- **[H1.route_cost]** ROUTE_FAILURE — Replacement does not add a large detour (walkingDistanceDelta ≤ 5 km); stub picks the top-ranked candidate  
  Evidence: {"walkingDistanceDeltaM":11922,"from":"Tokyo Station","to":"Ebisu"}
- **[H3.removes_least_valuable]** RANKING_FAILURE — The dropped stop is chosen by value, not by position (last-of-day)  
  Evidence: ["D1 dinner: Rokurinsha Tokyo Ramen Street","D2 dinner: Andy's Shin Hinomoto","D3 dinner: Yakiniku Yoin Ebisu","D4 dinner: Yakitori Morimoto","D5 dinner: Hakkoku"]
- **[H3.scope_asked]** CLASSIFICATION_FAILURE — "I feel tired" is scoped (today / next days) or the scope is asked, not applied to the whole trip silently  
  Evidence: {"daysTouched":5,"days":5}
- **[H5.concrete_reason]** EVIDENCE_FAILURE — Conflict reason is concrete (names the place and the day)  
  Evidence: null
- **[H5.resolution_options]** EVIDENCE_FAILURE — Structured resolution options (move day / remove / edit requirement)  
  Evidence: StateConflictDetail = { message, consideringId } — no options field in the outcome type
- **[M1.memory_supported_at_own_pace]** RANKING_FAILURE — Memory still reaches the plan at the traveller's own measured pace (3 stops/day)  
  Evidence: {"pacedBookstores":0,"pacedChangedItems":0,"rolesAdmittingBookstoreAt3":[]}
- **[M1.claim_bound]** RANKING_FAILURE — Memory stays within its own claim bound (claimsAllowed) — ranking does not add uncapped extra claims  
  Evidence: {"bookstoresInPlan":4,"claimLimit":2,"note":"bound applies to the first-claim path only; memoryMatch keeps boosting the same category in ranking"}
- **[M1.provenance_truthful]** EVIDENCE_FAILURE — Rationale states the Memory provenance truthfully (explicit statement ≠ photos/saved places)  
  Evidence: ["Bookstore turns up 1 times in your photos and saved places.","Bookstore turns up 1 times in your photos and saved places."]
- **[M2.memory_representable]** MEMORY_FAILURE — "Quiet, less crowded" can be stored as a Memory the planner reads  
  Evidence: MemorySubject facets: category | price_band | time_fit | stay_length | stops_per_day | day_span_metres | start_minutes — no crowd/popularity facet; `crowd` was dropped in facets.ts
- **[M2.conflict_in_trace]** EVIDENCE_FAILURE — Trace indicates the State/Memory conflict and the current-trip override  
  Evidence: {"sensojiReasons":["For “This trip I want to experience iconic Tokyo landmarks even if crowded.”: it is a landmark.","A 17-minute walk from Kuramae.","Chosen over Tokyo National Museum, which is a weaker match for what you wrote."]}
- **[R1.recall_areas]** DISCOVERY_FAILURE — Candidate recall proxy = 2 (literary areas such as Jimbocho / Shimokitazawa / Koenji reached)  
  Evidence: {"bookstores":5,"kissaten":9,"strong":9,"expectedAreaHits":[]}
- **[R1.slow_pace]** RANKING_FAILURE — Intent "slow neighborhood exploration" lowers the day density (≤ 4 stops/day, no nightly bar)  
  Evidence: {"stopsPerDay":[5,5,5,5,5],"nightcaps":5,"pace":5}
- **[R1.expansion]** DISCOVERY_FAILURE — Semantic expansion carries ≥ 50% of Intent terms into discovery queries  
  Evidence: {"reached":["kissaten"],"lost":["showa","literary","cultural","atmosphere","slow","neighborhood","exploration","bookstores","small","independent","places"]}
- **[R1.area_stage]** DISCOVERY_FAILURE — An area-candidate stage exists before POI retrieval  
  Evidence: {"stageExists":false,"note":"No area-level retrieval: searches are \"<lodging> <category>\" around the base lodging. Neighbourhoods below are what the pool happens to contain.","neighborhoodsInPool":{"Kuramae":37,"Kamezawa":1,"Torigoe":1,"Asakusa":12,"Kitanomarukōen":1,"Kanda Jinbōchō":1,"Yokoami":2,"Honjo":3,"Yanagibashi":4,"Sotokanda":1,"Kotobuki":5,"Marunouchi":2,"Asakusabashi":4,"Higashishinag

### P2

- **[M1.scoped_change]** RANKING_FAILURE — Memory changes only a bounded number of stops (≤ 2 × claim limit)  
  Evidence: {"changedStops":10,"claimLimit":2}
- **[M1.no_taxis_represented]** CONSTRAINT_FAILURE — "No taxis." is represented as a structured constraint (not a free-text ranking term)  
  Evidence: {"tag":null,"maxHopKm":2.13,"maxSpanKm":2.13}
- **[R1.category_plausible]** FILTER_FAILURE — Planned stops are filed under a category their own name agrees with  
  Evidence: {"inPool":["Soba Udon Monju Asakusa Branch → bar_cocktail","Neko Naraku Cafe & Bar → bar_cocktail","WESTSIDE COFFEE KURAMAE → grocery_market"],"planned":["D3 nightcap: Soba Udon Monju Asakusa Branch [bar_cocktail]"]}

## 8. Regression vs Previous Run

No prior eval report — this run is the baseline.

Scenario definition changes this run:
- First run of suite core-eval-1.0 — no prior definitions to diverge from.
- M2: the spec Memory is not representable; a documented proxy (aversion: temple_shrine) is used for the State>Memory ranking checks.
- H4: adds an invariant probe (State edit "Day 2 dinner: ramen") alongside the Convenience edit.
- H5: test data sets Nezu Museum closed on Thursdays (Day 4 = 2026-10-08) in an eval-local catalogue copy.
- R1/R2: run on data/demo_retrieved_v1 (104 places retrieved around Kuramae) — no live Places calls.

## 9. Recommended Fixes for Current Version

<!-- FIXES -->

## 10. Strengthening Opportunities

These are not bugs but high-value improvements.

<!-- STRENGTHENING -->

## 11. Next Eval Focus

<!-- NEXT -->
