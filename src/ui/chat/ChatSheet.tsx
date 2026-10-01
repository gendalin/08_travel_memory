/**
 * Chat sheet (UI draft 02).
 *
 * The conversation and what comes out of it: proposals and conflicts. The record of
 * confirmed decisions lives on the State screen, under Priorities (2026-10-01): the
 * chat is for what to change next, not for the history of what changed.
 *
 * The composer stays inside the sheet, so sending and reading are the same
 * place (§14.2: "Bottom composer → expanded chat sheet").
 */

import type { Plan } from '../../domain/plan/types.ts'
import type { ChatEntry } from '../../app/store.ts'
import type { Proposal } from '../../domain/proposals/types.ts'
import type { PlaceCatalogue } from '../../services/places/types.ts'
import { ChangeProposalCard } from '../proposals/ChangeProposalCard.tsx'
import { ChatComposer } from './ChatComposer.tsx'

interface Props {
  entries: ChatEntry[]
  proposal: Proposal | null
  conflict: string | null
  lifecycleNote: string | null
  busy: string | null
  error: string | null
  catalogue: PlaceCatalogue
  /** Stops in the committed plan, so a proposal can say how many it leaves alone. */
  stopsInPlan: number
  /** The committed plan, for the side-by-side comparison. */
  currentPlan?: Plan
  onSend: (message: string) => void
  onConfirm: (declinedUnitIds: string[]) => void
  onKeep: () => void
  onDismissConflict: () => void
  onClose: () => void
}

export function ChatSheet({
  entries, proposal, conflict, lifecycleNote, busy, error, catalogue, stopsInPlan, currentPlan,
  onSend, onConfirm, onKeep, onDismissConflict, onClose,
}: Props) {
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet tall with-composer"
        role="dialog"
        aria-label="Chat"
        onClick={(event) => event.stopPropagation()}
      >
        {/* No title or prompt text: the field and the keyboard say what to do. */}
        <div className="sheet-head chat-head">
          <button className="sheet-close" aria-label="Close chat" data-testid="close-chat" onClick={onClose}>
            ✕
          </button>
        </div>

        {error && <div className="banner error" role="alert">{error}</div>}
        {lifecycleNote && (
          <div className="banner busy" data-testid="lifecycle-note">{lifecycleNote}</div>
        )}

        <div className="chat-thread" data-testid="chat-thread">
          {entries.map((entry) => (
            <span key={entry.id} className={`bubble ${entry.from}`}>{entry.text}</span>
          ))}
        </div>

        {conflict && (
          <div className="conflict-card" data-testid="plan-conflict">
            <div className="title">This can't be planned</div>
            <ul><li>{conflict}</li></ul>
            <button className="btn-ghost" data-testid="dismiss-conflict" onClick={onDismissConflict}>
              Keep the plan as it is
            </button>
          </div>
        )}

        {proposal && (
          <ChangeProposalCard
            proposal={proposal}
            catalogue={catalogue}
            stopsInPlan={stopsInPlan}
            {...(currentPlan ? { currentPlan } : {})}
            busy={busy}
            onConfirm={onConfirm}
            onKeep={onKeep}
          />
        )}

        <ChatComposer busy={busy} onSend={onSend} autoFocus />
      </div>
    </div>
  )
}
