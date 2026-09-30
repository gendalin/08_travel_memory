/**
 * The evidence a brief is written from: pages fetched and read by code (spec §10.3).
 *
 * Each candidate page is fetched here, reduced to its text, and tied to the place —
 * by being the website Google lists for it, or by naming it. A page that does neither
 * is not evidence for this place, however relevant it looks: that is how a brief
 * would pick up a same-named business across town.
 *
 * What is kept is compact. The model sees a few thousand characters per page; the
 * stored record keeps a short excerpt. No page copy enters the dataset.
 */

import type { PoiEnrichmentEvidence } from '../../src/services/places/poiBrief.ts'
import { cacheKey, readCache, writeCache } from './cache.ts'
import type { CandidateSource } from './discover_poi_sources.ts'
import type { PlaceDetails } from './fetch_place_details.ts'

/** At most this many sources per place (§10.2). */
export const MAX_SOURCES = 3

/** Characters of a page the model is shown. Enough for an About page. */
const TEXT_FOR_MODEL = 5_000
/** Characters of a page kept in the evidence record. */
const EXCERPT = 600
/** Less text than this and a page has nothing to describe the place with. */
const SUBSTANTIVE = 200

const FETCH_TIMEOUT_MS = 12_000

export interface FetchedEvidence {
  record: PoiEnrichmentEvidence
  /** The page text the model is given. Not stored in the dataset. */
  text: string
}

interface PageCache {
  url: string
  ok: boolean
  title?: string
  text?: string
  reason?: string
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
}

function metaContent(html: string, name: string): string | undefined {
  const pattern = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]*(?:name|property)=["']${name}["']`,
    'i',
  )
  const match = html.match(pattern)
  return match ? decodeEntities(match[1] ?? match[2]).trim() : undefined
}

/**
 * Table rows as single lines, with a date cell that spans several rows written onto
 * each of them.
 *
 * Schedules are tables whose cells wrap each value in its own element, so reading
 * them element by element broke every row into fragments too short to keep — a
 * league's whole month of games came back as 112 characters. A row is one fact (one
 * game: date, teams, ground, time), so it is kept as one line; and a date given once
 * for four rows (`rowspan`) is repeated by code onto the rows it covers, so each line
 * carries its own date.
 */
function flattenTables(html: string): string {
  let carried: { text: string; rows: number } | undefined
  return html.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_, row: string) => {
    const spanned = row.match(/<t[hd][^>]*rowspan=["']?(\d+)["']?[^>]*>([\s\S]*?)<\/t[hd]>/i)
    const cells = row
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    let line = cells
    if (spanned) {
      carried = { text: spanned[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), rows: Number(spanned[1]) - 1 }
    } else if (carried && carried.rows > 0) {
      line = `${carried.text} ${cells}`
      carried.rows -= 1
    }
    return `\n${line}\n`
  })
}

/** A line worth keeping: a sentence, or a short line that carries a time or a date. */
function worthKeeping(line: string): boolean {
  return line.length >= 25 || (line.length >= 8 && /\d{1,2}:\d{2}|\d{1,2}\/\d{1,2}|\d{1,2}月\d{1,2}日/.test(line))
}

/** Page HTML -> title and readable text: description meta first, then the body. */
export function pageText(html: string): { title?: string; text: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const description = metaContent(html, 'description') ?? metaContent(html, 'og:description')

  const body = flattenTables(html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' '))
    .replace(/<(nav|footer|header|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|li|div|section|article|dd|dt|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')

  const lines = decodeEntities(body)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    // Menus and buttons are short; sentences are not — nor is a schedule row.
    .filter(worthKeeping)

  const text = [description, ...lines].filter(Boolean).join('\n')
  return { ...(title ? { title: decodeEntities(title).replace(/\s+/g, ' ').trim() } : {}), text }
}

async function fetchPage(url: string): Promise<PageCache> {
  const cached = readCache<PageCache>('pages', cacheKey(url))
  if (cached) return cached

  let result: PageCache
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
        'Accept-Language': 'en,ja;q=0.8',
        Accept: 'text/html,application/xhtml+xml',
      },
    })
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok) result = { url, ok: false, reason: `HTTP ${res.status}` }
    else if (!type.includes('html')) result = { url, ok: false, reason: `not HTML (${type})` }
    else {
      const { title, text } = pageText(await res.text())
      result = { url, ok: true, ...(title ? { title } : {}), text: text.slice(0, 20_000) }
    }
  } catch (error) {
    result = { url, ok: false, reason: error instanceof Error ? error.message : String(error) }
  }

  writeCache('pages', cacheKey(url), result)
  return result
}

