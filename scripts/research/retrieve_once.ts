/**
 * ONE live retrieval run, against the real Places API. THIS SPENDS MONEY.
 *
 * Research-only, and deliberately awkward to trigger: it is not wired to any product
 * flow, and it refuses to call anything until `--confirm` is passed. The dry run
 * prints every search it would issue and what the field mask bills at, so the cost is
 * visible before it is incurred rather than after.
 *
 * Every response is cached on disk, so a second run of the same trip is free — which
 * is the point of running it once here rather than from a test.
 *
 * Run:
 *   npm run research:retrieve            # dry run, no calls, no cost
 *   npm run research:retrieve -- --confirm
 *   npm run research:retrieve -- --replay --confirm   # the last model plan again
 *
 * A `--model --confirm` run saves the model's plan to research-out/query_plan.json.
 * `--replay` reads it back instead of asking the model, so the same searches are
 * issued — and answered from the cache, free — while the code that reads them
 * changes. The model's wording differs on every call, and every new wording is a
 * new billed search.
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  seedProfile,
  confirmCandidate,
  loadProfileMemories,
  type BundledMemory,
} from '../../src/application/manageMemory/manageMemory.ts'
import { tagAll } from '../../src/application/decompose/tagConsidering.ts'
import { buildRetrievalProfile, searchPlan } from '../../src/application/planning/retrievalProfile.ts'
import { resolveQueryPlan } from '../../src/application/planning/queryPlan.ts'
import { retrievePlaces } from '../../src/application/planning/retrievePlaces.ts'
import { createMemorySnapshot } from '../../src/domain/memory/snapshot.ts'
import { createCatalogueSnapshot } from '../../src/domain/places/catalogueSnapshot.ts'
import { INTEREST_CATEGORY_IDS } from '../../src/domain/places/taxonomy.ts'
import { createRepositories } from '../../src/services/persistence/inMemory.ts'
import { createPlaceCatalogue } from '../../src/services/places/catalogue.ts'
import { createStubLlm } from '../../src/services/llm/stubLlm.ts'
import { planQueries } from '../../server/openai.ts'
import { geocodeLodging, searchMany } from '../../server/places.ts'

const CONFIRMED = process.argv.includes('--confirm')
const USE_MODEL = process.argv.includes('--model')
const REPLAY = process.argv.includes('--replay')
const PLAN_FILE = resolve(process.cwd(), 'research-out/query_plan.json')
const OUT_DIR = resolve(process.cwd(), 'research-out')

/** The trip this run retrieves for. Deliberately the demo's own brief. */
const TRIP = {
  destination: 'Tokyo',
  baseLodgingName: 'Kuramae',
  days: 5,
  intentText: 'Slow-paced. Time in local neighbourhoods.',
  consideringText: 'Moderate budget. Avoid queues.',
  /** Confirmed in Profile: the strongest preference and both measured patterns. */
  confirm: ['sushi', 'stops_per_day', 'day_span_metres'],
}

const bundled = JSON.parse(
  readFileSync('data/demo_tokyo_v1/memories.json', 'utf8'),
) as BundledMemory[]

async function snapshotFor(): Promise<ReturnType<typeof createMemorySnapshot>> {
  const repositories = createRepositories()
  const now = new Date().toISOString()
  await seedProfile(bundled, repositories.memories, now)

  for (const wanted of TRIP.confirm) {
    const memory = bundled.find(
      (entry) => entry.subject.facet === wanted || entry.subject.value === wanted,
    )
    if (memory) await confirmCandidate(memory.id, repositories.memories)
  }

  return createMemorySnapshot('trip_live', await loadProfileMemories(repositories.memories), now)
}

/**
 * The brief's Considering, tagged the way the product tags it (B7).
 *
 * Against an EMPTY catalogue, which is the honest one to use here: retrieval is what
 * produces the catalogue, so nothing can be resolved against it yet. `avoid` and
 * `budget` need no catalogue; a must-visit would come out unresolved, which is
 * exactly what it is before a single place has been fetched.
 */
const state = {
  version: 1,
  intent: [{ id: 'intent_1', text: TRIP.intentText }],
  considering: tagAll(
    TRIP.consideringText
      .split('.')
      .map((clause, index) => ({ id: `cons_${index + 1}`, text: clause.trim() }))
      .filter((item) => item.text.length > 0),
    createPlaceCatalogue([]),
  ),
  priorities: [],
}

const snapshot = await snapshotFor()
const profile = buildRetrievalProfile({ days: TRIP.days, snapshot, state })

console.log('\nRetrieval plan for one trip\n')
console.log(`  destination  : ${TRIP.destination}, based at ${TRIP.baseLodgingName}`)
console.log(`  intent       : ${TRIP.intentText}`)
console.log(`  considering  : ${TRIP.consideringText}`)
console.log(`  memories on  : ${snapshot.memories.map((memory) => memory.id).join(', ') || '(none)'}`)
console.log(`  pace         : ${profile.stopsPerDay} stops a day, ${profile.targets.length} roles`)
console.log(`  radius       : ${profile.radiusMetres ?? '(no memory measured one)'} m${profile.radiusMetres ? ' — a hard filter, not a bias' : ''}`)
console.log(`  avoiding     : ${profile.avoid.join('; ') || '(nothing stated)'}`)

const excluded = [...new Set(profile.targets.flatMap((target) => target.excluded))]
if (excluded.length > 0) console.log(`  not searched : ${excluded.join(', ')}`)
if (profile.gaps.length > 0) {
  console.log('  cannot derive:')
  for (const gap of profile.gaps) console.log(`    - ${gap.what}`)
}

