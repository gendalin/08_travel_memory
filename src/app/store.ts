/**
 * App state and actions.
 *
 * Every domain call goes through src/application/*. Components read this store
 * and dispatch these actions; no component imports src/domain (§13.2).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import type { Plan } from '../domain/plan/types.ts'
import type { Memory } from '../domain/memory/types.ts'
import type { Proposal } from '../domain/proposals/types.ts'
import type { Receipt } from '../domain/receipts/types.ts'
import type { TripState } from '../domain/state/types.ts'
import type { Trip } from '../domain/trip/types.ts'
import {
  buildReviewDraft,
  confirmReview,
  DESTINATION,
  toFrame,
  tripDays,
  type ReviewDraft,
  type StageAInput,
} from '../application/createTrip/createTrip.ts'
import { generateFirstPlan } from '../application/generatePlan/generatePlan.ts'
import { createMemorySnapshot } from '../domain/memory/snapshot.ts'
import { handleChatMessage, type ChatOutcome } from '../application/handleChat/handleChat.ts'
import {
  confirmProposal,
  invalidatePendingProposal,
  rejectProposal,
  supersedePendingProposal,
} from '../application/commitProposal/commitProposalUseCase.ts'
import {
  proposeStateEdit,
  toStateDraft,
  type StateDraft,
} from '../application/editState/proposeStateEdit.ts'
import { narrowProposal } from '../application/planning/narrowProposal.ts'
import { explainValidationError, type ConflictOption } from '../application/planning/conflicts.ts'
import { tagConsidering } from '../application/decompose/tagConsidering.ts'
import type { EventFinder, EventSearchResult, FoundEvent } from '../services/events/types.ts'
import { withEventPlaces } from '../services/places/eventPlaces.ts'
import {
  listAlternatives,
  proposeAlternative,
  type Alternative,
} from '../application/alternatives/alternatives.ts'
import {
  confirmCandidate,
  deactivateProfileMemory,
  dismissMemory,
  editMemoryText,
  loadProfileMemories,
  seedProfile,
  type BundledEvidence,
  type BundledMemory,
} from '../application/manageMemory/manageMemory.ts'
import { explainDay, type DayExplanation } from '../application/explainDay/explainDay.ts'
import { createPersistentRepositories } from '../services/persistence/localStore.ts'
import { retrieveForTrip } from '../application/createTrip/retrieveForTrip.ts'
import type { PlacesSearcher } from '../application/planning/retrievePlaces.ts'
import { catalogueForTrip, catalogueFromSnapshot } from '../services/places/catalogue.ts'
import type { LodgingLocator } from '../services/places/lodging.ts'
import type { PlaceCatalogue } from '../services/places/types.ts'
import { createResilientLlm } from '../services/llm/resilientLlm.ts'
import type { LlmService } from '../services/llm/types.ts'

/**
 * Routes. `trip` covers both views of an existing trip — which one is showing
 * is `view`, because Plan and State are peers reached from one control, not
 * separate destinations (UI drafts 01, 03).
 */
export type Screen = 'index' | 'setup' | 'review' | 'trip'

export type TripView = 'plan' | 'state'

/** A Stage B conflict, tied back to the Considering item that caused it (§3.6.5). */
export interface StateConflict {
  message: string
  consideringId?: string
  /** Ways out, computed by code: another day, drop it, edit it. */
  options?: ConflictOption[]
}

export interface ChatEntry {
  id: string
  from: 'user' | 'agent'
  text: string
}

/**
 * What the app needs to retrieve places for a trip of its own.
 *
 * Optional, and that is the cost switch. Present means Generate searches Places for
 * this traveller and freezes what it finds onto the trip; absent means the trip is
 * planned from the pre-loaded bundle, which is what the scripted demo, the static
 * review build and every E2E run do — no calls, no bill, same answer every time.
 */
export interface RetrievalDeps {
  locator: LodgingLocator
  searcher: PlacesSearcher
}

