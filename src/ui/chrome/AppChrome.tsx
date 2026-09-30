/**
 * Floating top chrome (UI draft 01).
 *
 * Index on the left, Plan / State in the middle. It sits over the map rather
 * than above it, because the map is the screen — a bar would cost a strip of
 * the only view that matters.
 */

interface Props {
  /** Plan or State, the two views of the same trip. */
  view: 'plan' | 'state'
  onSelectView: (view: 'plan' | 'state') => void
  onOpenIndex: () => void
}

export function AppChrome({ view, onSelectView, onOpenIndex }: Props) {
  return (
    <div className="app-chrome">
      <button
        className="icon-button floating"
        aria-label="Trips and profile"
        data-testid="open-index"
        onClick={onOpenIndex}
      >
        ☰
      </button>

      <div className="segmented" role="tablist" aria-label="Trip view">
        {(['plan', 'state'] as const).map((option) => (
          <button
            key={option}
            role="tab"
            aria-selected={view === option}
            data-testid={`view-${option}`}
            onClick={() => onSelectView(option)}
          >
            {option === 'plan' ? 'Plan' : 'State'}
          </button>
        ))}
      </div>

      {/* Balances the index button so the segmented control stays centred. */}
      <span className="spacer" aria-hidden="true" />
    </div>
  )
}
