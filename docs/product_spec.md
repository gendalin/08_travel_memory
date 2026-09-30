# The Next Trip — Implementation Spec v0.7
## Claude Code Repository + Production Plan

**Status:** Implementation-ready MVP specification  
**Primary platform:** Mobile web, mobile-first  
**Primary demo destination:** Tokyo  
**Primary product themes:**  
1. **Personal Memory**  
2. **Human–Agent Collaboration**

**Source of truth for:** product behavior, interaction model, technical boundaries, repository structure, demo data contract, implementation sequence, testing gates, and production readiness.

> This document supersedes `product_spec_v0.5.md` and `the_next_trip_implementation_spec_v0.6.md` where they conflict.

---

# 0. EXECUTION RULES FOR CLAUDE CODE

Claude Code should follow these rules before writing production code.

## 0.1 Build in gates, not feature-by-feature

Do **not** build the full UI first.

Implementation order is:

1. Product / architecture freeze
2. Tokyo demo data preprocessing contract
3. Deterministic domain engine
4. Thin vertical slice
5. Personal Memory layer
6. Full Human–Agent Collaboration
7. UI system + interaction polish
8. Research harness
9. Production hardening

A gate is complete only when its **Definition of Done** passes.

Do not proceed to the next gate when acceptance tests for the current gate fail.

## 0.2 Product priorities

When scope conflicts occur, prioritize in this order:

1. Correct State / Plan consistency
2. Clear user approval before agent changes
3. Reliable Personal Memory provenance and reuse
4. Deterministic diff / classification / validation
5. Clear recommendation rationale
6. Polished UI
7. Research instrumentation
8. Secondary travel features

Do not add travel-product functionality unless it directly supports one of the two product themes:

- Personal Memory
- Human–Agent Collaboration

## 0.3 Deterministic code before LLM judgment

Use code for:

- constraint validation,
- state / plan diffs,
- Replace / Reorganize / Reframe classification,
- routing metrics,
- Expected Impact,
- proposal lifecycle,
- atomic commits,
- receipts,
- persistence,
- locking,
- schema validation.

Use the LLM for:

- natural-language decomposition,
- semantic interpretation,
- candidate retrieval/ranking assistance,
- drafting itinerary candidates from bounded POIs,
- rationales,
- chat responses,
- candidate Memory extraction.

The LLM must never be the source of truth for numeric impact metrics or change classification.

## 0.4 User-facing language vs system language

Internal system terms:

- Replace
- Reorganize
- Reframe

should remain in schemas, logs, tests, receipts metadata, and architecture documentation.

User-facing UI should prefer natural language:

- **Change this place**
- **Update this afternoon**
- **Change the trip direction**

Do not force users to learn internal agent terminology.

---

# 1. PRODUCT THESIS & MVP BOUNDARY

## 1.1 Product thesis

**The Next Trip** is a personal travel planning agent where the user and agent collaboratively maintain:

- the current itinerary,
- the trip-level planning State,
- a persistent Personal Memory,
- and a visible history of confirmed changes.

The product should make four things visible and manageable:

1. **Plan** — what the current trip itinerary is.
2. **State** — what the agent is currently optimizing for and respecting.
3. **Decisions** — what changed, why, and what impact it had.
4. **Memory** — what the system believes about the user across trips.

The product is not primarily a “better Tokyo recommendation engine.”

Its core value is:

> **Memory → recommendation → rationale**

and

> **User input → proposed change → understandable diff → confirm → commit → receipt**

## 1.2 MVP includes

- New Trip
- State decomposition and confirmation
- first itinerary generation
- whole-trip map
- day-by-day itinerary
- POI rationale
- day rationale
- Alternatives
- chat
- Replace / Reorganize / Reframe
- proposal preview
- State / Plan atomic commit
- Decision Receipts
- candidate / active Memory
- Memory provenance
- Memory reuse on future trips
- Tokyo demo data
- local persistence
- deterministic validation
- developer tools
- research instrumentation after core product is stable

## 1.3 MVP excludes

- user-facing photo import
- user-facing map-link import
- screenshot import UI
- preprocessing UI
- post-trip learning
- automatic learning from completed-trip traces
- multi-user planning
- payments
- booking
- hotel search/planning
- multiple lodging locations in one trip
- itinerary drag-and-drop
- arbitrary direct plan editing
- undo / rollback
- whole-trip explanation page
- comprehensive real-time guarantee
- proactive monitoring
- full cost accounting
- live reservation inventory
- autonomous plan mutation without user confirmation

---

# 2. CORE PRODUCT MODEL

The product has three user-facing conceptual layers.

## 2.1 Plan

**Question:** What is the itinerary?

Contains:

- whole-trip map,
- all planned POIs,
- day itinerary,
- route,
- timeline,
- POI detail,
- rationale,
- alternatives,
- proposed changes.

## 2.2 State

**Question:** What is the agent planning against for this trip?

State contains exactly:

1. Intent
2. Considering
3. Priorities

State is explicit, editable, versioned, and user-visible.

State is **not** hidden chain-of-thought.

## 2.3 Memory

**Question:** What does the system believe about me across trips?

Memory contains:

- candidate memories,
- active memories,
- provenance,
- explicit-vs-inferred distinction.

Memory affects future trips through a trip-level immutable snapshot.

## 2.4 Scope rule

| Layer | Scope | Example |
|---|---|---|
| Plan | Current itinerary | Day 2 museum at 14:00 |
| State | Current trip | Slow pace; must visit Nezu Museum |
| Memory | Cross-trip | Prefers compact walkable neighborhoods |

State and Memory must never be silently merged.

---

# 3. STATE MODEL

## 3.1 Intent

Intent describes:

> **What kind of trip the user wants.**

Examples:

- Slow-paced
- Spend time in local neighborhoods
- Recover and relax
- Focus on design and architecture
- Spend time near the sea

Intent is not a numeric trade-off weight.

## 3.2 Considering

Considering describes:

> **Concrete constraints, requirements, or boundaries the itinerary must respect.**

Examples:

- Must visit 21_21 Design Sight
- No taxis
- Need two hours for laptop work on Day 3
- Day 5 is a half day
- Must reach Haneda by 17:20
- Budget should remain moderate

Considering items may have internal structured tags for deterministic validation.

Example:

```ts
{
  kind: "fixed_time",
  dayIndex: 4,
  time: "17:20"
}
```

The structured tag is internal; the user sees natural language.

## 3.3 Priorities

Priorities are:

> **Optimization dimensions used to choose between otherwise valid plans.**

Core MVP priorities:

1. **Convenience**
   - route efficiency
   - transfer simplicity
   - walking / transit burden
   - spatial continuity

