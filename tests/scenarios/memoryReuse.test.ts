/**
 * scenario_memory_reuse — the Gate 4 required scenario.
 *
 *   1. Confirm a candidate Memory
 *   2. Create a new trip
 *   3. Verify the Memory appears in the snapshot
 *   4. Generate the plan
 *   5. Verify at least one recommendation rationale references that Memory id
 *
 * Plus the rule that gives the snapshot its point: a Profile change after the
 * trip exists must not alter that trip.
 */

import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  confirmCandidate,
  deactivateProfileMemory,
  loadProfileMemories,
  seedProfile,
  type BundledMemory,
} from '../../src/application/manageMemory/manageMemory.ts'
import {
  confirmReview,
  defaultPriorities,
  toFrame,
  type StageAInput,
} from '../../src/application/createTrip/createTrip.ts'
import { generateFirstPlan } from '../../src/application/generatePlan/generatePlan.ts'
import { categoryPreferences, planShape } from '../../src/domain/memory/preferences.ts'
import { allItems } from '../../src/domain/plan/types.ts'
import { createPlaceCatalogue } from '../../src/services/places/catalogue.ts'
import { createRepositories } from '../../src/services/persistence/inMemory.ts'
import type { Repositories } from '../../src/services/persistence/types.ts'
import type { DemoPlace } from '../../src/services/places/types.ts'

const places = JSON.parse(readFileSync('data/demo_tokyo_v1/tokyo_places.json', 'utf8')) as DemoPlace[]
const bundled = JSON.parse(readFileSync('data/demo_tokyo_v1/memories.json', 'utf8')) as BundledMemory[]
const catalogue = createPlaceCatalogue(places)
const NOW = new Date('2026-09-22T09:00:00')

/** Ids read from the bundle rather than assumed, so a re-derivation cannot
 * silently point these at the wrong memory — mem_006 and mem_007 swapped places
 * when the spatial pattern started being emitted for any span. */
const byFacet = (facet: string) =>
  bundled.find((memory) => memory.subject.facet === facet)!.id

/** "Repeatedly drawn to sushi", the strongest trend in the bundle. */
const SUSHI_MEMORY = bundled.find(
  (memory) => memory.subject.facet === 'category' && memory.subject.value === 'sushi',
)!.id
const PACE_MEMORY = byFacet('stops_per_day')
const SPAN_MEMORY = byFacet('day_span_metres')

/**
 * A constructed slower pace than the bundle's own.
 *
 * The bundle measures three stops a day and the demo day structure offers three
 * slots, so the real pace memory cannot shorten anything yet — the effect only
 * becomes visible below the number of slots a day has. Asserting on a constructed
 * value keeps the test about the mechanism rather than about a coincidence.
 */
const SLOW_PACE_MEMORY_ID = 'mem_slow_pace'

const SETUP: StageAInput = {
  name: 'Tokyo Slow Week',
  startDate: '2026-10-05', endDate: '2026-10-09',
  baseLodgingPlaceId: 'kuramae_base', baseLodgingName: 'Kuramae',
  intentText: 'Slow-paced.', consideringText: 'Moderate budget.',
}

let repositories: Repositories

/** The bundle plus the constructed slower pace, so tests count what was seeded. */
const SEEDED: BundledMemory[] = [
  ...bundled,
  {
    ...bundled.find((memory) => memory.subject.facet === 'stops_per_day')!,
    id: SLOW_PACE_MEMORY_ID,
    text: 'Moves at an unhurried pace — around 2 distinct stops on a typical day',
    subject: { facet: 'stops_per_day', value: 2 },
  },
]

beforeEach(async () => {
  repositories = createRepositories()
  await seedProfile(SEEDED, repositories.memories, NOW.toISOString())
})

async function createTripWithProfile() {
  const profile = await loadProfileMemories(repositories.memories)
  const frame = toFrame(SETUP)
  const { trip, state } = confirmReview({
    tripId: 'trip_1', frame,
    draft: { intent: [], considering: [], priorities: defaultPriorities() },
    profileMemories: profile,
    catalogue,
    createdAt: NOW.toISOString(),
  })
  const generated = generateFirstPlan({
    frame, state, catalogue, days: 5, now: NOW, memorySnapshot: trip.memorySnapshot,
  })
  return { trip, state, ...generated }
}

