/**
 * Shared types and paths for the Tokyo demo preprocessing pipeline.
 *
 * Boundary reminder:
 *   source_inputs/  ->  scripts/preprocess/  ->  data/demo_tokyo_v1/  ->  product
 *
 * Product code under /src must never import from this module's RAW paths,
 * and must never read source_inputs/ directly.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(HERE, '..', '..')

export const PATHS = {
  /** Read-only. Never rename, overwrite, compress or delete anything below this. */
  raw: {
    root: resolve(REPO_ROOT, 'source_inputs/tokyo_raw'),
    photos: resolve(REPO_ROOT, 'source_inputs/tokyo_raw/photos'),
    screenshots: resolve(REPO_ROOT, 'source_inputs/tokyo_raw/screenshots'),
    mapLinks: resolve(REPO_ROOT, 'source_inputs/tokyo_raw/maps/map_links.csv'),
    /** Folder holding the saved-places export (and map_links.csv). */
    mapsDir: resolve(REPO_ROOT, 'source_inputs/tokyo_raw/maps'),
    context: resolve(REPO_ROOT, 'source_inputs/tokyo_raw/source_context.md'),
  },
  /** Normalized output. The only data the product may consume. */
  out: {
    root: resolve(REPO_ROOT, 'data/demo_tokyo_v1'),
    manifest: resolve(REPO_ROOT, 'data/demo_tokyo_v1/manifest.json'),
    userContext: resolve(REPO_ROOT, 'data/demo_tokyo_v1/user_context.json'),
    memories: resolve(REPO_ROOT, 'data/demo_tokyo_v1/memories.json'),
    evidence: resolve(REPO_ROOT, 'data/demo_tokyo_v1/evidence.json'),
    places: resolve(REPO_ROOT, 'data/demo_tokyo_v1/tokyo_places.json'),
    scenario: resolve(REPO_ROOT, 'data/demo_tokyo_v1/demo_scenario.json'),
  },
} as const

/** Repo-relative POSIX path, used for provenance in evidence records. */
export function relPath(absolutePath: string): string {
  return absolutePath.slice(REPO_ROOT.length + 1).split('\\').join('/')
}

// ---------------------------------------------------------------------------
// Normalized source records (intermediate, in-memory only)
// ---------------------------------------------------------------------------

export interface GeoPoint {
  lat: number
  lng: number
}

export interface PhotoMetadata {
  /** Repo-relative path back to the untouched original. */
  sourcePath: string
  fileName: string
  /** EXIF DateTimeOriginal, local time, ISO-like without timezone. Null when absent. */
  capturedAt: string | null
  /** EXIF GPS, when present. Null when absent — never guessed. */
  location: GeoPoint | null
  /** Free-form, non-identifying scene summary. Filled by a later stage. */
  summary?: string
}

export const MAP_SOURCE_TYPES = ['google_maps_list', 'google_maps_place'] as const
export type MapSourceType = (typeof MAP_SOURCE_TYPES)[number]

/** One raw row of map_links.csv. */
export interface MapLinkRow {
  source_id: string
  type: string
  url: string
  note: string
}

export interface NormalizedMapLink {
  sourceId: string
  type: MapSourceType
  url: string
  note: string
  /** Place name, when the source carries one (Takeout exports do; share URLs do not). */
  name?: string
  /** Google feature id from the place URL. Stable, and available without an API key. */
  ftid?: string
  /** Set once list/place resolution is implemented. */
  placeId?: string
  /** For places resolved out of a list, the list's source_id. */
  parentSourceId?: string
}

export interface ScreenshotRecord {
  sourcePath: string
  fileName: string
  /** File mtime or EXIF, when available. Screenshots often carry no capture time. */
  capturedAt: string | null
  /** Interest signal only — never a visit. Filled by a later stage. */
  summary?: string
}

// ---------------------------------------------------------------------------
// Normalized output contracts (data/demo_tokyo_v1/)
// ---------------------------------------------------------------------------

export type EvidenceKind = 'photo' | 'saved_place' | 'screenshot'

