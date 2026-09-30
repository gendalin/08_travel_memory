/**
 * The composer (UI drafts 01, 02).
 *
 * Two forms of one control. Over the map it is a *button* shaped like the
 * field: tapping it opens the chat sheet, where the real input lives. It is
 * deliberately not a text field — a field that opens a sheet the moment you
 * focus it swallows the first keystrokes into a control that is about to be
 * covered.
 *
 * Inside the sheet it is the field itself, focused on open, so the tap that
 * expanded it lands you on the keyboard.
 */

import { useState } from 'react'

interface Props {
  busy: string | null
  onSend: (message: string) => void
  autoFocus?: boolean
}

/** The collapsed form: looks like the field, behaves like a button. */
export function ChatLauncher({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="composer">
      <button className="composer-launcher" data-testid="open-chat" onClick={onOpen}>
        <span className="placeholder">Tell me what changed…</span>
        <span className="send" aria-hidden="true">↑</span>
      </button>
    </div>
  )
}

export function ChatComposer({ busy, onSend, autoFocus }: Props) {
  const [draft, setDraft] = useState('')

  return (
    <div className="composer">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!draft.trim() || busy) return
          onSend(draft.trim())
          setDraft('')
        }}
      >
        <input
          aria-label="Message"
          data-testid="chat-input"
          placeholder="Tell me what changed…"
          value={draft}
          autoFocus={autoFocus}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" aria-label="Send" data-testid="chat-send" disabled={busy !== null}>
          ↑
        </button>
      </form>
    </div>
  )
}
