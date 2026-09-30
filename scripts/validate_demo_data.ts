/**
 * validate_demo_data.ts
 *
 * Validates data/demo_tokyo_v1/ — the only data the product is allowed to read.
 * Works on the empty placeholder bundle and on real preprocessed data.
 *
 * Run with: npm run validate:data
 *
 * Fails when:
 *   - ids are duplicated
 *   - a sourceRef points to missing evidence
 *   - POI coordinates are missing
 *   - candidate memories lack provenance
 *   - a preprocessed Memory has status "active"
 *   - a scripted scenario references a missing POI
 *   - malformed map source types exist
 */

import { existsSync, readFileSync } from 'node:fs'

import { priceBand, timeBandsOn } from '../src/domain/places/facets.ts'
import { DEFAULT_STOPS_PER_DAY } from '../src/domain/plan/dayRoles.ts'
import { capacitySummary, roleCapacity } from '../src/domain/plan/roleCapacity.ts'
import { CATEGORY_BY_ID } from './preprocess/taxonomy.ts'
import { WEEKDAY_KEYS } from '../src/domain/places/openingHours.ts'
import {
  MAP_SOURCE_TYPES,
  PATHS,
  readJson,
  type CandidateMemory,
  type DemoPlace,
  type DemoScenario,
  type EvidenceRecord,
  type Manifest,
  type MapSourceType,
  type UserContext,
} from './preprocess/types.ts'

const errors: string[] = []
const warnings: string[] = []
const lines: string[] = []

function fail(message: string): void {
  errors.push(message)
}

function warn(message: string): void {
  warnings.push(message)
}

function ok(message: string): void {
  lines.push(`✓ ${message}`)
}

function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }
  return [...duplicates]
}

// --- manifest ---------------------------------------------------------------

function validateManifest(): void {
  const manifest = readJson<Manifest>(PATHS.out.manifest)
  if (!manifest.schemaVersion) fail('manifest: schemaVersion is required')
  if (manifest.bundleId !== 'demo_tokyo_v1') {
    fail(`manifest: bundleId must be "demo_tokyo_v1", got "${manifest.bundleId}"`)
  }
  if (!manifest.destination) fail('manifest: destination is required')
  for (const key of ['photos', 'mapLinks', 'screenshots'] as const) {
    if (typeof manifest.sourceCounts?.[key] !== 'number') {
      fail(`manifest: sourceCounts.${key} must be a number`)
    }
  }
  if (manifest.generatedAt === null) {
    warn('manifest: generatedAt is null — bundle has not been generated yet')
  }
  ok('manifest')
}

// --- user context -----------------------------------------------------------

function validateUserContext(): void {
  const context = readJson<UserContext>(PATHS.out.userContext)
  for (const key of [
    'typicalStartTime',
    'avgDailyStops',
    'walkingTolerance',
    'preferredAreaPattern',
  ] as const) {
    if (!(key in context)) fail(`user_context: missing key "${key}"`)
  }
  if (!Array.isArray(context.notes)) fail('user_context: notes must be an array')
  ok('user context')
}

// --- places -----------------------------------------------------------------

