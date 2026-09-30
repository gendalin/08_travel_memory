/**
 * New Trip — Stage B: Review your trip (Gate 3 step 2).
 *
 * Intent / Considering are editable, addable, deletable. Priorities take a
 * low / medium / high weight. An agent-proposed Priority enters State only if
 * the user presses Add (§3.4) — there is no path where it slips in silently.
 */

import { useState } from 'react'

import type { ReviewDraft } from '../../application/createTrip/createTrip.ts'
import type { PriorityWeight } from '../../domain/state/types.ts'
import type { ConflictOption } from '../../application/planning/conflicts.ts'
import { ConflictOptions } from '../state/ConflictOptions.tsx'

interface Props {
  draft: ReviewDraft
  acceptedPriority: string | undefined
  busy: string | null
  /** Trip frame summary shown at the top (§3.6.4). */
  tripName: string
  dateRange: string
  lodging: string
  activeMemoryCount: number
  /** State conflicts blocking generation (§3.6.5). */
  conflicts: Array<{ message: string; consideringId?: string; options?: ConflictOption[] }>
  /** How each line was understood, keyed `intent:<text>` / `considering:<text>` (2026-10-01). */
  readAs?: Record<string, { readAs: string; question?: string }>
  onChange: (draft: ReviewDraft) => void
  onAcceptPriority: (name: string | undefined) => void
  onShowMemories: () => void
  onBack: () => void
  onGenerate: () => void
}

const WEIGHTS: PriorityWeight[] = ['low', 'medium', 'high']

