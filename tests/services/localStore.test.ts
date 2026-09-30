/**
 * Keeping a trip across a reload (Gate 8).
 *
 * Two claims carry the rest:
 *
 *   - a committed transaction reaches storage as ONE write, so there is no reload
 *     that can show a plan the state never agreed to
 *   - a browser that will not store anything is reported, not discovered later by a
 *     traveller whose trip has vanished
 */

import { describe, expect, it, vi } from 'vitest'

import {
  clearPersisted,
  createPersistentRepositories,
  STORAGE_KEY,
  type StorageLike,
} from '../../src/services/persistence/localStore.ts'
import { createMemorySnapshot } from '../../src/domain/memory/snapshot.ts'
import type { Trip } from '../../src/domain/trip/types.ts'
import type { TripState } from '../../src/domain/state/types.ts'
import type { Plan } from '../../src/domain/plan/types.ts'
import type { Proposal } from '../../src/domain/proposals/types.ts'
import type { Receipt } from '../../src/domain/receipts/types.ts'
import { memory } from '../domain/fixtures.ts'

/** An in-process stand-in for `localStorage`, with the failure modes it has. */
function fakeStorage(options: { refuseWrites?: boolean; seed?: string } = {}): StorageLike & {
  values: Map<string, string>
  writes: number
} {
  const values = new Map<string, string>()
  if (options.seed) values.set(STORAGE_KEY, options.seed)

  return {
    values,
    writes: 0,
    getItem(key) {
      return values.get(key) ?? null
    },
    setItem(key, value) {
      // A probe write is allowed even in the refusing mode, which is exactly how
      // private browsing behaves — and why the probe alone is not enough.
      if (options.refuseWrites && key === STORAGE_KEY) throw new Error('QuotaExceededError')
      this.writes++
      values.set(key, value)
    },
    removeItem(key) {
      values.delete(key)
    },
  }
}

const FRAME = {
  name: 'Tokyo Slow Week',
  destination: 'Tokyo',
  startDate: '2026-10-05',
  endDate: '2026-10-09',
  baseLodging: { placeId: 'kuramae_base', name: 'Kuramae' },
}

const trip = (id = 'trip_1', createdAt = '2026-10-01T00:00:00.000Z'): Trip => ({
  id,
  frame: FRAME,
  memorySnapshot: createMemorySnapshot(id, [memory({ id: 'mem_1', status: 'active' })], createdAt),
  createdAt,
})

const state = (version: number): TripState => ({
  version,
  intent: [{ id: 'intent_1', text: 'Slow-paced.' }],
  considering: [],
  priorities: [],
})

const plan = (version: number): Plan => ({
  version,
  days: [
    {
      dayIndex: 0,
      startsAt: FRAME.baseLodging,
      endsAt: FRAME.baseLodging,
      items: [
        { id: 'item_d0_lunch', placeId: 'ameyoko', dayIndex: 0, startTime: '12:45', endTime: '13:45' },
      ],
    },
  ],
})

const NO_LIST_CHANGE = { added: [], removed: [], modified: [] }
const NO_STATE_DIFF = {
  intent: NO_LIST_CHANGE,
  considering: NO_LIST_CHANGE,
  priorities: NO_LIST_CHANGE,
}
const NO_IMPACT = {
  itemsAffected: 1,
  poiCountDelta: 0,
  walkingDistanceDeltaM: null,
  travelTimeDeltaMin: null,
  freeTimeDeltaMin: null,
  budgetWarning: null,
}

const proposal = (): Proposal => ({
  id: 'prop_1',
  tripId: 'trip_1',
  status: 'pending',
  type: 'replace',
  initiator: 'user',
  trigger: 'closed today',
  candidateState: state(1),
  candidatePlan: plan(2),
  stateDiff: NO_STATE_DIFF,
  planDiff: NO_LIST_CHANGE,
  impact: NO_IMPACT,
  rationale: 'why',
  createdAt: '2026-10-02T00:00:00.000Z',
})

const receipt = (): Receipt => ({
  id: 'rcpt_1',
  tripId: 'trip_1',
  proposalId: 'prop_1',
  type: 'replace',
  initiator: 'user',
  trigger: 'closed today',
  summary: 'Swapped a place.',
  stateDiff: NO_STATE_DIFF,
  planDiff: NO_LIST_CHANGE,
  rationale: 'why',
  impact: NO_IMPACT,
  resultingStateVersion: 1,
  resultingPlanVersion: 2,
  timestamp: '2026-10-02T00:00:00.000Z',
})

describe('a first run', () => {
  it('has nothing to restore and has not seeded', () => {
    const storage = fakeStorage()
    const repositories = createPersistentRepositories({ storage })

    expect(repositories.status).toMatchObject({ saving: true, restored: false, seeded: false })
  })

  it('keeps a saved trip, and the next session finds it', async () => {
    const storage = fakeStorage()
    const first = createPersistentRepositories({ storage })

    await first.trips.save(trip())
    await first.states.save('trip_1', state(1))
    await first.plans.save('trip_1', plan(1))

    const second = createPersistentRepositories({ storage })
    expect(second.status.restored).toBe(true)
    expect((await second.trips.get('trip_1'))?.frame.name).toBe('Tokyo Slow Week')
    expect((await second.states.getCurrent('trip_1'))?.version).toBe(1)
    expect((await second.plans.getCurrent('trip_1'))?.version).toBe(1)
  })
})

