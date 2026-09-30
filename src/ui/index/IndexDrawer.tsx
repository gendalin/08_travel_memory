/**
 * Index (UI draft 05) — what the trip slides aside to uncover.
 *
 * New Trip at the top, trips in the middle, Profile pinned to the bottom.
 * Editing Memory lives behind Profile, never inside the New Trip flow (§3.6.2).
 *
 * The panel does not move: App slides the screen you were on to the right as a
 * card, and this is what was underneath. The scrim sits between that card and
 * this panel — it veils the card, catches the tap that sends it back, and
 * leaves the Index above it fully live.
 */

import { useState } from 'react'

interface Props {
  tripName?: string
  activeMemoryCount: number
  onNewTrip: () => void
  onOpenTrip: () => void
  onOpenProfile: () => void
  /** Data / demo reset (Gate 8). Destructive, so it confirms in place first. */
  onReset: () => void
  /** True when the browser is not keeping anything — worth saying here. */
  notSaving?: boolean
  onClose: () => void
}

export function IndexDrawer({
  tripName, activeMemoryCount, onNewTrip, onOpenTrip, onOpenProfile, onReset,
  notSaving, onClose,
}: Props) {
  /**
   * Confirmation happens in this row rather than in a dialog.
   *
   * §5.7 forbids stacking a sheet on a sheet, and the Index is already an overlay.
   * Turning the row itself into the question keeps the one rule and still makes the
   * act deliberate — which it has to be, because there is no undo (§7).
   */
  const [confirming, setConfirming] = useState(false)

  return (
    <>
      <div className="stage-scrim" role="presentation" onClick={onClose} />

      <nav className="drawer" aria-label="Trips and profile">
        <button className="new-trip" data-testid="new-trip" onClick={onNewTrip}>
          + New Trip
        </button>

        <div className="section-title">Trip</div>
        <ul className="trip-list">
          {tripName ? (
            <li>
              <button aria-current="true" data-testid="open-trip" onClick={onOpenTrip}>
                {tripName}
              </button>
            </li>
          ) : (
            <li className="lede" style={{ padding: '0 4px' }}>No trips yet.</li>
          )}
        </ul>

        <div className="drawer-foot">
          {notSaving && (
            <p className="trip-meta" data-testid="not-saving">
              This browser is not keeping your trip — it will be gone if you reload.
            </p>
          )}

          {confirming ? (
            <p className="trip-meta" data-testid="confirm-reset">
              Start over? This deletes the trip, its receipts and every memory you
              confirmed. There is no undo.{' '}
              <button className="link-button" data-testid="reset-confirm" onClick={onReset}>
                Start over
              </button>{' '}
              <button className="link-button" data-testid="reset-cancel" onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </p>
          ) : (
            <button className="link-button" data-testid="reset-demo" onClick={() => setConfirming(true)}>
              Start over
            </button>
          )}

          <button className="profile-row" data-testid="open-profile" onClick={onOpenProfile}>
            <span className="avatar" aria-hidden="true">G</span>
            <span>
              Profile
              {/* Only ever says what is true of something: an empty Profile says
                  nothing rather than announcing its emptiness. */}
              {activeMemoryCount > 0 && (
                <span className="trip-meta" style={{ display: 'block' }}>
                  {activeMemoryCount} in use on new trips
                </span>
              )}
            </span>
          </button>
        </div>
      </nav>
    </>
  )
}
