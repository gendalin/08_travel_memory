/**
 * Routing (product_spec §3.6.1, §3.6.9; UI drafts 01, 03, 05).
 *
 * Four routes: the Index a first-run user lands on, the two New Trip stages,
 * and the trip itself. The trip has two views — Plan and State — reached from
 * the segmented control rather than being separate destinations, because they
 * are two readings of the same thing.
 *
 * Index and Profile are overlays on the trip, so leaving the map never loses
 * where you were. The Index is not a panel that slides in over the trip: the
 * trip itself slides aside as a card and the Index is what was behind it, the
 * grammar the Claude iOS app uses for the same move.
 */

import { useEffect, useState } from 'react'

import { tripDays, type StageAInput } from '../application/createTrip/createTrip.ts'
import { useAppStore, type AppDeps } from './store.ts'
import { AppChrome } from '../ui/chrome/AppChrome.tsx'
import { IndexScreen } from '../ui/index/IndexScreen.tsx'
import { IndexDrawer } from '../ui/index/IndexDrawer.tsx'
import { StageASetup } from '../ui/newTrip/StageASetup.tsx'
import { StageBReview } from '../ui/newTrip/StageBReview.tsx'
import { PlanScreen } from '../ui/plan/PlanScreen.tsx'
import { StateScreen } from '../ui/state/StateScreen.tsx'
import { ProfileSheet } from '../ui/memory/ProfileSheet.tsx'
import { MemoryDisclosureSheet } from '../ui/memory/MemoryDisclosureSheet.tsx'

/** "2026-10-05" + "2026-10-09" -> "Oct 5 – Oct 9 · 5 days" */
function formatRange(input: StageAInput | null): string {
  if (!input) return ''
  const format = (iso: string) => {
    const [year, month, day] = iso.split('-').map(Number)
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  }
  const days = tripDays(input.startDate, input.endDate)
  return `${format(input.startDate)} – ${format(input.endDate)} · ${days} days`
}

/** Matches --motion-sheet; the card has to finish sliding back before the
    Index it uncovered is taken out of the DOM. */
const DRAWER_EXIT_MS = 240

/**
 * What the product did by itself, said once, anywhere (Gate 8, Phase C2).
 *
 * At app level rather than per screen because a fall back can happen on any of them
 * — Stage A's decomposition, a Replace from the chat — and three copies of the same
 * bar would be three chances for one of them to be missed.
 *
 * `role="status"` so it is announced rather than only drawn: a traveller using a
 * screen reader has even less way to tell a rule's sentence from the model's.
 */
function DegradedNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="app-notice banner busy" role="status" data-testid="degraded-notice">
      <span>{message}</span>
      <button className="link-button" data-testid="dismiss-degraded" onClick={onDismiss}>
        OK
      </button>
    </div>
  )
}

export function App({ deps }: { deps: AppDeps }) {
  const store = useAppStore(deps)
  const [showMemories, setShowMemories] = useState(false)
  /** The Index outlives its own dismissal by one transition. */
  const [indexMounted, setIndexMounted] = useState(false)

  useEffect(() => {
    if (store.drawerOpen) {
      setIndexMounted(true)
      return
    }
    if (!indexMounted) return
    const timer = setTimeout(() => setIndexMounted(false), DRAWER_EXIT_MS)
    return () => clearTimeout(timer)
  }, [store.drawerOpen, indexMounted])

  const activeMemories = store.memories.filter((memory) => memory.status === 'active')

  return (
    <div className="app" data-drawer={store.drawerOpen ? 'open' : 'closed'}>
      {(store.drawerOpen || indexMounted) && (
        <IndexDrawer
          tripName={store.trip?.frame.name}
          activeMemoryCount={store.activeMemoryCount}
          onNewTrip={store.startNewTrip}
          onOpenTrip={store.openTrip}
          onOpenProfile={store.openProfile}
          onReset={store.resetDemo}
          notSaving={store.notSaving}
          onClose={store.closeIndex}
        />
      )}

      {store.degraded && (
        <DegradedNotice message={store.degraded} onDismiss={store.dismissDegraded} />
      )}

      {/* Everything the Index slides out from under. */}
      <div className="app-stage">
        {store.screen === 'index' && (
          <IndexScreen
            tripName={store.trip?.frame.name}
            activeMemoryCount={store.activeMemoryCount}
            onNewTrip={store.startNewTrip}
            onOpenTrip={store.openTrip}
            onOpenProfile={store.openProfile}
          />
        )}

        {store.screen === 'setup' && (
          <>
            {store.error && (
              <div className="banner error" role="alert" style={{ margin: 16 }}>{store.error}</div>
            )}
            <StageASetup
              activeMemoryCount={store.activeMemoryCount}
              busy={store.busy}
              initial={store.setupInput}
              onSubmit={store.submitSetup}
              onShowMemories={() => setShowMemories(true)}
              onClose={store.closeNewTrip}
            />
          </>
        )}

        {store.screen === 'review' && store.draft && store.setupInput && (
          <>
            {store.error && (
              <div className="banner error" role="alert" style={{ margin: 16 }}>{store.error}</div>
            )}
            <StageBReview
              draft={store.draft}
              acceptedPriority={store.acceptedPriority}
              busy={store.busy}
              tripName={store.setupInput.name}
              dateRange={formatRange(store.setupInput)}
              lodging={store.setupInput.baseLodgingName}
              activeMemoryCount={store.activeMemoryCount}
              conflicts={store.conflicts}
              readAs={store.reviewReadAs}
              onChange={store.setDraft}
              onAcceptPriority={store.setAcceptedPriority}
              onShowMemories={() => setShowMemories(true)}
              onBack={store.backToSetup}
              onGenerate={store.generateItinerary}
            />
          </>
        )}

        {store.screen === 'trip' && (
          <>
            <AppChrome
              view={store.view}
              onSelectView={store.selectView}
              onOpenIndex={store.openIndex}
            />

            {/* The trip's own set of places, which is its frozen snapshot when it was
                retrieved for itself (B4) and the bundle when it was not. */}
            {store.view === 'plan' && <PlanScreen store={store} catalogue={store.catalogue} />}

            {store.view === 'state' && store.stateDraft && (
              <StateScreen
                draft={store.stateDraft}
                busy={store.busy}
                dirty={store.stateDirty}
                conflicts={store.stateConflicts}
                readings={Object.fromEntries([
                  ...(store.state?.intent ?? []).map((item) => [`intent:${item.id}`, { text: item.text, ...(item.readAs ? { readAs: item.readAs } : {}) }]),
                  ...(store.state?.considering ?? []).map((item) => [`considering:${item.id}`, { text: item.text, ...(item.readAs ? { readAs: item.readAs } : {}), ...(item.question ? { question: item.question } : {}) }]),
                ])}
                note={store.stateNote}
                onChange={store.setStateDraft}
                onSave={store.saveStateDraft}
                onRevert={store.revertStateDraft}
                eventChoice={store.eventChoice}
                onPickEvent={store.pickEvent}
                onSkipEvent={store.skipEvent}
              />
            )}
          </>
        )}
      </div>

      {store.profileOpen && (
        <ProfileSheet
          memories={store.memories}
          onConfirm={store.confirmMemory}
          onDeactivate={store.stopUsingMemory}
          onDismiss={store.forgetMemory}
          onEdit={store.renameMemory}
          onClose={store.closeProfile}
        />
      )}

      {showMemories && (
        <MemoryDisclosureSheet memories={activeMemories} onClose={() => setShowMemories(false)} />
      )}
    </div>
  )
}
