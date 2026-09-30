# The Next Trip — Preprocessing Setup Spec
## Claude Code instructions for raw source structure and demo-data preparation

**Status:** Ready to execute  
**Scope:** Repository file/folder setup for Tokyo demo preprocessing  
**Product boundary:** Raw source ingestion and preprocessing are outside the user-facing product flow.

---

# 1. Objective

Create a clear boundary between:

```text
RAW SOURCES
    ↓
PREPROCESSING
    ↓
NORMALIZED DEMO DATA
    ↓
PRODUCT
```

The product must never read directly from `source_inputs/`.

Claude Code should first create the repository structure and templates in this spec.  
Do **not** begin product UI implementation as part of this task.

---

# 2. Required Repository Structure

Create the following structure:

```text
/
├── source_inputs/
│   └── tokyo_raw/
│       ├── maps/
│       │   ├── map_links.csv
│       │   └── map_notes.md
│       │
│       ├── photos/
│       │   └── .gitkeep
│       │
│       ├── screenshots/
│       │   └── .gitkeep
│       │
│       └── source_context.md
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
│   ├── preprocess/
│   │   ├── extract_photo_metadata.ts
│   │   ├── normalize_map_links.ts
│   │   ├── normalize_screenshots.ts
│   │   ├── build_evidence.ts
│   │   ├── build_candidate_memories.ts
│   │   ├── build_user_context.ts
│   │   └── build_tokyo_demo_bundle.ts
│   │
│   └── validate_demo_data.ts
│
├── docs/
│   ├── preprocessing_spec.md
│   └── demo_data_contract.md
│
└── .gitignore
```

If equivalent project folders already exist, merge into them rather than duplicating structure.

---

# 3. Raw Source Rules

## 3.1 Raw sources are immutable

Files under:

```text
/source_inputs/tokyo_raw/
```

must be treated as read-only source material.

Preprocessing scripts may:

- read,
- parse,
- extract metadata,
- generate derived files.

They must not:

- rename original source files,
- overwrite original source files,
- modify EXIF metadata,
- compress originals,
- delete originals.

---

## 3.2 Product isolation

Application/runtime code under `/src` must never directly import or read:

```text
/source_inputs/
```

Only normalized output under:

```text
/data/demo_tokyo_v1/
```

may be consumed by the product.

---

# 4. Map Source Input

Create:

```text
/source_inputs/tokyo_raw/maps/map_links.csv
```

with this exact header:

```csv
source_id,type,url,note
```

Add these example rows as comments in `map_notes.md`, not as fake data in the CSV:

```text
map_001,google_maps_list,https://maps.app.goo.gl/xxxxx,Tokyo saved places
map_002,google_maps_place,https://maps.app.goo.gl/yyyyy,Bookstore I saved
map_003,google_maps_place,https://maps.app.goo.gl/zzzzz,Cafe
```

Supported `type` values for MVP:

```text
google_maps_list
google_maps_place
```

Rules:

- `source_id` must be unique.
- `url` is the original user-provided share URL.
- `note` may be empty.
- Do not infer preference from a single saved place.
- Repeated category patterns may contribute stronger evidence.

---

# 5. Photo Source Input

Raw travel photos go in:

```text
/source_inputs/tokyo_raw/photos/
```

Preferred source files:

- HEIC
- JPG / JPEG
- PNG only when the file is actually a photo

Preserve:

- original filename,
- EXIF date/time,
- GPS,
- original image bytes.

Do not require the user to manually create metadata files.

Preprocessing should extract available metadata automatically.

For the MVP, use a representative subset rather than an entire photo library.

The goal is to support evidence for:

- travel pace,
- daily start time,
- number of stops,
- movement pattern,
- spatial range,
- repeated content / destination categories.

The preprocessing pipeline must not infer:

- identity of people,
- personal relationships,
- sensitive traits.

---

# 6. Screenshot Source Input

Raw screenshots go in:

```text
/source_inputs/tokyo_raw/screenshots/
```

Screenshots must remain a separate evidence type from travel photos.

Screenshots may represent:

- a saved restaurant,
- a destination recommendation,
- an exhibition,
- social-media content,
- a travel article,
- a map result.

Interpretation rule:

> Screenshot = intentional saved information / possible interest.

Do not interpret a screenshot as proof that the user visited that place.

---

# 7. `source_context.md`

Create:

```text
/source_inputs/tokyo_raw/source_context.md
```

with this starter content:

```md
# Tokyo Preprocessing Context

## Purpose

These raw sources are used only to prepare the Tokyo demo dataset for The Next Trip.

They are not read directly by the product.

---

## Photos

Photos may come from previous trips.

Use them to derive evidence related to:

- travel pace
- typical daily start time
- walking / movement pattern
- spatial range
- repeated destination categories
- repeated activity patterns

Do not infer:

- who people are
- personal relationships
- sensitive personal traits

A photographed subject does not automatically equal a stable preference.

---

## Maps

Google Maps links represent places intentionally saved or collected.

Saved place != confirmed preference.

Treat:

- one saved place as weak evidence
- repeated categories / repeated patterns as stronger evidence

Preserve the original source id and URL provenance.

---

## Screenshots

Screenshots represent content intentionally saved by the user.

They may indicate interest, but do not imply the place was visited.

Keep screenshots separate from historical-behavior evidence.

---

## Memory rule

Preprocessing may produce candidate memories only.

Preprocessing must never directly create active memory.

Every inferred memory must preserve provenance and source references.
```

