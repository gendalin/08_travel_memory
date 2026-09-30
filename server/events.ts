/**
 * Live event search (product_spec §7.8). Server-side: it spends the web-search, model
 * and Places keys.
 *
 *   web search  finds pages that might list the events      (OpenAI `web_search`)
 *   code        fetches each page and reads its text
 *   model       lists the events ON THAT PAGE, quoting the line for each
 *   code        keeps an event only if the quote is on the page, the date is in the
 *               trip, the start time is in the quote and the venue is on the page
 *   Places      puts the venue on the map
 *
 * The model never supplies a fact that code has not found on a fetched page. An
 * event that fails any check is dropped, not repaired.
 *
 * Live data goes stale, so results are cached for a day, not forever.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { envOrThrow } from '../scripts/preprocess/env.ts'
import { REPO_ROOT } from '../scripts/preprocess/types.ts'
import { cleanUrl, isBlocked } from '../scripts/enrich/discover_poi_sources.ts'
import { pageText } from '../scripts/enrich/fetch_poi_evidence.ts'
import { TYPICAL_EVENT_MINUTES, type EventSearchResult, type FoundEvent } from '../src/services/events/types.ts'
import { MODEL, structured } from './openai.ts'
import { findVenue } from './places.ts'

const CACHE = resolve(REPO_ROOT, '.cache/events')
/** Live event data is re-checked after a day. */
const TTL_MS = 24 * 60 * 60 * 1000
/** Pages read per search. */
const MAX_PAGES = 4
/** Characters of a page the model is shown. Schedules are long. */
const PAGE_CHARS = 16_000

/**
 * Where a destination is, so a venue found for it can be checked to be in it. A
 * league schedule lists every ground in the country; a game at Koshien is not a game
 * in Tokyo, however the page words it.
 */
const DESTINATION_CENTRES: Record<string, { lat: number; lng: number; radiusKm: number }> = {
  Tokyo: { lat: 35.6812, lng: 139.7671, radiusKm: 30 },
}

function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

/** Official sources first: leagues, clubs, venues, ticketing. */
const OFFICIAL_HOSTS = [
  'npb.jp', 'giants.jp', 'yakult-swallows.co.jp', 'tokyo-dome.co.jp', 'jingu-stadium.com',
  'sumo.or.jp', 'jleague.jp', 'kabuki-bito.jp', 't.pia.jp', 'eplus.jp', 'l-tike.com',
]

/**
 * Official pages code can name without searching: a league's own monthly schedule.
 * Web search is not repeatable — one run returned the October page and the next did
 * not — so where the official source has a stable address, it is always read.
 */
const OFFICIAL_PAGES: Record<string, (month: { year: number; month: number }) => string> = {
  baseball: ({ year, month }) => `https://npb.jp/games/${year}/schedule_${String(month).padStart(2, '0')}_detail.html`,
}

function monthsBetween(startDate: string, endDate: string): Array<{ year: number; month: number }> {
  const months: Array<{ year: number; month: number }> = []
  let year = Number(startDate.slice(0, 4))
  let month = Number(startDate.slice(5, 7))
  const lastYear = Number(endDate.slice(0, 4))
  const lastMonth = Number(endDate.slice(5, 7))
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    months.push({ year, month })
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return months
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The ways a page writes a date: 9/29, 9月29日, September 29, 2026-09-29. */
function dateForms(date: string): string[] {
  const month = Number(date.slice(5, 7))
  const day = Number(date.slice(8, 10))
  return [date, `${month}/${day}`, `${month}月${day}日`, `${MONTH_NAMES[month - 1]} ${day}`, `${MONTH_NAMES[month - 1].slice(0, 3)} ${day}`]
}

const QUERY: Record<string, string> = {
  baseball: 'NPB professional baseball games at Tokyo Dome and Meiji Jingu Stadium',
  sumo: 'Grand Sumo tournament days at Ryogoku Kokugikan',
  football: 'J.League football matches in Tokyo',
  concert: 'concerts in Tokyo',
  kabuki: 'kabuki performances at Kabukiza',
  festival: 'festivals (matsuri) in Tokyo',
}

function cachePath(area: string, key: unknown): string {
  const hash = createHash('sha1').update(JSON.stringify(key)).digest('hex').slice(0, 16)
  return join(CACHE, area, `${hash}.json`)
}

function fresh<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined
  try {
    const cached = JSON.parse(readFileSync(file, 'utf8')) as { at: number; value: T }
    return Date.now() - cached.at < TTL_MS ? cached.value : undefined
  } catch {
    return undefined
  }
}

