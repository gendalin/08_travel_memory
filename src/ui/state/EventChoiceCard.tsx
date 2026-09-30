/**
 * Pick an event the search found (product_spec §7.8).
 *
 * Every option says where it was found and when it was checked — live data is only
 * as good as its source and its date — and a recorded search says it is recorded.
 * An empty search says why, rather than leaving the line silently unplanned.
 */

import type { EventChoice } from '../../app/store.ts'
import type { FoundEvent } from '../../services/events/types.ts'

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function dayLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return `${WEEKDAY[new Date(year, month - 1, day).getDay()]} ${month}/${day}`
}

export function EventChoiceCard({
  choice,
  busy,
  onPick,
  onSkip,
}: {
  choice: EventChoice
  busy: string | null
  onPick: (event: FoundEvent) => void
  onSkip: () => void
}) {
  const { result, activity } = choice
  const checked = result.searchedAt.slice(0, 10)

  return (
    <div className="event-choice" data-testid="event-choice">
      <div className="title">
        {result.events.length > 0 ? `Pick a ${activity} game for your trip` : `No ${activity} to plan`}
      </div>
      <p className="sub">
        {result.recorded
          ? `From a search recorded on ${checked} for this demo. The full app searches live.`
          : `Searched just now (${checked}) on official pages.`}
      </p>

      {result.events.length === 0 && <p data-testid="event-none">{result.note}</p>}

      <ul className="event-options">
        {result.events.map((event) => (
          <li key={event.id}>
            <button data-testid="event-option" disabled={busy !== null} onClick={() => onPick(event)}>
              <span className="event-when">
                {dayLabel(event.date)} · {event.start}
                {event.endEstimated ? ` – about ${event.end}` : ` – ${event.end}`}
              </span>
              <span className="event-title">{event.title}</span>
              <span className="event-where">
                {event.venue.name} · source {hostOf(event.sourceUrl)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <button className="btn-ghost" data-testid="event-skip" disabled={busy !== null} onClick={onSkip}>
        {result.events.length > 0 ? "Don't plan one now" : 'Keep the line, plan nothing'}
      </button>
    </div>
  )
}
