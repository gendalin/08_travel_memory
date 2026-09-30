/**
 * The prototype's cursor: a soft coloured gradient in place of the arrow and the
 * pointing hand, the way a Figma prototype shows where a viewer is pointing.
 *
 *   - it follows the mouse, and swells a little over anything clickable — that is
 *     the affordance the hand used to give
 *   - pressing contracts the gradient, so a click reads as a click
 *   - text fields keep the ordinary text cursor: an insertion point needs precision
 *     a gradient cannot give
 *
 * Mouse and trackpad only. On touch there is no cursor to replace, so nothing is
 * installed. The review build calls this; the app itself keeps the system cursor.
 */

/** Anything a click does something to. */
const CLICKABLE =
  'a, button, [role="button"], [role="tab"], [role="menuitem"], [role="option"], label, select, summary, ' +
  '.tappable, [data-place-id], .leaflet-interactive, .leaflet-marker-icon'

const TEXT_ENTRY =
  'input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, [contenteditable="true"]'

const STYLE = `
html.gradient-cursor, html.gradient-cursor * { cursor: none !important; }
html.gradient-cursor :is(${TEXT_ENTRY}) { cursor: text !important; }

.gradient-cursor-dot {
  position: fixed;
  left: 0;
  top: 0;
  width: 44px;
  height: 44px;
  margin: -22px 0 0 -22px;
  border-radius: 50%;
  pointer-events: none;
  z-index: 2147483647;
  /* #38C6F4, from a solid core out to transparent. */
  background: radial-gradient(
    circle,
    rgba(56, 198, 244, 0.95) 0%,
    rgba(56, 198, 244, 0.85) 14%,
    rgba(56, 198, 244, 0.45) 36%,
    rgba(56, 198, 244, 0.18) 55%,
    rgba(56, 198, 244, 0) 70%
  );
  transform: translate3d(var(--x, -100px), var(--y, -100px), 0) scale(var(--s, 1));
  transition: transform 140ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 160ms ease;
  will-change: transform;
}
.gradient-cursor-dot[data-state='hover'] { --s: 1.35; }
.gradient-cursor-dot[data-state='press'] { --s: 0.5; }
.gradient-cursor-dot[data-state='hover-press'] { --s: 0.62; }
.gradient-cursor-dot[data-hidden='true'] { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .gradient-cursor-dot { transition: opacity 160ms ease; }
}
`

export function installGradientCursor(): void {
  if (typeof window === 'undefined' || !window.matchMedia('(pointer: fine)').matches) return
  if (document.querySelector('.gradient-cursor-dot')) return

  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  const dot = document.createElement('div')
  dot.className = 'gradient-cursor-dot'
  dot.setAttribute('aria-hidden', 'true')
  dot.dataset.hidden = 'true'
  document.body.appendChild(dot)
  document.documentElement.classList.add('gradient-cursor')

  let pressed = false
  let overClickable = false

  const render = () => {
    dot.dataset.state = overClickable ? (pressed ? 'hover-press' : 'hover') : pressed ? 'press' : 'rest'
  }

  // Following the mouse without a transition lag: position goes straight into the
  // custom properties; only the scale animates.
  window.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType !== 'mouse') return
      dot.style.setProperty('--x', `${event.clientX}px`)
      dot.style.setProperty('--y', `${event.clientY}px`)
      const target = event.target instanceof Element ? event.target : null
      dot.dataset.hidden = target?.closest(TEXT_ENTRY) ? 'true' : 'false'
      overClickable = Boolean(target?.closest(CLICKABLE))
      render()
    },
    { passive: true },
  )
  window.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse') return
    pressed = true
    render()
  })
  window.addEventListener('pointerup', () => {
    pressed = false
    render()
  })
  document.addEventListener('pointerleave', () => {
    dot.dataset.hidden = 'true'
  })
  window.addEventListener('blur', () => {
    pressed = false
    render()
  })
}
