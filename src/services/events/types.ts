/**
 * Live events: finding real, dated, timed things to do on the trip (product_spec §7.8).
 *
 * A traveller who writes "at least one baseball game" needs an actual game — a date,
 * a start time, a stadium — before it can be planned around. That is live
 * information: it did not exist when the catalogue was built, and it changes. So it
 * is searched for when asked, and every event carries where it came from and when it
 * was checked.
 */

/** An event as found, before it is placed on a trip day. */
export interface FoundEvent {
  id: string
  title: string
  activity: string
  /** YYYY-MM-DD. */
  date: string
  /** HH:MM. */
  start: string
  /** HH:MM. */
  end: string
  /** True when the source gave only a start time and the end is a typical length. */
  endEstimated: boolean
  venue: { name: string; lat: number; lng: number; neighborhood: string }
  sourceUrl: string
  sourceTitle?: string
  fetchedAt: string
}

export interface EventSearchResult {
  events: FoundEvent[]
  /** When the search ran — or, for recorded data, when it was recorded. */
  searchedAt: string
  /** True for the prototype's recorded snapshot rather than a live search. */
  recorded: boolean
  /** Why the list is empty or short, in words the traveller can read. */
  note?: string
}

export interface EventFinder {
  find(input: {
    activity: string
    destination: string
    /** YYYY-MM-DD, inclusive. */
    startDate: string
    endDate: string
  }): Promise<EventSearchResult>
}

/** How long an activity usually runs, when a source gives only its start. */
export const TYPICAL_EVENT_MINUTES: Record<string, number> = {
  baseball: 210,
  football: 120,
  sumo: 240,
  concert: 150,
  kabuki: 240,
  festival: 180,
}
