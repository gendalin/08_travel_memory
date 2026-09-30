/**
 * Index (product_spec §3.6.1) — where a first run starts.
 *
 * Same contents and same order as the drawer (UI draft 05): New Trip, then
 * trips, then Profile at the foot. Once a trip exists the drawer takes over,
 * so the two must not drift apart.
 *
 * Editing Memory lives here rather than inside the New Trip flow, which
 * §3.6.2 forbids.
 */

interface Props {
  tripName?: string
  activeMemoryCount: number
  onNewTrip: () => void
  onOpenTrip: () => void
  onOpenProfile: () => void
}

export function IndexScreen({
  tripName, activeMemoryCount, onNewTrip, onOpenTrip, onOpenProfile,
}: Props) {
  return (
    <div className="screen index-screen">
      <h1>The Next Trip</h1>

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
          <li className="chat-empty">Nothing planned yet.</li>
        )}
      </ul>

      <div className="drawer-foot">
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
    </div>
  )
}
