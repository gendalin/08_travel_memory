/**
 * Where the trip is based (B3).
 *
 * The traveller types a name on Stage A — "Kuramae", "Park Hotel Tokyo" — and every
 * search after that is biased around it, the day-span budget is measured from it, and
 * §4.2 anchors every day to it. So a wrong point here is not a wrong pin; it is a
 * whole trip planned around the wrong part of the city.
 *
 * Which is why the matched address comes back with the coordinates. "Kuramae" is a
 * station, a district, and any number of hotels: the traveller is the only one who
 * can tell which they meant, and they can only tell if they are shown.
 *
 * The lookup itself is server-side (the key never reaches the browser, §13.1) and
 * asks only for Essentials fields, the cheapest billable tier — resolving a hotel
 * should not cost what retrieving a stop costs.
 */

export interface ResolvedLodging {
  lat: number
  lng: number
  /** What Places matched, for the traveller to confirm or correct. */
  matchedAddress: string
}

export interface LodgingLocator {
  /** Null when nothing matched. Never a guessed coordinate. */
  locate(input: { name: string; destination: string }): Promise<ResolvedLodging | null>
}

export function createHttpLodgingLocator(baseUrl = '/api'): LodgingLocator {
  return {
    async locate(input) {
      const res = await fetch(`${baseUrl}/lodging`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) return null

      const body = (await res.json()) as { lodging: ResolvedLodging | null }
      return body.lodging
    },
  }
}

/**
 * A locator backed by places already in hand.
 *
 * Used by the demo and by tests, where the base lodging is a catalogue entry and
 * there is nothing to look up. Matches on name, case-insensitively, and reports the
 * neighbourhood as the matched address — which is as much as a fixture knows.
 */
export function createCatalogueLodgingLocator(
  places: ReadonlyArray<{ name: string; lat: number; lng: number; neighborhood: string }>,
): LodgingLocator {
  return {
    async locate({ name }) {
      const wanted = name.trim().toLowerCase()
      const found = places.find((place) => place.name.toLowerCase() === wanted)
      if (!found) return null
      return { lat: found.lat, lng: found.lng, matchedAddress: found.neighborhood }
    },
  }
}
