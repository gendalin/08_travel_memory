/**
 * "Why this day?" (UI draft 08; product_spec §5.5).
 *
 * Every line is assembled from data the trip already holds — see
 * `explainDay`. Sections with nothing to say are omitted rather than padded.
 *
 * Reached by a visible button next to the day tabs. The draft opens it on a
 * long press; Gate 6 task 7 and §14.5 forbid a critical action that only a long
 * press can reach, so the long press is an accelerator, not the way in.
 */

import type { DayExplanation } from '../../application/explainDay/explainDay.ts'

interface Props {
  explanation: DayExplanation
  onBack: () => void
}

export function WhyThisDaySheet({ explanation, onBack }: Props) {
  return (
    <div className="sheet-backdrop" onClick={onBack} role="presentation">
      <div
        className="sheet tall why-day"
        role="dialog"
        aria-label={`Why Day ${explanation.dayIndex + 1}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-nav">
          <button
            className="icon-button"
            aria-label="Back to the itinerary"
            data-testid="why-day-back"
            onClick={onBack}
          >
            ‹
          </button>
          <span className="title">Day {explanation.dayIndex + 1}</span>
          <span style={{ minWidth: 44 }} />
        </div>

        <p className="eyebrow">{explanation.dateLabel}</p>

        <h4>Why this itinerary?</h4>
        <p>{explanation.shape}</p>

        {explanation.whyToday.length > 0 && (
          <>
            <h4>Why today?</h4>
            {explanation.whyToday.map((reason) => (
              <p key={reason} data-testid="why-today">{reason}</p>
            ))}
          </>
        )}

        {explanation.considerations.length > 0 && (
          <>
            <h4>What I worked from</h4>
            <dl data-testid="why-considerations">
              {explanation.considerations.map((entry) => (
                <div key={entry.label} style={{ display: 'contents' }}>
                  <dt>{entry.label}</dt>
                  <dd>{entry.value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}

        {explanation.memories.length > 0 && (
          <>
            <h4>From your profile</h4>
            {explanation.memories.map((memory) => (
              <div key={memory.id} className="memory-cite" data-testid="memory-citation" data-memory-id={memory.id}>
                <span aria-hidden="true">◆</span>
                <span>{memory.text.split('—')[0].trim()} · {memory.provenance}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
