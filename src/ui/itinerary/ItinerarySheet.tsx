/**
 * Itinerary (UI draft 07; product_spec §5.3).
 *
 * A bottom sheet with three detents — peek, half, full — rather than a modal
 * over the map. The map is the screen, and the itinerary is a reading of what
 * is on it: at peek and half you can still see, pan and tap the pins the list
 * is describing. Drag the grabber (or tap it) to change how much of each you
 * want; drag below the lowest detent to dismiss.
 *
 * Trip name, swipeable day tabs, then a timeline for the selected day: time,
 * image, title, a one-line description and the reason it was recommended.
 *
 * The map shows the SELECTED day only, with the route between stops — tapping
 * a stop here selects its pin, and vice versa. Showing all five days at once is
 * what made the map unreadable.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { Plan } from '../../domain/plan/types.ts'
import type { Memory, MemorySnapshot } from '../../domain/memory/types.ts'
import { provenanceLabel } from '../../domain/memory/types.ts'
import type { PlaceCatalogue } from '../../services/places/types.ts'
import { PlaceThumb } from '../places/PlaceThumb.tsx'
import { ReasonText } from '../places/ReasonText.tsx'

interface Props {
  plan: Plan
  catalogue: PlaceCatalogue
  /** The trip's immutable snapshot, used to resolve cited memory ids. */
  memorySnapshot?: MemorySnapshot
  tripName: string
  selectedDay: number
  selectedPlaceId: string | null
  /** Stops the last committed change put in place, marked "Updated". */
  updatedItemIds?: ReadonlySet<string>
  onSelectDay: (dayIndex: number) => void
  onSelectPlace: (placeId: string) => void
  onWhyThisDay: () => void
  /** How much of the map the sheet is covering, so the map can frame around it. */
  onInsetChange?: (inset: number) => void
  onClose: () => void
}

type Detent = 'peek' | 'half' | 'full'

/** Each detent as a fraction of the plan screen. The sheet is as tall as `full`. */
const DETENT: Record<Detent, number> = { peek: 0.3, half: 0.58, full: 0.92 }
const ORDER: Detent[] = ['peek', 'half', 'full']
const SHEET = DETENT.full

/** Below this much of the peek detent, a downward drag is a dismissal. */
const DISMISS_FRACTION = 0.55

/** Resting offset, as a percentage of the sheet's own height. */
function restingOffset(detent: Detent): number {
  return (1 - DETENT[detent] / SHEET) * 100
}

/** How much of a sheet `height` px tall this detent leaves on screen. */
function visibleAt(detent: Detent, height: number): number {
  return (DETENT[detent] / SHEET) * height
}

/** How much of it is below the fold at that detent, in px. */
function hiddenAt(detent: Detent, height: number): number {
  return height - visibleAt(detent, height)
}