export interface AppDeps {
  catalogue: PlaceCatalogue
  llm: LlmService
  /** Absent for a run that plans from the bundle. */
  retrieval?: RetrievalDeps
  /** Raw memories from the demo bundle; seeded into the Profile on first render. */
  bundledMemories: BundledMemory[]
  /** The bundle's evidence, so seeded memories can name the places behind them. */
  bundledEvidence?: BundledEvidence[]
  /**
   * Finds real, dated events when State asks for one (§7.8): live through the server
   * in the app, a dated recording in the offline prototype. Absent: event requests
   * are kept in State and not planned.
   */
  events?: EventFinder
  now: () => Date
}

/** An event search waiting for the traveller to pick one (§7.8). */
export interface EventChoice {
  consideringId: string
  activity: string
  result: EventSearchResult
}

let sequence = 0
const nextId = (prefix: string) => `${prefix}_${++sequence}`

/**
 * What a failure says to the traveller (Gate 8).
 *
 * Never the raw message. It used to be: a 500 from the planning service reached the
 * screen as the URL, the status and whatever body the provider returned. With the
 * model now behind a retry budget and a deterministic stand-in, an error getting
 * this far is the product's own — a failed write, or a bug — and neither a stack
 * frame nor a provider's wording tells a traveller anything they can act on.
 *
 * The detail is not lost, it is just put where it is useful.
 */
function saying(doing: string, cause: unknown): string {
  console.error(`[the-next-trip] ${doing}`, cause)
  return `Something went wrong while ${doing}. Try again.`
}