2. **Cost**
   - POI price level
   - rough transit burden
   - budget compatibility

3. **Novelty**
   - difference from known Memory/history
   - less repetitive categories
   - less familiar options

Weights:

- low
- medium
- high

Default: `medium`.

Priority labels must not restate Intent.

Example:

- `Slow pace` → Intent
- `Convenience` → Priority

## 3.4 Agent-proposed Priority

The agent may propose an additional Priority, for example:

- Photographic potential
- Craft & design
- Accessibility

The agent may **not** silently add it.

Flow:

```text
Agent proposes new Priority
→ user sees proposed addition
→ user confirms
→ Priority enters State
```

Any later Priority addition or weight change that affects State is a Reframe transaction.

## 3.5 New Trip decomposition

New Trip input includes:

- trip name,
- dates,
- one base lodging,
- free text for Intent,
- free text for Considering.

The agent decomposes free text into discrete items.

Before first generation, show a **Decomposition Preview**.

User can:

- edit Intent items,
- delete Intent items,
- add Intent items,
- edit Considering items,
- delete Considering items,
- add Considering items,
- change Priority weights,
- accept / decline proposed additional Priorities.

On confirmation:

- State v1 is created,
- Memory snapshot is created,
- first itinerary generation begins.

No Decision Receipt is created because trip creation is not a change transaction.

## 3.6 New Trip UI flow — normative

The New Trip experience is a **two-stage flow**:

```text
Index
→ + New Trip
→ Stage A: Trip Setup
→ Review trip state
→ Stage B: Decomposition Preview
→ Generate itinerary
→ Plan
```

This is the only supported first-trip creation flow in the MVP.

The user does **not** manually create structured State before the preview.  
The user first writes natural-language trip input; the agent then decomposes it into State.

### 3.6.1 Entry point

From the existing Index/menu:

```text
+ New Trip
```

opens a full-height mobile sheet or full-screen route.

Do not open New Trip as a small modal.

The visual language should remain consistent with the uploaded UI drafts:

- minimal chrome,
- black / neutral typography,
- generous spacing,
- rounded sheet controls,
- one clear primary CTA,
- mobile-first layout.

### 3.6.2 Stage A — Trip Setup

Purpose:

> Collect only the information the user naturally knows before planning.

Do not expose internal labels such as `State`, `Reframe`, or `Memory snapshot` on this screen.

#### Screen structure

```text
┌──────────────────────────────────┐
│ ×                     New Trip   │
│                                  │
│ Tokyo                            │
│                                  │
│ Trip details                     │
│ [ Tokyo Slow Week            ]   │
│                                  │
│ Dates                            │
│ [ Sep 28 ]  →  [ Oct 02 ]        │
│                                  │
│ Staying in                       │
│ [ Kuramae, Tokyo             ]   │
│                                  │
│ ───────────────────────────────  │
│                                  │
│ What kind of trip do you want?   │
│                                  │
│ [ I want a slow-paced Tokyo      │
│   trip with local neighborhoods, │
│   coffee, design and some        │
│   museums. I don't want every    │
│   day packed...              ]   │
│                                  │
│ Anything the plan should         │
│ consider?                        │
│                                  │
│ [ I must visit 21_21 Design      │
│   Sight. Day 5 is a half day.    │
│   I need two hours to work on    │
│   Day 3. No taxis...         ]   │
│                                  │
│ Using 5 memories from Profile  > │
│                                  │
│ [      Review trip state       ] │
└──────────────────────────────────┘
```

This is a structural wireframe only; visual styling should follow the UI system in §14.

#### Required fields

1. **Destination**
   - Tokyo for the MVP demo.
   - The production control may be architected as a place/destination field, but only Tokyo needs to be supported in the demo dataset.

2. **Trip name**
   - Required.
   - May be prefilled from destination, e.g. `Tokyo Trip`.
   - User editable.

3. **Start date / End date**
   - Required.

4. **Base lodging**
   - Required.
   - One lodging only for the MVP.
   - Use a place reference with coordinates.
   - Example: `Kuramae, Tokyo`.

5. **What kind of trip do you want?**
   - Required free text.
   - This is the source for **Intent**.
   - Do not ask the user to manually format bullet points.

6. **Anything the plan should consider?**
   - Optional but recommended free text.
   - This is the source for **Considering**.
   - Examples include must-visits, fixed times, work blocks, mobility constraints, and budget boundaries.

#### Personal Memory disclosure

Show a lightweight row near the CTA:

```text
Using 5 memories from Profile  >
```

Rules:

- It is informational, not a configuration step.
- Tapping it may open a simple read-only sheet listing the active memories that would be snapshotted.
- It must not allow editing Memory inside the New Trip flow.
- Editing Memory remains a Profile action.
- The actual immutable Memory snapshot is created only when Stage B is confirmed.
- If there are zero active memories, omit the row.

This disclosure exists to make Personal Memory visible without adding another setup step.

#### Primary action

```text
Review trip state
```

This does **not** generate the itinerary.

It triggers:

```text
natural-language input
→ agent decomposition
→ structured Intent / Considering
→ initial Priority weights
→ optional proposed additional Priority
→ Stage B
```

### 3.6.3 Stage A validation

The CTA remains disabled until:

- destination exists,
- trip name exists,
- valid start and end dates exist,
- base lodging exists,
- Intent source text is non-empty.

Considering may be empty.

Show validation inline next to the field.

Do not use error-alert modals for normal form validation.

### 3.6.4 Stage B — Decomposition Preview

Purpose:

> Let the user verify the shared planning contract before the agent creates the itinerary.

This screen may use the user-facing title:

```text
Review your trip
```

Avoid presenting `Decomposition Preview` as the main UI title; that is an internal product term.

#### Screen structure

```text
┌──────────────────────────────────┐
│ ‹                   Review trip  │
│                                  │
│ Tokyo Slow Week                  │
│ Sep 28 – Oct 02 · Kuramae        │
│                                  │
│ INTENT                           │
│ Slow pace                    ✎   │
│ Local neighborhoods          ✎   │
│ Coffee and design            ✎   │
│ Architecture and museums     ✎   │
│ Unstructured walking time    ✎   │
│ + Add                            │
│                                  │
│ CONSIDERING                      │
│ Must visit 21_21 Design Sight ✎  │
│ Day 5 is a half day           ✎  │
│ Reach Haneda before 17:20     ✎  │
│ 2 hours laptop work on Day 3  ✎  │
│ No taxis                      ✎  │
│ + Add                            │
│                                  │
│ PRIORITIES                       │
│ Convenience    Low  Med  High    │
│ Cost           Low  Med  High    │
│ Novelty        Low  Med  High    │
│                                  │
│ Suggested                        │
│ Craft & design · High       [＋] │
│                                  │
│ Using 5 memories from Profile  > │
│                                  │
│ [      Generate itinerary      ] │
└──────────────────────────────────┘
```

