/**
 * Keeping a trip across a reload, offline (Gate 8).
 *
 * Everything up to here lived in memory, which meant a refresh — or a phone
 * reclaiming a background tab — lost the trip, the receipts and every memory the
 * traveller had confirmed. For a product whose whole claim is that decisions
 * accumulate, that is not a missing feature so much as a contradiction.
 *
 * Built ON the in-memory store rather than beside it. The reads, the filters and the
 * staged commit are already written and already tested; this adds a load at the start
 * and a flush after every write. Two implementations of the same eight repositories
 * would be two chances for them to disagree about what a trip is.
 *
 * **Atomic by construction.** The flush writes the entire store as ONE value, so a
 * `commitTransaction` that staged State, Plan, Proposal and Receipt together reaches
 * storage together or not at all. There is no window in which a plan is saved against
 * a state that was never agreed to — which is the property `commitTransaction` exists
 * for, and the reason this is a single key rather than one per collection.
 *
 * **Offline-safe, and honest when it cannot be.** Private mode, a blocked origin and
 * a full quota all fail here, and they fail differently from each other and silently.
 * So every read and every write is guarded, the first failure flips `status.saving` to
 * false, and the product can tell the traveller their changes are not being kept
 * instead of discovering it for them at the next reload.
 */

import type { Memory } from '../../domain/memory/types.ts'
import type { Plan } from '../../domain/plan/types.ts'
import type { Proposal } from '../../domain/proposals/types.ts'
import type { Receipt } from '../../domain/receipts/types.ts'
import type { TripState } from '../../domain/state/types.ts'
import type { Trip } from '../../domain/trip/types.ts'
import { createRepositories, createStore, type InMemoryStore } from './inMemory.ts'
import type { Repositories } from './types.ts'

/** The slice of `Storage` this needs. Narrow, so a test can hand over a fake. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const STORAGE_KEY = 'the-next-trip:v1'

/**
 * Bumped when the shape below changes.
 *
 * A stored trip from an older shape is dropped rather than migrated: this is a
 * portfolio demo with a reset button, and a half-understood old trip on screen is
 * worse than starting clean. A real product would migrate.
 */
const FORMAT = 1

interface Persisted {
  format: number
  /** So the Profile is seeded from the bundle once, and not on every load. */
  seededAt?: string
  trips: Trip[]
  states: Array<[string, TripState]>
  plans: Array<[string, Plan]>
  receipts: Receipt[]
  memories: Memory[]
  /**
   * Deliberately absent: a pending Proposal.
   *
   * It was never confirmed, so the committed itinerary does not reflect it, and §7.7
   * gives a proposal a lifetime bounded by the conversation it came from. Restoring
   * one would put a change the traveller walked away from back in front of them, with
   * the plan it was computed against possibly no longer on screen.
   */
  proposals?: never
}

export interface PersistenceStatus {
  /** False once storage has refused a write: the product is no longer keeping data. */
  saving: boolean
  /** True when a previous session's trip was loaded. */
  restored: boolean
  /** True when the Profile has already been seeded from the bundle. */
  seeded: boolean
}

function browserStorage(): StorageLike | undefined {
  try {
    // Touching `localStorage` itself throws on a blocked origin, before any call.
    const storage = globalThis.localStorage
    if (!storage) return undefined
    // A probe, because private mode allows the getter and refuses the write.
    const probe = `${STORAGE_KEY}:probe`
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch {
    return undefined
  }
}

/**
 * Re-freezes what the domain froze when it made it.
 *
 * JSON has no idea that a Memory snapshot is immutable (§10.5) or that a catalogue
 * snapshot is (B4). Both come back from storage as ordinary objects, and the guard
 * that would have caught a stray write is gone exactly when a reload makes it
 * hardest to notice.
 */
function refreeze(trip: Trip): Trip {
  if (trip.memorySnapshot) {
    Object.freeze(trip.memorySnapshot.memories)
    Object.freeze(trip.memorySnapshot)
  }
  if (trip.catalogueSnapshot) {
    Object.freeze(trip.catalogueSnapshot.places)
    Object.freeze(trip.catalogueSnapshot.provenance)
    Object.freeze(trip.catalogueSnapshot)
  }
  return Object.freeze(trip)
}

function read(storage: StorageLike): Persisted | undefined {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Persisted
    if (parsed.format !== FORMAT) return undefined
    return parsed
  } catch {
    // Corrupt or unreadable. Treated as no data: the reset path is the same one.
    return undefined
  }
}

