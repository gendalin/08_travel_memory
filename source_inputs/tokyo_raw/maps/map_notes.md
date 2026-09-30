# Map Source Notes

## The workflow: one CSV per trip

Export the trip's saved list from Google Takeout and drop the CSV in this
folder, named after the list:

```text
maps/
├── Tokyo.csv              # ← the saved-places export. This is the whole input.
├── map_links.csv          # optional, usually empty (see bottom)
├── map_links.example.csv  # template for the optional channel
└── map_notes.md
```

Any `.csv` here that is not `map_links.csv` / `map_links.example.csv` is read as
a saved-places export. Nothing needs registering — drop the file and re-run
`npm run preprocess:tokyo`.

---

## How to export

Google Takeout → **Saved** → the list → export. One list, one CSV.

There is no API that reads a Google saved list, and scraping the share page is
fragile and against the Terms of Service. Takeout is the supported path.

---

## Expected columns

Takeout writes the header in the account's display language. Both are read:

| Chinese | English | Used as |
| --- | --- | --- |
| `標題` | `Title` | place name |
| `筆記` | `Note` | the user's own note — kept, and treated as intent |
| `網址` | `URL` | original Google Maps place URL |
| `標籤` | `Tags` | kept, not yet interpreted |
| `留言` | `Comment` | kept, not yet interpreted |

A leading blank row is normal Takeout output and is skipped. Rows without a
name are not places and are skipped.

---

## Place identity without an API key

The export URL embeds Google's feature id:

```text
https://www.google.com/maps/place/Sawada/data=!4m2!3m1!1s0x60188be6f5d7cc35:0x72daba306bd91406
                                                        └──────── ftid ────────┘
```

That `ftid` is stable, so it is used as `placeId` directly. A Places API key is
**not** needed to identify a place — only to enrich it with coordinates,
category, price level and opening hours.

---

## Ids

```text
Tokyo.csv  ->  list source id   list_tokyo
               place ids        tokyo_001, tokyo_002, ...
               every place carries parentSourceId = list_tokyo
```

Ids are positional, so reordering rows in the CSV reassigns them. `placeId`
(the ftid) is the identity that survives reordering.

---

## Scope rule

**Everything in the list counts as part of that trip**, including places outside
the destination city. `江之浦測候所` sits in Odawara, ~80 km from Tokyo; it is in
the list, so it is in scope, and the planner is expected to handle it as a day
trip rather than filter it out.

No geographic filtering is applied to list places.

---

## Interpretation rules

- A saved place is **not** a confirmed preference.
- One saved place is weak evidence. Repeated categories are stronger — the
  threshold is 3 items before a category counts as a trend.
- A user's own `筆記` / `Note` is a stronger intent signal than a bare save.
- Preserve the original source id, URL and list relation in provenance.
- A list is a container, never a place.

---

## `map_links.csv` — optional

Held over from the original spec for ad-hoc share URLs
(`source_id,type,url,note`, types `google_maps_list` / `google_maps_place`).
Normally left as a header-only file.

A `google_maps_list` row here cannot be expanded — there is no API for it — so
it is recorded as one clearly-labelled *unresolved list* record and never
counted as a single saved place. If you find yourself adding list rows here,
export the list instead.
