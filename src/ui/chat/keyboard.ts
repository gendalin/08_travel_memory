/**
 * The on-screen keyboard, for opening the chat (2026-10-01).
 *
 * Opening the chat should put the traveller straight into typing, keyboard up, the
 * way a messaging app does. iOS only raises the keyboard for a focus() made inside
 * the tap itself — and the chat's input does not exist yet at that moment: it mounts
 * after the tap, when the sheet renders. So the tap focuses a stand-in input at once,
 * which brings the keyboard up; when the real input mounts it takes the focus, and the
 * keyboard stays up across the hand-over. The stand-in is removed as soon as it has
 * handed over, and after a second in any case.
 */

let standIn: HTMLInputElement | null = null

/** Call synchronously inside the tap that opens the chat. */
export function primeKeyboard(): void {
  if (typeof document === 'undefined') return
  releaseKeyboardStandIn()
  const input = document.createElement('input')
  input.setAttribute('aria-hidden', 'true')
  input.tabIndex = -1
  // 16px: below it iOS zooms the page on focus.
  Object.assign(input.style, { position: 'fixed', bottom: '0', left: '0', width: '1px', height: '1px', opacity: '0', fontSize: '16px', border: '0', padding: '0' })
  document.body.appendChild(input)
  input.focus()
  standIn = input
  window.setTimeout(releaseKeyboardStandIn, 1000)
}

/** Called once the real input has the focus. */
export function releaseKeyboardStandIn(): void {
  standIn?.remove()
  standIn = null
}

/**
 * Keeps `--keyboard-inset` on the root element equal to the height the keyboard
 * covers, so a sheet can sit above it rather than under it. The layout viewport does
 * not shrink for the iOS keyboard; the visual viewport does.
 */
export function trackKeyboardInset(): () => void {
  const viewport = typeof window !== 'undefined' ? window.visualViewport : null
  if (!viewport) return () => {}
  const update = () => {
    const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
    document.documentElement.style.setProperty('--keyboard-inset', `${Math.round(covered)}px`)
  }
  update()
  viewport.addEventListener('resize', update)
  viewport.addEventListener('scroll', update)
  return () => {
    viewport.removeEventListener('resize', update)
    viewport.removeEventListener('scroll', update)
  }
}
