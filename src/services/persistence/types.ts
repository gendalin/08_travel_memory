/**
 * Persistence interfaces (product_spec §13.2).
 *
 * The domain declares what it needs; adapters implement it. `inMemory.ts` is what
 * the tests run on; `localStore.ts` is what the app runs on, which keeps a trip
 * across a reload by writing the whole store as one value (Gate 8).
 *
 * `commitTransaction` exists because atomicity has to be real at the storage
 * layer, not just in the pure commit function — a partial write that saved the
 * Plan but not the State would leave the trip describing a plan it never agreed
 * to.
 */

import type { Plan } from '../../domain/plan/types.ts'
import type { Memory } from '../../domain/memory/types.ts'
import type { Proposal } from '../../domain/proposals/types.ts'
import type { Receipt } from '../../domain/receipts/types.ts'
import type { TripState } from '../../domain/state/types.ts'
import type { ID, Trip } from '../../domain/trip/types.ts'

export interface TripRepository {
  get(tripId: ID): Promise<Trip | undefined>
  save(trip: Trip): Promise<void>
  list(): Promise<Trip[]>
}

export interface StateRepository {
  getCurrent(tripId: ID): Promise<TripState | undefined>
  save(tripId: ID, state: TripState): Promise<void>
}

export interface PlanRepository {
  getCurrent(tripId: ID): Promise<Plan | undefined>
  save(tripId: ID, plan: Plan): Promise<void>
}

export interface ProposalRepository {
  get(proposalId: ID): Promise<Proposal | undefined>
  listByTrip(tripId: ID): Promise<Proposal[]>
  save(proposal: Proposal): Promise<void>
}

export interface ReceiptRepository {
  listByTrip(tripId: ID): Promise<Receipt[]>
  append(receipt: Receipt): Promise<void>
}

/** Profile-level memories, shared across trips. */
export interface MemoryRepository {
  list(): Promise<Memory[]>
  save(memory: Memory): Promise<void>
  /** Hard delete — there is no archived state (§10.1). */
  remove(memoryId: ID): Promise<void>
}

export interface CommitTransactionInput {
  tripId: ID
  state: TripState
  plan: Plan
  proposal: Proposal
  receipt: Receipt
}

export interface UnitOfWork {
  /** Persists State, Plan, Proposal and Receipt together, or throws. */
  commitTransaction(input: CommitTransactionInput): Promise<void>
}

export interface Repositories {
  trips: TripRepository
  states: StateRepository
  plans: PlanRepository
  proposals: ProposalRepository
  receipts: ReceiptRepository
  memories: MemoryRepository
  unitOfWork: UnitOfWork
}