function validatePlaces(): Set<string> {
  const places = readJson<DemoPlace[]>(PATHS.out.places)
  if (!Array.isArray(places)) {
    fail('tokyo_places.json must be an array')
    return new Set()
  }

  for (const duplicate of findDuplicates(places.map((place) => place.placeId))) {
    fail(`places: duplicate placeId "${duplicate}"`)
  }

  for (const place of places) {
    const label = place.placeId || place.name || '<unnamed>'
    if (!place.placeId) fail(`places: "${label}" is missing placeId`)
    if (!place.name) fail(`places: "${label}" is missing name`)
    if (typeof place.lat !== 'number' || typeof place.lng !== 'number') {
      fail(`places: "${label}" is missing coordinates`)
    } else if (place.lat === 0 && place.lng === 0) {
      fail(`places: "${label}" has placeholder coordinates (0,0)`)
    }
    if (!place.category) fail(`places: "${label}" is missing category`)
    if (!place.neighborhood) fail(`places: "${label}" is missing neighborhood`)
    if (typeof place.typicalDurationMin !== 'number') {
      fail(`places: "${label}" is missing typicalDurationMin`)
    }
  }

  // A bare count is not a verdict any more. Gate 1's 80-150 target was retired when
  // planning moved to per-trip retrieval: how many places a trip gets is decided by
  // its own brief and retrieval profile, and this bundle is the fixture the demo and
  // the harness run on. What still matters is whether the fixture can fill a day,
  // which `validateRoleCapacity` answers per role — an answer a total never gave.
  if (places.length === 0) {
    warn('places: 0 places — tokyo_places.json is still a placeholder')
  }

  validateFacetCoverage(places)
  validateRoleCapacity(places)

  ok(`${places.length} places`)
  return new Set(places.map((place) => place.placeId))
}

// --- evidence ---------------------------------------------------------------

function validateEvidence(): Set<string> {
  const evidence = readJson<EvidenceRecord[]>(PATHS.out.evidence)
  if (!Array.isArray(evidence)) {
    fail('evidence.json must be an array')
    return new Set()
  }

  for (const duplicate of findDuplicates(evidence.map((record) => record.id))) {
    fail(`evidence: duplicate id "${duplicate}"`)
  }

  const kinds = new Set(['photo', 'saved_place', 'screenshot'])
  for (const record of evidence) {
    const label = record.id || '<no id>'
    if (!record.id) fail('evidence: record is missing id')
    if (!kinds.has(record.kind)) fail(`evidence ${label}: unknown kind "${record.kind}"`)
    if (!record.sourcePath) fail(`evidence ${label}: missing sourcePath provenance`)
    if (record.kind === 'saved_place' && !record.sourceId) {
      fail(`evidence ${label}: saved_place must retain its map source_id`)
    }
  }

  ok(`${evidence.length} evidence records`)
  return new Set(evidence.map((record) => record.id))
}

// --- memories ---------------------------------------------------------------

