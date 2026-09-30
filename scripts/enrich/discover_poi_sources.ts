/**
 * Where a place is described, found by web search and judged by code (spec §10).
 *
 * The search is OpenAI's `web_search` tool — the key the repository already holds,
 * rather than a second search provider. It is used to FIND pages and nothing else:
 * the URLs are read from the structured citations and source list the API returns,
 * never from text the model wrote, and every one is then classified, ranked and
 * (in `fetch_poi_evidence`) fetched and checked by code.
 *
 * The query is built from the place alone — name, neighbourhood, Tokyo. No trip
 * Intent or Memory goes in: a brief is reused by every trip (§10.1).
 */

import { envOrThrow } from '../preprocess/env.ts'
import { MODEL } from '../../server/openai.ts'
import type { PoiSourceType } from '../../src/services/places/poiBrief.ts'
import { fileSafe, readCache, writeCache } from './cache.ts'
import type { PlaceDetails } from './fetch_place_details.ts'

export interface CandidateSource {
  url: string
  type: PoiSourceType
  title?: string
}

/** Pages that do not describe a place, or cannot be read without signing in. */
const BLOCKED_HOSTS = [
  'google.', 'goo.gl', 'maps.app.goo.gl',
  'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'tiktok.com', 'youtube.com',
  'pinterest.', 'reddit.com', 'threads.net', 'linkedin.com',
  'tripadvisor.', 'yelp.', 'booking.com', 'agoda.', 'expedia.', 'hotels.com', 'trip.com',
  'klook.com', 'kkday.com', 'getyourguide.', 'viator.com',
  'wanderlog.com', 'foursquare.com', 'restaurantguru.', 'mapcarta.com',
]

/** National and city tourism bodies. */
const TOURISM_HOSTS = ['gotokyo.org', 'japan.travel', 'jnto.go.jp', 'visit-chuo.jp', 'taitonavi.jp', 'kanko-sumida.jp']

/** Editorial and travel publications with their own writers and editors. */
const EDITORIAL_HOSTS = [
  'timeout.com', 'timeout.jp', 'japan-guide.com', 'tokyocheapo.com', 'tokyoweekender.com',
  'cntraveler.com', 'guide.michelin.com', 'nytimes.com', 'theguardian.com', 'eater.com',
  'lonelyplanet.com', 'japantimes.co.jp', 'savorjapan.com', 'matcha-jp.com', 'metropolisjapan.com',
  'spoon-tamago.com', 'designboom.com', 'dezeen.com', 'wallpaper.com', 'monocle.com',
  'artnet.com', 'artforum.com', 'tokyoartbeat.com', 'casabrutus.com', 'brutus.jp', 'popeyemagazine.jp',
  'nippon.com', 'jw-webmagazine.com', 'livejapan.com', 'gltjp.com', 'tabemono.info',
]

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return undefined
  }
}

function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`) || (domain.endsWith('.') && host.includes(domain))
}

/** Tracking parameters off, so the same page is the same URL. */
export function cleanUrl(url: string): string {
  try {
    const parsed = new URL(url)
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith('utm_') || key === 'fbclid' || key === 'gclid') parsed.searchParams.delete(key)
    }
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return url
  }
}

export function isBlocked(url: string): boolean {
  const host = hostOf(url)
  return host === undefined || BLOCKED_HOSTS.some((domain) => hostIs(host, domain))
}

/**
 * What kind of source a URL is, from its host alone. Code decides this, never the
 * model (§15: source metadata comes from code).
 */
export function classifySource(url: string, officialUrl: string | undefined): PoiSourceType {
  const host = hostOf(url) ?? ''
  const officialHost = officialUrl ? hostOf(officialUrl) : undefined
  if (officialHost && (host === officialHost || host.endsWith(`.${officialHost}`))) {
    return 'official_website'
  }
  if (TOURISM_HOSTS.some((domain) => hostIs(host, domain))) return 'official_tourism'
  if (/\.(lg|go|ac)\.jp$/.test(host) || host.endsWith('.gov')) return 'institutional'
  if (EDITORIAL_HOSTS.some((domain) => hostIs(host, domain))) return 'editorial'
  return 'other_trusted'
}

const TYPE_RANK: Record<PoiSourceType, number> = {
  official_website: 0,
  official_tourism: 1,
  institutional: 1,
  editorial: 2,
  other_trusted: 3,
}

interface SearchCache {
  query: string
  urls: Array<{ url: string; title?: string }>
}

/** Runs the web search, or answers from cache. */
async function searchWeb(query: string, cacheId: string): Promise<SearchCache> {
  const cached = readCache<SearchCache>('search', cacheId)
  if (cached && cached.query === query) return cached

  const key = envOrThrow('OPENAI_API_KEY', 'POI enrichment')
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
      type: string
      action?: { sources?: Array<{ url?: string; title?: string }> }
      content?: Array<{ annotations?: Array<{ type: string; url?: string; title?: string }> }>
    }>
  }

  const urls: SearchCache['urls'] = []
  for (const item of body.output) {
    for (const source of item.action?.sources ?? []) {
      if (source.url) urls.push({ url: source.url, ...(source.title ? { title: source.title } : {}) })
    }
    for (const part of item.content ?? []) {
      for (const note of part.annotations ?? []) {
        if (note.type === 'url_citation' && note.url) {
          urls.push({ url: note.url, ...(note.title ? { title: note.title } : {}) })
        }
      }
    }
  }

  const result = { query, urls }
  writeCache('search', cacheId, result)
  return result
}

export function searchQueryFor(place: { name: string; neighborhood: string }, details: PlaceDetails): string {
  const names = details.nameJa && details.nameJa !== place.name ? `"${place.name}" (${details.nameJa})` : `"${place.name}"`
  return (
    `Find the official website and trusted descriptive sources (official tourism, institutional, ` +
    `or reputable editorial) about ${names}, ${place.neighborhood}, Tokyo` +
    (details.address ? ` — address ${details.address}` : '') +
    `. What is it, its concept, history or specialty? Cite the pages.`
  )
}

/**
 * Candidate sources for one place, best first: the official site, then the most
 * authoritative of the rest. More candidates than will be used, because some will
 * not load or will turn out not to be about this place.
 */
export async function discoverSources(
  place: { placeId: string; name: string; neighborhood: string },
  details: PlaceDetails,
): Promise<{ query: string; candidates: CandidateSource[] }> {
  const query = searchQueryFor(place, details)
  const found = await searchWeb(query, fileSafe(place.placeId))

  const seen = new Set<string>()
  const candidates: CandidateSource[] = []
  const add = (url: string, title?: string) => {
    const clean = cleanUrl(url)
    if (seen.has(clean) || isBlocked(clean)) return
    seen.add(clean)
    candidates.push({ url: clean, type: classifySource(clean, details.websiteUri), ...(title ? { title } : {}) })
  }

  if (details.websiteUri) add(details.websiteUri)
  for (const entry of found.urls) add(entry.url, entry.title)

  candidates.sort((a, b) => TYPE_RANK[a.type] - TYPE_RANK[b.type])
  return { query, candidates }
}
