/**
 * The ways out of a Conflict, as buttons (eval spec §13).
 *
 * Each one only edits the draft — a day rewrites the Considering line, drop removes
 * it, edit focuses it — so nothing is committed until the traveller saves or
 * generates again, and the same validation runs on the result.
 */

import type { ConflictOption } from '../../application/planning/conflicts.ts'

export function ConflictOptions(props: {
  options?: ConflictOption[]
  onRewrite: (text: string) => void
  onRemove: () => void
  onEdit: () => void
}) {
  if (!props.options || props.options.length === 0) return null
  return (
    <div className="conflict-options" data-testid="conflict-options">
      {props.options.map((option) => (
        <button
          key={option.kind === 'move_day' ? `day_${option.dayIndex}` : option.kind}
          className="chip"
          data-testid={`conflict-option-${option.kind}`}
          onClick={() => {
            if (option.kind === 'move_day') props.onRewrite(option.text)
            else if (option.kind === 'remove') props.onRemove()
            else props.onEdit()
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
