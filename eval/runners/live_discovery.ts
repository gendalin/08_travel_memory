/**
 * One LIVE discovery run for Golden Scenario R1. THIS SPENDS MONEY with --confirm.
 *
 *   npx tsx eval/runners/live_discovery.ts            # dry run: lists searches, no calls
 *   npx tsx eval/runners/live_discovery.ts --confirm  # issues them (cached on disk)
 *
 * R1 is otherwise scored on data/demo_retrieved_v1, which was retrieved before area
 * discovery existed, so it cannot show whether discovery now reaches Jimbocho or
 * Yanaka. This runs the product's own trip retrieval for the R1 brief — the same
 * profile, lodging searches and area searches `retrieveForTrip` issues — with the
 * code's own wording (no model call: cheaper, and the same words every time), and
 * freezes the result where `EVAL_R1_CATALOGUE` can point R1 at it.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { tagAll } from '../../src/application/decompose/tagConsidering.ts'
import { buildRetrievalProfile } from '../../src/application/planning/retrievalProfile.ts'
import { areaQueries, resolveQueryPlan } from '../../src/application/planning/queryPlan.ts'
import { retrievePlaces } from '../../src/application/planning/retrievePlaces.ts'
import { createPlaceCatalogue } from '../../src/services/places/catalogue.ts'
import { categoriesNamedBy } from '../../src/domain/places/taxonomy.ts'
import { geocodeLodging, searchMany } from '../../server/places.ts'
import { R1_INTENT } from '../scenarios/recommendation.ts'

const CONFIRMED = process.argv.includes('--confirm')
const LODGING = 'Kuramae'
const DAYS = 5
const intentText = R1_INTENT.join('. ')

const state = {
  version: 1,
  intent: R1_INTENT.map((text, index) => ({ id: `intent_${index + 1}`, text })),
  considering: tagAll([], createPlaceCatalogue([])),
  priorities: [],
}
// R1 has no Memory, so the profile is role structure alone — as a new traveller's is.
const profile = buildRetrievalProfile({ days: DAYS, state })
const lodgingQueries = resolveQueryPlan({ profile, destination: 'Tokyo', baseLodgingName: LODGING, ownWords: intentText })

console.log(`\nLive discovery for R1 — "${intentText}", based at ${LODGING}\n`)

async function main() {
  // The lodging must be resolved before areas can be judged "within reach"; that is one
  // cheap Essentials call, cached from earlier runs.
  const lodging = CONFIRMED
    ? await geocodeLodging({ name: LODGING, destination: 'Tokyo' })
    : { lat: 35.704, lng: 139.791, matchedAddress: 'Kuramae (approximate, dry run)', cached: true }
  if (!lodging) throw new Error(`could not resolve ${LODGING}`)

  const discovery = areaQueries({
    ownWords: intentText,
    lodging,
    ...(profile.radiusMetres === undefined ? {} : { radiusMetres: profile.radiusMetres }),
    excluded: profile.avoid.flatMap((value) => categoriesNamedBy(value)),
  })
  const queries = [...lodgingQueries, ...discovery.filter((query) => !lodgingQueries.some((existing) => existing.textQuery === query.textQuery))]

  console.log(`  ${lodgingQueries.length} lodging searches + ${discovery.length} area searches:`)
  for (const query of queries) {
    console.log(`    ${query.area ? `[${query.area.name}]`.padEnd(16) : '[lodging]'.padEnd(16)} x${query.retrieve} "${query.textQuery}"`)
  }
  console.log(`\n  Bills at: 1 Essentials call (lodging, cached if seen) + up to ${queries.length} Text Search calls.`)
  console.log('  Responses are cached on disk (.cache/places-search); a repeat run costs nothing.')

  if (!CONFIRMED) {
    console.log('\n  DRY RUN — nothing was called. Add --confirm to issue these.\n')
    return
  }

  const report = await retrievePlaces({
    queries,
    lodging,
    ...(profile.radiusMetres === undefined ? {} : { radiusMetres: profile.radiusMetres }),
    searcher: {
      async search(requests) {
        const outcome = await searchMany(requests)
        return {
          results: outcome.results.map((entry) => ({ textQuery: entry.textQuery, places: entry.places as never[] })),
          calls: outcome.calls,
          fromCache: outcome.fromCache,
        }
      },
    },
  })

  console.log(`\n  ${report.calls} billed calls, ${report.fromCache} from cache`)
  console.log(`  ${report.returned} results returned, ${report.places.length} usable`)
  if (Object.keys(report.rejected).length > 0) console.log(`  rejected: ${JSON.stringify(report.rejected)}`)
  if (report.emptySearches.length > 0) console.log(`  empty searches: ${report.emptySearches.join(' | ')}`)

  const byArea: Record<string, number> = {}
  for (const place of report.places) byArea[place.neighborhood] = (byArea[place.neighborhood] ?? 0) + 1
  console.log(`  neighbourhoods: ${JSON.stringify(byArea)}`)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join('artifacts', 'live_discovery', stamp)
  mkdirSync(dir, { recursive: true })
  // Photos are not asked for here; strip nothing else.
  writeFileSync(join(dir, 'places.json'), JSON.stringify(report.places, null, 2))
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ queries: queries.map((query) => ({ text: query.textQuery, area: query.area?.name ?? null })), calls: report.calls, fromCache: report.fromCache, returned: report.returned, usable: report.places.length, rejected: report.rejected, emptySearches: report.emptySearches, lodging }, null, 2))
  console.log(`\n  wrote ${dir}/places.json — score R1 on it with:\n    EVAL_R1_CATALOGUE=${dir}/places.json npm run eval:core\n`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