export function StageBReview({
  draft, acceptedPriority, busy, tripName, dateRange, lodging, activeMemoryCount,
  conflicts, readAs, onChange, onAcceptPriority, onShowMemories, onBack, onGenerate,
}: Props) {
  const readLine = (section: 'intent' | 'considering', text: string) => {
    const read = readAs?.[`${section}:${text.trim()}`]
    if (!read) return null
    return (
      <p className={`read-as${read.question ? ' unsure' : ''}`} data-testid="read-as">
        {read.question ? `Not sure how to plan this: ${read.question}` : `Read as: ${read.readAs}`}
      </p>
    )
  }
  const [newIntent, setNewIntent] = useState('')
  const [newConsidering, setNewConsidering] = useState('')

  const editList = (key: 'intent' | 'considering', id: string, text: string) =>
    onChange({ ...draft, [key]: draft[key].map((item) => (item.id === id ? { ...item, text } : item)) })

  const removeItem = (key: 'intent' | 'considering', id: string) =>
    onChange({ ...draft, [key]: draft[key].filter((item) => item.id !== id) })

  const addItem = (key: 'intent' | 'considering', text: string) => {
    if (!text.trim()) return
    onChange({ ...draft, [key]: [...draft[key], { id: `${key}_${Date.now()}`, text: text.trim() }] })
  }

  const consideringConflicts = conflicts.filter((conflict) => conflict.consideringId)
  const otherConflicts = conflicts.filter((conflict) => !conflict.consideringId)

  const conflictCard = (entries: Props['conflicts'], testId: string) =>
    entries.length > 0 && (
      <div className="conflict-card" data-testid={testId}>
        <div className="title">This can't be planned yet</div>
        <ul>
          {entries.map((conflict) => (
            <li key={conflict.message}>
              {conflict.message}
              {conflict.consideringId && (() => {
                const item = draft.considering.find((c) => c.id === conflict.consideringId)
                return item ? <> — from “{item.text}”</> : null
              })()}
              {conflict.consideringId && (
                <ConflictOptions
                  options={conflict.options}
                  onRewrite={(text) => editList('considering', conflict.consideringId!, text)}
                  onRemove={() => removeItem('considering', conflict.consideringId!)}
                  onEdit={() => document.querySelector<HTMLInputElement>(`[aria-label^="Considering:"]`)?.focus()}
                />
              )}
            </li>
          ))}
        </ul>
      </div>
    )

  return (
    <div className="screen">
      <div className="sheet-nav">
        <button className="icon-button" aria-label="Back to trip setup" data-testid="back-to-setup" onClick={onBack}>
          ‹
        </button>
        <span className="title">Review trip</span>
        <span style={{ minWidth: 44 }} />
      </div>

      <div className="trip-summary">
        <h1 className="name" data-testid="trip-summary-name">{tripName}</h1>
        <div className="meta">{dateRange} · {lodging}</div>
      </div>
      <p className="lede">This is what I'll plan against. Change anything that isn't right.</p>

      {conflictCard(otherConflicts, 'conflict-general')}

      <div className="section-title">What kind of trip</div>
      {draft.intent.map((item) => (
        <div key={item.id}>
        <div className="editable-row">
          <input
            aria-label={`Intent: ${item.text}`}
            value={item.text}
            onChange={(e) => editList('intent', item.id, e.target.value)}
          />
          <button aria-label={`Remove ${item.text}`} onClick={() => removeItem('intent', item.id)}>−</button>
        </div>
        {readLine('intent', item.text)}
        </div>
      ))}
      <div className="editable-row">
        <input
          aria-label="Add intent"
          placeholder="Add something…"
          value={newIntent}
          onChange={(e) => setNewIntent(e.target.value)}
        />
        <button aria-label="Add intent item" onClick={() => { addItem('intent', newIntent); setNewIntent('') }}>+</button>
      </div>

      <div className="section-title">Should consider</div>
      {conflictCard(consideringConflicts, 'conflict-considering')}
      {draft.considering.map((item) => (
        <div key={item.id}>
        <div className="editable-row">
          <input
            aria-label={`Considering: ${item.text}`}
            value={item.text}
            onChange={(e) => editList('considering', item.id, e.target.value)}
          />
          <button aria-label={`Remove ${item.text}`} onClick={() => removeItem('considering', item.id)}>−</button>
        </div>
        {readLine('considering', item.text)}
        </div>
      ))}
      <div className="editable-row">
        <input
          aria-label="Add consideration"
          placeholder="Add something…"
          value={newConsidering}
          onChange={(e) => setNewConsidering(e.target.value)}
        />
        <button aria-label="Add considering item" onClick={() => { addItem('considering', newConsidering); setNewConsidering('') }}>+</button>
      </div>

      <div className="section-title">What to optimise for</div>
      <div className="card">
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
                      priorities: draft.priorities.map((p) =>
                        p.id === priority.id ? { ...p, weight } : p,
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
      </div>

      {draft.proposedPriority && (
        <div className="proposed-priority" data-testid="proposed-priority">
          <p>
            Want me to also optimise for <strong>{draft.proposedPriority.name}</strong>?{' '}
            {draft.proposedPriority.reason}
          </p>
          <div className="actions">
            {acceptedPriority === draft.proposedPriority.name ? (
              <button className="btn-ghost" onClick={() => onAcceptPriority(undefined)}>Added — remove</button>
            ) : (
              <>
                <button
                  className="btn-ghost primary-ghost"
                  data-testid="accept-priority"
                  onClick={() => onAcceptPriority(draft.proposedPriority?.name)}
                >
                  Add it
                </button>
                <button
                  className="btn-ghost"
                  data-testid="decline-priority"
                  onClick={() => {
                    // Declining removes it from the draft entirely (§3.6.4).
                    onAcceptPriority(undefined)
                    onChange({ ...draft, proposedPriority: undefined })
                  }}
                >
                  No thanks
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {activeMemoryCount > 0 && (
        <button className="disclosure tappable" data-testid="memory-disclosure-b" onClick={onShowMemories}>
          <span>
            Using {activeMemoryCount} {activeMemoryCount === 1 ? 'memory' : 'memories'} from Profile
          </span>
          <span aria-hidden="true">›</span>
        </button>
      )}

      <div className="cta-bar">
        <button
          className="btn-primary"
          data-testid="generate-itinerary"
          disabled={busy !== null}
          onClick={onGenerate}
        >
          {busy ?? 'Generate itinerary'}
        </button>
      </div>
    </div>
  )
}