function keep(file: string, value: unknown): void {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify({ at: Date.now(), value }, null, 2))
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

async function searchPages(query: string): Promise<Array<{ url: string; title?: string }>> {
  const key = envOrThrow('OPENAI_API_KEY', 'event search')
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      tools: [{ type: 'web_search' }],
      include: ['web_search_call.action.sources'],
      input: query,
    }),
  })
  if (!res.ok) throw new Error(`web search ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const body = (await res.json()) as {
    output: Array<{
      action?: { sources?: Array<{ url?: string; title?: string }> }
      content?: Array<{ annotations?: Array<{ type: string; url?: string; title?: string }> }>
    }>
  }
  const found: Array<{ url: string; title?: string }> = []
  for (const item of body.output) {
    for (const source of item.action?.sources ?? []) if (source.url) found.push({ url: source.url, title: source.title })
    for (const part of item.content ?? []) {
      for (const note of part.annotations ?? []) {
        if (note.type === 'url_citation' && note.url) found.push({ url: note.url, title: note.title })
      }
    }
  }
  const seen = new Set<string>()
  return found
    .map((entry) => ({ ...entry, url: cleanUrl(entry.url) }))
    .filter((entry) => !isBlocked(entry.url) && !seen.has(entry.url) && seen.add(entry.url))
    .sort((a, b) => Number(!OFFICIAL_HOSTS.some((host) => hostOf(b.url).endsWith(host))) - Number(!OFFICIAL_HOSTS.some((host) => hostOf(a.url).endsWith(host))))
}

async function readPage(url: string): Promise<{ title?: string; text: string } | undefined> {
  const file = cachePath('pages', url)
  const cached = fresh<{ title?: string; text: string } | null>(file)
  if (cached !== undefined) return cached ?? undefined
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
        'Accept-Language': 'en,ja;q=0.8',
      },
    })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) {
      keep(file, null)
      return undefined
    }
    const page = pageText(await res.text())
    keep(file, page)
    return page
  } catch {
    return undefined
  }
}

const normalise = (text: string) => text.replace(/\s+/g, ' ').trim()

interface Extracted {
  events: Array<{ date: string; start: string; title: string; venue: string; quote: string }>
}

async function extract(input: {
  text: string
  activity: string
  startDate: string
  endDate: string
}): Promise<Extracted['events']> {
  const output = await structured<Extracted>(
    `You list scheduled ${input.activity} events that appear on ONE web page.
Use only the page text. Never add an event, date, time, team or venue the page does not state.
Only events dated from ${input.startDate} to ${input.endDate} inclusive, held in Tokyo.
For each event:
- date: YYYY-MM-DD
- start: HH:MM, 24-hour, exactly as the page gives it
- title: who or what, e.g. "Giants vs Tigers"
- venue: the venue name as the page gives it
- quote: the exact text from the page that shows this event's date or time and title,
  copied character for character (at most 200 characters)
If the page lists no such events, return an empty list.`,
    input.text,
    {
      type: 'object',
      additionalProperties: false,
      required: ['events'],
      properties: {
        events: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['date', 'start', 'title', 'venue', 'quote'],
            properties: {
              date: { type: 'string' },
              start: { type: 'string' },
              title: { type: 'string' },
              venue: { type: 'string' },
              quote: { type: 'string' },
            },
          },
        },
      },
    },
    'events_on_page',
  )
  return output.events
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = Math.min(23 * 60 + 59, h * 60 + m + minutes)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Code's checks on one extracted event. Everything a traveller will rely on must be
 * on the page: the quoted line, the time inside it, the venue somewhere on it.
 */
export function verifiedOnPage(
  event: Extracted['events'][number],
  pageTextValue: string,
  range: { startDate: string; endDate: string },
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date) || event.date < range.startDate || event.date > range.endDate) return false
  // A reserve date may never be played, and a cancelled one will not be.
  if (/予備|中止|延期|reserve|postponed|cancel/i.test(`${event.title} ${event.quote}`)) return false
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(event.start)) return false
  const page = normalise(pageTextValue)
  const quote = normalise(event.quote)
  if (quote.length < 8 || !page.includes(quote)) return false
  const [hour, minute] = event.start.split(':')
  const timeInQuote =
    quote.includes(event.start) ||
    quote.includes(`${Number(hour)}:${minute}`) ||
    quote.includes(`${Number(hour)}時`)
  if (!timeInQuote) return false
  // The date must be in the line too, so an event cannot be put on the wrong day.
  if (!dateForms(event.date).some((form) => quote.includes(form))) return false
  return event.venue.trim().length > 1 && page.toLowerCase().includes(event.venue.trim().toLowerCase())
}

export async function findEvents(
  input: {
    activity: string
    destination: string
    startDate: string
    endDate: string
  },
  /** Receives one line per step — pages tried, events extracted, checks failed. */
  trace?: (line: string) => void,
): Promise<EventSearchResult> {
  const resultFile = cachePath('results', input)
  const cached = fresh<EventSearchResult>(resultFile)
  if (cached) return cached

  const searchedAt = new Date().toISOString()
  const subject = QUERY[input.activity] ?? `${input.activity} events in ${input.destination}`
  const pages = await searchPages(
    `${subject} between ${input.startDate} and ${input.endDate}. Official schedule pages with dates, start times and venues.`,
  )

  const events: FoundEvent[] = []
  const seen = new Set<string>()
  trace?.(`search found ${pages.length} pages: ${pages.map((page) => page.url).join(' , ')}`)
  const official = OFFICIAL_PAGES[input.activity]
  const toRead = [
    ...(official ? monthsBetween(input.startDate, input.endDate).map((month) => ({ url: official(month), title: undefined })) : []),
    ...pages.slice(0, MAX_PAGES),
  ].filter((page, index, all) => all.findIndex((other) => other.url === page.url) === index)
  for (const candidate of toRead) {
    const page = await readPage(candidate.url)
    if (!page || page.text.length < 200) {
      trace?.(`skip ${candidate.url}: ${page ? `only ${page.text.length} chars` : 'could not read'}`)
      continue
    }
    const text = page.text.slice(0, PAGE_CHARS)
    const extracted = await extract({ text, activity: input.activity, startDate: input.startDate, endDate: input.endDate })
    trace?.(`${candidate.url}: ${page.text.length} chars, ${extracted.length} events extracted`)
    for (const event of extracted) {
      if (!verifiedOnPage(event, text, input)) {
        trace?.(`  rejected ${JSON.stringify(event)}`)
        continue
      }
      const key = `${event.date}|${event.start}|${event.venue.toLowerCase()}`
      if (seen.has(key)) continue
      const place = await findVenue({ name: event.venue, destination: input.destination })
      if (!place) {
        trace?.(`  "${event.venue}" is not a venue Places can place in ${input.destination}`)
        continue
      }
      const centre = DESTINATION_CENTRES[input.destination]
      if (centre && kmBetween(centre, place) > centre.radiusKm) {
        trace?.(`  "${event.venue}" is ${Math.round(kmBetween(centre, place))} km from ${input.destination}; not in it`)
        continue
      }
      seen.add(key)
      events.push({
        id: createHash('sha1').update(key).digest('hex').slice(0, 10),
        title: event.title.trim(),
        activity: input.activity,
        date: event.date,
        start: event.start,
        end: addMinutes(event.start, TYPICAL_EVENT_MINUTES[input.activity] ?? 150),
        endEstimated: true,
        venue: { name: place.name, lat: place.lat, lng: place.lng, neighborhood: place.address || place.name },
        sourceUrl: candidate.url,
        ...(candidate.title ?? page.title ? { sourceTitle: candidate.title ?? page.title } : {}),
        fetchedAt: searchedAt,
      })
    }
  }

  events.sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))
  const result: EventSearchResult = {
    events,
    searchedAt,
    recorded: false,
    ...(events.length === 0
      ? { note: `I looked for ${input.activity} in ${input.destination} from ${input.startDate} to ${input.endDate} and found nothing I could confirm on an official page.` }
      : {}),
  }
  keep(resultFile, result)
  return result
}