#### Intent interactions

User can:

- inline edit,
- add,
- delete.

Do not expose numerical weights.

#### Considering interactions

User can:

- inline edit,
- add,
- delete.

If structured tags can be inferred deterministically, they remain internal.

#### Priority interactions

Core Priorities are:

- Convenience
- Cost
- Novelty

User can adjust:

- low
- medium
- high.

User cannot manually create arbitrary Priorities.

Agent-proposed additional Priorities appear under:

```text
Suggested
```

and require explicit acceptance.

Declining a suggested Priority removes it from the draft State.

### 3.6.5 Stage B conflict behavior

Before first itinerary generation, code should validate structured State constraints that can already be checked.

If a conflict is detected:

- keep the user on Stage B,
- show a compact inline Conflict card near the relevant section,
- explain which Considering items conflict,
- offer edit/remove resolution.

Do not enter Plan until the State can produce a valid first itinerary.

### 3.6.6 Stage B primary action

Primary CTA:

```text
Generate itinerary
```

On tap:

```text
confirm draft State
→ create State v1
→ snapshot active Memory
→ generate Plan v1
→ validate Plan
→ persist Trip
→ open Plan
```

This is one creation transaction, but it is **not** a Decision Receipt transaction.

Log it for research instrumentation when research mode is enabled.

### 3.6.7 Generation state

While generating the first Plan:

- keep the New Trip context visible,
- disable duplicate submission,
- show a clear progress state,
- provide truthful stage labels only if the application actually tracks those stages.

Safe default:

```text
Building your Tokyo trip…
```

Do not simulate fake reasoning text.

If generation fails after the retry policy:

- keep Stage B intact,
- show a recoverable error,
- allow Retry,
- do not discard user input.

### 3.6.8 Successful completion

After Plan v1 validates successfully:

```text
New Trip
→ Plan default view
```

The map immediately shows all POIs in the generated itinerary, consistent with §5.1.

The user can then:

- inspect POIs,
- open Itinerary,
- open State,
- chat with the agent.

### 3.6.9 Navigation / cancellation

Stage A:

- `×` closes New Trip.
- If any data has been entered, confirm discard before closing.

Stage B:

- Back returns to Stage A with original free text preserved.
- Structured edits made in Stage B should remain in the draft while moving back/forward within the same creation session.
- Closing before generation discards the draft Trip after confirmation.

### 3.6.10 Data lifecycle during New Trip

Before `Generate itinerary`:

```text
Trip draft
Draft State
Current active Memory
```

Nothing is yet a persisted active Trip.

After confirmation:

```text
Trip created
State v1 created
Memory snapshot created
Plan v1 created
```

This prevents half-created trips from appearing in the Trips list.

### 3.6.11 Product consistency rules

The New Trip UI must preserve all existing v0.7 product rules:

- Intent = desired experience
- Considering = concrete constraints
- Priorities = optimization dimensions
- Personal Memory is cross-trip
- Memory is not silently converted into State
- preprocessing is outside the product flow
- only one base lodging in the MVP
- no Receipt for initial trip creation
- active Memory snapshot becomes immutable once the Trip is created
- first Plan must validate before it is shown
- product does not expose hidden model reasoning

---


# 4. TRIP FRAME & TIME MODEL

## 4.1 Trip frame

Trip metadata is not State.

```ts
interface TripFrame {
  name: string
  destination: string
  startDate: string
  endDate: string
  baseLodging: PlaceRef
}
```

For MVP:

> **One base lodging per trip only.**

Multi-hotel / lodging changes are out of scope.

## 4.2 Daily structure

Each day begins and ends at `baseLodging`.

This rule is used by planner, validator, routing, and itinerary display.

## 4.3 Time phases

### Pre-trip

`now < startDate`

- no itinerary items are locked.

### In-trip

`startDate <= now <= endDate`

- items with `startTime < now` are locked,
- proposals cannot mutate locked items.

### Post-trip

`now > endDate`

- itinerary is read-only,
- no post-trip learning in MVP.

---

# 5. PLAN & INTERACTION MODEL

## 5.1 Default Plan view

Initial Plan view shows:

- full-trip map,
- all itinerary POIs,
- chat composer,
- Itinerary button,
- Index/menu.

There is no day filter in the default map.

## 5.2 POI sheet

Tap POI → open bottom sheet.

Contains:

- image,
- title,
- short description,
- Why this place?
- Alternatives.

Locked POIs show a locked state.

Long press may be a shortcut but not the primary interaction.

## 5.3 Itinerary

Open Itinerary → show:

- trip name,
- Day 1 … Day N,
- selected-day route,
- timeline,
- thumbnail,
- POI title,
- short description,
- rationale.

Map and itinerary list must stay synchronized.

## 5.4 Why this place?

Generated at plan time and stored on the item.

May reference:

- Intent,
- Considering,
- Priorities,
- active Memory snapshot,
- route continuity,
- proximity,
- category balance,
- time context.

Store references:

```ts
rationaleRefs: {
  stateItemIds: ID[]
  priorityIds: ID[]
  memoryIds: ID[]
}
```

Do not regenerate rationale on every open.

## 5.5 Why this day?

Provide a visible info affordance next to Day.

It explains:

- why activities are on this day,
- why the order makes sense,
- which constraints matter,
- rough route / timing logic.

There is no separate whole-trip explanation.

State is the trip-level rationale.

## 5.6 Alternatives

POI sheet → **Alternatives**

Show 3–5 options selected from bounded Tokyo POIs.

Each alternative contains:

- image,
- title,
- short description,
- reason.

If the alternative fits the same slot:

```text
user selects
→ user action itself is confirmation
→ Replace commits
→ Receipt
```

If the alternative shifts another item:

```text
user selects
→ Reorganize proposal
→ preview
→ confirm
→ commit
```

Mark alternatives that will cause a broader schedule change.

## 5.7 Avoid nested modal depth

Do not stack multiple bottom sheets.

Example:

```text
POI sheet
→ Alternatives
```

should use:

- sheet content replacement,
- sheet navigation push,
- or a full-height sheet transition.

Avoid:

```text
sheet
→ sheet
→ modal
```

---

# 6. CHAT, STATE, AND MEMORY ROUTING

Every chat message is evaluated on **two independent axes**.

## 6.1 Axis A — Does this affect the current trip?

Possible result:

- Answer / Focus only
- Replace
- Reorganize
- Reframe
- Conflict
- Clarifying question

## 6.2 Axis B — Is this a stable cross-trip fact?