describe('seeding the Profile', () => {
  it('loads every bundled memory as a candidate, never active', async () => {
    const profile = await loadProfileMemories(repositories.memories)
    expect(profile).toHaveLength(SEEDED.length)
    expect(profile.every((memory) => memory.status === 'candidate')).toBe(true)
  })

  it('reads the kind and subject the bundle states, not a parsed provenance string', async () => {
    const profile = await loadProfileMemories(repositories.memories)
    const sushi = profile.find((memory) => memory.id === SUSHI_MEMORY)!
    expect(sushi.kind).toBe('preference')
    expect(sushi.subject).toEqual({ facet: 'category', value: 'sushi' })
    // The display type stays inside the product's four-value union.
    expect(['saved_places', 'historical_behavior', 'explicit_statement', 'agent_inference'])
      .toContain(sushi.provenance.type)
  })

  it('with autoActivate, makes only the strongly evidenced memories active', async () => {
    const fresh = createRepositories()
    const profile = await seedProfile(bundled, fresh.memories, NOW.toISOString(), {
      autoActivate: true,
    })
    const active = profile.filter((memory) => memory.status === 'active').map((memory) => memory.id)
    const expected = bundled
      .filter(
        (memory) =>
          (memory.kind === 'preference' || memory.kind === 'pattern') &&
          memory.provenance.sourceRefs.length >= 3 &&
          memory.confidence >= 0.65,
      )
      .map((memory) => memory.id)
    expect(active.sort()).toEqual(expected.sort())
    expect(active).toContain(SUSHI_MEMORY)
    expect(profile.some((memory) => memory.status === 'candidate')).toBe(true)
  })

  it('never re-activates a memory the user stopped using when seeded again', async () => {
    const fresh = createRepositories()
    await seedProfile(bundled, fresh.memories, NOW.toISOString(), { autoActivate: true })
    await deactivateProfileMemory(SUSHI_MEMORY, fresh.memories)

    const again = await seedProfile(bundled, fresh.memories, NOW.toISOString(), {
      autoActivate: true,
    })
    expect(again.find((memory) => memory.id === SUSHI_MEMORY)!.status).toBe('candidate')
  })

  it('an auto-activated memory reaches the trip snapshot and the plan', async () => {
    repositories = createRepositories()
    await seedProfile(bundled, repositories.memories, NOW.toISOString(), { autoActivate: true })
    const { trip, plan } = await createTripWithProfile()
    expect(trip.memorySnapshot.memories.map((memory) => memory.id)).toContain(SUSHI_MEMORY)
    expect(
      allItems(plan).some((item) =>
        item.rationaleRefs?.memoryIds.includes(SUSHI_MEMORY),
      ),
    ).toBe(true)
  })

  it('orders candidates by confidence for review', async () => {
    const profile = await loadProfileMemories(repositories.memories)
    const confidences = profile.map((memory) => memory.confidence)
    expect(confidences).toEqual([...confidences].sort((a, b) => b - a))
  })
})

describe('scenario_memory_reuse', () => {
  it('step 1: confirming a candidate makes it active', async () => {
    const after = await confirmCandidate(SUSHI_MEMORY, repositories.memories)
    const sushi = after.find((memory) => memory.id === SUSHI_MEMORY)!
    expect(sushi.status).toBe('active')
  })

  it('step 3: the confirmed Memory appears in the new trip snapshot', async () => {
    await confirmCandidate(SUSHI_MEMORY, repositories.memories)
    const { trip } = await createTripWithProfile()
    expect(trip.memorySnapshot.memories.map((memory) => memory.id)).toEqual([SUSHI_MEMORY])
  })

  it('unconfirmed candidates stay out of the snapshot', async () => {
    const { trip } = await createTripWithProfile()
    expect(trip.memorySnapshot.memories).toHaveLength(0)
  })

  it('step 5: a recommendation rationale references that Memory id', async () => {
    await confirmCandidate(SUSHI_MEMORY, repositories.memories)
    const { plan, validation } = await createTripWithProfile()
    expect(validation.valid).toBe(true)

    const citing = allItems(plan).filter((item) =>
      item.rationaleRefs?.memoryIds.includes(SUSHI_MEMORY),
    )
    expect(citing.length).toBeGreaterThan(0)

    // The cited item really is a sushi place — the memory's own category.
    for (const item of citing) {
      expect(catalogue.get(item.placeId)?.category).toBe('sushi')
    }
  })

  it('materially changes the plan: more sushi with the memory than without', async () => {
    const without = await createTripWithProfile()
    const sushiWithout = allItems(without.plan).filter(
      (item) => catalogue.get(item.placeId)?.category === 'sushi',
    ).length

    await confirmCandidate(SUSHI_MEMORY, repositories.memories)
    const including = await createTripWithProfile()
    const sushiWith = allItems(including.plan).filter(
      (item) => catalogue.get(item.placeId)?.category === 'sushi',
    ).length

    expect(sushiWith).toBeGreaterThan(sushiWithout)
  })

  it('the rationale text explains itself without naming internals', async () => {
    await confirmCandidate(SUSHI_MEMORY, repositories.memories)
    const { plan } = await createTripWithProfile()
    const cited = allItems(plan).find((item) =>
      item.rationaleRefs?.memoryIds.includes(SUSHI_MEMORY),
    )!
    expect(cited.rationale).toBeTruthy()
    expect(cited.rationale).not.toMatch(/mem_\d+|category_trend|confidence/i)
  })

  it('never shows a numeric confidence anywhere in a rationale', async () => {
    await confirmCandidate(SUSHI_MEMORY, repositories.memories)
    const { plan } = await createTripWithProfile()
    for (const item of allItems(plan)) {
      expect(item.rationale ?? '').not.toMatch(/0\.\d+/)
    }
  })
})

