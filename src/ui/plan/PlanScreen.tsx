/**
 * Plan (UI draft 01) — the map is the screen.
 *
 * The map fills the view; the chrome, the Itinerary button and the composer
 * float over it. Everything that is not the map lives in a sheet, and only one
 * sheet is ever open (§5.7) — the itinerary rests on the map at a detent
 * rather than covering it.
 *
 * Changes and their history are in the chat sheet, not here: the Plan screen
 * shows the trip as it currently stands.
 */

import { useCallback, useState } from 'react'

import { allItems } from '../../domain/plan/types.ts'
import type { AppStore } from '../../app/store.ts'
import type { PlaceCatalogue } from '../../services/places/types.ts'
import { MapCanvas, type AlternativeMarker, type MapMarker } from '../map/MapCanvas.tsx'
import { ItinerarySheet } from '../itinerary/ItinerarySheet.tsx'
import { WhyThisDaySheet } from '../itinerary/WhyThisDaySheet.tsx'
import { PoiSheet } from './PoiSheet.tsx'
import { ChatLauncher } from '../chat/ChatComposer.tsx'
import { ChatSheet } from '../chat/ChatSheet.tsx'

interface Props {
  store: AppStore
  catalogue: PlaceCatalogue
}

/**
 * One sheet at a time — never a sheet on top of a sheet (§5.7).
 *
 * Chat is not in this union: it is held in the store, because flows outside
 * this screen open it too.
 */
type OpenSheet = 'none' | 'itinerary' | 'why-day' | 'poi'