Possible result:

- no Memory candidate
- Memory candidate

Example:

> “I never enjoy crowded tourist spots.”

Current-trip interpretation:

```text
Potential State change:
Avoid heavily crowded tourist spots
```

Cross-trip interpretation:

```text
Candidate Memory:
Prefers less crowded destinations
```

These are separate.

The agent must not silently convert Memory into State or State into Memory.

## 6.3 Memory candidate from chat

If stable cross-trip preference is detected:

show a small inline note:

> Remember for future trips?

User may:

- confirm now,
- review later in Profile,
- dismiss.

A Memory candidate does not affect the current trip’s immutable Memory snapshot.

If the same message should affect the current trip, that occurs through a separate State / Plan proposal.

---

# 7. CHANGE TRANSACTION MODEL

All change proposals follow:

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

## 7.1 Deterministic classification

Classification is computed from the diff. **Any State change is a Reframe**, however
little of the itinerary it moves (revised 2026-09-30, reversing 2026-09-29). The
core eval found that typing a State edit by plan movement let a change of the trip's
own terms commit unreviewed and be recorded as a mere place change.

```text
if stateDiff is non-empty
→ Reframe

else if planDiff is empty
→ Answer / Focus

else if exactly one item changed identity or was removed
     AND no item was added, and no item's start or day moved
→ Replace
   (the swapped item's END may change within its slot — a longer stop
    that runs into free time has pushed nothing)

else if more than one item changed, across more than one day
→ Reframe

else
→ Reorganize
```

Normative examples:

| Case | Type |
|---|---|
| One POI → another, same slot | Replace |
| One POI → a longer one that fits the slot's free time | Replace |
| Remove one POI, nothing else moves | Replace |
| One replacement shifts later items | Reorganize |
| Add item | Reorganize (one day) / Reframe (several days) |
| Reorder / retime | Reorganize |
| One POI moved to another day | Reorganize |
| State edit that changes nothing in the itinerary | Reframe (State only) |
| State edit that swaps one stop in place | Replace |
| State edit that re-plans part of one day (e.g. an event) | Reorganize |
| State edit that changes stops on several days | Reframe |
| Same-slot Alternative pick | Replace, user-confirmed by selection |

## 7.2 Replace UI

User-facing language:

> **Change this place**

Show:

- Before
- After
- short reason
- primary: Confirm change
- secondary: Keep current

## 7.3 Reorganize UI

User-facing language:

> **Update this afternoon**

or:

> **Update Day 3**

Show:

- affected range,
- Before / After,
- rationale,
- Expected Impact,
- Confirm changes,
- Keep current.

## 7.4 Reframe UI

User-facing language:

> **Change the trip direction**

Show:

- proposed State diff,
- Expected Impact,
- Preview proposed plan,
- itinerary diff,
- Confirm changes,
- Keep current.

A Reframe with several changes is reviewed change by change (§7.6).

## 7.5 Expected Impact

Computed by code.

MVP metrics:

- itemsAffected
- poiCountDelta
- walkingDistance delta
- travelTime delta
- freeTime delta
- budgetWarning

Do not display false precision.

Cost is simplified:

- POI price level,
- rough budget compatibility,
- warnings only.

Do not display detailed day cost ranges unless backed by reliable data.

## 7.5b Reading the traveller's words (decided 2026-10-01)

Every piece of free text — the Stage A notes, each Intent and Considering line, and
every chat message — is read by the model into a closed vocabulary of instructions
(must-visit, a day in a place, avoid, budget, pace, finish by, half day, free time, a
meal, an event, transport, a general wish, or "unclear" with one question back). The
model names the KIND and the words; code decides the rest: which day ("last", "禮拜三"),
which place (the trip's own places, then the area table, then a geocode — never a place
the model named on its own), which category (taxonomy ids only). An invalid reading is
treated as unread. With no model (offline, stub, service down) the rules read the line.

Each line shows how it was read ("Read as: Day 5 → a day in Yokohama"), or the question
when it could not be planned. A line is read once, when added or edited.

Adding OR removing a line updates the itinerary through the same path: a day named for
a place is re-planned there (fetching places there on a live run), a removed pin or
named day is undone, a removed limit re-ranks what now clearly fits better. Each is a
previewed Reframe; on confirmation the plan becomes a new version, and every version
is kept so any two can be compared side by side.

## 7.6 User direct State edit

A State edit touches only the stops it affects (revised 2026-09-29), and is always
previewed when it moves the itinerary (revised 2026-09-30).

```text
User edits State
→ draft State
→ find the edit's reach: the stops it overlaps, rules out, or strands
→ re-choose each of those in place (same day, same start, same part of the day)
→ validate
→ plan unchanged: State commits immediately, one Receipt
→ otherwise (even one stop): Reframe proposal, reviewed change by change
→ State + Plan commit together, one Receipt
```

**Slow pace** (decided 2026-09-30). "Slow" is how much a day MOVES, not how many
stops it has. Six stops inside one kilometre is slow; five stops each two kilometres
apart is not. A State line asking for a slow pace ("slow-paced", "take it easy",
"慢慢逛") sets a movement budget per day:

- a **move** is a hop between consecutive stops longer than a walk (> 1 km) — at
  most **1** a day;
- an **area** is a group of stops each within a walk of another — at most **2** a day;
- the legs to and from the lodging are not counted.

Planning keeps every day inside the budget whenever any open candidate can, and says
on the stop when none could. Adding a slow pace to an existing trip re-chooses only
the stops that make a day move, in place; it never drops a stop.

**Area days** (decided 2026-09-30). When the traveller's words or a confirmed
neighbourhood memory ask for a kind of neighbourhood ("Showa-era literary", "vintage"),
retrieval also searches the best matching areas from a code-owned table (Jimbocho,
Yanaka, Koenji, …) within reach, and planning spends a day in each area the trip's pool
can furnish (at least 3 places; at most 2 areas; Day 2 and Day 4 of a five-day trip).
On an area day:

- every part of the day but the late "one more" is chosen inside the area first;
- the main stop is what the area is known for and not what lunch could be — the
  bookshop, with the kissaten left for lunch;
- a replacement (closed, rain, State edit) is looked for in the same area first;
- the day is labelled "A day in Jimbocho", and its main stop says why.

The legs out and back are not moves, so an area day is a slow day.

**Variety.** An optional stop is not the same kind of place as the stop before it,
and a kind used three times in the trip waits for others — unless nothing else is
open. An area day's signature stop is exempt: a day in a bookshop quarter opens on a
bookshop.

**Reach.** What an edit may re-choose, and nothing more:

