/**
 * New Trip — Stage A: Trip Setup (product_spec §3.6.2, §3.6.3).
 *
 * Collects only what the user knows before planning. Internal vocabulary
 * (State, Reframe, Memory snapshot) never appears on this screen.
 *
 * The Memory row is informational only — tapping it opens a read-only sheet.
 * Editing Memory inside the New Trip flow is forbidden by §3.6.2.
 */

import { useState } from 'react'

import { DESTINATION, type StageAInput } from '../../application/createTrip/createTrip.ts'

interface Props {
  activeMemoryCount: number
  busy: string | null
  initial?: StageAInput | null
  onSubmit: (input: StageAInput) => void
  onShowMemories: () => void
  onClose: () => void
}

export function StageASetup({
  activeMemoryCount, busy, initial, onSubmit, onShowMemories, onClose,
}: Props) {
  const [name, setName] = useState(initial?.name ?? 'Tokyo Trip')
  const [startDate, setStartDate] = useState(initial?.startDate ?? '')
  const [endDate, setEndDate] = useState(initial?.endDate ?? '')
  const [lodging, setLodging] = useState(initial?.baseLodgingName ?? '')
  const [intentText, setIntentText] = useState(initial?.intentText ?? '')
  const [consideringText, setConsideringText] = useState(initial?.consideringText ?? '')
  const [touched, setTouched] = useState(false)

  // §3.6.3: the CTA stays disabled until every required field is present and
  // the dates make sense. Considering may be empty; Intent may not.
  const datesOrdered = startDate !== '' && endDate !== '' && endDate >= startDate
  const errors = {
    name: name.trim() === '' ? 'Give the trip a name.' : undefined,
    dates:
      startDate === '' || endDate === ''
        ? 'Pick both dates.'
        : !datesOrdered
          ? 'The end date is before the start date.'
          : undefined,
    lodging: lodging.trim() === '' ? 'Where will you be staying?' : undefined,
    intent: intentText.trim() === '' ? 'A sentence or two is enough.' : undefined,
  }
  const ready = Object.values(errors).every((error) => error === undefined)

  const dirty =
    intentText.trim() !== '' || consideringText.trim() !== '' || lodging.trim() !== ''

  const show = (key: keyof typeof errors) => (touched ? errors[key] : undefined)

  return (
    <div className="screen">
      <div className="sheet-nav">
        <button
          className="icon-button"
          aria-label="Close new trip"
          data-testid="close-new-trip"
          onClick={() => {
            // §3.6.9: confirm before discarding anything the user typed.
            if (!dirty || window.confirm('Discard this trip?')) onClose()
          }}
        >
          ×
        </button>
        <span className="title">New Trip</span>
        <span style={{ minWidth: 44 }} />
      </div>

      <h1>{DESTINATION}</h1>
      <p className="lede">Tell me roughly what you want. I'll turn it into something you can edit.</p>

      <div className="field">
        <label htmlFor="trip-name">Trip name</label>
        <input
          id="trip-name"
          value={name}
          aria-invalid={show('name') !== undefined}
          onChange={(e) => setName(e.target.value)}
        />
        {show('name') && <div className="field-error">{show('name')}</div>}
      </div>

      <div className="field">
        <label htmlFor="destination">Destination</label>
        <input id="destination" value={DESTINATION} readOnly />
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="start-date">Start</label>
          <input id="start-date" type="date" value={startDate}
            aria-invalid={show('dates') !== undefined}
            onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="end-date">End</label>
          <input id="end-date" type="date" value={endDate}
            aria-invalid={show('dates') !== undefined}
            onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
      {show('dates') && <div className="field-error" data-testid="dates-error">{show('dates')}</div>}

      <div className="field">
        <label htmlFor="lodging">Staying in</label>
        <input
          id="lodging"
          placeholder="Kuramae, Tokyo"
          value={lodging}
          aria-invalid={show('lodging') !== undefined}
          onChange={(e) => setLodging(e.target.value)}
        />
        {show('lodging') && <div className="field-error">{show('lodging')}</div>}
      </div>

      <div className="field">
        <label htmlFor="intent">What kind of trip do you want?</label>
        <textarea
          id="intent"
          placeholder="Slow-paced, time in local neighbourhoods, coffee and design, some museums. I don't want every day packed."
          value={intentText}
          aria-invalid={show('intent') !== undefined}
          onChange={(e) => setIntentText(e.target.value)}
        />
        {show('intent') && <div className="field-error" data-testid="intent-error">{show('intent')}</div>}
      </div>

      <div className="field">
        <label htmlFor="considering">Anything the plan should consider?</label>
        <textarea
          id="considering"
          placeholder="I must visit 21_21 Design Sight. Day 5 is a half day. No taxis."
          value={consideringText}
          onChange={(e) => setConsideringText(e.target.value)}
        />
      </div>

      {/* §3.6.2: informational row near the CTA; omitted entirely at zero. */}
      {activeMemoryCount > 0 && (
        <button
          className="disclosure tappable"
          data-testid="memory-disclosure"
          onClick={onShowMemories}
        >
          <span>
            Using {activeMemoryCount} {activeMemoryCount === 1 ? 'memory' : 'memories'} from Profile
          </span>
          <span aria-hidden="true">›</span>
        </button>
      )}

      <div className="cta-bar">
        <button
          className="btn-primary"
          data-testid="review-trip-state"
          disabled={busy !== null}
          onClick={() => {
            setTouched(true)
            if (!ready) return
            onSubmit({
              name: name.trim(),
              startDate,
              endDate,
              baseLodgingPlaceId: 'kuramae_base',
              baseLodgingName: lodging.trim(),
              intentText,
              consideringText,
            })
          }}
        >
          {busy ?? 'Review trip state'}
        </button>
      </div>
    </div>
  )
}
