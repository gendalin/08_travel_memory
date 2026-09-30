/**
 * Typed Memory (product_spec §10, §10.4's deferred evidence weighting).
 *
 * The behaviour this replaces: preference extraction read a bare category off the
 * provenance record and dropped every memory that had none — which discarded the
 * pace memory in its entirety, and there was a passing test asserting it did.
 */

import { describe, expect, it } from 'vitest'

import {
  categoryPreferences,
  claimsAllowed,
  DEFAULT_CLAIM_DAYS,
  planShape,
} from '../../src/domain/memory/preferences.ts'
import { createMemorySnapshot } from '../../src/domain/memory/snapshot.ts'
import type { Memory, MemorySubject } from '../../src/domain/memory/types.ts'
import { memory } from './fixtures.ts'

function active(overrides: Partial<Memory> & Pick<Memory, 'id'>): Memory {
  return memory({ status: 'active', ...overrides })
}

function snapshotOf(memories: Memory[]) {
  return createMemorySnapshot('trip_1', memories, '2026-09-01T00:00:00.000Z')
}

const category = (value: string): MemorySubject => ({ facet: 'category', value })

describe('categoryPreferences', () => {
  it('reads the subject rather than parsing a provenance string', () => {
    const snapshot = snapshotOf([active({ id: 'm1', subject: category('izakaya') })])
    expect(categoryPreferences(snapshot)).toEqual([
      { category: 'izakaya', memoryId: 'm1', weight: 0.7 },
    ])
  })

  /**
   * §10.2 allows confidence for candidate ordering and inference quality. Planning
   * weight is a third use it does not list, and the two numbers answer different
   * questions: how much does the traveller care, versus how sure are we.
   */
  it('weights by strength, not confidence', () => {
    const snapshot = snapshotOf([active({ id: 'm1', strength: 0.2, confidence: 0.95 })])
    expect(categoryPreferences(snapshot)[0].weight).toBe(0.2)
  })

  it('signs the weight by polarity, so an aversion needs no separate mechanism', () => {
    const snapshot = snapshotOf([
      active({ id: 'likes', subject: category('sushi'), strength: 0.8, polarity: 1 }),
      active({ id: 'avoids', subject: category('ramen'), strength: 0.6, polarity: -1 }),
    ])
    expect(categoryPreferences(snapshot)).toEqual([
      { category: 'sushi', memoryId: 'likes', weight: 0.8 },
      { category: 'ramen', memoryId: 'avoids', weight: -0.6 },
    ])
  })

  it('orders by absolute weight, so a strong aversion is as decisive as a strong liking', () => {
    const snapshot = snapshotOf([
      active({ id: 'mild', subject: category('sushi'), strength: 0.3 }),
      active({ id: 'strong_aversion', subject: category('ramen'), strength: 0.9, polarity: -1 }),
    ])
    expect(categoryPreferences(snapshot).map((entry) => entry.memoryId)).toEqual([
      'strong_aversion',
      'mild',
    ])
  })

  it('leaves out kinds that do not act by ranking', () => {
    const snapshot = snapshotOf([
      active({ id: 'pace', kind: 'pattern', subject: { facet: 'stops_per_day', value: 3 } }),
      active({ id: 'pref', subject: category('sushi') }),
    ])
    expect(categoryPreferences(snapshot).map((entry) => entry.memoryId)).toEqual(['pref'])
  })

  it('leaves out a preference about a facet other than category', () => {
    const snapshot = snapshotOf([
      active({ id: 'cheap', subject: { facet: 'price_band', value: 'budget' } }),
    ])
    expect(categoryPreferences(snapshot)).toEqual([])
  })
})

describe('planShape', () => {
  it('is empty without a snapshot', () => {
    expect(planShape(undefined)).toEqual({})
  })

  it('reads each measured pattern, carrying the memory behind it', () => {
    const snapshot = snapshotOf([
      active({ id: 'pace', kind: 'pattern', subject: { facet: 'stops_per_day', value: 3 }, strength: 0.67 }),
      active({ id: 'span', kind: 'pattern', subject: { facet: 'day_span_metres', value: 5578 }, strength: 0.33 }),
      active({ id: 'start', kind: 'pattern', subject: { facet: 'start_minutes', value: 540 }, strength: 0.5 }),
    ])

    expect(planShape(snapshot)).toEqual({
      stopsPerDay: { value: 3, memoryId: 'pace', strength: 0.67 },
      daySpanMetres: { value: 5578, memoryId: 'span', strength: 0.33 },
      startMinutes: { value: 540, memoryId: 'start', strength: 0.5 },
    })
  })

  it('prefers the more consistent measurement when two describe the same thing', () => {
    const snapshot = snapshotOf([
      active({ id: 'shaky', kind: 'pattern', subject: { facet: 'stops_per_day', value: 6 }, strength: 0.2 }),
      active({ id: 'steady', kind: 'pattern', subject: { facet: 'stops_per_day', value: 3 }, strength: 0.9 }),
    ])
    expect(planShape(snapshot).stopsPerDay).toEqual({ value: 3, memoryId: 'steady', strength: 0.9 })
  })

  it('ignores a preference, however category-like its subject', () => {
    const snapshot = snapshotOf([active({ id: 'pref', kind: 'preference' })])
    expect(planShape(snapshot)).toEqual({})
  })
})

describe('claimsAllowed', () => {
  it('derives the bound from the memory own observed rate', () => {
    const twiceAWeek = active({ id: 'm1', scope: { ratePerDay: 0.4 } })
    expect(claimsAllowed(twiceAWeek, 5)).toBe(2)
    expect(claimsAllowed(twiceAWeek, 10)).toBe(4)
  })

  it('falls back to the shared heuristic when the memory has no rate', () => {
    const noRate = active({ id: 'm1' })
    expect(claimsAllowed(noRate, 6)).toBe(Math.round(6 / DEFAULT_CLAIM_DAYS))
  })

  /** A confirmed memory that never gets a slot is a memory confirming nothing. */
  it('always allows at least one claim', () => {
    expect(claimsAllowed(active({ id: 'm1', scope: { ratePerDay: 0.01 } }), 1)).toBe(1)
    expect(claimsAllowed(active({ id: 'm2' }), 1)).toBe(1)
  })
})
