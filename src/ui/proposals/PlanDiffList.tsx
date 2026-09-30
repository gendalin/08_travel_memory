/**
 * Itinerary diff, in the user's terms (product_spec §7.3, §7.4).
 *
 * Swaps read as Before / After; a stop that only moved reads as a time change,
 * because "13:30 → 11:30" is the whole story and a Before/After card would
 * repeat the same name twice.
 */

import type { PlanDiff } from '../../domain/plan/diff.ts'
import type { PlaceCatalogue } from '../../services/places/types.ts'

export function PlanDiffList({ diff, catalogue }: { diff: PlanDiff; catalogue: PlaceCatalogue }) {
  const name = (placeId: string) => catalogue.get(placeId)?.name ?? placeId

  const swapped = diff.modified.filter((change) => change.fields.includes('placeId'))
  const moved = diff.modified.filter((change) => !change.fields.includes('placeId'))

  return (
    <ul className="diff-list" data-testid="plan-diff">
      {swapped.map((change) => (
        <li key={change.after.id}>
          <span className="day">Day {change.after.dayIndex + 1}</span>
          <span className="swap">
            <span className="was">{name(change.before.placeId)}</span>
            <span className="arrow" aria-hidden="true"> → </span>
            <span className="now">{name(change.after.placeId)}</span>
          </span>
        </li>
      ))}

      {moved.map((change) => (
        <li key={change.after.id}>
          <span className="day">Day {change.after.dayIndex + 1}</span>
          <span className="now">{name(change.after.placeId)}</span>
          {/* Kept on one line: "13:30 → 11:30" split across lines is unreadable. */}
          <span className="times">
            <span className="was">{change.before.startTime}</span>
            <span className="arrow" aria-hidden="true"> → </span>
            <span className="now">{change.after.startTime}</span>
          </span>
        </li>
      ))}

      {diff.removed.map((item) => (
        <li key={item.id} data-testid="diff-removed">
          <span className="day">Day {item.dayIndex + 1}</span>
          <span className="was">{name(item.placeId)}</span>
          <span className="note">dropped</span>
        </li>
      ))}

      {diff.added.map((item) => (
        <li key={item.id} data-testid="diff-added">
          <span className="day">Day {item.dayIndex + 1}</span>
          <span className="now">{name(item.placeId)}</span>
          <span className="note">added at {item.startTime}</span>
        </li>
      ))}
    </ul>
  )
}