export function ItinerarySheet({
  plan, catalogue, memorySnapshot, tripName, selectedDay, selectedPlaceId, updatedItemIds,
  onSelectDay, onSelectPlace, onWhyThisDay, onInsetChange, onClose,
}: Props) {
  // Opens at half: enough itinerary to read, enough map to see it on.
  const [detent, setDetent] = useState<Detent>('half')
  /** Non-null while a drag is in flight; the live offset, in px. */
  const [drag, setDrag] = useState<number | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{
    startY: number
    baseOffset: number
    height: number
    delta: number
    moved: boolean
  } | null>(null)

  const day = plan.days.find((entry) => entry.dayIndex === selectedDay) ?? plan.days[0]

  /**
   * How far the sheet's own bottom edge sits below the screen's, at rest.
   *
   * The sheet is always as tall as its FULL detent and the shorter detents are
   * reached by sliding it down, so at peek and half its lower part — 287px of it at
   * half, on a 844px screen — is off the bottom of the viewport. The scrolling
   * region inside it ends down there too, which meant the last stop of a day could
   * be scrolled to and still not be readable: the list had reached its end while
   * the end was off screen.
   *
   * Paying it back as padding below the content is what lets the last stop travel
   * up into the part of the sheet a person can actually see.
   */
  const [belowFold, setBelowFold] = useState(0)

  useLayoutEffect(() => {
    const measure = () => {
      const height = sheetRef.current?.getBoundingClientRect().height ?? 0
      onInsetChange?.(visibleAt(detent, height))
      setBelowFold(hiddenAt(detent, height))
    }

    measure()
    // The sheet is a fraction of the screen, so every one of these figures changes
    // when the screen does — a rotation, or a desktop window being dragged.
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [detent, onInsetChange])

  // Once the sheet is gone the map has the whole screen back.
  useEffect(() => () => onInsetChange?.(0), [onInsetChange])

  /**
   * The drag is tracked on the window rather than by capturing the pointer:
   * a captured pointer retargets the click that follows it, which would eat
   * the taps on the close button and the day tabs sitting in the same band.
   */
  const beginDrag = (event: React.PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const height = sheetRef.current?.getBoundingClientRect().height ?? 0
    if (height === 0) return
    dragRef.current = {
      startY: event.clientY,
      baseOffset: (restingOffset(detent) / 100) * height,
      height,
      delta: 0,
      moved: false,
    }
    setDrag(0)
  }

  const dragging = drag !== null
  /** When a drag last ended, so the click it produces can be ignored. */
  const draggedAt = useRef(0)

  useEffect(() => {
    if (!dragging) return

    const move = (event: PointerEvent) => {
      const state = dragRef.current
      if (!state) return
      const delta = event.clientY - state.startY
      if (Math.abs(delta) > 4) state.moved = true
      // Never higher than the full detent, never further down than gone.
      state.delta = Math.max(-state.baseOffset, Math.min(state.height - state.baseOffset, delta))
      setDrag(state.delta)
    }

    const end = () => {
      const state = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!state) return

      // A tap is not a drag: the grabber's own click handler takes it from
      // here, so the sheet is not stepped twice by one finger.
      if (!state.moved) return
      draggedAt.current = Date.now()

      const visible = state.height - (state.baseOffset + state.delta)
      if (visible < visibleAt('peek', state.height) * DISMISS_FRACTION) {
        onClose()
        return
      }

      // Snap to whichever detent the sheet was left closest to.
      setDetent(
        ORDER.reduce((closest, option) =>
          Math.abs(visibleAt(option, state.height) - visible) <
          Math.abs(visibleAt(closest, state.height) - visible)
            ? option
            : closest,
        ),
      )
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [dragging, onClose])

  /** Tapping the grabber walks up the detents and wraps back to peek. */
  const cycleDetent = () => {
    if (Date.now() - draggedAt.current < 300) return
    setDetent(ORDER[(ORDER.indexOf(detent) + 1) % ORDER.length])
  }

  /** Resolved from the snapshot, so the rationale stays true after Profile edits. */
  const citedFor = (memoryIds: string[] | undefined): Memory[] =>
    (memoryIds ?? [])
      .map((id) => memorySnapshot?.memories.find((memory) => memory.id === id))
      .filter((memory): memory is Memory => memory !== undefined)

  const offset =
    drag === null
      ? `${restingOffset(detent)}%`
      : `calc(${restingOffset(detent)}% + ${drag}px)`

  return (
    <div
      className={`sheet detent-sheet${drag === null ? '' : ' is-dragging'}`}
      data-detent={detent}
      ref={sheetRef}
      role="dialog"
      aria-label="Itinerary"
      style={{ height: `${SHEET * 100}%`, transform: `translateY(${offset})` }}
    >
      <div className="sheet-drag" onPointerDown={beginDrag}>
        <button
          className="sheet-grabber"
          aria-label={`Itinerary sheet, ${detent} height. Resize.`}
          data-testid="itinerary-detent"
          onClick={cycleDetent}
        />

        <div className="sheet-head">
          <div>
            <h3>{tripName}</h3>
            <p className="sub">{plan.days.length} days · itinerary v{plan.version}</p>
          </div>
          <button className="sheet-close" aria-label="Close" data-testid="close-itinerary" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="day-tabs" role="tablist">
          {plan.days.map((entry) => (
            <button
              key={entry.dayIndex}
              className="chip"
              role="tab"
              aria-selected={entry.dayIndex === selectedDay}
              onClick={() => onSelectDay(entry.dayIndex)}
              /* The draft reaches "Why this day" on a long press. It stays as an
                 accelerator, but the button below is the way in (§14.5). */
              onContextMenu={(event) => {
                event.preventDefault()
                onSelectDay(entry.dayIndex)
                onWhyThisDay()
              }}
            >
              Day {entry.dayIndex + 1}
            </button>
          ))}
        </div>
      </div>

      <div
        className="detent-body"
        style={{ paddingBottom: `calc(var(--space-6) + ${belowFold}px)` }}
      >
        <div className="link-row">
          <button className="btn-ghost" data-testid="why-this-day" onClick={onWhyThisDay}>
            Why this day?
          </button>
        </div>

        {day.area && (
          <p className="day-area" data-testid="day-area">
            A day in {day.area.name}
          </p>
        )}

        <ul className="timeline" data-testid="timeline">
          {day.items.map((item) => {
            const place = catalogue.get(item.placeId)
            const cited = citedFor(item.rationaleRefs?.memoryIds)
            return (
              <li
                key={item.id}
                aria-selected={item.placeId === selectedPlaceId}
                onClick={() => onSelectPlace(item.placeId)}
                data-place-id={item.placeId}
              >
                <span className="time">
                  {item.startTime}
                  {updatedItemIds?.has(item.id) && (
                    <span className="updated-badge" data-testid="updated-badge">Updated</span>
                  )}
                </span>

                <PlaceThumb place={place} width={480} />

                <span className="name">{place?.name ?? item.placeId}</span>
                <span className="meta">
                  {place?.neighborhood} · {place?.category.replace(/_/g, ' ')}
                </span>
                {place?.shortDescription && <span className="desc">{place.shortDescription}</span>}
                <ReasonText className="why" reasons={item.reasons} rationale={item.rationale} />

                {cited.map((memory) => (
                  <span
                    key={memory.id}
                    className="memory-cite"
                    data-testid="memory-citation"
                    data-memory-id={memory.id}
                  >
                    <span aria-hidden="true">◆</span>
                    <span>{provenanceLabel(memory.provenance.type)}</span>
                  </span>
                ))}
              </li>
            )
          })}
          {day.items.length === 0 && <li style={{ cursor: 'default' }}>Nothing planned yet.</li>}
        </ul>
      </div>
    </div>
  )
}
