/**
 * In-memory persistence for domain tests (Gate 2).
 *
 * `commitTransaction` deliberately stages every write and applies them only
 * after all have been validated, so a failure mid-transaction leaves the store
 * untouched. That is what lets the atomic-commit tests mean something — and
 * `localStore.ts`, which the app runs on, builds the same guarantee on top of it by
 * flushing the whole store as a single value.
 */

import type { Plan } from '../../domain/plan/types.ts'
import type { Memory } from '../../domain/memory/types.ts'
import type { Proposal } from '../../domain/proposals/types.ts'
import type { Receipt } from '../../domain/receipts/types.ts'
import type { TripState } from '../../domain/state/types.ts'
import type { ID, Trip } from '../../domain/trip/types.ts'
import type { CommitTransactionInput, Repositories } from './types.ts'

export interface InMemoryStore {
  trips: Map<ID, Trip>
  states: Map<ID, TripState>
  plans: Map<ID, Plan>
  proposals: Map<ID, Proposal>
  receipts: Receipt[]
  memories: Map<ID, Memory>
}

export function createStore(): InMemoryStore {
  return {
    trips: new Map(),
    states: new Map(),
    plans: new Map(),
    proposals: new Map(),
    receipts: [],
    memories: new Map(),
  }
}

export interface InMemoryOptions {
  /** Test hook: throw at this point inside commitTransaction. */
  failCommitAt?: 'state' | 'plan' | 'proposal' | 'receipt'
}

export function createRepositories(
  store: InMemoryStore = createStore(),
  options: InMemoryOptions = {},
): Repositories & { store: InMemoryStore } {
  return {
    store,

    trips: {
      async get(tripId) {
        return store.trips.get(tripId)
      },
      async save(trip) {
        store.trips.set(trip.id, trip)
      },
      async list() {
        return [...store.trips.values()]
      },
    },

    states: {
      async getCurrent(tripId) {
        return store.states.get(tripId)
      },
      async save(tripId, state) {
        store.states.set(tripId, state)
      },
    },

    plans: {
      async getCurrent(tripId) {
        return store.plans.get(tripId)
      },
      async save(tripId, plan) {
        store.plans.set(tripId, plan)
      },
    },

    proposals: {
      async get(proposalId) {
        return store.proposals.get(proposalId)
      },
      async listByTrip(tripId) {
        return [...store.proposals.values()].filter((proposal) => proposal.tripId === tripId)
      },
      async save(proposal) {
        store.proposals.set(proposal.id, proposal)
      },
    },

    receipts: {
      async listByTrip(tripId) {
        return store.receipts.filter((receipt) => receipt.tripId === tripId)
      },
      async append(receipt) {
        store.receipts.push(receipt)
      },
    },

    memories: {
      async list() {
        return [...store.memories.values()]
      },
      async save(memory) {
        store.memories.set(memory.id, memory)
      },
      async remove(memoryId) {
        store.memories.delete(memoryId)
      },
    },

    unitOfWork: {
      async commitTransaction(input: CommitTransactionInput) {
        // Stage first; apply only once everything has succeeded.
        const apply: Array<() => void> = []

        if (options.failCommitAt === 'state') throw new Error('injected failure: state')
        apply.push(() => store.states.set(input.tripId, input.state))

        if (options.failCommitAt === 'plan') throw new Error('injected failure: plan')
        apply.push(() => store.plans.set(input.tripId, input.plan))

        if (options.failCommitAt === 'proposal') throw new Error('injected failure: proposal')
        apply.push(() => store.proposals.set(input.proposal.id, input.proposal))

        if (options.failCommitAt === 'receipt') throw new Error('injected failure: receipt')
        apply.push(() => store.receipts.push(input.receipt))

        for (const write of apply) write()
      },
    },
  }
}
