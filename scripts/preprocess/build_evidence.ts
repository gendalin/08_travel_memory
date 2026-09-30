/**
 * build_evidence.ts
 *
 * Responsibilities:
 *   - merge normalized source records (photos, map links, screenshots)
 *   - create stable evidence ids
 *   - retain provenance back to raw input
 *   - write data/demo_tokyo_v1/evidence.json
 *
 * Every evidence object keeps the path or source id needed to trace it back to
 * raw input. Ids are assigned in a deterministic order (photos, then saved
 * places, then screenshots; each sorted by filename / source_id) so an unchanged
 * input set reproduces identical ids across runs.
 */

import { extractPhotoMetadata } from './extract_photo_metadata.ts'
import { normalizeMapLinks, readTakeoutLists, type TakeoutList } from './normalize_map_links.ts'
import type { ImageClassification } from './classify_images.ts'
import type { PlaceClassification } from './classify_places.ts'
import { normalizeScreenshots } from './normalize_screenshots.ts'
import {
  makeId,
  PATHS,
  relPath,
  roundCoordinate,
  writeJson,
  type EvidenceRecord,
  type NormalizedMapLink,
  type PhotoMetadata,
  type ScreenshotRecord,
} from './types.ts'

export interface EvidenceInputs {
  photos: PhotoMetadata[]
  mapLinks: NormalizedMapLink[]
  /** Google Takeout saved-list exports, already expanded into places. */
  takeoutLists: TakeoutList[]
  screenshots: ScreenshotRecord[]
  /** Vision results keyed by sourcePath. Empty when classification has not run. */
  classifications?: Map<string, ImageClassification>
  /** Saved-place results keyed by place name. */
  placeClassifications?: Map<string, PlaceClassification>
}

export function buildEvidence(inputs: EvidenceInputs): EvidenceRecord[] {
  const records: EvidenceRecord[] = []
  const classifications = inputs.classifications ?? new Map()
  const placeClassifications = inputs.placeClassifications ?? new Map()
  let index = 0

  /** Vision output for an image, when classification has run over it. */
  const visionFields = (sourcePath: string) => {
    const hit = classifications.get(sourcePath)
    if (!hit) return {}
    return {
      summary: hit.summary,
      category: hit.category,
      categoryConfidence: hit.confidence,
      categorySource: 'vision' as const,
      ...(hit.placeName ? { placeName: hit.placeName } : {}),
    }
  }

  for (const photo of inputs.photos) {
    records.push({
      id: makeId('ev', ++index),
      kind: 'photo',
      sourcePath: photo.sourcePath,
      observedAt: photo.capturedAt,
      location: photo.location
        ? { lat: roundCoordinate(photo.location.lat), lng: roundCoordinate(photo.location.lng) }
        : null,
      summary: photo.summary ?? '',
      ...visionFields(photo.sourcePath),
    })
  }

  for (const link of inputs.mapLinks) {
    // An unexpanded google_maps_list is a collection standing for many places,
    // not one saved place. It is recorded so provenance survives, and labelled
    // so no downstream stage miscounts it as a single place.
    const unresolvedList = link.type === 'google_maps_list' && !link.placeId
    const summary = unresolvedList
      ? `Unresolved saved-place list${link.note ? `: ${link.note}` : ''} (pending expansion into individual places)`
      : link.note

    records.push({
      id: makeId('ev', ++index),
      kind: 'saved_place',
      sourcePath: relPath(PATHS.raw.mapLinks),
      sourceId: link.sourceId,
      ...(link.placeId ? { placeId: link.placeId } : {}),
      ...(link.parentSourceId ? { parentSourceId: link.parentSourceId } : {}),
      summary,
    })
  }

  // Places expanded out of Takeout exports. Each keeps its list relation.
  for (const list of inputs.takeoutLists) {
    for (const place of list.places) {
      const classified = place.name ? placeClassifications.get(place.name) : undefined
      const base = place.note ? `${place.name} — ${place.note}` : (place.name ?? '')

      records.push({
        id: makeId('ev', ++index),
        kind: 'saved_place',
        sourcePath: list.sourcePath,
        sourceId: place.sourceId,
        ...(place.placeId ? { placeId: place.placeId } : {}),
        parentSourceId: list.sourceId,
        ...(place.name ? { placeName: place.name } : {}),
        summary: classified ? `${base} — ${classified.summary}` : base,
        ...(classified
          ? {
              category: classified.category,
              categoryConfidence: classified.confidence,
              categorySource: 'llm_name' as const,
            }
          : {}),
      })
    }
  }

  for (const screenshot of inputs.screenshots) {
    records.push({
      id: makeId('ev', ++index),
      kind: 'screenshot',
      sourcePath: screenshot.sourcePath,
      observedAt: screenshot.capturedAt,
      // Interest signal only — never phrased as a visit.
      summary: screenshot.summary ?? '',
      ...visionFields(screenshot.sourcePath),
    })
  }

  return records
}

export async function buildEvidenceFromSources(): Promise<EvidenceRecord[]> {
  const [photos, screenshots] = await Promise.all([
    extractPhotoMetadata(),
    normalizeScreenshots(),
  ])
  const { links, errors } = normalizeMapLinks()
  if (errors.length > 0) {
    throw new Error(`map link errors:\n  ${errors.join('\n  ')}`)
  }
  return buildEvidence({ photos, mapLinks: links, takeoutLists: readTakeoutLists(), screenshots })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const evidence = await buildEvidenceFromSources()
  writeJson(PATHS.out.evidence, evidence)
  console.log(`evidence: ${evidence.length} records -> ${relPath(PATHS.out.evidence)}`)
}