// --- the searches, before any of them are issued ---------------------------
let planned
if (REPLAY) {
  console.log('\n  replaying the saved model plan (no model call)…')
  planned = JSON.parse(readFileSync(PLAN_FILE, 'utf8'))
} else if (USE_MODEL && CONFIRMED) {
  console.log('\n  planning search wording with the model…')
  planned = await planQueries({
    destination: TRIP.destination,
    baseLodgingName: TRIP.baseLodgingName,
    intentText: TRIP.intentText,
    consideringText: TRIP.consideringText,
    searches: searchPlan(profile).map((entry) => ({
      category: entry.category,
      preferred: entry.preferred,
    })),
    allowedCategories: [...INTEREST_CATEGORY_IDS],
  })
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(PLAN_FILE, JSON.stringify(planned, null, 2), 'utf8')
} else if (USE_MODEL) {
  // Dry run: the deterministic stub stands in, so the wording is visible without a
  // model call.
  planned = await createStubLlm().planQueries({
    destination: TRIP.destination,
    baseLodgingName: TRIP.baseLodgingName,
    intentText: TRIP.intentText,
    consideringText: TRIP.consideringText,
    searches: searchPlan(profile).map((entry) => ({
      category: entry.category,
      preferred: entry.preferred,
    })),
    allowedCategories: [...INTEREST_CATEGORY_IDS],
  })
}

const queries = resolveQueryPlan({
  profile,
  destination: TRIP.destination,
  baseLodgingName: TRIP.baseLodgingName,
  ...(planned ? { planned } : {}),
  ownWords: `${TRIP.intentText}\n${TRIP.consideringText}`,
})

console.log(`\n  ${queries.length} searches to issue:`)
for (const query of queries) {
  console.log(
    `    ${query.category.padEnd(20)} x${String(query.retrieve).padStart(2)} ` +
      `[${query.source}]${query.preferred ? '[habit]' : ''}${query.addedByModel ? '[added]' : ''} "${query.textQuery}"` +
        (query.servesWords ? `  <- for ${query.servesWords.map((words) => `"${words}"`).join(', ')}` : ''),
  )
}

console.log('\n  What this bills at:')
console.log('    1 Essentials call  — resolving the base lodging (location + address only)')
console.log(`    ${queries.length} Enterprise + Atmosphere calls — the searches above`)
console.log('    editorialSummary puts every search in the Atmosphere tier; see Google\'s')
console.log('    Places pricing page for the current rate and free allowance')
console.log('    Every response is cached, so a repeat of this run costs nothing')
if (USE_MODEL && !REPLAY) console.log('    1 model call       — search wording')

if (!CONFIRMED) {
  console.log('\n  DRY RUN — nothing was called. Add --confirm to issue these.\n')
  process.exit(0)
}

// --- live from here --------------------------------------------------------
console.log('\n  resolving the base lodging…')
const lodging = await geocodeLodging({ name: TRIP.baseLodgingName, destination: TRIP.destination })
if (!lodging) {
  console.error(`  could not resolve "${TRIP.baseLodgingName}" in ${TRIP.destination}. Stopping.`)
  process.exit(1)
}
console.log(
  `  matched: ${lodging.matchedAddress || '(no address returned)'} ` +
    `at ${lodging.lat}, ${lodging.lng}${lodging.cached ? ' (from cache)' : ''}`,
)

console.log('\n  searching…')
const report = await retrievePlaces({
  queries,
  lodging,
  ...(profile.radiusMetres ? { radiusMetres: profile.radiusMetres } : {}),
  searcher: {
    async search(requests) {
      const outcome = await searchMany(requests)
      return {
        results: outcome.results.map((entry) => ({
          textQuery: entry.textQuery,
          places: entry.places as never[],
        })),
        calls: outcome.calls,
        fromCache: outcome.fromCache,
      }
    },
  },
})

console.log(`\n  ${report.calls} billed calls, ${report.fromCache} from cache`)
console.log(`  ${report.returned} results returned, ${report.places.length} usable`)

if (Object.keys(report.rejected).length > 0) {
  console.log('  rejected by the quality gate:')
  for (const [reason, count] of Object.entries(report.rejected)) {
    console.log(`    ${reason.padEnd(20)} ${count}`)
  }
}
if (report.emptySearches.length > 0) {
  console.log('  searches that found nothing usable:')
  for (const query of report.emptySearches) console.log(`    "${query}"`)
}

const byCategory = new Map<string, number>()
for (const place of report.places) {
  byCategory.set(place.category, (byCategory.get(place.category) ?? 0) + 1)
}
console.log('\n  usable places by category:')
for (const [category, count] of [...byCategory].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${category.padEnd(22)} ${count}`)
}

// Frozen exactly as a real trip would freeze it (B4), so what is written out is the
// snapshot the trip would carry rather than a loose list of places.
const catalogueSnapshot = createCatalogueSnapshot({
  tripId: 'trip_live',
  places: report.places,
  provenance: {
    queries: queries.map((query) => query.textQuery),
    rejected: report.rejected as Record<string, number>,
    lodging: {
      lat: lodging.lat,
      lng: lodging.lng,
      matchedAddress: lodging.matchedAddress,
    },
    ...(profile.radiusMetres ? { radiusMetres: profile.radiusMetres } : {}),
  },
  createdAt: new Date().toISOString(),
})

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(
  resolve(OUT_DIR, 'catalogue_snapshot.json'),
  JSON.stringify(catalogueSnapshot, null, 2),
  'utf8',
)
writeFileSync(
  resolve(OUT_DIR, 'retrieved_places.json'),
  JSON.stringify(report.places, null, 2),
  'utf8',
)
console.log(
  `\n  snapshot v${catalogueSnapshot.version}: ${catalogueSnapshot.places.length} places ` +
    `-> research-out/catalogue_snapshot.json\n`,
)
