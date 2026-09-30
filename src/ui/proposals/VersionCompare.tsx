/**
 * Two versions of the itinerary, side by side, day by day (2026-10-01).
 *
 * The list of changes says what moved; this shows the two days whole, so the
 * traveller can judge the day they would get rather than a list of edits. Only days
 * that differ are shown. A stop is matched across versions by its slot (item id), so a
 * swapped stop sits opposite what it replaces.
 */

import type { Plan, PlanDay, PlanItem } from '../../domain/plan/types.ts'
import type { PlaceCatalogue } from '../../services/places/types.ts'

type Mark = 'same' | 'changed' | 'removed' | 'added'

function signature(item: PlanItem): string {
  return `${item.placeId}@${item.startTime}`
}

function dayDiffers(before: PlanDay | undefined, after: PlanDay | undefined): boolean {
  const a = (before?.items ?? []).map(signature).sort().join('|')
  const b = (after?.items ?? []).map(signature).sort().join('|')
  return a !== b || before?.area?.id !== after?.area?.id
}

function Column({ day, other, catalogue, side }: { day: PlanDay | undefined; other: PlanDay | undefined; catalogue: PlaceCatalogue; side: 'before' | 'after' }) {
  const items = [...(day?.items ?? [])].sort((a, b) => a.startTime.localeCompare(b.startTime))
  const mark = (item: PlanItem): Mark => {
    const opposite = other?.items.find((entry) => entry.id === item.id)
    if (!opposite) return side === 'before' ? 'removed' : 'added'
    return signature(opposite) === signature(item) ? 'same' : 'changed'
  }
  return (
    <ol className="version-col" data-testid={`version-${side}`}>
      {day?.area && <li className="version-area">In {day.area.name}</li>}
      {items.map((item) => {
        const state = mark(item)
        return (
          <li key={item.id} className={`version-stop ${state}`} data-mark={state}>
            <span className="time">{item.startTime}</span>
            <span className="name">{catalogue.get(item.placeId)?.name ?? item.placeId}</span>
          </li>
        )
      })}
      {items.length === 0 && <li className="version-stop empty">—</li>}
    </ol>
  )
}

export function VersionCompare({
  before,
  after,
  catalogue,
  beforeLabel,
  afterLabel,
}: {
  before: Plan
  after: Plan
  catalogue: PlaceCatalogue
  beforeLabel: string
  afterLabel: string
}) {
  const indexes = [...new Set([...before.days, ...after.days].map((day) => day.dayIndex))].sort((a, b) => a - b)
  const differing = indexes.filter((index) =>
    dayDiffers(before.days.find((day) => day.dayIndex === index), after.days.find((day) => day.dayIndex === index)),
  )

  if (differing.length === 0) {
    return <p className="version-same" data-testid="version-compare">The two versions are the same.</p>
  }

  return (
    <div className="version-compare" data-testid="version-compare">
      <div className="version-head">
        <span />
        <span>{beforeLabel}</span>
        <span>{afterLabel}</span>
      </div>
      {differing.map((index) => {
        const b = before.days.find((day) => day.dayIndex === index)
        const a = after.days.find((day) => day.dayIndex === index)
        return (
          <div className="version-day" key={index} data-testid="version-day">
            <span className="version-day-label">Day {index + 1}</span>
            <Column day={b} other={a} catalogue={catalogue} side="before" />
            <Column day={a} other={b} catalogue={catalogue} side="after" />
          </div>
        )
      })}
    </div>
  )
}
