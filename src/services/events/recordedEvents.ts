/**
 * Events from a recorded live search — the prototype's stand-in for searching
 * (product_spec §7.8).
 *
 * The prototype is one offline file with no server and no key, so it cannot search.
 * It carries a real search, recorded on a known date, and every event it offers is
 * marked recorded so the app can say so. Nothing here is invented: the recording is
 * what `server/events.ts` found and verified on official pages.
 */

import type { EventFinder, EventSearchResult } from './types.ts'

export interface EventRecording extends EventSearchResult {
  window: { startDate: string; endDate: string }
}

export function createRecordedEventFinder(recordings: readonly EventRecording[]): EventFinder {
  return {
    async find(input) {
      const recording = recordings.find((entry) => entry.events.some((event) => event.activity === input.activity))
        ?? recordings[0]
      const checked = recording?.searchedAt.slice(0, 10) ?? 'an earlier date'
      const events = (recording?.events ?? []).filter(
        (event) => event.activity === input.activity && event.date >= input.startDate && event.date <= input.endDate,
      )
      const covered =
        recording !== undefined &&
        input.startDate >= recording.window.startDate &&
        input.endDate <= recording.window.endDate
      return {
        events,
        searchedAt: recording?.searchedAt ?? new Date(0).toISOString(),
        recorded: true,
        ...(events.length === 0
          ? {
              note: covered
                ? `The recorded search (${checked}) found no ${input.activity} in Tokyo on these dates.`
                : `This demo carries a search recorded on ${checked} for ${recording?.window.startDate ?? '?'} to ${recording?.window.endDate ?? '?'}; these dates are outside it. The full app searches live.`,
            }
          : {}),
      }
    },
  }
}