describe('a committed transaction', () => {
  it('reaches storage as one write', async () => {
    const storage = fakeStorage()
    const repositories = createPersistentRepositories({ storage })
    await repositories.trips.save(trip())
    const before = storage.writes

    await repositories.unitOfWork.commitTransaction({
      tripId: 'trip_1',
      state: state(2),
      plan: plan(2),
      proposal: proposal(),
      receipt: receipt(),
    })

    // The property §13.2 asks for: no window in which the plan is stored against a
    // state that was never agreed to.
    expect(storage.writes - before).toBe(1)

    const next = createPersistentRepositories({ storage })
    expect((await next.states.getCurrent('trip_1'))?.version).toBe(2)
    expect((await next.plans.getCurrent('trip_1'))?.version).toBe(2)
    expect(await next.receipts.listByTrip('trip_1')).toHaveLength(1)
  })

  it('does not bring a pending proposal back', async () => {
    // It was never confirmed, so nothing on screen reflects it (§7.7).
    const storage = fakeStorage()
    const repositories = createPersistentRepositories({ storage })
    await repositories.trips.save(trip())
    await repositories.proposals.save(proposal())

    const next = createPersistentRepositories({ storage })
    expect(await next.proposals.get('prop_1')).toBeUndefined()
  })
})

describe('what comes back', () => {
  it('is frozen again, as the domain made it', async () => {
    const storage = fakeStorage()
    const first = createPersistentRepositories({ storage })
    await first.trips.save(trip())

    const restored = (await createPersistentRepositories({ storage }).trips.get('trip_1'))!

    // §10.5 is a guarantee about a trip's memory, not about one session's objects.
    expect(Object.isFrozen(restored.memorySnapshot)).toBe(true)
    expect(Object.isFrozen(restored.memorySnapshot?.memories)).toBe(true)
  })

  it('is ignored when it cannot be read', () => {
    const storage = fakeStorage({ seed: '{ not json' })
    expect(createPersistentRepositories({ storage }).status.restored).toBe(false)
  })

  it('is ignored when it was written by an older shape', () => {
    const storage = fakeStorage({ seed: JSON.stringify({ format: 0, trips: [trip()] }) })
    expect(createPersistentRepositories({ storage }).status.restored).toBe(false)
  })
})

describe('a browser that will not store anything', () => {
  it('says so once and keeps working', async () => {
    const onUnavailable = vi.fn()
    const storage = fakeStorage({ refuseWrites: true })
    const repositories = createPersistentRepositories({ storage, onUnavailable })

    await repositories.trips.save(trip())
    await repositories.states.save('trip_1', state(1))

    expect(onUnavailable).toHaveBeenCalledOnce()
    expect(repositories.status.saving).toBe(false)
    // In memory it all still works: the session is usable, it just will not survive.
    expect((await repositories.trips.get('trip_1'))?.id).toBe('trip_1')
  })

  it('is what an app with no storage at all gets, without throwing', async () => {
    const repositories = createPersistentRepositories({ storage: undefined })
    await repositories.trips.save(trip())

    expect(repositories.status.saving).toBe(false)
    expect((await repositories.trips.get('trip_1'))?.id).toBe('trip_1')
  })
})

describe('reset', () => {
  it('forgets the trip, the receipts and the seeding', async () => {
    const storage = fakeStorage()
    const repositories = createPersistentRepositories({ storage })
    await repositories.trips.save(trip())
    await repositories.receipts.append(receipt())
    await repositories.memories.save(memory({ id: 'mem_1', status: 'active' }))
    repositories.markSeeded('2026-10-02T00:00:00.000Z')

    repositories.clear()

    expect(repositories.status.seeded).toBe(false)
    expect(await repositories.trips.list()).toEqual([])
    const next = createPersistentRepositories({ storage })
    expect(next.status).toMatchObject({ restored: false, seeded: false })
  })

  it('can be done before anything reads, which is the recovery hatch', () => {
    const storage = fakeStorage({ seed: JSON.stringify({ format: 1, trips: [trip()] }) })
    clearPersisted(storage)
    expect(createPersistentRepositories({ storage }).status.restored).toBe(false)
  })
})

describe('what the Profile remembers', () => {
  it('keeps a confirmation across a reload', async () => {
    // The failure this guards: re-seeding on load forced every confirmed memory
    // back to `candidate`, undoing the one act §10.3 insists the user makes.
    const storage = fakeStorage()
    const first = createPersistentRepositories({ storage })
    await first.memories.save(memory({ id: 'mem_1', status: 'active' }))
    first.markSeeded('2026-10-02T00:00:00.000Z')

    const next = createPersistentRepositories({ storage })
    expect(next.status.seeded).toBe(true)
    expect((await next.memories.list())[0].status).toBe('active')
  })
})

describe('a trip that cannot be read any more', () => {
  it('is forgotten without taking the Profile with it', async () => {
    // Its places belong to a catalogue this build does not have. A confirmed memory
    // is about the traveller, not about any one set of places, so it survives.
    const storage = fakeStorage()
    const repositories = createPersistentRepositories({ storage })

    await repositories.trips.save(trip())
    await repositories.states.save('trip_1', state(1))
    await repositories.plans.save('trip_1', plan(1))
    await repositories.receipts.append(receipt())
    await repositories.memories.save(memory({ id: 'mem_1', status: 'active' }))
    repositories.markSeeded('2026-10-02T00:00:00.000Z')

    repositories.forgetTrip('trip_1')

    expect(await repositories.trips.list()).toEqual([])
    expect(await repositories.states.getCurrent('trip_1')).toBeUndefined()
    expect(await repositories.plans.getCurrent('trip_1')).toBeUndefined()
    expect(await repositories.receipts.listByTrip('trip_1')).toEqual([])
    expect((await repositories.memories.list())[0].status).toBe('active')

    // Gone from storage too, or the next load would restore it again.
    const next = createPersistentRepositories({ storage })
    expect(next.status.restored).toBe(false)
    expect(next.status.seeded).toBe(true)
    expect(await next.memories.list()).toHaveLength(1)
  })
})
