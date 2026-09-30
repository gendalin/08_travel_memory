/**
 * POI enrichment — the parts decided by code, tested offline (poi_enrichment_spec).
 *
 * The model writes the prose; code decides which pages count as sources, what kind
 * of source each is, whether a page is about this place at all, and how much
 * confidence the evidence can carry. Those decisions are what these tests hold.
 */

import { describe, expect, it } from 'vitest'

import {
  classifySource,
  cleanUrl,
  isBlocked,
} from '../../scripts/enrich/discover_poi_sources.ts'
import { namesPlace, pageText, siteOf, type FetchedEvidence } from '../../scripts/enrich/fetch_poi_evidence.ts'
import { confidenceCap, SIGNAL_VOCABULARY } from '../../scripts/enrich/generate_poi_brief.ts'
import { validatePoiEnrichment, type PoiBrief } from '../../src/services/places/poiBrief.ts'

describe('what kind of source a page is — decided by code, from its host', () => {
  const official = 'https://www.2121designsight.jp/'

  it('the website Google lists for the place is its official site, subdomains included', () => {
    expect(classifySource('https://www.2121designsight.jp/en/about/', official)).toBe('official_website')
    expect(classifySource('https://shop.2121designsight.jp/', official)).toBe('official_website')
  })

  it('tourism bodies, public institutions and editorial publications are told apart', () => {
    expect(classifySource('https://www.gotokyo.org/en/spot/123/index.html', official)).toBe('official_tourism')
    expect(classifySource('https://www.city.taito.lg.jp/bunka/index.html', official)).toBe('institutional')
    expect(classifySource('https://www.timeout.com/tokyo/things-to-do/x', official)).toBe('editorial')
    expect(classifySource('https://someblog.example.com/post', official)).toBe('other_trusted')
  })

  it('never uses review aggregators, social media or maps as a source', () => {
    for (const url of [
      'https://www.tripadvisor.com/Attraction_Review-g1',
      'https://www.instagram.com/koncent/',
      'https://www.google.com/maps/place/x',
      'https://www.yelp.com/biz/x',
    ]) {
      expect(isBlocked(url)).toBe(true)
    }
    expect(isBlocked('https://www.2121designsight.jp/')).toBe(false)
  })

  it('drops tracking parameters, so one page is one URL', () => {
    expect(cleanUrl('https://www.tnm.jp/?lang=en&utm_source=openai#top')).toBe('https://www.tnm.jp/?lang=en')
  })

  it('groups subdomains of one organisation as one site', () => {
    expect(siteOf('https://kifu.artmuseums.go.jp/en/x')).toBe('artmuseums.go.jp')
    expect(siteOf('https://www.artmuseums.go.jp/en/y')).toBe('artmuseums.go.jp')
    expect(siteOf('https://visit-chiyoda.tokyo/app/spot/1')).toBe('visit-chiyoda.tokyo')
  })
})

describe('reading a page', () => {
  it('keeps the description and sentences, not scripts, menus or buttons', () => {
    const { title, text } = pageText(`
      <html><head><title>About | Okuramae Shobō</title>
      <meta name="description" content="A secondhand bookshop in Kuramae since 2015.">
      <script>var tracking = 1;</script></head>
      <body><nav><a>Home</a><a>Shop</a></nav>
      <p>We stock art books, photography and small-press zines from across Japan.</p>
      <button>OK</button></body></html>`)
    expect(title).toBe('About | Okuramae Shobō')
    expect(text).toContain('A secondhand bookshop in Kuramae since 2015.')
    expect(text).toContain('small-press zines')
    expect(text).not.toContain('tracking')
    expect(text).not.toContain('Home')
  })
})

