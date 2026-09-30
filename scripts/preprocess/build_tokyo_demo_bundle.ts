/**
 * build_tokyo_demo_bundle.ts
 *
 * Orchestrates preprocessing:
 *
 *   raw inputs
 *   -> normalized sources
 *   -> evidence
 *   -> candidate memories
 *   -> user context
 *   -> manifest update
 *   -> validation
 *
 * Run with: npm run preprocess:tokyo
 *
 * Raw sources are read-only. This script writes only into data/demo_tokyo_v1/.
 * It refuses to run against an empty source set so a real bundle is never
 * silently replaced with an empty one.
 */

import { extractPhotoMetadata } from './extract_photo_metadata.ts'
import { normalizeMapLinks, readTakeoutLists } from './normalize_map_links.ts'
import { normalizeScreenshots } from './normalize_screenshots.ts'
import { buildEvidence } from './build_evidence.ts'
import { assertMemoryInvariants, buildCandidateMemories } from './build_candidate_memories.ts'
import { buildUserContext } from './build_user_context.ts'
import { classifyImages, type ImageTarget } from './classify_images.ts'
import { classifyPlaceNames } from './classify_places.ts'
import { hasEnv } from './env.ts'
import { PATHS, readJson, relPath, writeJson, type Manifest } from './types.ts'
import { resolve } from 'node:path'

export async function buildTokyoDemoBundle(): Promise<void> {
  console.log('Tokyo demo preprocessing\n')

  // 1. normalized sources
  const [photos, screenshots] = await Promise.all([
    extractPhotoMetadata(),
    normalizeScreenshots(),
  ])
  const { links: mapLinks, errors: mapErrors } = normalizeMapLinks()
  const takeoutLists = readTakeoutLists()
  const listPlaces = takeoutLists.reduce((sum, list) => sum + list.places.length, 0)

  if (mapErrors.length > 0) {
    for (const error of mapErrors) console.error(`  ! ${error}`)
    throw new Error(`${mapErrors.length} map link error(s); fix map_links.csv and rerun`)
  }

  const total = photos.length + mapLinks.length + listPlaces + screenshots.length
  if (total === 0) {
    console.error('No raw sources found under source_inputs/tokyo_raw/.')
    console.error('Add photos, screenshots and map links first, then rerun.')
    process.exitCode = 1
    return
  }

  console.log(
    `  sources: ${photos.length} photos, ${mapLinks.length} map links, ` +
      `${takeoutLists.length} saved list(s) -> ${listPlaces} places, ${screenshots.length} screenshots`,
  )
  for (const list of takeoutLists) {
    console.log(`    ${list.name}: ${list.places.length} places (${list.sourceId})`)
  }

  // 2. content classification (photos + screenshots)
  const targets: ImageTarget[] = [
    ...photos.map((photo) => ({
      absolutePath: resolve(PATHS.raw.photos, photo.fileName),
      sourcePath: photo.sourcePath,
      kind: 'photo' as const,
    })),
    ...screenshots.map((screenshot) => ({
      absolutePath: resolve(PATHS.raw.screenshots, screenshot.fileName),
      sourcePath: screenshot.sourcePath,
      kind: 'screenshot' as const,
    })),
  ]

  let classifications = new Map()
  if (hasEnv('OPENAI_API_KEY')) {
    process.stdout.write(`  classifying ${targets.length} images`)
    classifications = await classifyImages(targets, (done, total, cached) => {
      process.stdout.write(`\r  classifying ${targets.length} images: ${done}/${total} (${cached} cached)   `)
    })
    process.stdout.write('\n')
  } else {
    console.log('  classification skipped: OPENAI_API_KEY not set')
  }

  // 3. saved-place classification
  const placeNames = takeoutLists.flatMap((list) =>
    list.places.map((place) => place.name).filter((name): name is string => Boolean(name)),
  )
  let placeClassifications = new Map()
  if (placeNames.length > 0 && hasEnv('OPENAI_API_KEY')) {
    placeClassifications = await classifyPlaceNames(placeNames)
    console.log(`  classified ${placeClassifications.size} saved places (by name)`)
  }

  // 4. evidence
  const evidence = buildEvidence({
    photos,
    mapLinks,
    takeoutLists,
    screenshots,
    classifications,
    placeClassifications,
  })
  writeJson(PATHS.out.evidence, evidence)
  console.log(`  evidence: ${evidence.length} records`)

  // 5. candidate memories (never active)
  const memories = buildCandidateMemories(evidence)
  assertMemoryInvariants(memories, evidence)
  writeJson(PATHS.out.memories, memories)
  console.log(`  candidate memories: ${memories.length}`)

  // 6. user context (summary, not Memory)
  writeJson(PATHS.out.userContext, buildUserContext(evidence))
  console.log('  user context: written')

  // 7. manifest
  const manifest = readJson<Manifest>(PATHS.out.manifest)
  writeJson(PATHS.out.manifest, {
    ...manifest,
    generatedAt: new Date().toISOString(),
    sourceCounts: {
      photos: photos.length,
      // Every saved-place source that became evidence: share-URL rows plus
      // places expanded out of Takeout exports.
      mapLinks: evidence.filter((record) => record.kind === 'saved_place').length,
      screenshots: screenshots.length,
    },
  } satisfies Manifest)
  console.log('  manifest: updated')

  // NOTE: tokyo_places.json is curated separately (80-150 POIs) and is not
  // regenerated here. demo_scenario.json events stay unbound until those
  // places exist.

  console.log(`\nWrote ${relPath(PATHS.out.root)}. Next: npm run validate:data`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildTokyoDemoBundle()
}
