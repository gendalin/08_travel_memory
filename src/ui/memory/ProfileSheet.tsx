/**
 * Profile — Personal Memory review (UI draft 06; product_spec §10, Gate 4).
 *
 * Two sections, as the draft has them: what has been noticed but is not in use,
 * and what is. The draft splits them on a confidence score; the product does
 * not show confidence (§10.2), so the split is by status — which is the thing
 * that actually decides whether a memory reaches a plan.
 *
 * Every row is inline-editable, and its overflow menu carries the actions that
 * change status. Memories with strong evidence from photos and saved places
 * arrive already in use; the rest wait here for the user.
 */

import { useState } from 'react'

import type { Memory } from '../../domain/memory/types.ts'
import { provenanceLabel } from '../../domain/memory/types.ts'

interface Props {
  memories: Memory[]
  onConfirm: (memoryId: string) => void
  onDeactivate: (memoryId: string) => void
  onDismiss: (memoryId: string) => void
  onEdit: (memoryId: string, text: string) => void
  onClose: () => void
}

interface RowProps {
  memory: Memory
  actions: Array<{ label: string; danger?: boolean; testId: string; run: () => void }>
  meta: string
  onEdit: (text: string) => void
}

function MemoryRow({ memory, actions, meta, onEdit }: RowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [text, setText] = useState(memory.text)

  return (
    <li
      className={`memory ${memory.status === 'active' ? 'active' : ''}`}
      data-testid={memory.status === 'active' ? 'memory-active' : 'memory-candidate'}
      data-memory-id={memory.id}
    >
      <textarea
        className="memory-text"
        aria-label={`Memory: ${memory.text}`}
        rows={Math.max(1, Math.ceil(text.length / 34))}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (text.trim() !== memory.text) onEdit(text)
        }}
      />
      <div className="memory-meta">{meta}</div>

      <button
        className="memory-menu-button"
        aria-label={`Options for “${memory.text}”`}
        aria-expanded={menuOpen}
        data-testid={`memory-menu-${memory.id}`}
        onClick={() => setMenuOpen((open) => !open)}
      >
        •••
      </button>

      {menuOpen && (
        <div className="memory-menu" role="menu">
          {actions.map((action) => (
            <button
              key={action.label}
              role="menuitem"
              className={action.danger ? 'danger' : undefined}
              data-testid={action.testId}
              onClick={() => {
                setMenuOpen(false)
                action.run()
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </li>
  )
}

export function ProfileSheet({ memories, onConfirm, onDeactivate, onDismiss, onEdit, onClose }: Props) {
  const candidates = memories.filter((memory) => memory.status === 'candidate')
  const active = memories.filter((memory) => memory.status === 'active')

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet tall"
        role="dialog"
        aria-label="Profile"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-head">
          <div>
            <h3>What I remember</h3>
            <p className="sub">Strong patterns from your photos and saved places are used on new trips. The rest waits for you.</p>
          </div>
          <button className="sheet-close" aria-label="Close" data-testid="profile-back" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="section-title">Noticed in your photos and saved places</div>
        {candidates.length === 0 && <p className="chat-empty">Nothing waiting for review.</p>}
        <ul className="memories" data-testid="candidate-memories">
          {candidates.map((memory) => (
            <MemoryRow
              key={memory.id}
              memory={memory}
              meta={`${provenanceLabel(memory.provenance.type)} · ${memory.provenance.sourceRefs.length} sources`}
              onEdit={(text) => onEdit(memory.id, text)}
              actions={[
                {
                  label: 'Remember this',
                  testId: `confirm-${memory.id}`,
                  run: () => onConfirm(memory.id),
                },
                {
                  label: 'Delete',
                  danger: true,
                  testId: `dismiss-${memory.id}`,
                  run: () => onDismiss(memory.id),
                },
              ]}
            />
          ))}
        </ul>

        <div className="section-title">Current memory about you</div>
        {active.length === 0 && (
          <p className="chat-empty">Nothing in use yet. Confirm something above to start.</p>
        )}
        <ul className="memories" data-testid="active-memories">
          {active.map((memory) => (
            <MemoryRow
              key={memory.id}
              memory={memory}
              meta={`${provenanceLabel(memory.provenance.type)} · used on new trips`}
              onEdit={(text) => onEdit(memory.id, text)}
              actions={[
                {
                  label: 'Stop using',
                  testId: `deactivate-${memory.id}`,
                  run: () => onDeactivate(memory.id),
                },
                {
                  label: 'Delete',
                  danger: true,
                  testId: `dismiss-${memory.id}`,
                  run: () => onDismiss(memory.id),
                },
              ]}
            />
          ))}
        </ul>
      </div>
    </div>
  )
}