export function PlanScreen({ store, catalogue }: Props) {
  const [sheet, setSheet] = useState<OpenSheet>('none')
  const [showingAlternatives, setShowingAlternatives] = useState(false)
  /** How much of the map the itinerary sheet is resting over, in px. */
  const [mapInset, setMapInset] = useState(0)
  const { trip, plan, proposal } = store

  if (!trip || !plan) return null

  const markers: MapMarker[] = allItems(plan)
    .map((item, index) => {
      const place = catalogue.get(item.placeId)
      return place ? { place, dayIndex: item.dayIndex, label: String(index + 1) } : undefined
    })
    .filter((marker): marker is MapMarker => marker !== undefined)

  const selectedPlace = store.selectedPlaceId ? catalogue.get(store.selectedPlaceId) : undefined
  const selectedItem = allItems(plan).find((item) => item.placeId === store.selectedPlaceId)

  const alternatives = selectedItem ? store.alternativesFor(selectedItem.id) : []

  // The map mirrors the sheet: while options are on screen, so are their pins.
  const alternativeMarkers: AlternativeMarker[] =
    sheet === 'poi' && showingAlternatives
      ? alternatives.map((alternative, index) => ({ place: alternative.place, index: index + 1 }))
      : []

  // Cited memories come from the trip's snapshot, not the live Profile, so the
  // rationale still reads correctly after the Profile changes (§10.5).
  const citedMemories = (selectedItem?.rationaleRefs?.memoryIds ?? [])
    .map((memoryId) => trip.memorySnapshot.memories.find((memory) => memory.id === memoryId))
    .filter((memory): memory is NonNullable<typeof memory> => memory !== undefined)

  const openPoi = (placeId: string) => {
    store.setSelectedPlaceId(placeId)
    setShowingAlternatives(false)
    store.closeChat()
    setSheet('poi')
  }

  const chooseAlternative = (placeId: string) => {
    if (!selectedItem) return
    setSheet('none')
    setShowingAlternatives(false)
    void store.chooseAlternative(selectedItem.id, placeId)
  }

  const openChat = () => {
    setSheet('none')
    store.openChat()
  }

  // Stable, because the sheet reports its inset from an effect.
  const handleInsetChange = useCallback((inset: number) => setMapInset(inset), [])

  return (
    <div className="plan-screen">
      <MapCanvas
        markers={markers}
        lodging={catalogue.get(trip.frame.baseLodging.placeId)}
        selectedPlaceId={store.selectedPlaceId}
        focusDayIndex={sheet === 'itinerary' || sheet === 'why-day' ? store.selectedDay : undefined}
        alternatives={alternativeMarkers}
        bottomInset={sheet === 'itinerary' ? mapInset : 0}
        onSelect={openPoi}
        onSelectAlternative={chooseAlternative}
      />

      {/* The trip already names itself in the Itinerary sheet and in the Index;
          over the map it was a card sitting on the pins it described. What is
          left is the way in, and the version the rest of the app reads. */}
      <div className="plan-caption">
        <span className="sr-only" data-testid="plan-version">v{plan.version}</span>
        <button
          className="fab"
          data-testid="open-itinerary"
          onClick={() => {
            store.closeChat()
            setSheet('itinerary')
          }}
        >
          Itinerary
        </button>
      </div>

      {/* Pending work is announced without freezing the map (§14.5). */}
      {store.busy && !store.chatOpen && (
        <div className="pending-pill" data-testid="pending" role="status">
          <span className="dot" aria-hidden="true" />
          {store.busy}
        </div>
      )}

      {/* A proposal or conflict waiting in the chat sheet must be visible from
          the map, or the user has no idea anything is waiting. Never at the
          same time as the pending pill — they occupy the same spot. */}
      {(proposal || store.planConflict) && !store.chatOpen && !store.busy && (
        <button className="pending-pill" data-testid="waiting-badge" onClick={openChat}>
          {proposal ? 'A change is waiting for you' : "That change can't be planned"}
        </button>
      )}

      <ChatLauncher onOpen={openChat} />

      {sheet === 'itinerary' && !store.chatOpen && (
        <ItinerarySheet
          plan={plan}
          history={store.planHistory}
          catalogue={catalogue}
          memorySnapshot={trip.memorySnapshot}
          tripName={trip.frame.name}
          selectedDay={store.selectedDay}
          selectedPlaceId={store.selectedPlaceId}
          updatedItemIds={store.updatedItemIds}
          onSelectDay={store.setSelectedDay}
          onSelectPlace={store.setSelectedPlaceId}
          onWhyThisDay={() => setSheet('why-day')}
          onInsetChange={handleInsetChange}
          onClose={() => setSheet('none')}
        />
      )}

      {sheet === 'why-day' && !store.chatOpen && (
        <WhyThisDaySheet
          explanation={store.explainSelectedDay()}
          onBack={() => setSheet('itinerary')}
        />
      )}

      {sheet === 'poi' && !store.chatOpen && selectedPlace && (
        <PoiSheet
          place={selectedPlace}
          dayIndex={selectedItem?.dayIndex}
          startTime={selectedItem?.startTime}
          rationale={selectedItem?.rationale}
          reasons={selectedItem?.reasons}
          citedMemories={citedMemories}
          alternatives={alternatives}
          showingAlternatives={showingAlternatives}
          onShowAlternatives={() => setShowingAlternatives(true)}
          onHideAlternatives={() => setShowingAlternatives(false)}
          onChooseAlternative={selectedItem ? chooseAlternative : undefined}
          onClose={() => {
            setShowingAlternatives(false)
            setSheet('none')
          }}
        />
      )}

      {store.chatOpen && (
        <ChatSheet
          entries={store.chat}
          proposal={proposal}
          receipts={store.receipts}
          conflict={store.planConflict}
          lifecycleNote={store.lifecycleNote}
          busy={store.busy}
          error={store.error}
          catalogue={catalogue}
          stopsInPlan={allItems(plan).length}
          currentPlan={plan}
          onSend={store.sendMessage}
          onConfirm={store.confirmChange}
          onKeep={store.keepCurrent}
          onDismissConflict={store.dismissConflict}
          onClose={store.closeChat}
        />
      )}
    </div>
  )
}