function validateMemories(evidenceIds: Set<string>): void {
  // status is widened to string on purpose: the whole point is to catch an
  // "active" value that the type system says cannot be there.
  type RawMemory = Omit<CandidateMemory, 'status'> & { status: string }
  const memories = readJson<RawMemory[]>(PATHS.out.memories)
  if (!Array.isArray(memories)) {
    fail('memories.json must be an array')
    return
  }

  for (const duplicate of findDuplicates(memories.map((memory) => memory.id))) {
    fail(`memories: duplicate id "${duplicate}"`)
  }

  const errorsBefore = errors.length
  let refCount = 0
  let activeFound = 0
  for (const memory of memories) {
    const label = memory.id || '<no id>'
    if (!memory.id) fail('memories: memory is missing id')
    if (!memory.text) fail(`memories ${label}: missing text`)

    if (memory.status === 'active') {
      activeFound++
      fail(`memories ${label}: preprocessing must never emit status "active"`)
    } else if (memory.status !== 'candidate') {
      fail(`memories ${label}: status must be "candidate", got "${memory.status}"`)
    }

    if (typeof memory.confidence !== 'number' || memory.confidence < 0 || memory.confidence > 1) {
      fail(`memories ${label}: confidence must be a number between 0 and 1`)
    }

    // Typed fields (§10.4's deferred "evidence weighting"). A memory the planner
    // cannot act on predictably must not reach the Profile, so these are errors
    // rather than warnings.
    if (!PREPROCESSING_KINDS.has(memory.kind)) {
      fail(
        `memories ${label}: kind must be one of ${[...PREPROCESSING_KINDS].join(', ')}, ` +
          `got "${memory.kind}"`,
      )
    }

    const subject = memory.subject
    if (!subject || !SUBJECT_VALUE_TYPE[subject.facet]) {
      fail(`memories ${label}: subject.facet "${subject?.facet}" is not in the facet vocabulary`)
    } else if (typeof subject.value !== SUBJECT_VALUE_TYPE[subject.facet]) {
      fail(
        `memories ${label}: subject "${subject.facet}" needs a ` +
          `${SUBJECT_VALUE_TYPE[subject.facet]} value, got ${typeof subject.value}`,
      )
    } else if (subject.facet === 'category' && !CATEGORY_BY_ID.has(String(subject.value))) {
      fail(`memories ${label}: category "${subject.value}" is not in the taxonomy`)
    }

    if (memory.polarity !== 1 && memory.polarity !== -1) {
      fail(`memories ${label}: polarity must be 1 or -1, got ${memory.polarity}`)
    }

    // Kept separate from confidence on purpose: strength is how much the
    // traveller cares, confidence is how sure we are. Equal values across the
    // whole bundle would mean one of them is not being derived.
    if (typeof memory.strength !== 'number' || memory.strength < 0 || memory.strength > 1) {
      fail(`memories ${label}: strength must be a number between 0 and 1`)
    }

    // A frequency per travel day cannot exceed one, and zero would mean the
    // memory may never be acted on — both are bugs rather than signals.
    const rate = memory.scope?.ratePerDay
    if (rate !== undefined && (typeof rate !== 'number' || rate <= 0 || rate > 1)) {
      fail(`memories ${label}: scope.ratePerDay must be greater than 0 and at most 1, got ${rate}`)
    }

    if (!memory.provenance || !memory.provenance.type) {
      fail(`memories ${label}: missing provenance`)
      continue
    }
    const refs = memory.provenance.sourceRefs
    if (!Array.isArray(refs) || refs.length === 0) {
      fail(`memories ${label}: provenance has no sourceRefs`)
      continue
    }
    for (const ref of refs) {
      refCount++
      if (!evidenceIds.has(ref)) {
        fail(`memories ${label}: sourceRef "${ref}" has no matching evidence record`)
      }
    }
  }

  if (errors.length === errorsBefore) {
    ok(`${memories.length} candidate memories`)
    ok(`source references valid (${refCount} checked)`)

    // If these never diverge, one of the two numbers is not doing its own job.
    const withRate = memories.filter((memory) => memory.scope?.ratePerDay !== undefined).length
    if (withRate === 0) {
      warn('memories: no memory carries scope.ratePerDay — every claim bound is a heuristic')
    } else {
      ok(`${withRate}/${memories.length} memories carry a derived claim rate`)
    }

    const diverging = memories.filter((memory) => memory.strength !== memory.confidence).length
    if (diverging === 0) {
      warn('memories: strength equals confidence everywhere — one of them is not being derived')
    } else {
      ok(`strength diverges from confidence on ${diverging}/${memories.length} memories`)
    }
  }
  if (activeFound === 0) ok('no active preprocessing memories')
}

/**
 * Facet coverage (§12.2).
 *
 * A facet that is usually absent is worse than no facet: a retrieval filter on it
 * silently throws most of the catalogue away, and a memory that points at it can
 * never be satisfied. So coverage is reported on every data build, and a facet
 * that falls below the floor is a warning to stop relying on it — not a silent
 * degradation discovered later in a plan.
 *
 * All three shipped facets are derived from fields the validator already
 * requires above, so full coverage is the expected result and anything less
 * means the data lost something.
 */
const MIN_FACET_COVERAGE = 0.9