describe('snapshot immutability across Profile changes', () => {
  it('deactivating a memory afterwards does not alter the existing trip', async () => {
    await confirmCandidate(SUSHI_MEMORY, repositories.memories)
    const { trip, plan } = await createTripWithProfile()
    const before = JSON.stringify(plan)

    await deactivateProfileMemory(SUSHI_MEMORY, repositories.memories)

    expect(trip.memorySnapshot.memories.map((memory) => memory.id)).toEqual([SUSHI_MEMORY])
    expect(JSON.stringify(plan)).toBe(before)
  })

  it('a later confirmation affects the NEXT trip, not this one', async () => {
    const first = await createTripWithProfile()
    expect(first.trip.memorySnapshot.memories).toHaveLength(0)

    await confirmCandidate(SUSHI_MEMORY, repositories.memories)
    const second = await createTripWithProfile()

    expect(first.trip.memorySnapshot.memories).toHaveLength(0)
    expect(second.trip.memorySnapshot.memories).toHaveLength(1)
  })
})

describe('categoryPreferences', () => {
  it('is empty without a snapshot', () => {
    expect(categoryPreferences(undefined)).toEqual([])
  })

  it('orders preferences by strength, strongest first', async () => {
    await confirmCandidate('mem_005', repositories.memories) // ramen, strength 0.17
    await confirmCandidate(SUSHI_MEMORY, repositories.memories) // sushi, strength 1.00
    const { trip } = await createTripWithProfile()

    expect(categoryPreferences(trip.memorySnapshot).map((p) => p.category)).toEqual([
      'sushi',
      'ramen',
    ])
  })

  /**
   * Weight is `strength`, not `confidence`. §10.2 permits confidence for candidate
   * ordering and inference quality only, and planning weight is a third use it
   * does not list. The two also diverge in the bundle: sushi and izakaya sit at
   * 0.90 and 0.85 confidence — nearly alike, because confidence saturates around
   * ten observations — while their strengths are 1.00 and 0.56.
   */
  it('weights by strength rather than confidence', async () => {
    await confirmCandidate(SUSHI_MEMORY, repositories.memories)
    const { trip } = await createTripWithProfile()

    const [sushi] = categoryPreferences(trip.memorySnapshot)
    const memory = trip.memorySnapshot.memories.find((entry) => entry.id === SUSHI_MEMORY)!

    expect(sushi.weight).toBe(memory.strength)
    expect(sushi.weight).not.toBe(memory.confidence)
  })

  it('leaves a pattern memory out of category preferences, and reads it as a shape', async () => {
    // Regression against the behaviour this step removed: preference extraction
    // used to drop every memory without a category, which discarded the pace
    // memory entirely — and there was a passing test asserting it did.
    await confirmCandidate(PACE_MEMORY, repositories.memories)
    const { trip } = await createTripWithProfile()

    expect(categoryPreferences(trip.memorySnapshot)).toEqual([])
    expect(planShape(trip.memorySnapshot).stopsPerDay?.value).toBe(3)
    expect(planShape(trip.memorySnapshot).stopsPerDay?.memoryId).toBe(PACE_MEMORY)
  })

  it('reads the spatial pattern as a day-span budget', async () => {
    await confirmCandidate(SPAN_MEMORY, repositories.memories)
    const { trip } = await createTripWithProfile()

    const span = planShape(trip.memorySnapshot).daySpanMetres
    expect(span?.memoryId).toBe(SPAN_MEMORY)
    // The measured median, which the old derivation never emitted at all because
    // it only fired below a two-kilometre "compact" threshold.
    expect(span?.value).toBeGreaterThan(5000)
  })
})

