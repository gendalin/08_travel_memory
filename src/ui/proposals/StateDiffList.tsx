/**
 * Proposed State diff (product_spec §7.4).
 *
 * Reframe changes what the agent is planning against, so the State change is
 * shown first and in the user's own sentences — the itinerary preview below it
 * is the consequence, not the proposal.
 */

import type { StateDiff } from '../../domain/state/diff.ts'

export function StateDiffList({ diff }: { diff: StateDiff }) {
  const rows: Array<{ key: string; label: string; text: string }> = []

  for (const item of diff.intent.added) rows.push({ key: `ia${item.id}`, label: 'Adds', text: item.text })
  for (const item of diff.intent.removed) rows.push({ key: `ir${item.id}`, label: 'Drops', text: item.text })
  for (const change of diff.intent.modified) {
    rows.push({ key: `im${change.after.id}`, label: 'Changes', text: `“${change.before.text}” to “${change.after.text}”` })
  }

  for (const item of diff.considering.added) rows.push({ key: `ca${item.id}`, label: 'Adds', text: item.text })
  for (const item of diff.considering.removed) rows.push({ key: `cr${item.id}`, label: 'Drops', text: item.text })
  for (const change of diff.considering.modified) {
    rows.push({ key: `cm${change.after.id}`, label: 'Changes', text: `“${change.before.text}” to “${change.after.text}”` })
  }

  for (const item of diff.priorities.added) {
    rows.push({ key: `pa${item.id}`, label: 'Adds', text: `${item.name} at ${item.weight}` })
  }
  for (const change of diff.priorities.modified) {
    rows.push({ key: `pm${change.after.id}`, label: 'Changes', text: `${change.after.name} from ${change.before.weight} to ${change.after.weight}` })
  }
  for (const item of diff.priorities.removed) {
    rows.push({ key: `pr${item.id}`, label: 'Drops', text: `${item.name}` })
  }

  if (rows.length === 0) return null

  return (
    <ul className="diff-list" data-testid="state-diff">
      {rows.map((row) => (
        <li key={row.key}>
          <span className="day">{row.label}</span>
          <span className="now">{row.text}</span>
        </li>
      ))}
    </ul>
  )
}