/**
 * The site a URL belongs to: `kifu.artmuseums.go.jp` and `www.artmuseums.go.jp` are
 * one organisation. Japan's second-level domains (go.jp, co.jp, …) keep three labels.
 */
export function siteOf(url: string): string {
  const labels = new URL(url).hostname.toLowerCase().split('.')
  const secondLevel = /^(go|co|ac|or|ne|lg|ed|gr)$/.test(labels[labels.length - 2] ?? '') && labels.at(-1) === 'jp'
  return labels.slice(secondLevel ? -3 : -2).join('.')
}

/** Lower-case, accents off, punctuation to spaces: "Tōmei Bookstore" -> "tomei bookstore". */
export function normaliseName(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Words that say what kind of place it is, not which one. */
const GENERIC_NAME_WORDS = new Set([
  'the', 'of', 'and', 'tokyo', 'japan', 'cafe', 'coffee', 'shop', 'store', 'museum', 'gallery',
  'art', 'book', 'books', 'bookstore', 'shrine', 'temple', 'restaurant', 'bar', 'house', 'main',
  'branch', 'kuramae', 'asakusa', 'ueno', 'ginza', 'shibuya', 'shinjuku', 'national',
])

/**
 * Whether a page names this place: its whole name, its Japanese name, or every
 * distinctive word of its name. Only names that could not belong to any place in
 * the category count — "Tokyo Museum" alone proves nothing.
 */
export function namesPlace(pageText: string, names: string[]): boolean {
  const page = normaliseName(pageText)
  const compactPage = page.replace(/\s+/g, '')
  return names.some((name) => {
    const normal = normaliseName(name)
    if (normal.length < 3) return false
    if (page.includes(normal) || compactPage.includes(normal.replace(/\s+/g, ''))) return true
    const distinctive = normal.split(' ').filter((word) => word.length >= 3 && !GENERIC_NAME_WORDS.has(word))
    return distinctive.length > 0 && distinctive.every((word) => page.includes(word))
  })
}

/**
 * Up to three pieces of evidence for one place, best source first. Candidates that
 * do not load, say too little, or cannot be tied to the place are skipped and
 * reported, not used.
 */
export async function fetchEvidence(input: {
  place: { placeId: string; name: string }
  details: PlaceDetails
  candidates: CandidateSource[]
  now: string
}): Promise<{ evidence: FetchedEvidence[]; skipped: Array<{ url: string; reason: string }> }> {
  const names = [input.place.name, ...(input.details.nameJa ? [input.details.nameJa] : [])]
  const evidence: FetchedEvidence[] = []
  const skipped: Array<{ url: string; reason: string }> = []

  for (const candidate of input.candidates) {
    if (evidence.length >= MAX_SOURCES) break
    // One official page is enough; after it, prefer a different voice.
    if (candidate.type === 'official_website' && evidence.some((entry) => entry.record.sourceType === 'official_website')) {
      continue
    }

    // One page per site: a second page from the same site is the same voice, and
    // is often a listing that names every venue the body runs.
    const site = siteOf(candidate.url)
    if (evidence.some((entry) => siteOf(entry.record.sourceUrl) === site)) {
      skipped.push({ url: candidate.url, reason: 'another page from a site already used' })
      continue
    }

    const page = await fetchPage(candidate.url)
    if (!page.ok || !page.text) {
      skipped.push({ url: candidate.url, reason: page.reason ?? 'no text' })
      continue
    }
    if (page.text.length < SUBSTANTIVE) {
      skipped.push({ url: candidate.url, reason: `too little text (${page.text.length} chars)` })
      continue
    }

    const official = candidate.type === 'official_website'
    if (!official && !namesPlace(`${page.title ?? ''}\n${page.text}`, names)) {
      skipped.push({ url: candidate.url, reason: 'does not name this place' })
      continue
    }

    const title = candidate.title ?? page.title
    evidence.push({
      record: {
        poiId: input.place.placeId,
        sourceUrl: candidate.url,
        sourceType: candidate.type,
        ...(title ? { title } : {}),
        extractedSummary: page.text.slice(0, EXCERPT),
        fetchedAt: input.now,
        identity: official ? 'official_website' : 'name_on_page',
      },
      text: page.text.slice(0, TEXT_FOR_MODEL),
    })
  }

  return { evidence, skipped }
}