---

# 8. `map_notes.md`

Create:

```text
/source_inputs/tokyo_raw/maps/map_notes.md
```

with:

```md
# Map Source Notes

Use `map_links.csv` for all source URLs.

Supported source types:

- `google_maps_list`
- `google_maps_place`

Example format:

```csv
source_id,type,url,note
map_001,google_maps_list,https://maps.app.goo.gl/xxxxx,Tokyo saved places
map_002,google_maps_place,https://maps.app.goo.gl/yyyyy,Bookstore I saved
```

Rules:

- Keep original URLs unchanged.
- Do not treat one saved place as a confirmed preference.
- Resolve list sources into individual place evidence during preprocessing.
- Preserve the original collection/source relation in provenance.
```

---

# 9. Normalized Demo Output

Preprocessing must eventually produce:

```text
/data/demo_tokyo_v1/
```

with six files.

---

## 9.1 `manifest.json`

Initialize with:

```json
{
  "schemaVersion": "1.0",
  "bundleId": "demo_tokyo_v1",
  "destination": "Tokyo",
  "generatedAt": null,
  "sourceCounts": {
    "photos": 0,
    "mapLinks": 0,
    "screenshots": 0
  }
}
```

---

## 9.2 `user_context.json`

Initialize with:

```json
{
  "typicalStartTime": null,
  "avgDailyStops": null,
  "walkingTolerance": null,
  "preferredAreaPattern": null,
  "notes": []
}
```

This file stores summarized behavioral context.

It is not active Memory.

---

## 9.3 `memories.json`

Initialize as:

```json
[]
```

Preprocessing rules:

- output only `candidate` memories,
- never output `active`,
- confidence is independent from status,
- every memory must have provenance,
- every inferred memory must have valid `sourceRefs`.

Expected item form:

```json
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
```

---

## 9.4 `evidence.json`

Initialize as:

```json
[]
```

Every evidence object must retain the path or source id needed to trace it back to raw input.

Example photo evidence:

```json
{
  "id": "ev_043",
  "kind": "photo",
  "sourcePath": "source_inputs/tokyo_raw/photos/IMG_3291.HEIC",
  "observedAt": "2026-09-05T15:32:00",
  "location": {
    "lat": 0,
    "lng": 0
  },
  "summary": "Street / local neighborhood scene"
}
```

Example map evidence:

```json
{
  "id": "ev_102",
  "kind": "saved_place",
  "sourcePath": "source_inputs/tokyo_raw/maps/map_links.csv",
  "sourceId": "map_002",
  "placeId": "PLACE_ID",
  "summary": "Saved independent bookstore"
}
```

Example screenshot evidence:

```json
{
  "id": "ev_144",
  "kind": "screenshot",
  "sourcePath": "source_inputs/tokyo_raw/screenshots/screenshot_014.png",
  "summary": "Saved restaurant recommendation in Tokyo"
}
```

---

## 9.5 `tokyo_places.json`

Initialize as:

```json
[]
```

Target for the MVP:

> 80–150 curated Tokyo POIs.

Coverage target:

- 6–8 neighborhoods
- 8–10 useful categories
- sufficient alternatives for scripted demo cases
- meaningful contrast for Personal Memory / State effects

Do not optimize for maximum POI count.

Expected shape:

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

Use one stable place identity across map, routing, itinerary, evidence, and alternatives.

---

## 9.6 `demo_scenario.json`

Initialize with:

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

Do not bind scenario events to fake POIs yet.

Only bind them after `tokyo_places.json` contains valid demo places and alternatives.

---

# 10. Preprocessing Scripts

Claude Code should create script placeholders under:

```text
/scripts/preprocess/
```

The first implementation can be minimal.

---

## 10.1 `extract_photo_metadata.ts`

Responsibilities:

- list photo files,
- preserve source path,
- extract EXIF when available,
- capture date/time,
- capture GPS,
- output normalized metadata,
- do not modify originals.

---

## 10.2 `normalize_map_links.ts`

Responsibilities:

- read `map_links.csv`,
- validate supported source types,
- preserve original source id,
- normalize URLs,
- resolve place/list identities when implementation is available,
- emit evidence-ready records.

---

## 10.3 `normalize_screenshots.ts`

Responsibilities:

- list screenshot files,
- preserve source path,
- prepare screenshot evidence records,
- leave semantic extraction extensible.

Do not classify screenshots as visits.

---

## 10.4 `build_evidence.ts`

Responsibilities:

- merge normalized source records,
- create stable evidence ids,
- retain provenance,
- write `evidence.json`.