export interface EvidenceRecord {
  id: string
  kind: EvidenceKind
  /** Always retained so any record can be traced back to raw input. */
  sourcePath: string
  /** Present for map-derived evidence: the map_links.csv source_id. */
  sourceId?: string
  /** For a place expanded out of a saved list, that list's source_id. */
  parentSourceId?: string
  placeId?: string
  observedAt?: string | null
  location?: GeoPoint | null
  summary: string
  /** Taxonomy category id, or "unclassified". Absent until a stage resolves one. */
  category?: string
  /** 0-1, from whichever signal produced the category. */
  categoryConfidence?: number
  /** Which signal produced the category, in descending order of trust. */
  categorySource?: 'google_places' | 'vision' | 'llm_name' | 'keywords'
  /** Business name read off a screenshot, when legible. */
  placeName?: string
}

/** Preprocessing emits `candidate` only. `active` is a product-runtime state. */
export type MemoryStatus = 'candidate'

/** Mirrors the product's MemoryKind; preprocessing only emits these two. */
export type CandidateMemoryKind = 'preference' | 'pattern'

/**
 * What a candidate memory is about. Serialised shape of the product's
 * MemorySubject: a facet name plus its value, where a measured pattern's value is
 * a number rather than a label.
 */
export interface CandidateMemorySubject {
  facet:
    | 'category'
    | 'price_band'
    | 'time_fit'
    | 'stay_length'
    | 'stops_per_day'
    | 'day_span_metres'
    | 'start_minutes'
  value: string | number
}

export interface CandidateMemory {
  id: string
  text: string
  status: MemoryStatus
  kind: CandidateMemoryKind
  subject: CandidateMemorySubject
  /** 1 draws toward the subject, -1 away. Preprocessing only infers attraction. */
  polarity: 1 | -1
  /** 0-1: how much the traveller appears to care. The planning weight. */
  strength: number
  /** Independent from status AND from strength. A 0.9 memory is still a candidate. */
  confidence: number
  /**
   * How much of a trip the memory may claim. Absent when the evidence cannot say —
   * the planner then falls back to a heuristic rather than inventing a rate.
   */
  scope?: { ratePerDay?: number }
  provenance: {
    type: string
    /** Must be non-empty and must resolve against evidence.json ids. */
    sourceRefs: string[]
  }
}

export interface UserContext {
  typicalStartTime: string | null
  avgDailyStops: number | null
  walkingTolerance: string | null
  preferredAreaPattern: string | null
  notes: string[]
}

export interface DemoPlace {
  placeId: string
  name: string
  lat: number
  lng: number
  category: string
  neighborhood: string
  priceLevel?: 0 | 1 | 2 | 3 | 4
  /** Per-weekday spans, "11:00-15:00" or "closed" — same shape the runtime reads. */
  openingHours?: Record<string, string>
  typicalDurationMin: number
  tags: string[]
  shortDescription: string
  source: 'places_api' | 'map_source' | 'screenshot' | 'manual_demo'
}

export interface Manifest {
  schemaVersion: string
  bundleId: string
  destination: string
  generatedAt: string | null
  sourceCounts: {
    photos: number
    mapLinks: number
    screenshots: number
  }
}

export interface DemoScenario {
  trip: { name: string; days: number; baseLodging: string }
  events: Array<{
    id: string
    day: number
    text: string
    /** Bound only after tokyo_places.json holds real places. */
    placeId?: string
    alternativePlaceIds?: string[]
  }>
}

// ---------------------------------------------------------------------------
// Small IO helpers
// ---------------------------------------------------------------------------

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

/**
 * Decimal places kept on coordinates written to data/demo_tokyo_v1/.
 *
 * 4 dp is about 11 m. EXIF GPS arrives as rationals that float-divide into
 * 14 decimal places (35.76400000000001), which is noise, not accuracy — and
 * that noise would be committed to version control verbatim.
 *
 * This is false-precision cleanup, NOT a privacy measure: 11 m still pinpoints
 * a building. Drop to 2 dp (~1.1 km) if the intent is to blur the trail.
 * 4 dp sits far below the 250 m stop-clustering radius, so derived pace,
 * stop counts and spans are unaffected.
 */
export const EVIDENCE_COORD_DECIMALS = 4

export function roundCoordinate(value: number, decimals = EVIDENCE_COORD_DECIMALS): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** Stable, zero-padded ids so reruns over unchanged input are reproducible. */
export function makeId(prefix: string, index: number): string {
  return `${prefix}_${String(index).padStart(3, '0')}`
}