| Edit | Reach |
|---|---|
| "Day 2 dinner: sushi" (one slot, one kind of place) | that one stop |
| A new avoid | only the stops it rules out (what a place IS — category, type, name — not what its description mentions) |
| A lower budget | only the stops above it |
| A new Intent line, a Priority weight | only stops a replacement beats by a clear margin (0.1 of the score) |
| A picked event (§7.8) | the stops its time overlaps (with travel time either side), a meal it displaces offered again around it, and the stop before it if too far to make the start |
| A must-visit, a time limit, a half day | as before: the stop inserted, the day compressed |

**Never re-chosen:** a stop that has already happened; a stop the traveller picked,
named or booked; a stop a memory claimed, for a change that is only a matter of degree.

**Replace commits immediately**, the way picking an alternative does. The stop it
replaced is offered first under that stop's "More options" — switching back is one
tap, and is itself an ordinary Replace (there is still no undo, §7).

**Everything else is a proposal reviewed change by change.** Each change is listed with
its reason and can be accepted or declined; declining keeps the original stop in that
slot. Changes that ARE the request — the event itself, the stops its hours overlap, a
slot the traveller named — are marked as such and cannot be declined on their own. The
narrowed plan is validated again before it commits.

**Say what could not follow.** A stop the edit reached but could not re-choose — nothing
else is open then — is named, with why, rather than left looking as if the edit had
nothing to do.

**Show the reach.** The proposal says how much it leaves alone ("Only 2 stops change;
the other 20 stay as they are"), its heading names the scope ("Change this place",
"Update Day 3 evening", "Change the trip direction"), and the stops a committed change
put in place are marked "Updated" on the itinerary until the next change.

If `planDiff` is empty:

- State commits immediately,
- one Receipt,
- and anything the itinerary could not follow is said.

## 7.7 Proposal lifecycle

At most one pending proposal per trip.

```text
generating
→ pending
→ committed

pending
→ rejected
→ superseded
→ invalidated

generating
→ failed
```

Rules:

- new change request supersedes pending proposal,
- user State edit invalidates pending proposal,
- locked-item conflict invalidates proposal,
- only committed proposals create Receipts.

## 7.8 Live event data

Some things a traveller asks for exist only on a date, at a time — "at least one
baseball game", a concert, a sumo day, a festival. They cannot be planned from the
catalogue: they are searched for when asked, as live data. This is one of the places the
product earns its keep — timely, specific information a static list cannot hold.

**When:** a State line names an activity that needs a real date and time before it can
be placed (tag `event_request`).