function validateFacetCoverage(places: DemoPlace[]): void {
  const usable = places.filter((place) => place.category !== 'accommodation')
  if (usable.length === 0) return

  const share = (n: number) => n / usable.length

  const coverage: Array<[string, number]> = [
    // A place with no band on any day cannot be scheduled at all.
    [
      'time_fit',
      share(
        usable.filter((place) =>
          WEEKDAY_KEYS.some((weekday) => timeBandsOn(place, weekday).length > 0),
        ).length,
      ),
    ],
    ['price_band', share(usable.filter((place) => priceBand(place) !== undefined).length)],
    ['stay_length', share(usable.filter((place) => place.typicalDurationMin > 0).length)],
  ]

  for (const [facet, ratio] of coverage) {
    const percent = Math.round(ratio * 100)
    if (ratio < MIN_FACET_COVERAGE) {
      warn(`facets: ${facet} covers only ${percent}% of places — too sparse to filter or rank on`)
    } else {
      ok(`facet ${facet}: ${percent}% coverage`)
    }
  }
}

/**
 * Whether the catalogue can fill a day (B0).
 *
 * Reported per role rather than as one place count, because "34 places" says
 * nothing about WHICH places are missing. A shortfall in `nightcap` and a shortfall
 * in `lunch` need different searches.
 *
 * Measured against the day a trip actually gets — `DEFAULT_STOPS_PER_DAY`, the pace
 * used when nothing has measured the traveller — over the demo scenario's five days.
 *
 * What it measures is now the SEED set: a live run retrieves its own places at Generate
 * and freezes them onto the trip, and this bundle is what a stubbed run plans from and
 * what a live run falls back to. A shortfall here is a thinner scripted demo, not a
 * limit on the product.
 * It was measured against all eight roles, which reported a shortfall of seven
 * places against a day no trip in the demo is planned at, while saying nothing about
 * the one role that IS short at the real pace.
 */
const CAPACITY_TRIP_DAYS = 5
const CAPACITY_STOPS_PER_DAY = DEFAULT_STOPS_PER_DAY

function validateRoleCapacity(places: DemoPlace[]): void {
  const usable = places.filter((place) => place.category !== 'accommodation')

  const capacities = roleCapacity({
    places: usable,
    days: CAPACITY_TRIP_DAYS,
    stopsPerDay: CAPACITY_STOPS_PER_DAY,
  })
  const summary = capacitySummary(capacities, usable.length)

  if (summary.short === 0 && summary.rolesShort === 0) {
    ok(`role capacity: ${summary.available} places cover a ${CAPACITY_STOPS_PER_DAY}-stop, ${CAPACITY_TRIP_DAYS}-day trip`)
    return
  }

  // The whole-trip figure first, because it is the one that binds: a plan uses
  // each place once, so a per-role count can look healthy while the trip as a
  // whole cannot be filled.
  if (summary.short > 0) {
    warn(
      `role capacity: a ${CAPACITY_STOPS_PER_DAY}-stop, ${CAPACITY_TRIP_DAYS}-day trip needs ` +
        `${summary.needed} distinct places; ${summary.available} are available — short ${summary.short}`,
    )
  }
  for (const entry of capacities) {
    if (entry.short === 0) continue
    warn(
      `  ${entry.role.id}: only ${entry.available} could fill it, needs ${entry.needed} ` +
        `— short ${entry.short} even before competing with other roles`,
    )
  }
}

/** Kinds preprocessing may emit. Aversion, constraint and context need the user. */
const PREPROCESSING_KINDS = new Set<string>(['preference', 'pattern'])

/** The facet vocabulary, and what type each facet's value must be. */
const SUBJECT_VALUE_TYPE: Record<string, 'string' | 'number' | undefined> = {
  category: 'string',
  price_band: 'string',
  time_fit: 'string',
  stay_length: 'string',
  stops_per_day: 'number',
  day_span_metres: 'number',
  start_minutes: 'number',
}

// --- scenario ---------------------------------------------------------------

