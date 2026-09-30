/**
 * Two small eval fixes (2026-09-30): a retrieved place whose own name says what it is
 * is filed under that, and "No taxis." is a structured constraint rather than a
 * ranking word.
 */

import { describe, expect, it } from 'vitest'

import { tagConsidering } from '../../src/application/decompose/tagConsidering.ts'
import { stateTerms } from '../../src/application/planning/rankCandidates.ts'
import { categoryNamedIn, resolveCategory } from '../../src/services/places/retrieval.ts'
import { createPlaceCatalogue } from '../../src/services/places/catalogue.ts'

describe('categoryNamedIn', () => {
  it('reads one unambiguous kind of place from a name', () => {
    expect(categoryNamedIn('Soba Udon Monju Asakusa Branch')).toBe('soba_udon')
    expect(categoryNamedIn('WESTSIDE COFFEE KURAMAE')).toBe('cafe_kissaten')
    expect(categoryNamedIn('Okuramae Shobō')).toBe('bookstore')
  })

  it('decides nothing when a name names two kinds, or none', () => {
    expect(categoryNamedIn('Neko Naraku Cafe & Bar')).toBeUndefined()
    expect(categoryNamedIn('Kuramae Park')).toBeUndefined()
  })

  it('wins over a Google type that disagrees', () => {
    expect(resolveCategory({ displayName: { text: 'Soba Udon Monju' }, primaryType: 'bar', types: ['bar'] } as never)).toEqual({
      category: 'soba_udon',
      from: 'name',
    })
  })
})

describe('"No taxis."', () => {
  const empty = createPlaceCatalogue([])
  it('is tagged as a transport constraint', () => {
    expect(tagConsidering('No taxis.', empty)).toEqual({ kind: 'transport', avoid: 'taxi' })
  })

  it('no longer leaks "taxis" into ranking terms', () => {
    const state = {
      version: 1,
      intent: [{ id: 'i', text: 'Explore slowly' }],
      considering: [{ id: 'c', text: 'No taxis.', tag: tagConsidering('No taxis.', empty) }],
      priorities: [],
    }
    expect(stateTerms(state)).not.toContain('taxis')
  })
})