---

## 10.5 `build_candidate_memories.ts`

Responsibilities:

- derive candidate memories from evidence,
- never activate memory,
- retain sourceRefs,
- keep confidence separate from status.

This may initially use deterministic sample logic before LLM inference is added.

---

## 10.6 `build_user_context.ts`

Responsibilities:

derive compact behavior summary such as:

- typical start time,
- average daily stops,
- walking tolerance,
- compact vs broad area pattern.

Do not duplicate these values as active Memory automatically.

---

## 10.7 `build_tokyo_demo_bundle.ts`

Responsibilities:

orchestrate preprocessing:

```text
raw inputs
→ normalized sources
→ evidence
→ candidate memories
→ user context
→ manifest update
→ validation
```

---

# 11. Data Validation

Create:

```text
/scripts/validate_demo_data.ts
```

Add npm script:

```json
{
  "scripts": {
    "validate:data": "tsx scripts/validate_demo_data.ts"
  }
}
```

Validation must fail when:

- ids are duplicated,
- a `sourceRef` points to missing evidence,
- POI coordinates are missing,
- candidate memories lack provenance,
- a preprocessed Memory has status `active`,
- a scripted scenario references a missing POI,
- malformed map source types exist.

Validation should print a readable summary.

Example:

```text
Tokyo demo data validation

✓ manifest
✓ 84 places
✓ 136 evidence records
✓ 9 candidate memories
✓ source references valid
✓ no active preprocessing memories

0 errors
```

---

# 12. Git / Privacy Rules

Update `.gitignore`.

At minimum:

```gitignore
# Raw personal sources
source_inputs/tokyo_raw/photos/*
source_inputs/tokyo_raw/screenshots/*

# Keep directory structure
!source_inputs/tokyo_raw/photos/.gitkeep
!source_inputs/tokyo_raw/screenshots/.gitkeep

# Secrets
.env
.env.local

# Local preprocessing cache
.cache/
tmp/
```

Do not commit personal raw photos or screenshots by default.

Before committing map links, confirm whether the URLs are acceptable to keep in the repository.

If not, keep `map_links.csv` local and add a tracked:

```text
map_links.example.csv
```

---

# 13. Claude Code Execution Order

Claude Code should execute this setup in the following order.

## Task 1 — Create folders

Create all folders in §2.

Do not process any user files yet.

---

## Task 2 — Create source templates

Create:

- `map_links.csv`
- `map_notes.md`
- `source_context.md`
- `.gitkeep` files

---

## Task 3 — Create demo output placeholders

Create all six files under:

```text
/data/demo_tokyo_v1/
```

using the initial contents defined above.

---

## Task 4 — Create preprocessing script skeletons

Create all files in:

```text
/scripts/preprocess/
```

with:

- clear responsibilities,
- typed input/output interfaces,
- TODO markers where implementation is deferred.

Do not invent source data.

---

## Task 5 — Create data validator

Implement enough validation for placeholder data and future real data.

---

## Task 6 — Add npm scripts

At minimum:

```text
validate:data
preprocess:tokyo
```

Suggested:

```json
{
  "scripts": {
    "preprocess:tokyo": "tsx scripts/preprocess/build_tokyo_demo_bundle.ts",
    "validate:data": "tsx scripts/validate_demo_data.ts"
  }
}
```

Adapt to the repository's existing package tooling if needed.

---

## Task 7 — Stop

After structure is created:

**Do not begin semantic analysis of photos, map links, or screenshots until the user has placed the raw source files into the folders.**

Report:

```text
Created:
Files added:
Commands available:
Where user should add raw data:
Next step:
```

---

# 14. What the User Does After Claude Code Finishes

The user only needs to provide source material.

## Maps

Edit:

```text
source_inputs/tokyo_raw/maps/map_links.csv
```

Add real Google Maps list/place URLs.

---

## Photos

Copy selected original travel photos into:

```text
source_inputs/tokyo_raw/photos/
```

Prefer original HEIC / JPEG files with EXIF intact.

---

## Screenshots

Copy selected screenshots into:

```text
source_inputs/tokyo_raw/screenshots/
```

---

## Context

Edit if needed:

```text
source_inputs/tokyo_raw/source_context.md
```

Do not manually classify every photo or screenshot.

---

# 15. First Real Preprocessing Run

Only after the raw sources are present:

```bash
npm run preprocess:tokyo
npm run validate:data
```

Claude Code should then inspect validation output before proceeding.

The expected product boundary remains:

```text
source_inputs/
    ↓
scripts/preprocess/
    ↓
data/demo_tokyo_v1/
    ↓
product
```

The app must not directly read raw source files.

---

# 16. Definition of Done for This Setup Task

This repository-setup task is complete when:

- all source folders exist,
- all templates exist,
- all normalized output placeholders exist,
- preprocessing script skeletons exist,
- validation command exists,
- raw personal files are git-ignored,
- product code has no dependency on `source_inputs/`,
- Claude Code has stopped before processing non-existent raw data.

---

# END
