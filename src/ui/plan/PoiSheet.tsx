/**
 * POI sheet, with Alternatives as in-sheet navigation (UI draft 09; §5.2, §5.6, §5.7).
 *
 * The Alternatives view replaces this sheet's content rather than opening a
 * second sheet — §5.7 forbids stacking sheet on sheet — and the options are
 * numbered to match the pins that appear on the map behind it.
 *
 * Picking one that fits the same slot IS the confirmation (§5.6): it commits a
 * Replace and writes a Receipt. One that would move the rest of the day is
 * marked, and comes back as a proposal to preview instead.
 *
 * The detail view carries everything the stop's itinerary row does — when it is,
 * its photo and credit, what it is, why it was chosen and the memory behind it —
 * so opening a stop from the map is not a thinner reading than finding it in
 * the list.
 */

import type { Alternative } from '../../application/alternatives/alternatives.ts'
import type { Memory } from '../../domain/memory/types.ts'
import { provenanceLabel } from '../../domain/memory/types.ts'
import type { DemoPlace } from '../../services/places/types.ts'
import type { StopReason } from '../../domain/plan/types.ts'
import { PlaceThumb } from '../places/PlaceThumb.tsx'
import { PoiBriefSection } from '../places/PoiBriefSection.tsx'
import { ReasonText } from '../places/ReasonText.tsx'

interface Props {
  place: DemoPlace
  /** Zero-based day of the plan item this place occupies, when it is planned. */
  dayIndex?: number
  /** HH:MM, when it is planned. */
  startTime?: string
  rationale?: string
  /** The rationale as separate reasons, primary first. */
  reasons?: StopReason[]
  /** Memories from the trip snapshot that this recommendation was based on. */
  citedMemories?: Memory[]
  locked?: boolean
  /** Alternatives for the plan item this place occupies. Empty = no swap offer. */
  alternatives?: Alternative[]
  /** True while the Alternatives view is showing — the map mirrors it. */
  showingAlternatives: boolean
  onShowAlternatives: () => void
  onHideAlternatives: () => void
  onChooseAlternative?: (placeId: string) => void
  /**
   * Offered only when the trip can actually look further (B8).
   *
   * A trip is planned from a frozen set of places, so running out is a real state
   * and widening the set is an explicit act. Absent means widening is not available
   * for this trip — a demo trip planned against the bundled set has nowhere to look
   * — and then the sheet says it has run out without offering a button that would do
   * nothing.
   */
  onLookFurther?: () => void
  onClose: () => void
}

export function PoiSheet({
  place, dayIndex, startTime, rationale, reasons, citedMemories = [], locked, alternatives = [],
  showingAlternatives, onShowAlternatives, onHideAlternatives, onChooseAlternative,
  onLookFurther, onClose,
}: Props) {
  const swappable = onChooseAlternative !== undefined && !locked
  const canSwap = alternatives.length > 0 && swappable
  /** Swappable in principle, with nothing to swap to. Said, not left blank. */
  const outOfOptions = swappable && alternatives.length === 0

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-label={showingAlternatives ? `Alternatives to ${place.name}` : place.name}
        onClick={(event) => event.stopPropagation()}
      >
        {!showingAlternatives ? (
          <div className="poi-detail">
            <div className="sheet-head">
              <div>
                <h3>{place.name}</h3>
                <p className="sub">
                  {place.neighborhood} · {place.category.replace(/_/g, ' ')}
                  {locked && ' · already happened'}
                </p>
              </div>
              <button className="sheet-close" aria-label="Close" data-testid="close-poi" onClick={onClose}>
                ✕
              </button>
            </div>

            {startTime && (
              <span className="time" data-testid="poi-time">
                {dayIndex !== undefined && `Day ${dayIndex + 1} · `}{startTime}
              </span>
            )}

            <PlaceThumb place={place} width={480} />

            {place.shortDescription && <p data-testid="poi-short">{place.shortDescription}</p>}

            {place.poiBrief && <PoiBriefSection brief={place.poiBrief} />}

            {(rationale || (reasons && reasons.length > 0)) && (
              <>
                <div className="section-title">Why this place</div>
                <p className="sub why" style={{ fontSize: 'var(--text-sub)' }}>
                  <ReasonText reasons={reasons} rationale={rationale} />
                </p>
              </>
            )}

            {citedMemories.map((memory) => (
              <div key={memory.id} className="memory-cite" data-testid="memory-citation" data-memory-id={memory.id}>
                <span aria-hidden="true">◆</span>
                <span>
                  {memory.text.split('—')[0].trim()} · {provenanceLabel(memory.provenance.type)}
                </span>
              </div>
            ))}

            <div style={{ height: 'var(--space-4)' }} />

            {canSwap && (
              <button
                className="btn-secondary"
                data-testid="open-alternatives"
                onClick={onShowAlternatives}
              >
                More options for {place.name}
              </button>
            )}

            {outOfOptions && (
              <div data-testid="no-alternatives">
                <p className="sub">
                  No other option for this part of the day. Everything else in this
                  trip is already in the plan, shut at that time, or not the kind of
                  place that fits here.
                </p>
                {onLookFurther && (
                  <button
                    className="btn-secondary"
                    data-testid="look-further"
                    onClick={onLookFurther}
                  >
                    Look further
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="sheet-nav">
              <button
                className="icon-button"
                aria-label={`Back to ${place.name}`}
                data-testid="back-to-poi"
                onClick={onHideAlternatives}
              >
                ‹
              </button>
              <span className="title">More options for {place.name}</span>
              <button className="sheet-close" aria-label="Close" data-testid="close-poi" onClick={onClose}>
                ✕
              </button>
            </div>

            <ul className="alternatives" data-testid="alternatives">
              {alternatives.map((alternative, index) => (
                <li key={alternative.place.placeId}>
                  <button
                    data-testid="alternative"
                    data-place-id={alternative.place.placeId}
                    data-shifts={alternative.shiftsSchedule ? 'true' : 'false'}
                    onClick={() => onChooseAlternative?.(alternative.place.placeId)}
                  >
                    <span className="alt-thumb" aria-hidden="true">
                      {alternative.place.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="alt-title">
                      {/* Numbered to match the pin on the map behind the sheet. */}
                      <span className="alt-index" aria-hidden="true">{index + 1}</span>
                      <span className="alt-name">{alternative.place.name}</span>
                    </span>
                    <span className="alt-desc">{alternative.place.shortDescription}</span>
                    <span className="alt-reason">“{alternative.reason}”</span>
                    {alternative.shiftsSchedule && (
                      <span className="alt-warn" data-testid="alternative-shifts">
                        Needs longer than this slot — changes the rest of the day
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
