/**
 * Area discovery (eval R1, 2026-09-30).
 *
 * "Showa-era literary atmosphere, old bookstores, kissaten" used to be searched only
 * as "Kuramae <category>". It now also searches the neighbourhoods that ARE that —
 * chosen from a code-owned table, within reach, centred on the area.
 */

import { describe, expect, it } from 'vitest'

import { areaQueries, MAX_DISCOVERY_AREAS } from '../../src/application/planning/queryPlan.ts'
import { retrievePlaces, type PlacesSearcher } from '../../src/application/planning/retrievePlaces.ts'
import { areasFor, charactersIn, TOKYO_AREAS } from '../../src/domain/places/areas.ts'

const KURAMAE = { lat: 35.704, lng: 139.791 }
const R1 = 'Showa-era literary and cultural atmosphere\nslow neighborhood exploration\nold bookstores\nkissaten\nsmall independent cultural places'

describe('reading what kind of neighbourhood is wanted', () => {
  it('maps the traveller’s words onto area characters, in three languages', () => {
    expect(charactersIn(R1)).toEqual(expect.arrayContaining(['showa', 'literary', 'used_books', 'kissaten', 'independent']))
    expect(charactersIn('想逛昭和風的舊書店和喫茶店')).toEqual(expect.arrayContaining(['showa', 'used_books', 'kissaten']))
    expect(charactersIn('Sushi and nightlife')).toEqual([])
  })

  it('ranks the areas that match most first, nearest breaking ties', () => {
    const ranked = areasFor(charactersIn(R1), KURAMAE).map((entry) => entry.area.id)
    expect(ranked[0]).toBe('jimbocho')
    expect(ranked.slice(0, 4)).toEqual(expect.arrayContaining(['jimbocho', 'yanaka']))
  })
})

describe('areaQueries', () => {
  it('searches the best areas for what makes them what they are', () => {
    const queries = areaQueries({ ownWords: R1, lodging: KURAMAE })
    const areas = [...new Set(queries.map((query) => query.area!.id))]
    expect(areas.length).toBeLessThanOrEqual(MAX_DISCOVERY_AREAS)
    expect(areas).toContain('jimbocho')
    expect(queries.map((query) => query.textQuery)).toContain('Jimbocho bookstore')
    expect(queries.every((query) => query.servesWords && query.servesWords.length > 0)).toBe(true)
  })

  it('only ever names an area from the table', () => {
    const known = new Set(TOKYO_AREAS.map((area) => area.id))
    for (const query of areaQueries({ ownWords: R1, lodging: KURAMAE })) expect(known.has(query.area!.id)).toBe(true)
  })

  it('skips the area the lodging is already in, and areas out of reach', () => {
    const near = areaQueries({ ownWords: 'craft and coffee', lodging: KURAMAE })
    expect(near.some((query) => query.area!.id === 'kuramae')).toBe(false)
    const tight = areaQueries({ ownWords: 'vintage and live music', lodging: KURAMAE, radiusMetres: 3000 })
    expect(tight.some((query) => ['koenji', 'shimokitazawa'].includes(query.area!.id))).toBe(false)
  })

  it('leaves out a category the trip avoids, and adds nothing when no character is asked for', () => {
    expect(areaQueries({ ownWords: R1, lodging: KURAMAE, excluded: ['bookstore'] }).some((query) => query.category === 'bookstore')).toBe(false)
    expect(areaQueries({ ownWords: 'Good food', lodging: KURAMAE })).toEqual([])
  })

  it('uses a confirmed neighbourhood memory even when the words do not say it', () => {
    const queries = areaQueries({ ownWords: 'Slow week', lodging: KURAMAE, remembered: ['literary'] })
    expect(queries.some((query) => query.area!.id === 'jimbocho' || query.area!.id === 'hongo')).toBe(true)
  })
})

describe('retrievePlaces with an area search', () => {
  it('centres the area search on the area, the rest on the lodging', async () => {
    const seen: Array<{ textQuery: string; bias?: { lat: number; lng: number } }> = []
    const searcher: PlacesSearcher = {
      async search(requests) {
        seen.push(...requests)
        return { results: requests.map((request) => ({ textQuery: request.textQuery, places: [] })), calls: requests.length, fromCache: 0 }
      },
    }
    const [area] = areaQueries({ ownWords: R1, lodging: KURAMAE })
    await retrievePlaces({
      queries: [{ category: 'sushi', retrieve: 3, textQuery: 'Kuramae sushi', source: 'default', preferred: false, addedByModel: false }, area],
      lodging: { ...KURAMAE, matchedAddress: 'Kuramae' },
      searcher,
    })
    expect(seen[0].bias).toMatchObject({ lat: KURAMAE.lat, lng: KURAMAE.lng })
    expect(seen[1].bias).toMatchObject({ lat: area.area!.lat, lng: area.area!.lng })
  })
})
