/**
 * Trip State (UI drafts 03, 04; product_spec §2.2, §7.6, §14.2).
 *
 * A view of the trip, reached from the Plan / State control — not a modal over
 * the map. State is explicit and editable, which is the whole reason it is a
 * peer of the Plan rather than something buried in a menu.
 *
 * Editing is inline: a chip becomes a field on focus and nothing else moves.
 * Saving does not touch the itinerary — it produces a candidate Plan which is
 * validated and previewed (§7.6).
 *
 * Trip metadata (name, dates, lodging) is the frame, not State (§4.1), so it is
 * deliberately absent.
 */

import type { StateDraft } from '../../application/editState/proposeStateEdit.ts'
import type { PriorityWeight } from '../../domain/state/types.ts'
import type { EventChoice } from '../../app/store.ts'
import type { FoundEvent } from '../../services/events/types.ts'
import { EventChoiceCard } from './EventChoiceCard.tsx'
import { ConflictOptions } from './ConflictOptions.tsx'
import type { ConflictOption } from '../../application/planning/conflicts.ts'

interface Props {
  draft: StateDraft
  busy: string | null
  dirty: boolean
  /** Constraints the plan could not satisfy, against the row that caused them. */
  conflicts: Array<{ message: string; consideringId?: string; options?: ConflictOption[] }>
  /** How each saved line was read, keyed `intent:<id>` / `considering:<id>`. */
  readings?: Record<string, { text: string; readAs?: string; question?: string }>
  /** Confirmation shown when an edit committed without a preview (§7.6). */
  note: string | null
  onChange: (draft: StateDraft) => void
  onSave: () => void
  onRevert: () => void
  /** An event search waiting for a pick (§7.8). */
  eventChoice?: EventChoice | null
  onPickEvent?: (event: FoundEvent) => void
  onSkipEvent?: () => void
}

const WEIGHTS: PriorityWeight[] = ['low', 'medium', 'high']

export function StateScreen({
  draft, busy, dirty, conflicts, readings, note, onChange, onSave, onRevert, eventChoice, onPickEvent, onSkipEvent,
}: Props) {
  const editRow = (key: 'intent' | 'considering', id: string, text: string) =>
    onChange({ ...draft, [key]: draft[key].map((row) => (row.id === id ? { ...row, text } : row)) })

  const removeRow = (key: 'intent' | 'considering', id: string) =>
    onChange({ ...draft, [key]: draft[key].filter((row) => row.id !== id) })

  const addRow = (key: 'intent' | 'considering') =>
    onChange({ ...draft, [key]: [...draft[key], { id: `${key}_${Date.now()}`, text: '' }] })

  const rowConflict = (id: string) => conflicts.find((conflict) => conflict.consideringId === id)
  const generalConflicts = conflicts.filter((conflict) => !conflict.consideringId)

  const group = (key: 'intent' | 'considering', heading: string, testId: string) => (
    <section className="state-group">
      <h3>{heading}</h3>
      {draft[key].map((row) => {
        const conflict = key === 'considering' ? rowConflict(row.id) : undefined
        return (
          <div key={row.id}>
            <div className="state-chip">
              <input
                data-testid={`${key}-input`}
                aria-label={`${heading}: ${row.text}`}
                aria-invalid={conflict !== undefined}
                value={row.text}
                onChange={(event) => editRow(key, row.id, event.target.value)}
              />
              <button
                className="remove"
                aria-label={`Remove ${row.text}`}
                onClick={() => removeRow(key, row.id)}
              >
                −
              </button>
            </div>
            {(() => {
              // How the saved line was understood (2026-10-01) — only while its text is
              // the saved text, so an edit in progress never shows a stale reading.
              const read = readings?.[`${key}:${row.id}`]
              if (!read || read.text !== row.text) return null
              return (
                <p className={`read-as${read.question ? ' unsure' : ''}`} data-testid="read-as">
                  {read.question ? `Not sure how to plan this: ${read.question}` : `Read as: ${read.readAs}`}
                </p>
              )
            })()}
            {conflict && (
              <div className="conflict-card" data-testid="state-conflict">
                <div className="title">This can't be planned</div>
                <ul><li>{conflict.message}</li></ul>
                <ConflictOptions
                  options={conflict.options}
                  onRewrite={(text) => editRow(key, row.id, text)}
                  onRemove={() => removeRow(key, row.id)}
                  onEdit={() => document.querySelector<HTMLInputElement>(`[aria-label="${heading}: ${row.text}"]`)?.focus()}
                />
              </div>
            )}
          </div>
        )
      })}
      <button className="state-add" data-testid={testId} onClick={() => addRow(key)}>
        + Add
      </button>
    </section>
  )

  return (
    <div className="state-screen" data-testid="state-screen">
      {note && (
        <div className="banner busy" data-testid="state-note" role="status">{note}</div>
      )}

      {eventChoice && onPickEvent && onSkipEvent && (
        <EventChoiceCard choice={eventChoice} busy={busy} onPick={onPickEvent} onSkip={onSkipEvent} />
      )}

      {generalConflicts.length > 0 && (
        <div className="conflict-card" data-testid="state-conflict">
          <div className="title">This can't be planned</div>
          <ul>
            {generalConflicts.map((conflict) => (
              <li key={conflict.message}>{conflict.message}</li>
            ))}
          </ul>
        </div>
      )}

      {group('intent', 'Intent', 'add-intent')}
      {group('considering', 'Considering', 'add-considering')}

      <section className="state-group">
        <h3>Priorities</h3>
        {draft.priorities.map((priority) => (
          <div className="priority" key={priority.id}>
            <span className="priority-name">{priority.name}</span>
            <div className="weights" role="group" aria-label={`${priority.name} weight`}>
              {WEIGHTS.map((weight) => (
                <button
                  key={weight}
                  aria-pressed={priority.weight === weight}
                  aria-label={`${priority.name} ${weight}`}
                  onClick={() =>
                    onChange({
                      ...draft,
                      priorities: draft.priorities.map((entry) =>
                        entry.id === priority.id ? { ...entry, weight } : entry,
                      ),
                    })
                  }
                >
                  {weight}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Nothing is saved as you type: the itinerary only moves on purpose. */}
      {dirty && (
        <div className="state-actions">
          <button className="btn-primary" data-testid="save-state" disabled={busy !== null} onClick={onSave}>
            {busy ?? 'Save changes'}
          </button>
          <button className="btn-secondary" data-testid="cancel-state" onClick={onRevert}>
            Undo edits
          </button>
        </div>
      )}
    </div>
  )
}