describe('a memory claims as often as the traveller actually did (§10, A4)', () => {
  /**
   * The bound used to be one constant for every memory — roughly one slot per
   * three trip days — so a category seen on two travel days in five got exactly
   * as much of the plan as one seen on every other day. It now comes from the
   * memory's own observed rate.
   */
  const rateOf = (id: string) =>
    bundled.find((memory) => memory.id === id)!.scope?.ratePerDay

  it('gives a frequent memory more of the plan than a rare one', async () => {
    const frequent = bundled.find(
      (memory) => memory.kind === 'preference' && (memory.scope?.ratePerDay ?? 0) >= 0.4,
    )!
    const rare = bundled.find(
      (memory) => memory.kind === 'preference' && (memory.scope?.ratePerDay ?? 1) <= 0.2,
    )!
    expect(rateOf(frequent.id)).toBeGreaterThan(rateOf(rare.id)!)

    const citing = async (memoryId: string) => {
      repositories = createRepositories()
      await seedProfile(SEEDED, repositories.memories, NOW.toISOString())
      await confirmCandidate(memoryId, repositories.memories)
      const { plan } = await createTripWithProfile()
      return allItems(plan).filter((item) => item.rationaleRefs?.memoryIds.includes(memoryId))
        .length
    }

    expect(await citing(frequent.id)).toBeGreaterThan(await citing(rare.id))
  })

  it('never lets a confirmed memory claim nothing at all', async () => {
    const rare = bundled.find(
      (memory) => memory.kind === 'preference' && (memory.scope?.ratePerDay ?? 1) <= 0.2,
    )!
    await confirmCandidate(rare.id, repositories.memories)
    const { plan } = await createTripWithProfile()

    expect(
      allItems(plan).filter((item) => item.rationaleRefs?.memoryIds.includes(rare.id)).length,
    ).toBeGreaterThan(0)
  })
})

describe('a pace pattern shapes the day (§10, A3)', () => {
  it('fills fewer stops a day than a trip with no pace measured at all', async () => {
    const unmeasured = await createTripWithProfile()

    await confirmCandidate(PACE_MEMORY, repositories.memories)
    const measured = await createTripWithProfile()

    const most = (trip: Awaited<ReturnType<typeof createTripWithProfile>>) =>
      Math.max(...trip.plan.days.map((day) => day.items.length))

    expect(most(measured)).toBe(3)
    expect(most(unmeasured)).toBeGreaterThan(most(measured))
  })

  /**
   * Three is the floor, not a target to go under. Every day has its anchor and its two
   * meals: a day without lunch is not a shorter day, it is a broken one.
   */
  it('still fills the anchor and both meals when the pace asks for fewer', async () => {
    await confirmCandidate(SLOW_PACE_MEMORY_ID, repositories.memories)
    const slower = await createTripWithProfile()

    expect(planShape(slower.trip.memorySnapshot).stopsPerDay?.value).toBe(2)
    expect(slower.plan.days.every((day) => day.items.length <= 3)).toBe(true)
    expect(slower.plan.days[0].items.length).toBe(3)
  })

  /**
   * No measurement means a full day, matching what retrieval assumes. Better to plan
   * one and report the roles that could not be filled than to decide on the
   * traveller's behalf that they want a short one.
   */
  it('attempts a full day when no pattern measured a pace', async () => {
    const unmeasured = await createTripWithProfile()
    expect(Math.max(...unmeasured.plan.days.map((day) => day.items.length))).toBeGreaterThan(3)
  })

  /** The catalogue running out is reported, not hidden as a shorter day. */
  it('names the parts of a day it could not fill', async () => {
    const unmeasured = await createTripWithProfile()
    expect(unmeasured.unfilled.length).toBeGreaterThan(0)
    for (const gap of unmeasured.unfilled) {
      expect(gap.because).toBe('nothing_available')
      expect(gap.dayIndex).toBeGreaterThanOrEqual(0)
    }
  })
})
