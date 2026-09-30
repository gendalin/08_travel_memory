/**
 * Read-only disclosure of the memories that would be snapshotted (§3.6.2).
 *
 * Informational, never a configuration step: there is no edit control here by
 * design. Editing Memory is a Profile action, and the snapshot itself is not
 * created until Stage B is confirmed.
 */

import type { Memory } from '../../domain/memory/types.ts'
import { provenanceLabel } from '../../domain/memory/types.ts'

interface Props {
  memories: Memory[]
  onClose: () => void
}

export function MemoryDisclosureSheet({ memories, onClose }: Props) {
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-label="Memories in use"
        data-testid="memory-disclosure-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-head">
          <div>
            <h3>What I'll use on this trip</h3>
            <p className="sub">
              Saved when you generate the itinerary, and fixed for this trip afterwards.
              Change these in Profile.
            </p>
          </div>
          <button className="sheet-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        <ul className="memories">
          {memories.map((memory) => (
            <li key={memory.id} className="memory active" data-testid="disclosed-memory">
              {/* Read-only: a plain paragraph, not the editable field the
                  Profile uses, so there is no edit affordance here at all. */}
              <p className="memory-text" style={{ margin: 0 }}>{memory.text}</p>
              <div className="memory-meta">{provenanceLabel(memory.provenance.type)}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
