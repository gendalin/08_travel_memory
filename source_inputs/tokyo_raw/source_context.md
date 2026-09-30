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
