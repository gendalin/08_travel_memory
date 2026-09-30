/**
 * A picked event as a place the trip can plan with (product_spec §7.8).
 *
 * An event is not in the catalogue — it was found for this trip, on a date — so it is
 * added from the State line that asked for it: a place at the venue, open for exactly
 * the event's hours on its one day. It is never a candidate for any other slot, and
 * it exists only while State holds the event, so deleting the line removes it.
 */

import { weekdayKey } from '../../domain/places/openingHours.ts'
import type { TripEvent, TripState } from '../../domain/state/types.ts'
import type { DemoPlace, PlaceCatalogue } from './types.ts'

export function eventPlaceId(event: Pick<TripEvent, 'id'>): string {
  return `event_${event.id}`
}

export function eventPlace(event: TripEvent): DemoPlace {
  const [year, month, day] = event.date.split('-').map(Number)
  const weekday = weekdayKey(new Date(year, month - 1, day))
  const minutes =
    Number(event.end.slice(0, 2)) * 60 + Number(event.end.slice(3)) - (Number(event.start.slice(0, 2)) * 60 + Number(event.start.slice(3)))
  let host = ''
  try {
    host = new URL(event.sourceUrl).hostname.replace(/^www\./, '')
  } catch {
    host = event.sourceUrl
  }
  return {
    placeId: eventPlaceId(event),
    name: event.title,
    lat: event.venue.lat,
    lng: event.venue.lng,
    category: 'exhibition_event',
    neighborhood: event.venue.name,
    openingHours: { [weekday]: `${event.start}-${event.end}` },
    typicalDurationMin: Math.max(30, minutes),
    tags: [event.activity, event.venue.name],
    shortDescription:
      `${event.title} at ${event.venue.name}, ${event.date} from ${event.start}` +
      `${event.endEstimated ? ` (ends around ${event.end})` : ` to ${event.end}`}. ` +
      `Checked ${event.fetchedAt.slice(0, 10)} on ${host}${event.recorded ? ' — recorded for this demo' : ''}.`,
    source: 'live_event',
  }
}

/** Events a State holds, picked and dated. */
export function eventsIn(state: TripState | null | undefined): TripEvent[] {
  return (state?.considering ?? [])
    .map((item) => (item.tag?.kind === 'event' ? item.tag.event : undefined))
    .filter((event): event is TripEvent => event !== undefined)
}

/** The catalogue, plus a place for every event these States hold. */
export function withEventPlaces(
  catalogue: PlaceCatalogue,
  ...states: Array<TripState | null | undefined>
): PlaceCatalogue {
  const extra = new Map(states.flatMap(eventsIn).map((event) => [eventPlaceId(event), eventPlace(event)]))
  if (extra.size === 0) return catalogue
  return {
    all: () => [...catalogue.all(), ...extra.values()],
    get: (placeId) => extra.get(placeId) ?? catalogue.get(placeId),
    has: (placeId) => extra.has(placeId) || catalogue.has(placeId),
    // An event is never a candidate for another slot.
    candidates: (filter) => catalogue.candidates(filter),
  }
}
