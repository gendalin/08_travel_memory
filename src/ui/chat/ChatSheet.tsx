/**
 * Chat sheet (UI draft 02).
 *
 * The conversation, and everything that comes out of it: proposals, conflicts
 * and the Receipt each committed change leaves behind. Putting them here rather
 * than on the map keeps one thread of what was asked and what happened — and
 * keeps the Plan screen a map.
 *
 * The composer stays inside the sheet, so sending and reading are the same
 * place (§14.2: "Bottom composer → expanded chat sheet").
 */

import type { Plan } from '../../domain/plan/types.ts'
import type { ChatEntry } from '../../app/store.ts'
import type { Proposal } from '../../domain/proposals/types.ts'
import type { Receipt } from '../../domain/receipts/types.ts'
import type { PlaceCatalogue } from '../../services/places/types.ts'
import { ChangeProposalCard } from '../proposals/ChangeProposalCard.tsx'
import { ReceiptList } from '../receipts/ReceiptList.tsx'
import { ChatComposer } from './ChatComposer.tsx'

interface Props {
  entries: ChatEntry[]
  proposal: Proposal | null
  receipts: Receipt[]
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
  entries, proposal, receipts, conflict, lifecycleNote, busy, error, catalogue, stopsInPlan, currentPlan,
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
        <div className="sheet-head">
          <div>
            <h3>What changed?</h3>
            <p className="sub">Tell me and I'll work out what it means for the trip.</p>
          </div>
          <button className="sheet-close" aria-label="Close chat" data-testid="close-chat" onClick={onClose}>
            ✕
          </button>
        </div>

        {error && <div className="banner error" role="alert">{error}</div>}
        {lifecycleNote && (
          <div className="banner busy" data-testid="lifecycle-note">{lifecycleNote}</div>
        )}

        <div className="chat-thread" data-testid="chat-thread">
          {entries.length === 0 && !proposal && (
            <p className="chat-empty">
              Nothing yet. Try “the ramen place on Day 2 is closed today”.
            </p>
          )}
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

        <ReceiptList receipts={receipts} catalogue={catalogue} />

        <ChatComposer busy={busy} onSend={onSend} autoFocus />
      </div>
    </div>
  )
}