describe('whether a page is about this place', () => {
  it('matches the whole name, accents and punctuation aside', () => {
    expect(namesPlace('Visit TOMEI BOOKSTORE in Kuramae', ['Tōmei Bookstore'])).toBe(true)
    expect(namesPlace('21_21 DESIGN SIGHT is a design museum', ['21_21 Design Sight'])).toBe(true)
  })

  it('matches the Japanese name, written without spaces', () => {
    expect(namesPlace('神田明神は東京の神社です', ['Kanda Myoujin Shrine', '神田明神'])).toBe(true)
  })

  it('does not accept a page that only shares generic words with the name', () => {
    expect(namesPlace('The best museums in Tokyo', ['Tokyo Origami Museum'])).toBe(false)
    expect(namesPlace('A guide to Kuramae cafes', ['Kissa Hangetsu'])).toBe(false)
  })
})

describe('how much confidence the evidence can carry', () => {
  const evidence = (type: FetchedEvidence['record']['sourceType'], chars: number): FetchedEvidence => ({
    record: {
      poiId: 'p', sourceUrl: `https://${type}.example/`, sourceType: type,
      extractedSummary: '', fetchedAt: '', identity: 'name_on_page',
    },
    text: 'x'.repeat(chars),
  })

  it('high needs an official, tourism or institutional page with real content', () => {
    expect(confidenceCap([evidence('official_website', 1200)])).toBe('high')
    expect(confidenceCap([evidence('institutional', 1200)])).toBe('high')
    expect(confidenceCap([evidence('editorial', 3000)])).toBe('medium')
  })

  it('a single thin page can only be low', () => {
    expect(confidenceCap([evidence('other_trusted', 250)])).toBe('low')
  })
})

describe('validation (§16)', () => {
  const brief: PoiBrief = {
    overview: 'A secondhand bookshop.',
    atmosphere: [],
    knownFor: ['art books'],
    goodFor: ['browsing'],
    decisionSignals: { cultural: ['independent'], experience: ['browsing'], setting: [], mainstreamness: 'low' },
    descriptionSources: [{ url: 'https://okuramae.example/about', type: 'official_website' }],
    descriptionConfidence: 'high',
  }
  const backing = [{
    poiId: 'p1', sourceUrl: 'https://okuramae.example/about', sourceType: 'official_website' as const,
    extractedSummary: '…', fetchedAt: '2026-09-29', identity: 'official_website' as const,
  }]

  it('passes a complete brief backed by evidence for this place', () => {
    const issues = validatePoiEnrichment({ placeId: 'p1', shortDescription: 'A bookshop.', brief, evidence: backing })
    expect(issues.filter((issue) => issue.level === 'error')).toEqual([])
  })

  it('fails a source that is evidence for another POI', () => {
    const issues = validatePoiEnrichment({
      placeId: 'p1', shortDescription: 'A bookshop.', brief,
      evidence: [{ ...backing[0], poiId: 'p2' }],
    })
    expect(issues.some((issue) => issue.level === 'error' && issue.message.startsWith('source not backed'))).toBe(true)
  })

  it('fails empty text, bad URLs, unknown types and missing confidence', () => {
    const broken = {
      ...brief,
      overview: '',
      descriptionSources: [{ url: 'not a url', type: 'blog' as never }],
      descriptionConfidence: undefined as never,
    }
    const messages = validatePoiEnrichment({ placeId: 'p1', shortDescription: '', brief: broken, evidence: [] })
      .filter((issue) => issue.level === 'error')
      .map((issue) => issue.message)
    expect(messages).toEqual(expect.arrayContaining([
      'empty shortDescription', 'empty overview', 'missing confidence',
      'invalid source URL "not a url"', 'unsupported source type "blog"',
    ]))
  })
})

describe('the decision-signal vocabulary', () => {
  it('is snake_case and never repeats a tag across groups', () => {
    const tags = Object.values(SIGNAL_VOCABULARY).flatMap((group) => Object.keys(group))
    for (const tag of tags) expect(tag).toMatch(/^[a-z]+(_[a-z]+)*$/)
    expect(new Set(tags).size).toBe(tags.length)
  })
})
