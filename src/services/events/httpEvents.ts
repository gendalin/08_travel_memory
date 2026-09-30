/** Live event search through the server, which holds the keys (§13.1, §7.8). */

import type { EventFinder, EventSearchResult } from './types.ts'

export function createHttpEventFinder(baseUrl = '/api'): EventFinder {
  return {
    async find(input) {
      const res = await fetch(`${baseUrl}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error(`event search ${res.status}`)
      return (await res.json()) as EventSearchResult
    },
  }
}