**Sources, in order:** the league or organiser's official pages (e.g. npb.jp), the
venue, official ticketing, reputable editorial. Where an official source has a stable
address (a league's monthly schedule), it is always read; web search finds the rest.

**Code verifies; the model only reads.** Web search finds pages. Code fetches each one.
The model lists the events on that page and must quote the line for each. Code keeps
an event only if:

- the quote is on the page,
- the quote carries the start time and the date,
- the date is within the trip,
- the venue is named on the page,
- the venue is a venue per Places (stadium, arena, theatre…) and within the destination,
- it is not a reserve, postponed or cancelled date.

Anything that fails a check is dropped, not repaired. The model never supplies a fact
code has not found on a fetched page.

**The traveller picks.** Found events are listed with date, time, what, where, the
source and when it was checked. Picking one plans it as a Reorganize (§7.6); declining
keeps the line in State, unplanned. An empty search says what was searched and that
nothing could be confirmed.

**Freshness.** Every event records `fetchedAt` and its source. Live results are cached
for a day, not indefinitely. An end time the source did not give is marked estimated.

**Offline prototype.** The shareable prototype has no server and no keys, so it carries a
dated recording of a real search, labelled "recorded for this demo" wherever it is shown.
The full app searches live.

---

# 8. VALIDATION ENGINE

Before proposal display, code validates:

- all structured Considering constraints,
- must-visits,
- fixed time blocks,
- opening-hours data available in demo dataset,
- no overlapping items,
- locked items unchanged,
- each day starts and ends at baseLodging,
- all POIs exist in the Tokyo dataset,
- no invented POI ids.

If invalid:

1. retry generation maximum 2 times,
2. then return Conflict or a clear error.

Never display an invalid itinerary as a proposal.

---

# 9. DECISION RECEIPTS

## 9.1 Unit

Exactly one Receipt per committed transaction.

Not one per POI.

## 9.2 Receipt contains

- transaction type,
- initiator,
- trigger,
- summary,
- State diff,
- Plan diff,
- rationale,
- Expected Impact,
- resulting State version,
- resulting Plan version,
- timestamp.

## 9.3 Purpose

Receipts provide:

- accountability,
- explainability,
- traceability.

Receipts do **not** provide:

- undo,
- rollback,
- restore,
- version-control UI.

---

# 10. PERSONAL MEMORY

## 10.1 Status

Only:

- `candidate`
- `active`

Delete is hard delete.

## 10.2 Confidence

Confidence is independent from status.

Use confidence only for:

- candidate ordering,
- internal inference quality.

Do not display numeric confidence to users.

Use provenance labels instead.

Examples:

- From your saved places
- From past travel behavior
- You said this in another trip

## 10.3 Activation

An inferred Memory auto-activates only when it first enters the Profile and its
evidence is strong: a `preference` or `pattern` drawn from photos or saved places,
backed by at least 3 evidence items, with confidence ≥ 0.65 (decided 2026-09-28).
Everything else enters as a candidate.

Flow:

```text
strong photo / saved-place evidence → active
otherwise → candidate → user confirms → active
```

After a Memory is in the Profile, only the user changes its status: a Memory the
user stops using is never re-activated automatically. Aversions, constraints and
context never auto-activate.

## 10.4 Provenance

Memory provenance types:

```ts
type MemoryProvenance =
  | "explicit_statement"
  | "historical_behavior"
  | "saved_places"
  | "agent_inference"
```

Store:

- provenance type,
- sourceRefs,
- createdAt.

Detailed evidence weighting belongs in future `memory_system.md`.

## 10.5 Immutable trip Memory snapshot

At trip creation:

```text
active memories
→ snapshot
→ attach snapshot to Trip
```

The snapshot is immutable for that trip.

Later Profile changes:

- affect future trips,
- do not alter the current trip snapshot,
- do not regenerate the current Plan.

UI should explain:

> Changes apply to future trips.

This rule preserves reproducibility of recommendation rationale, Plan versions, and Decision Receipts.


---

# 11. TOKYO DEMO DATA PREPROCESSING

This phase occurs before product use.

There is no user-facing preprocessing UI.

## 11.1 Input sources

Use available demo sources:

- Tokyo map collection links,
- previous travel photos,
- screenshots,
- manually curated demo evidence if needed.

## 11.2 Output bundle

Create a versioned bundle:

```text
/data/demo_tokyo_v1/
  manifest.json
  user_context.json
  memories.json
  evidence.json
  tokyo_places.json
  demo_scenario.json
```

## 11.3 `manifest.json`

Example:

```json
{
  "schemaVersion": "1.0",
  "bundleId": "demo_tokyo_v1",
  "destination": "Tokyo",
  "generatedAt": "ISO_DATE",
  "sourceCounts": {
    "photos": 0,
    "mapLinks": 0,
    "screenshots": 0
  }
}
```

## 11.4 `user_context.json`

Contains compact derived behavior.

Example:

```json
{
  "typicalStartTime": "10:30",
  "avgDailyStops": 4,
  "walkingTolerance": "high",
  "preferredAreaPattern": "compact-neighborhood",
  "notes": []
}
```

Do not treat this file as active Memory.

It is contextual evidence used only for preprocessing / planner support.

## 11.5 `memories.json`

Contains preprocessed candidate Memory only.

Preprocessing never outputs `active`.

Example:

```json
[
  {
    "id": "mem_001",
    "text": "Often saves local markets",
    "status": "candidate",
    "confidence": 0.74,
    "provenance": {
      "type": "saved_places",
      "sourceRefs": ["ev_012", "ev_031"]
    }
  }
]
```

## 11.6 `evidence.json`

Contains provenance evidence.

Example:

```json
[
  {
    "id": "ev_012",
    "kind": "map_link",
    "summary": "Saved: Ameyoko Market",
    "placeRef": "..."
  }
]
```

Evidence is not directly used as user-facing State.

## 11.7 `tokyo_places.json`

Target:

> **80–150 high-quality demo POIs**

Do not target 300–600 POIs for the first MVP.

Coverage target:

- 6–8 Tokyo neighborhoods
- 8–10 meaningful categories
- enough alternatives for demo scenarios
- enough contrast to demonstrate Memory / State effects

Each POI:

```ts
interface DemoPlace {
  placeId: string
  name: string
  lat: number
  lng: number
  category: string
  neighborhood: string
  priceLevel?: 0 | 1 | 2 | 3 | 4
  openingHours?: Record<string, unknown>
  typicalDurationMin: number
  tags: string[]
  shortDescription: string
  source: "places_api" | "map_source" | "screenshot" | "manual_demo"
}
```

## 11.8 `demo_scenario.json`

Contains scripted test events.

Example:

```json
{
  "trip": {
    "name": "Tokyo Slow Week",
    "days": 5,
    "baseLodging": "Kuramae"
  },
  "events": [
    {
      "id": "evt_closed_restaurant",
      "day": 2,
      "text": "The ramen place on Day 2 is closed today."
    },
    {
      "id": "evt_rain",
      "day": 3,
      "text": "It's going to rain after 3pm on Day 3."
    },
    {
      "id": "evt_tired",
      "day": 3,
      "text": "I feel tired. Fewer spots."
    }
  ]
}
```

## 11.9 Place / map architecture

Use one coherent place identity and map ecosystem.

Recommended MVP direction:

- Google Maps JavaScript API
- Google Places
- Google Routes

Persistent app data should prioritize:

- stable place identity,
- app-owned annotations,
- app-owned tags,
- app-owned short descriptions,
- personal relevance,
- provenance relationships.

Do not treat a large cached copy of third-party place data as app-owned permanent data.

Keep external provider code behind service interfaces so it can be replaced later.

Example:

```ts
interface PlacesService {}
interface RoutingService {}
interface MapAdapter {}
```

---

# 12. PLANNING PIPELINE

Do not send the full POI universe directly to the LLM.

Use a bounded pipeline.

```text
User input
↓
LLM semantic parse
↓
State representation
↓
Code filters impossible POIs
↓
Candidate retrieval
↓
Code / semantic scoring
↓
LLM selects from bounded candidate set
↓
Routing engine schedules
↓
Code validates
↓
LLM writes rationale
↓
Persist Plan
```

## 12.1 Candidate retrieval

Filter by:

- destination,
- day/time feasibility,
- opening hours,
- must-visit constraints,
- category relevance,
- distance / neighborhood,
- Memory relevance,
- State relevance.

Return a bounded set.

Recommended:

- 10–30 candidates per planning decision,
- not the entire dataset.

## 12.2 Ranking

Example score components:

```text
stateMatch
memoryMatch
convenienceScore
costScore
noveltyScore
routeFit
```

Weights come from Priorities.

LLM may interpret semantic relevance but should not invent numeric route / cost facts.

---

# 13. TECHNICAL ARCHITECTURE

## 13.1 Stack

Recommended:

- React
- TypeScript
- Vite
- mobile-web SPA
- Node local/API server
- OpenAI API with structured outputs
- IndexedDB for local app persistence
- Google Maps / Places / Routes behind adapters
- Vitest for domain tests
- Playwright for E2E

No API key should reach the browser.

## 13.2 Domain separation

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

Do not place planning rules inside React components.

## 13.3 Repository structure

```text
/
├── CLAUDE.md
├── README.md
├── package.json
├── .env.example
│
├── docs/
│   ├── product_spec.md
│   ├── architecture.md
│   ├── ui_interaction_spec.md
│   ├── demo_data_contract.md
│   └── research_eval.md
│
├── data/
│   └── demo_tokyo_v1/
│       ├── manifest.json
│       ├── user_context.json
│       ├── memories.json
│       ├── evidence.json
│       ├── tokyo_places.json
│       └── demo_scenario.json
│
├── scripts/
│   ├── build_tokyo_places.ts
│   ├── validate_demo_data.ts
│   └── reset_demo.ts
│
├── src/
│   ├── app/
│   │   ├── router/
│   │   ├── bootstrap/
│   │   └── dev/
│   │
│   ├── domain/
│   │   ├── trip/
│   │   ├── state/
│   │   ├── memory/
│   │   ├── plan/
│   │   ├── proposals/
│   │   ├── receipts/
│   │   ├── validation/
│   │   └── ranking/
│   │
│   ├── application/
│   │   ├── createTrip/
│   │   ├── generatePlan/
│   │   ├── handleChat/
│   │   ├── createProposal/
│   │   ├── commitProposal/
│   │   └── manageMemory/
│   │
│   ├── services/
│   │   ├── llm/
│   │   ├── maps/
│   │   ├── places/
│   │   ├── routing/
│   │   └── persistence/
│   │
│   ├── ui/
│   │   ├── components/
│   │   ├── map/
│   │   ├── plan/
│   │   ├── itinerary/
│   │   ├── chat/
│   │   ├── state/
│   │   ├── memory/
│   │   ├── proposals/
│   │   └── receipts/
│   │
│   └── styles/
│
├── tests/
│   ├── domain/
│   ├── scenarios/
│   ├── integration/
│   └── e2e/
│
└── server/
    ├── index.ts
    ├── openai.ts
    ├── places.ts
    └── routes.ts
```

---

# 14. UI / INTERACTION DESIGN SYSTEM

The uploaded UI drafts are the primary interaction reference.

Implementation should remain visually and structurally close to those drafts while improving:

- hierarchy,
- accessibility,
- platform consistency,
- component reuse,
- mobile ergonomics.

## 14.1 Reference hierarchy

### iOS Human Interface Guidelines

Use for:

- touch targets,
- navigation,
- sheets,
- back / close behavior,
- hierarchy,
- accessibility,
- motion restraint.

### Google Maps

Use for:

- map interaction,
- POI selection,
- marker hierarchy,
- map ↔ sheet synchronization,
- route presentation.

### Claude / ChatGPT / Gemini

Use for:

- conversation flow,
- concise assistant responses,
- structured UI only when necessary,
- proposal cards,
- explanation surfaces.

Do not visually blend all products.

Use each reference for the interaction pattern it is strongest at.

## 14.2 Core UI patterns

| Situation | Primary pattern |
|---|---|
| New Trip — Setup | Full-height sheet / full-screen route with trip details + two free-text inputs |
| New Trip — Review | Structured Intent / Considering / Priority review with one primary CTA |
| Default Plan | Map + bottom controls |
| POI | Map pin → bottom sheet |
| Alternatives | POI sheet → in-sheet navigation |
| Day itinerary | Sheet + timeline + synchronized map |
| Why this day | Day info action → sheet |
| Chat | Bottom composer → expanded chat sheet |
| Replace | Compact Before / After card |
| Reorganize | Diff card + Impact |
| Reframe | State diff → proposed Plan preview |
| State | Inline-editable rows |
| Priority | low / medium / high control |
| Memory candidate | lightweight review row/card |
| Receipt | read-only history detail |

## 14.3 CTA rule

Each decision surface should have one clear primary CTA.

Example:

Primary:

> Confirm changes

Secondary:

> Keep current

Do not give multiple equally prominent actions.

## 14.4 Progressive disclosure

Do not show all reasoning at once.

Default:

- title,
- short reason,
- key impact.

Then optional:

- detail,
- rationale refs,
- receipt history.

## 14.5 Interaction accessibility

Minimum:

- primary touch targets approximately 44×44 CSS px or larger,
- visible focus states,
- sufficient contrast,
- no long-press-only critical actions,
- clear loading / pending / error states.

---

# 15. RESEARCH HARNESS

Research functionality is not part of normal user navigation.

Put it behind:

```text
/dev
/research
```

## 15.1 Baseline mode

Baseline mode is a research flag.

Do not ask normal users to select it on New Trip.

Research mode can create:

- Full condition
- Baseline condition

using the same Tokyo scenario.

## 15.2 Baseline condition

Baseline removes:

- Memory use,
- State UI,
- rationale UI,
- proposal / receipt model.

Chat behaves like conventional regeneration.

Keep:

- same LLM,
- same Tokyo places,
- same route engine,
- same validation.

## 15.3 Research logging

Event logging remains local and exportable.

Do not expose Export Log in normal product navigation.

Put it in `/research` or `/dev`.

## 15.4 Survey

End-of-session research survey belongs to research mode.

Not part of normal product flow.

---

# 16. IMPLEMENTATION GATES

## GATE 0 — PRODUCT / ARCHITECTURE FREEZE

### Goal

Make scope unambiguous before implementation.

### Tasks

1. Copy this document into `docs/product_spec.md`.
2. Create:
   - `docs/architecture.md`
   - `docs/ui_interaction_spec.md`
   - `docs/demo_data_contract.md`
   - `docs/research_eval.md`
3. Move research-only behavior out of the normal product model.
4. Confirm:
   - core Priorities = Convenience / Cost / Novelty
   - one base lodging only
   - no post-trip learning
   - Memory snapshot immutable
   - no undo
   - no direct arbitrary Plan manipulation.

### Definition of Done

- No unresolved product behavior blocks Gate 1.
- Product and research flows are visibly separated.
- Claude Code can answer: “What should I explicitly not build?”

---

## GATE 1 — TOKYO DEMO DATA

### Goal

Create deterministic demo data before building the product UI.

### Tasks

1. Create `/data/demo_tokyo_v1`.
2. Process available:
   - map links,
   - previous trip photos,
   - screenshots.
3. Produce all six bundle files.
4. Curate 80–150 Tokyo POIs.
5. Ensure demo events have viable alternatives.
6. Write JSON schema / TypeScript schema.
7. Add validation script.

### Required command

```bash
npm run validate:data
```

### Tests

Validate:

- all ids unique,
- all sourceRefs valid,
- every POI has coordinates,
- all scripted scenario POIs exist,
- every candidate Memory has provenance,
- no Memory from preprocessing is active.

### Definition of Done

`npm run validate:data` passes with zero errors.

Do not proceed until it does.

---

## GATE 2 — DOMAIN ENGINE

### Goal

Implement product logic without polished UI.

### Implement

- Trip
- TripState
- Memory
- Plan
- Proposal
- Receipt
- diff engine
- change classifier
- validation engine
- Expected Impact
- proposal lifecycle
- atomic commit
- persistence interfaces.

### Unit tests required

Cover every classification boundary:

- same-slot swap → Replace
- remove one item → Replace
- retime → Reorganize
- reorder → Reorganize
- multiple items → Reorganize
- any State diff → Reframe
- empty diff → Answer / Focus.

Cover:

- pending proposal rules,
- proposal superseding,
- proposal invalidation,
- locked-item protection,
- atomic State / Plan commit.

### Required command

```bash
npm test
```

### Definition of Done

All domain tests pass without UI or LLM dependency.

---

## GATE 3 — THIN VERTICAL SLICE

### Goal

Prove one complete Human–Agent Collaboration loop.

Implement only:

```text
New Trip Stage A — Trip Setup
→ Review trip state
→ New Trip Stage B — Review your trip
→ Generate first Plan
→ Plan map
→ Itinerary
→ chat: restaurant closed
→ Replace proposal
→ Confirm
→ atomic commit
→ Receipt
```

### UI scope

Only minimum components needed for this story.

Do not yet build:

- full Profile,
- research mode,
- all edge cases,
- visual polish.

### Definition of Done

A user can complete the story end-to-end with real LLM output and persisted state.

---

## GATE 4 — PERSONAL MEMORY

### Goal

Prove Memory → recommendation → rationale.

### Implement

- Profile
- candidate Memory
- active Memory
- provenance labels
- candidate confirmation
- Memory snapshot on New Trip
- Memory refs in rationale
- future-trip reuse.

### Required scenario

1. Confirm a candidate Memory.
2. Create a new trip.
3. Verify Memory appears in snapshot.
4. Generate plan.
5. Verify at least one recommendation rationale references that Memory id.

### Definition of Done

The product can demonstrate that Personal Memory materially affects a plan and is inspectable.

---

## GATE 5 — FULL HUMAN–AGENT COLLABORATION

### Goal

Complete Replace / Reorganize / Reframe.

### Implement

#### Replace

- one POI
- no wider schedule shift

#### Reorganize

- multiple items / timing changes
- Expected Impact

#### Reframe

- State diff
- proposed Plan
- atomic commit

Also implement:

- State direct edit
- Conflict
- proposal lifecycle
- Receipts history
- Alternatives.

### Required demo scenarios

1. restaurant closed → Replace
2. rain after 15:00 → Reorganize
3. “I feel tired. Fewer spots.” → Reframe
4. direct State edit → Reframe
5. impossible must-visit → Conflict

### Definition of Done

All five scenarios pass automated or scripted E2E tests.

---

## GATE 6 — UI SYSTEM & POLISH

### Goal

Turn working product into portfolio-quality interaction design.

### Tasks

1. Compare implementation against uploaded UI drafts.
2. Preserve original IA unless a documented usability issue requires change.
3. Apply design-system tokens.
4. Standardize:
   - typography,
   - spacing,
   - sheets,
   - cards,
   - controls,
   - map pins,
   - selected states,
   - loading,
   - error,
   - pending states.
5. Remove nested modal patterns.
6. Ensure primary / secondary CTA hierarchy.
7. Ensure no critical action depends on long press.
8. Add responsive behavior around 390 px mobile width.

### Visual QA checklist

- Plan
- Chat
- State
- inline edit
- Index
- Profile
- Itinerary
- Why this day
- Alternatives
- Replace
- Reorganize
- Reframe
- Receipt

### Definition of Done

All core screens have consistent interaction and visual hierarchy.

---

## GATE 7 — RESEARCH HARNESS

### Goal

Add evaluation without polluting core product.

### Implement under `/research` or `/dev`

- full vs baseline condition,
- event log,
- export,
- survey,
- demo clock,
- prompt logging toggle.

### Definition of Done

Researcher can run both conditions using the same Tokyo scenario and export comparable logs.

---

## GATE 8 — PRODUCTION HARDENING

### Goal

Make demo reliable enough for portfolio review and structured user testing.

### Add

- schema validation for LLM output,
- maximum 2 LLM retries,
- API error states,
- routing fallbacks,
- loading states,
- offline-safe local persistence where possible,
- data reset,
- demo reset,
- accessibility review,
- E2E tests,
- visual regression if practical.

### Required E2E

```text
New Trip
→ Plan
→ Replace
→ Reorganize
→ Reframe
→ Receipt
→ Profile
→ New Trip using Memory
```

### Definition of Done

The scripted Tokyo demo can be completed repeatedly without manual repair.

---

# 17. TEST STRATEGY

## 17.1 Unit tests

Highest priority.

Test:

- classification,
- diffs,
- constraints,
- impact calculations,
- state transitions,
- memory status,
- snapshot immutability.

## 17.2 Integration tests

Test:

- LLM schema output → domain model,
- place retrieval → bounded candidates,
- route → Plan,
- Plan → validator,
- proposal → receipt.

## 17.3 Scenario tests

Use deterministic Tokyo scenarios.

Example:

```text
scenario_replace_closed_restaurant
scenario_reorganize_rain
scenario_reframe_tired
scenario_state_edit
scenario_conflict_closed_museum
scenario_memory_reuse
```

## 17.4 E2E tests

Use Playwright for:

- New Trip,
- map / itinerary,
- proposal confirmation,
- State,
- Profile,
- Receipts.

---

# 18. CLAUDE CODE TASK EXECUTION FORMAT

For each implementation task, Claude Code should work in this sequence.

## Before coding

1. State current Gate.
2. State exact files to change.
3. State acceptance criteria.
4. State tests that should pass.
5. Identify whether the change affects Product, Domain, UI, Data, or Research.

## During coding

- Make the smallest coherent change.
- Do not implement later-gate features early.
- Keep domain logic out of UI components.
- Do not weaken validation to make a test pass.

## After coding

Report:

```text
Implemented:
Files changed:
Tests added:
Tests passed:
Known limitations:
Next recommended task:
```

Do not silently change product rules.

If a product ambiguity is found:

> stop and surface the ambiguity before implementing a new rule.

---

# 19. FIRST CLAUDE CODE EXECUTION PLAN

Use this exact sequence.

## Task 1

Create repository structure and docs placeholders.

Do not build UI.

## Task 2

Create normative TypeScript domain types.

Include:

- Trip
- TripState
- Priority
- Plan
- Proposal
- Receipt
- Memory.

## Task 3

Create Tokyo demo data schemas + validation script.

## Task 4

Load `demo_tokyo_v1` into local persistence.

## Task 5

Implement diff + classifier with unit tests.

## Task 6

Implement validation engine.

## Task 7

Implement proposal state machine + atomic commit.

## Task 8

Implement minimal LLM structured-output service.

## Task 9

Implement first Plan generation.

## Task 10

Build the Thin Vertical Slice UI, beginning with the normative two-stage New Trip flow in §3.6.

Only after Tasks 1–9 are stable.

---

# 20. MVP SUCCESS CRITERIA

The product is successful as an MVP when it can clearly demonstrate both core themes.

## Personal Memory

A reviewer can see:

```text
Evidence / explicit user input
→ candidate Memory
→ user confirmation
→ active Memory
→ future-trip snapshot
→ recommendation
→ rationale citing Memory
```

## Human–Agent Collaboration

A reviewer can see:

```text
User request
→ agent proposal
→ clear diff
→ understandable impact
→ user confirmation
→ atomic State / Plan commit
→ persistent Receipt
```

If these two loops are reliable and understandable, secondary travel features should not delay release.

---

# 21. CURRENT NON-BLOCKING FUTURE ITEMS

Do not implement before MVP success criteria pass:

- multi-hotel trips
- post-trip learning
- proactive weather monitoring
- booking
- advanced cost accounting
- live reservation inventory
- multi-user collaboration
- rollback / undo
- automatic Priority creation without confirmation
- whole-trip explanation
- arbitrary drag-and-drop itinerary editing
- large-scale destination support beyond Tokyo

---

# END
