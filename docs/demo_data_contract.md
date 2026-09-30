# Demo Data Contract — `data/demo_tokyo_v1/`

The only data the product may read. Six files, all validated by
`npm run validate:data`. Types: [`../scripts/preprocess/types.ts`](../scripts/preprocess/types.ts).

---

## `manifest.json`

```json
{
  "schemaVersion": "1.0",
  "bundleId": "demo_tokyo_v1",
  "destination": "Tokyo",
  "generatedAt": null,
  "sourceCounts": { "photos": 0, "mapLinks": 0, "screenshots": 0 }
}
```

`generatedAt` is null until the first real preprocessing run.

---

## `user_context.json`

Summarized behavioral context. **Not active Memory**, and never promoted to
Memory automatically.

```json
{
  "typicalStartTime": null,
  "avgDailyStops": null,
  "walkingTolerance": null,
  "preferredAreaPattern": null,
  "notes": []
}
```

A field stays null when the evidence cannot support it.

---

## `evidence.json`

Array. Every record retains the path or source id needed to trace it back to raw
input. Three kinds: `photo`, `saved_place`, `screenshot`.

```json
{
  "id": "ev_043",
  "kind": "photo",
  "sourcePath": "source_inputs/tokyo_raw/photos/IMG_3291.HEIC",
  "observedAt": "2026-09-05T15:32:00",
  "location": { "lat": 0, "lng": 0 },
  "summary": "Street / local neighborhood scene"
}
```

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

```json
{
  "id": "ev_144",
  "kind": "screenshot",
  "sourcePath": "source_inputs/tokyo_raw/screenshots/screenshot_014.png",
  "summary": "Saved restaurant recommendation in Tokyo"
}
```

Rules: ids unique; `sourcePath` always present; `saved_place` always keeps its
`sourceId`; `location` is null when EXIF carries no GPS — never guessed.

---

## `memories.json`

Array of candidate memories.

```json
{
  "id": "mem_001",
  "text": "Often saves local markets",
  "status": "candidate",
  "confidence": 0.74,
  "provenance": { "type": "saved_places", "sourceRefs": ["ev_012", "ev_031"] }
}
```

Rules:

- `status` is always `"candidate"` — preprocessing never emits `"active"`
- `confidence` (0–1) is independent from `status`
- `provenance.sourceRefs` is non-empty and every id resolves in `evidence.json`

---

## `tokyo_places.json`

Array of curated POIs. Target 80–150, covering 6–8 neighborhoods and 8–10
categories, with enough alternatives for the scripted demo cases and meaningful
contrast for Personal Memory / State effects. Not optimized for raw count.

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
  source: 'places_api' | 'map_source' | 'screenshot' | 'manual_demo'
}
```

`placeId` is the one stable place identity across map, routing, itinerary,
evidence and alternatives. Coordinates are required and must not be `(0,0)`.

---

## `demo_scenario.json`

```json
{
  "trip": { "name": "Tokyo Slow Week", "days": 5, "baseLodging": "Kuramae" },
  "events": [
    { "id": "evt_closed_restaurant", "day": 2, "text": "The ramen place on Day 2 is closed today." },
    { "id": "evt_rain", "day": 3, "text": "It's going to rain after 3pm on Day 3." },
    { "id": "evt_tired", "day": 3, "text": "I feel tired. Fewer spots." }
  ]
}
```

Events may later carry `placeId` and `alternativePlaceIds`. Bind them only after
`tokyo_places.json` holds valid demo places and alternatives — the validator
rejects a reference to a missing POI.

---

## Validation

`npm run validate:data` fails when:

- ids are duplicated
- a `sourceRef` points to missing evidence
- POI coordinates are missing
- candidate memories lack provenance
- a preprocessed memory has status `active`
- a scripted scenario references a missing POI
- malformed map source types exist

Warnings (not failures) flag expected placeholder states: null `generatedAt`,
fewer than 80 places, unbound scenario events.