function validateScenario(placeIds: Set<string>): void {
  const scenario = readJson<DemoScenario>(PATHS.out.scenario)
  if (!scenario.trip?.name) fail('scenario: trip.name is required')
  if (typeof scenario.trip?.days !== 'number') fail('scenario: trip.days must be a number')
  if (!Array.isArray(scenario.events)) {
    fail('scenario: events must be an array')
    return
  }

  for (const duplicate of findDuplicates(scenario.events.map((event) => event.id))) {
    fail(`scenario: duplicate event id "${duplicate}"`)
  }

  let unbound = 0
  for (const event of scenario.events) {
    const label = event.id || '<no id>'
    if (!event.id) fail('scenario: event is missing id')
    if (typeof event.day !== 'number') fail(`scenario ${label}: day must be a number`)
    else if (event.day < 1 || event.day > (scenario.trip?.days ?? 0)) {
      fail(`scenario ${label}: day ${event.day} is outside the trip length`)
    }
    if (!event.text) fail(`scenario ${label}: missing text`)

    const referenced = [event.placeId, ...(event.alternativePlaceIds ?? [])].filter(
      (id): id is string => Boolean(id),
    )
    // Not every event is about a place: "it's going to rain" and "I feel tired"
    // reshape a day, so having no placeId is correct rather than unfinished.
    if (referenced.length === 0 && 'placeId' in event) unbound++
    for (const placeId of referenced) {
      if (!placeIds.has(placeId)) {
        fail(`scenario ${label}: references missing POI "${placeId}"`)
      }
    }
  }

  if (unbound > 0) {
    warn(`scenario: ${unbound} place-based event(s) not yet bound to POIs`)
  }

  ok(`${scenario.events.length} scenario events`)
}

// --- raw map source types ---------------------------------------------------

function validateMapSourceTypes(): void {
  // Optional channel: absent is the normal case for the single-CSV workflow.
  if (!existsSync(PATHS.raw.mapLinks)) {
    ok('map source types (share-URL channel not in use)')
    return
  }

  const rows = readFileSync(PATHS.raw.mapLinks, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)

  if (rows.length === 0 || !rows[0].startsWith('source_id,type,url,note')) {
    fail('map_links.csv: header must be "source_id,type,url,note"')
    return
  }

  const seen = new Set<string>()
  let count = 0
  for (const [index, row] of rows.slice(1).entries()) {
    const line = index + 2
    const [sourceId, type] = row.split(',').map((cell) => cell.trim())
    count++
    if (!sourceId) fail(`map_links.csv line ${line}: source_id is required`)
    else if (seen.has(sourceId)) fail(`map_links.csv line ${line}: duplicate source_id "${sourceId}"`)
    else seen.add(sourceId)

    if (!MAP_SOURCE_TYPES.includes(type as MapSourceType)) {
      fail(`map_links.csv line ${line}: malformed type "${type}"`)
    }
  }

  ok(count === 0 ? 'map source types (no rows yet)' : `${count} map source rows`)
}

// --- run --------------------------------------------------------------------

function run(): void {
  console.log('Tokyo demo data validation\n')

  const missing = Object.entries(PATHS.out)
    .filter(([key]) => key !== 'root')
    .filter(([, path]) => !existsSync(path))
  if (missing.length > 0) {
    for (const [key, path] of missing) console.error(`✗ missing ${key}: ${path}`)
    console.error(`\n${missing.length} errors`)
    process.exit(1)
  }

  validateManifest()
  validateUserContext()
  const placeIds = validatePlaces()
  const evidenceIds = validateEvidence()
  validateMemories(evidenceIds)
  validateScenario(placeIds)
  validateMapSourceTypes()

  for (const line of lines) console.log(line)

  if (warnings.length > 0) {
    console.log('')
    for (const warning of warnings) console.log(`! ${warning}`)
  }

  if (errors.length > 0) {
    console.log('')
    for (const error of errors) console.error(`✗ ${error}`)
  }

  console.log(`\n${errors.length} errors`)
  if (errors.length > 0) process.exit(1)
}

run()