export function useAppStore(deps: AppDeps) {
  /**
   * Storage, and what to say when there is none (Gate 8).
   *
   * A browser that refuses to keep anything — private mode, a blocked origin, a full
   * quota — is a working product that silently loses the trip at the next reload. The
   * traveller is told instead.
   */
  const [notSaving, setNotSaving] = useState(false)
  const repositories = useMemo(
    () => createPersistentRepositories({ onUnavailable: () => setNotSaving(true) }),
    [],
  )

  const [screen, setScreen] = useState<Screen>('index')
  const [view, setView] = useState<TripView>('plan')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  /**
   * The chat sheet lives here rather than in the Plan screen because it is
   * where every answer lands — a State edit that produces a proposal has to be
   * able to open it too, or the reply to what the user just did is hidden.
   */
  const [chatOpen, setChatOpen] = useState(false)
  const [memories, setMemories] = useState<Memory[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * What the product did by itself because the planning service was unreachable
   * (Gate 8, Phase C2). Shown, not swallowed: an answer a rule produced reads the
   * same as one the model produced, and the traveller is owed the difference.
   */
  const [degraded, setDegraded] = useState<string | null>(null)

  /**
   * The model, with §8's retry budget and the deterministic stand-in behind it.
   *
   * Wrapped here rather than where `deps.llm` is built, so every surface that asks
   * the model gets the same policy and there is one place that decides what happens
   * when it does not answer.
   */
  const llm = useMemo(
    () => createResilientLlm({ llm: deps.llm, onDegraded: (event) => setDegraded(event.message) }),
    [deps.llm],
  )

  const [setupInput, setSetupInput] = useState<StageAInput | null>(null)
  const [conflicts, setConflicts] = useState<StateConflict[]>([])
  const [draft, setDraft] = useState<ReviewDraft | null>(null)
  const [acceptedPriority, setAcceptedPriority] = useState<string | undefined>()

  const [trip, setTrip] = useState<Trip | null>(null)
  const [state, setState] = useState<TripState | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [selectedDay, setSelectedDay] = useState(0)
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null)

  /**
   * The places this trip can reach.
   *
   * A trip retrieved for itself carries its own frozen set (B4), and everything after
   * creation reads THAT rather than the pre-loaded bundle — which is what makes a
   * Replace offer the same three alternatives tomorrow as today, and what stops a
   * Receipt naming a set that has since changed underneath it.
   *
   * A trip planned from the bundle has no snapshot, and the bundle is its catalogue.
   *
   * Plus the venue of every event the trip holds, or that a pending proposal would
   * add — an event is found for the trip, not catalogued (§7.8).
   */
  const catalogue = useMemo(
    () => withEventPlaces(catalogueForTrip(trip, deps.catalogue), state, proposal?.candidateState),
    [trip, deps.catalogue, state, proposal],
  )

  /** An event search waiting on the traveller's pick. */
  const [eventChoice, setEventChoice] = useState<EventChoice | null>(null)

  /** A change that could not be planned, shown instead of a proposal (§8). */
  const [planConflict, setPlanConflict] = useState<string | null>(null)
  /** What happened to the previous pending proposal, in one line (§7.7). */
  const [lifecycleNote, setLifecycleNote] = useState<string | null>(null)

  // Direct State edit (§7.6). The draft is held here, never committed until the
  // resulting Plan has been validated.
  const [stateDraft, setStateDraft] = useState<StateDraft | null>(null)
  const [stateConflicts, setStateConflicts] = useState<StateConflict[]>([])
  /** Confirmation for an edit that committed without a preview (§7.6). */
  const [stateNote, setStateNote] = useState<string | null>(null)

  /**
   * Picks up where the last session left off, seeding the Profile only on a first run.
   *
   * The committed trip comes back — State, Plan and the Receipts behind them. A
   * pending proposal does not: it was never confirmed, so nothing on screen reflects
   * it, and putting a change the traveller walked away from back in front of them is
   * not continuity.
   */
  useEffect(() => {
    let cancelled = false

    void (async () => {
      const at = deps.now().toISOString()
      if (!repositories.status.seeded) {
        await seedProfile(deps.bundledMemories, repositories.memories, at, {
          autoActivate: true,
          evidence: deps.bundledEvidence,
        })
        repositories.markSeeded(at)
      }

      const stored = await loadProfileMemories(repositories.memories)
      const trips = await repositories.trips.list()
      // Newest first: one trip is the demo, but the model does not forbid more.
      const latest = [...trips].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      const restoredState = latest ? await repositories.states.getCurrent(latest.id) : undefined
      const restoredPlan = latest ? await repositories.plans.getCurrent(latest.id) : undefined
      const restoredReceipts = latest ? await repositories.receipts.listByTrip(latest.id) : []

      /**
       * A stored trip is only usable if its places still exist.
       *
       * They may not. The shareable prototype carries its catalogue inside the file,
       * so a viewer who opened an earlier build has a trip whose stops that build's
       * catalogue had and this one has never heard of — and the itinerary came back
       * as a column of raw place ids with no photographs, which is what a reader
       * reported as "the pictures are missing".
       *
       * Dropped rather than shown, and dropped narrowly: the Profile is about the
       * traveller, not about any one set of places, so confirmed memories survive.
       */
      const readable =
        latest !== undefined &&
        restoredPlan !== undefined &&
        restoredPlan.days
          .flatMap((day) => day.items)
          .every((item) => catalogueForTrip(latest, deps.catalogue).has(item.placeId))

      if (latest && !readable) repositories.forgetTrip(latest.id)

      if (cancelled) return
      setMemories(stored)

      if (readable && latest && restoredState && restoredPlan) {
        setTrip(latest)
        setState(restoredState)
        setPlan(restoredPlan)
        setStateDraft(toStateDraft(restoredState))
        setReceipts(restoredReceipts)
        setView('plan')
        setScreen('trip')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [deps.bundledMemories, deps.now, repositories])

  /**
   * The stops the last committed change put in place — marked "Updated" on the
   * itinerary until the next change, so what moved is visible at a glance.
   */
  const updatedItemIds = useMemo(() => {
    const last = [...receipts].reverse().find(
      (receipt) => receipt.planDiff.added.length + receipt.planDiff.modified.length > 0,
    )
    if (!last) return new Set<string>()
    return new Set([
      ...last.planDiff.added.map((item) => item.id),
      ...last.planDiff.modified.map((entry) => entry.after.id),
    ])
  }, [receipts])

  const activeMemoryCount = useMemo(
    () => memories.filter((memory) => memory.status === 'active').length,
    [memories],
  )

  /**
   * Back to a first run: nothing kept, the Profile seeded again (Gate 8).
   *
   * One action rather than two. The spec asks for a data reset and a demo reset, and
   * in this product they are the same act — the demo IS the data. Splitting them would
   * mean a button whose difference from the other button nobody could state.
   *
   * Deliberately destructive and deliberately explicit: there is no undo anywhere in
   * this product (§7), so the caller confirms before reaching this.
   */
  const resetDemo = useCallback(async () => {
    repositories.clear()

    setTrip(null)
    setState(null)
    setPlan(null)
    setProposal(null)
    setReceipts([])
    setChat([])
    setStateDraft(null)
    setStateConflicts([])
    setStateNote(null)
    setPlanConflict(null)
    setLifecycleNote(null)
    setSelectedDay(0)
    setSelectedPlaceId(null)
    setError(null)
    setDegraded(null)
    setChatOpen(false)
    setProfileOpen(false)
    setDrawerOpen(false)
    setView('plan')
    setScreen('index')

    const at = deps.now().toISOString()
    setMemories(await seedProfile(deps.bundledMemories, repositories.memories, at, {
          autoActivate: true,
          evidence: deps.bundledEvidence,
        }))
    repositories.markSeeded(at)
  }, [deps, repositories])

  /** Nothing is persisted until Generate, so discarding is just clearing the draft. */
  const discardDraft = useCallback(() => {
    setSetupInput(null)
    setDraft(null)
    setAcceptedPriority(undefined)
    setConflicts([])
    setError(null)
  }, [])

  const startNewTrip = useCallback(() => {
    discardDraft()
    setDrawerOpen(false)
    setScreen('setup')
  }, [discardDraft])

  /** × on the New Trip flow returns to wherever it was opened from (§3.6.9). */
  const closeNewTrip = useCallback(() => {
    discardDraft()
    setScreen(trip ? 'trip' : 'index')
  }, [discardDraft, trip])

  /** Back from Stage B keeps the draft, so edits survive a round trip (§3.6.9). */
  const backToSetup = useCallback(() => {
    setConflicts([])
    setError(null)
    setScreen('setup')
  }, [])

  const openTrip = useCallback(() => {
    setDrawerOpen(false)
    setView('plan')
    setScreen('trip')
  }, [])

  const openChat = useCallback(() => setChatOpen(true), [])
  const closeChat = useCallback(() => setChatOpen(false), [])

  const openIndex = useCallback(() => setDrawerOpen(true), [])
  const closeIndex = useCallback(() => setDrawerOpen(false), [])

  const openProfile = useCallback(() => {
    setDrawerOpen(false)
    setProfileOpen(true)
  }, [])

  const closeProfile = useCallback(() => setProfileOpen(false), [])

  const confirmMemory = useCallback(
    async (memoryId: string) => setMemories(await confirmCandidate(memoryId, repositories.memories)),
    [repositories.memories],
  )
  const stopUsingMemory = useCallback(
    async (memoryId: string) =>
      setMemories(await deactivateProfileMemory(memoryId, repositories.memories)),
    [repositories.memories],
  )
  const forgetMemory = useCallback(
    async (memoryId: string) => setMemories(await dismissMemory(memoryId, repositories.memories)),
    [repositories.memories],
  )
  const renameMemory = useCallback(
    async (memoryId: string, text: string) =>
      setMemories(await editMemoryText(memoryId, text, repositories.memories)),
    [repositories.memories],
  )

  /** Stage A -> Stage B. */
  const submitSetup = useCallback(
    async (input: StageAInput) => {
      setBusy('Reading your notes…')
      setError(null)
      try {
        // Re-running decomposition would throw away structured edits the user
        // already made, so a draft from this creation session is kept (§3.6.9).
        const unchanged =
          setupInput !== null &&
          setupInput.intentText === input.intentText &&
          setupInput.consideringText === input.consideringText
        const reviewDraft = unchanged && draft ? draft : await buildReviewDraft(input, llm)

        setSetupInput(input)
        setDraft(reviewDraft)
        setScreen('review')
      } catch (cause) {
        setError(saying('reading your notes', cause))
      } finally {
        setBusy(null)
      }
    },
    [llm, setupInput, draft],
  )

  /** Stage B -> State v1 + snapshot + validated Plan v1. */
  const generateItinerary = useCallback(async () => {
    if (!setupInput || !draft) return
    setBusy('Building your itinerary…')
    setError(null)
    setDegraded(null)
    try {
      const frame = toFrame(setupInput)
      const tripId = nextId('trip')
      const createdAt = deps.now().toISOString()
      const days = tripDays(frame.startDate, frame.endDate)

      /**
       * Retrieval, once, before anything is written.
       *
       * Both of the next two steps read the result: `confirmReview` resolves a
       * must-visit against the set the trip will actually have, and the generator
       * fills the day from it. A local binding rather than the `catalogue` memo,
       * which still describes the trip on screen — there is not one yet.
       */
      let snapshot
      let tripCatalogue = deps.catalogue

      if (deps.retrieval) {
        const outcome = await retrieveForTrip({
          tripId,
          days,
          destination: DESTINATION,
          baseLodgingName: setupInput.baseLodgingName,
          intentText: setupInput.intentText,
          consideringText: setupInput.consideringText,
          considering: draft.considering.map((item) => item.text),
          memorySnapshot: createMemorySnapshot(tripId, memories, createdAt),
          llm,
          locator: deps.retrieval.locator,
          searcher: deps.retrieval.searcher,
          createdAt,
          onProgress: setBusy,
        })

        if (outcome.kind === 'retrieved') {
          snapshot = outcome.snapshot
          tripCatalogue = catalogueFromSnapshot(outcome.snapshot)
        } else {
          // Said, not hidden: a trip planned from the seed set is a different trip
          // from one planned for this traveller (Phase C2).
          setDegraded(outcome.because)
        }
        setBusy('Building your itinerary…')
      }

      const { trip: newTrip, state: newState } = confirmReview({
        tripId,
        frame,
        draft,
        acceptedPriorityName: acceptedPriority,
        profileMemories: memories,
        catalogue: tripCatalogue,
        ...(snapshot ? { catalogueSnapshot: snapshot } : {}),
        createdAt,
      })

      const { plan: newPlan, validation } = generateFirstPlan({
        frame,
        state: newState,
        catalogue: tripCatalogue,
        days,
        now: deps.now(),
        // The trip's own snapshot, not the live Profile: memories confirmed
        // after this point must not reach back into this trip (§10.5).
        memorySnapshot: newTrip.memorySnapshot,
      })


      // Never display an invalid itinerary (§8). The user stays on Stage B with
      // the conflict tied to the Considering item that caused it (§3.6.5).
      if (!validation.valid) {
        setConflicts(
          validation.errors.map((problem) => explainValidationError(problem, newState, frame, tripCatalogue)),
        )
        return
      }
      setConflicts([])

      await repositories.trips.save(newTrip)
      await repositories.states.save(newTrip.id, newState)
      await repositories.plans.save(newTrip.id, newPlan)

      setTrip(newTrip)
      setState(newState)
      setPlan(newPlan)
      setStateDraft(toStateDraft(newState))
      setView('plan')
      setScreen('trip')
    } catch (cause) {
      setError(saying('building your itinerary', cause))
    } finally {
      setBusy(null)
    }
  }, [setupInput, draft, acceptedPriority, memories, deps, llm, repositories])

  /**
   * Chat -> proposal. The committed plan is untouched while a proposal is
   * pending, and a new request supersedes the previous one (§7.7).
   */
  const sendMessage = useCallback(
    async (message: string) => {
      if (!trip || !state || !plan) return
      const turnId = nextId('msg')
      setChat((entries) => [...entries, { id: turnId, from: 'user', text: message }])
      setBusy('Looking at the day…')
      setError(null)
      setPlanConflict(null)
      setLifecycleNote(null)
      try {
        if (proposal) {
          await supersedePendingProposal({ proposal, repositories })
          setProposal(null)
          setLifecycleNote('That replaces the suggestion I had open.')
        }

        const outcome: ChatOutcome = await handleChatMessage({
          message,
          tripId: trip.id,
          frame: trip.frame,
          state,
          plan,
          catalogue,
          llm,
          now: deps.now(),
          proposalId: nextId('prop'),
          createdAt: deps.now().toISOString(),
          focusDayIndex: selectedDay,
          memorySnapshot: trip.memorySnapshot,
          turnId: `chat:${trip.id}:${turnId}`,
        })

        // What the traveller said about themselves goes to the Profile as candidates,
        // on its own path: nothing here activates them (§10.3).
        if (outcome.kind !== 'conflict' && outcome.memoryCandidates?.length) {
          for (const memory of outcome.memoryCandidates) await repositories.memories.save(memory)
          setMemories(await loadProfileMemories(repositories.memories))
        }

        if (outcome.kind === 'proposal') {
          setProposal(outcome.proposal)
          await repositories.proposals.save(outcome.proposal)
        } else if (outcome.kind === 'answer') {
          setChat((entries) => [...entries, { id: nextId('msg'), from: 'agent', text: outcome.text }])
        } else {
          // A Conflict is its own surface, not a chat reply (§8).
          setPlanConflict(outcome.reason)
        }
      } catch (cause) {
        setError(saying('working out that change', cause))
      } finally {
        setBusy(null)
      }
    },
    [trip, state, plan, proposal, selectedDay, deps, repositories],
  )

  /** Commits the pending proposal: State and Plan together, one Receipt (§9.1). */
  const commitPending = useCallback(
    async (pending: Proposal) => {
      if (!trip || !state || !plan) return
      const result = await confirmProposal({
        proposal: pending,
        state,
        plan,
        catalogue,
        repositories,
        receiptId: nextId('rcpt'),
        // Recorded on the Receipt so "why this place and not another" survives the
        // set of places growing (B4).
        ...(trip.catalogueSnapshot
          ? { catalogueVersion: trip.catalogueSnapshot.version }
          : {}),
        timestamp: deps.now().toISOString(),
      })
      setState(result.state)
      setPlan(result.plan)
      setReceipts((all) => [...all, result.receipt])
      setProposal(null)
      setChat((entries) => [
        ...entries,
        { id: nextId('msg'), from: 'agent', text: result.receipt.summary },
      ])
    },
    [trip, state, plan, deps, repositories],
  )

  /**
   * Confirms the pending proposal, less any change the traveller declined (§7.6).
   * A declined change keeps the original stop in that slot; the narrowed plan is
   * validated again before anything commits.
   */
  const confirmChange = useCallback(async (declinedUnitIds: string[] = []) => {
    if (!proposal || !trip || !state || !plan) return
    setBusy('Applying the change…')
    try {
      if (declinedUnitIds.length === 0) {
        await commitPending(proposal)
        return
      }
      const narrowed = narrowProposal({
        proposal,
        declinedUnitIds,
        currentState: state,
        currentPlan: plan,
        frame: trip.frame,
        catalogue,
        now: deps.now(),
      })
      if (narrowed.kind === 'conflict') {
        setPlanConflict(narrowed.reason)
        return
      }
      await repositories.proposals.save(narrowed.proposal)
      await commitPending(narrowed.proposal)
    } catch (cause) {
      setError(saying('applying the change', cause))
    } finally {
      setBusy(null)
    }
  }, [proposal, trip, state, plan, catalogue, deps, repositories, commitPending])

  const keepCurrent = useCallback(async () => {
    if (!proposal) return
    await rejectProposal({ proposal, repositories })
    setProposal(null)
    setChat((entries) => [
      ...entries,
      { id: nextId('msg'), from: 'agent', text: 'Kept the current plan.' },
    ])
  }, [proposal, repositories])

  const dismissConflict = useCallback(() => setPlanConflict(null), [])

  // --- Direct State edit (§7.6) ---------------------------------------------

  /** Switching to State shows the committed State, never a stale draft. */
  const selectView = useCallback(
    (next: TripView) => {
      if (next === 'state' && state) {
        setStateConflicts([])
        setStateNote(null)
        setStateDraft(toStateDraft(state))
      }
      setView(next)
    },
    [state],
  )

  /** Undo edits — back to the State as committed. */
  const revertStateDraft = useCallback(() => {
    if (state) setStateDraft(toStateDraft(state))
    setStateConflicts([])
    setEventChoice(null)
  }, [state])

  /**
   * Save: draft State -> candidate Plan -> validate -> proposal, or an
   * immediate commit when the itinerary is unaffected (§7.6).
   */
  const saveDraft = useCallback(async (draftToSave: StateDraft, options: { skipEventSearch?: boolean } = {}) => {
    if (!trip || !state || !plan) return
    const stateDraft = draftToSave
    setBusy('Checking the trip…')
    setError(null)
    setPlanConflict(null)
    setStateNote(null)
    try {
      // A new line asking for an event needs a real one before it can be planned
      // (§7.8): search, and let the traveller pick. A line already saved, or already
      // given an event, is not searched again.
      const request = options.skipEventSearch
        ? undefined
        : stateDraft.considering
            .map((item) => ({ item, tag: tagConsidering(item.text, catalogue) }))
            .find(
              ({ item, tag }) =>
                tag?.kind === 'event_request' &&
                !item.event &&
                !state.considering.some((saved) => saved.id === item.id && saved.text === item.text),
            )
      if (request && request.tag?.kind === 'event_request' && deps.events) {
        setBusy(`Looking for ${request.tag.activity} on your dates…`)
        const result = await deps.events.find({
          activity: request.tag.activity,
          destination: trip.frame.destination,
          startDate: trip.frame.startDate,
          endDate: trip.frame.endDate,
        })
        setEventChoice({ consideringId: request.item.id, activity: request.tag.activity, result })
        return
      }

      // A user State edit invalidates any pending proposal (§7.7).
      if (proposal) {
        await invalidatePendingProposal({ proposal, repositories })
        setProposal(null)
        setLifecycleNote('Your edit replaced the suggestion I had open.')
      }

      const outcome = proposeStateEdit({
        tripId: trip.id,
        frame: trip.frame,
        state,
        plan,
        draft: stateDraft,
        catalogue,
        now: deps.now(),
        proposalId: nextId('prop'),
        createdAt: deps.now().toISOString(),
        memorySnapshot: trip.memorySnapshot,
      })

      if (outcome.kind === 'conflict') {
        setStateConflicts(outcome.conflicts)
        return
      }
      setStateConflicts([])

      if (outcome.kind === 'unchanged') return

      if (outcome.kind === 'commit_now') {
        await repositories.proposals.save(outcome.proposal)
        await commitPending(outcome.proposal)
        setStateDraft(toStateDraft(outcome.proposal.candidateState))
        // The itinerary did not move, so nothing on screen would otherwise
        // change — say so, rather than letting Save vanish silently.
        setStateNote(
          outcome.notes.length > 0
            ? `Saved, but the itinerary could not follow it. ${outcome.notes.join(' ')}`
            : 'Saved. The itinerary still works as it stands.',
        )
        return
      }

      // The plan moves only once the user confirms (§7.6), so the proposal is
      // put in front of them straight away rather than left behind a badge.
      setProposal(outcome.proposal)
      await repositories.proposals.save(outcome.proposal)
      setView('plan')
      setChatOpen(true)
    } catch (cause) {
      setError(saying('saving your trip state', cause))
    } finally {
      setBusy(null)
    }
  }, [trip, state, plan, proposal, deps, repositories, commitPending, catalogue])

  const saveStateDraft = useCallback(async () => {
    if (stateDraft) await saveDraft(stateDraft)
  }, [stateDraft, saveDraft])

  /** The traveller picked an event: it goes on its line, and the edit is saved with it. */
  const pickEvent = useCallback(
    async (found: FoundEvent) => {
      if (!trip || !stateDraft || !eventChoice) return
      const [y, m, d] = trip.frame.startDate.split('-').map(Number)
      const [ey, em, ed] = found.date.split('-').map(Number)
      const dayIndex = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(y, m - 1, d)) / 86_400_000)
      const next: StateDraft = {
        ...stateDraft,
        considering: stateDraft.considering.map((item) =>
          item.id === eventChoice.consideringId
            ? { ...item, event: { ...found, dayIndex, recorded: eventChoice.result.recorded } }
            : item,
        ),
      }
      setEventChoice(null)
      setStateDraft(next)
      await saveDraft(next)
    },
    [trip, stateDraft, eventChoice, saveDraft],
  )

  /** Keep the line without planning an event for it. */
  const skipEvent = useCallback(async () => {
    setEventChoice(null)
    if (stateDraft) await saveDraft(stateDraft, { skipEventSearch: true })
  }, [stateDraft, saveDraft])

  // --- Alternatives (§5.6) ---------------------------------------------------

  /** Why this day, assembled from trip data by the application layer (§5.5). */
  const explainSelectedDay = useCallback((): DayExplanation => {
    if (!trip || !plan || !state) {
      return {
        dayIndex: 0, dateLabel: '', shape: '', whyToday: [], considerations: [], memories: [],
      }
    }
    return explainDay({
      frame: trip.frame,
      plan,
      state,
      dayIndex: selectedDay,
      catalogue,
      memorySnapshot: trip.memorySnapshot,
    })
  }, [trip, plan, state, selectedDay, catalogue])

  const alternativesFor = useCallback(
    (itemId: string): Alternative[] =>
      trip && state && plan
        ? listAlternatives({
            itemId,
            frame: trip.frame,
            state,
            plan,
            catalogue,
            memorySnapshot: trip.memorySnapshot,
          })
        : [],
    [trip, state, plan, catalogue],
  )

  /**
   * Picking an alternative that fits the slot IS the confirmation, so it
   * commits straight away; one that moves other stops is previewed first
   * (§5.6).
   */
  const chooseAlternative = useCallback(
    async (itemId: string, placeId: string) => {
      if (!trip || !state || !plan) return
      setBusy('Checking that swap…')
      setError(null)
      setPlanConflict(null)
      try {
        if (proposal) {
          await supersedePendingProposal({ proposal, repositories })
          setProposal(null)
        }

        const outcome = proposeAlternative({
          tripId: trip.id,
          frame: trip.frame,
          state,
          plan,
          itemId,
          placeId,
          catalogue,
          now: deps.now(),
          proposalId: nextId('prop'),
          createdAt: deps.now().toISOString(),
        })

        if (outcome.kind === 'conflict') {
          setPlanConflict(outcome.reason)
          return
        }

        await repositories.proposals.save(outcome.proposal)

        if (outcome.proposal.type === 'replace') {
          await commitPending(outcome.proposal)
          setSelectedPlaceId(placeId)
        } else {
          setProposal(outcome.proposal)
        }
      } catch (cause) {
        setError(saying('swapping that place', cause))
      } finally {
        setBusy(null)
      }
    },
    [trip, state, plan, proposal, deps, repositories, commitPending],
  )

  /** True when the State editor holds changes that have not been saved. */
  const stateDirty = useMemo(
    () => state !== null && stateDraft !== null &&
      JSON.stringify(stateDraft) !== JSON.stringify(toStateDraft(state)),
    [state, stateDraft],
  )

  return {
    screen, view, selectView, busy, error, conflicts, setupInput,
    degraded, dismissDegraded: () => setDegraded(null), notSaving, resetDemo,
    chatOpen, openChat, closeChat,
    startNewTrip, closeNewTrip, backToSetup, openTrip,
    drawerOpen, openIndex, closeIndex,
    memories, activeMemoryCount, profileOpen,
    openProfile, closeProfile, confirmMemory, stopUsingMemory, forgetMemory, renameMemory,
    draft, setDraft, acceptedPriority, setAcceptedPriority,
    trip, state, plan, proposal, receipts, chat, catalogue,
    selectedDay, setSelectedDay,
    selectedPlaceId, setSelectedPlaceId,
    submitSetup, generateItinerary, sendMessage, confirmChange, keepCurrent,
    planConflict, dismissConflict, lifecycleNote,
    stateDraft, setStateDraft, stateDirty, stateConflicts, stateNote,
    revertStateDraft, saveStateDraft, updatedItemIds, eventChoice, pickEvent, skipEvent,
    explainSelectedDay, alternativesFor, chooseAlternative,
  }
}

export type AppStore = ReturnType<typeof useAppStore>