function hydrate(store: InMemoryStore, data: Persisted): void {
  for (const trip of data.trips ?? []) store.trips.set(trip.id, refreeze(trip))
  for (const [tripId, state] of data.states ?? []) store.states.set(tripId, state)
  for (const [tripId, plan] of data.plans ?? []) store.plans.set(tripId, plan)
  for (const receipt of data.receipts ?? []) store.receipts.push(receipt)
  for (const memory of data.memories ?? []) store.memories.set(memory.id, memory)
}

function snapshot(store: InMemoryStore, seededAt: string | undefined): Persisted {
  return {
    format: FORMAT,
    ...(seededAt ? { seededAt } : {}),
    trips: [...store.trips.values()],
    states: [...store.states.entries()],
    plans: [...store.plans.entries()],
    receipts: [...store.receipts],
    memories: [...store.memories.values()],
  }
}

/** Wipes stored data. The recovery path for a corrupt store and for demo reset. */
export function clearPersisted(storage: StorageLike | undefined = browserStorage()): void {
  try {
    storage?.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to do: there is no state worth reporting in a failed delete of
    // something the next load will treat as absent anyway.
  }
}

export interface PersistentRepositories extends Repositories {
  store: InMemoryStore
  status: PersistenceStatus
  /** Records that the bundle has been seeded, so a reload does not undo a confirmation. */
  markSeeded(at: string): void
  /** Data reset: empties the store and forgets everything kept. */
  clear(): void
  /**
   * Drops one trip and everything written against it, keeping the Profile.
   *
   * For a trip that cannot be read any more — its places belong to a catalogue this
   * build does not have. Memories survive, because a confirmed memory is about the
   * traveller rather than about any one set of places.
   */
  forgetTrip(tripId: string): void
}

export function createPersistentRepositories(options: {
  storage?: StorageLike | undefined
  /** Called the first time storage refuses to keep something. */
  onUnavailable?: (why: string) => void
} = {}): PersistentRepositories {
  const storage = 'storage' in options ? options.storage : browserStorage()
  const store = createStore()
  const inner = createRepositories(store)

  const existing = storage ? read(storage) : undefined
  if (existing) hydrate(store, existing)

  const status: PersistenceStatus = {
    saving: storage !== undefined,
    restored: (existing?.trips.length ?? 0) > 0,
    seeded: existing?.seededAt !== undefined,
  }

  let seededAt = existing?.seededAt

  function flush(): void {
    if (!storage || !status.saving) return
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(snapshot(store, seededAt)))
    } catch (cause) {
      // Out of quota, or a mode that allows the probe and refuses the real write.
      // Stop trying: the app keeps working from memory and says it is not saving.
      status.saving = false
      options.onUnavailable?.(String(cause))
    }
  }

  /** Wraps a write so the whole store reaches storage after it, as one value. */
  function saving<TArgs extends unknown[]>(
    write: (...args: TArgs) => Promise<void>,
  ): (...args: TArgs) => Promise<void> {
    return async (...args: TArgs) => {
      await write(...args)
      flush()
    }
  }

  return {
    store,
    status,

    markSeeded(at) {
      seededAt = at
      status.seeded = true
      flush()
    },

    forgetTrip(tripId) {
      store.trips.delete(tripId)
      store.states.delete(tripId)
      store.plans.delete(tripId)
      for (const [id, proposal] of store.proposals) {
        if (proposal.tripId === tripId) store.proposals.delete(id)
      }
      store.receipts = store.receipts.filter((receipt) => receipt.tripId !== tripId)
      status.restored = store.trips.size > 0
      flush()
    },

    clear() {
      store.trips.clear()
      store.states.clear()
      store.plans.clear()
      store.proposals.clear()
      store.memories.clear()
      store.receipts.length = 0
      seededAt = undefined
      status.seeded = false
      status.restored = false
      clearPersisted(storage)
    },

    trips: { ...inner.trips, save: saving(inner.trips.save) },
    states: { ...inner.states, save: saving(inner.states.save) },
    plans: { ...inner.plans, save: saving(inner.plans.save) },
    // A proposal is kept in memory for the session and never written out, so its
    // save needs no flush — see `Persisted.proposals`.
    proposals: inner.proposals,
    receipts: { ...inner.receipts, append: saving(inner.receipts.append) },
    memories: {
      ...inner.memories,
      save: saving(inner.memories.save),
      remove: saving(inner.memories.remove),
    },
    unitOfWork: { commitTransaction: saving(inner.unitOfWork.commitTransaction) },
  }
}
