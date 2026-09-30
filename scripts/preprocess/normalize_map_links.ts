/**
 * normalize_map_links.ts
 *
 * Responsibilities:
 *   - read the saved-places export in source_inputs/tokyo_raw/maps/ (Takeout CSV)
 *   - read map_links.csv, if the optional share-URL channel is in use
 *   - validate supported source types
 *   - preserve the original source id
 *   - normalize URLs
 *   - resolve place/list identities when that implementation is available
 *   - emit evidence-ready records
 *
 * Interpretation rules:
 *   - a saved place is not a confirmed preference
 *   - one saved place is weak evidence; repeated categories are stronger
 *
 * Output feeds build_evidence.ts. Nothing is written to disk by this module.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

import {
  MAP_SOURCE_TYPES,
  PATHS,
  relPath,
  type MapLinkRow,
  type MapSourceType,
  type NormalizedMapLink,
} from './types.ts'

export interface MapLinkResult {
  links: NormalizedMapLink[]
  errors: string[]
}

/** One Google Takeout saved-list export. */
export interface TakeoutList {
  /** Source id for the list itself, e.g. "list_tokyo". */
  sourceId: string
  /** Human list name, from the filename. */
  name: string
  /** Repo-relative path to the export. */
  sourcePath: string
  places: NormalizedMapLink[]
}

/**
 * Takeout writes its header in the account's display language.
 * Only the columns the pipeline actually consumes are mapped.
 */
const TAKEOUT_COLUMNS: Record<string, 'name' | 'note' | 'url'> = {
  '標題': 'name',
  'Title': 'name',
  '筆記': 'note',
  'Note': 'note',
  '網址': 'url',
  'URL': 'url',
}

/** "Tokyo JP food 100.csv" -> "tokyo_jp_food_100" */
export function slugifyListName(fileName: string): string {
  return basename(fileName, extname(fileName))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Google embeds a stable feature id in place URLs:
 *   .../data=!4m2!3m1!1s0x60188be6f5d7cc35:0x72daba306bd91406
 * It identifies the place without any API call, so it is used as placeId.
 */
export function extractFtid(url: string): string | undefined {
  const match = url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)
  return match?.[1]
}

/** Reads one Takeout export into place-level records. */
export function parseTakeoutList(csv: string, listSourceId: string, slug: string): NormalizedMapLink[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length === 0) return []

  const header = splitCsvLine(lines[0]).map((cell) => cell.replace(/^\ufeff/, ''))
  const columns = header.map((cell) => TAKEOUT_COLUMNS[cell])

  const places: NormalizedMapLink[] = []
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line)
    const row: { name?: string; note?: string; url?: string } = {}
    columns.forEach((key, i) => {
      if (key) row[key] = cells[i] ?? ''
    })

    // Takeout emits a blank separator row; a row without a name is not a place.
    if (!row.name) continue

    places.push({
      sourceId: `${slug}_${String(places.length + 1).padStart(3, '0')}`,
      type: 'google_maps_place',
      url: normalizeUrl(row.url ?? ''),
      note: row.note ?? '',
      name: row.name,
      ftid: extractFtid(row.url ?? ''),
      placeId: extractFtid(row.url ?? ''),
      parentSourceId: listSourceId,
    })
  }

  return places
}

/**
 * Filenames in maps/ that are the share-URL channel, not saved-places exports.
 * Every other .csv in the folder is treated as an export.
 */
const RESERVED_CSV_NAMES = new Set(['map_links.csv', 'map_links.example.csv'])

/**
 * Discovers and reads the saved-places export(s) in maps/.
 *
 * The expected setup is a single Takeout CSV named after the trip list
 * ("Tokyo.csv"). More than one file still works — each becomes its own list
 * source — but is not the intended workflow.
 */
export function readTakeoutLists(dir: string = PATHS.raw.mapsDir): TakeoutList[] {
  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter(
      (name) =>
        !name.startsWith('.') &&
        extname(name).toLowerCase() === '.csv' &&
        !RESERVED_CSV_NAMES.has(name),
    )
    .sort()
    .map((fileName) => {
      const slug = slugifyListName(fileName)
      const listSourceId = `list_${slug}`
      return {
        sourceId: listSourceId,
        name: basename(fileName, extname(fileName)),
        sourcePath: relPath(join(dir, fileName)),
        places: parseTakeoutList(readFileSync(join(dir, fileName), 'utf8'), listSourceId, slug),
      }
    })
}


/** Minimal CSV reader: 4 known columns, quoted fields supported, no embedded newlines. */
export function parseMapLinksCsv(csv: string): MapLinkRow[] {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length === 0) return []

  const header = splitCsvLine(lines[0])
  const expected = ['source_id', 'type', 'url', 'note']
  if (expected.some((column, i) => header[i] !== column)) {
    throw new Error(`map_links.csv header must be: ${expected.join(',')}`)
  }

  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line)
    return {
      source_id: cells[0] ?? '',
      type: cells[1] ?? '',
      url: cells[2] ?? '',
      note: cells[3] ?? '',
    }
  })
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"'
        i++
      } else if (char === '"') {
        inQuotes = false
      } else {
        current += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim())
  return cells
}

/** Trim and drop tracking query params. The original URL text is never rewritten beyond this. */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  try {
    const parsed = new URL(trimmed)
    for (const param of ['utm_source', 'utm_medium', 'utm_campaign', 'g_st']) {
      parsed.searchParams.delete(param)
    }
    return parsed.toString()
  } catch {
    return trimmed
  }
}

export function normalizeMapLinks(csvPath: string = PATHS.raw.mapLinks): MapLinkResult {
  const errors: string[] = []
  // The share-URL channel is optional. With the single-CSV workflow the file is
  // normally absent, which is not an error — the saved-places export is the input.
  if (!existsSync(csvPath)) {
    return { links: [], errors: [] }
  }

  const rows = parseMapLinksCsv(readFileSync(csvPath, 'utf8'))
  const seen = new Set<string>()
  const links: NormalizedMapLink[] = []

  for (const [index, row] of rows.entries()) {
    const line = index + 2
    if (!row.source_id) {
      errors.push(`line ${line}: source_id is required`)
      continue
    }
    if (seen.has(row.source_id)) {
      errors.push(`line ${line}: duplicate source_id "${row.source_id}"`)
      continue
    }
    if (!MAP_SOURCE_TYPES.includes(row.type as MapSourceType)) {
      errors.push(
        `line ${line}: unsupported type "${row.type}" (expected ${MAP_SOURCE_TYPES.join(' | ')})`,
      )
      continue
    }
    if (!row.url) {
      errors.push(`line ${line}: url is required`)
      continue
    }

    seen.add(row.source_id)
    links.push({
      sourceId: row.source_id,
      type: row.type as MapSourceType,
      url: normalizeUrl(row.url),
      note: row.note,
    })
  }

  // TODO(preprocess): resolve identities once a Places adapter exists.
  //   google_maps_place -> one link with placeId
  //   google_maps_list  -> expand into member places, each carrying
  //                        parentSourceId = the list's source_id
  // Expansion must preserve the original collection relation in provenance.

  return { links, errors }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { links, errors } = normalizeMapLinks()
  console.log(`map links: ${links.length}, errors: ${errors.length}`)
  for (const error of errors) console.error(`  ! ${error}`)
  console.log(JSON.stringify(links, null, 2))
}
