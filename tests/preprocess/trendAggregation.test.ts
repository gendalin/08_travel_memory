/**
 * Category trend aggregation (A4).
 *
 * Three numbers a trend now carries that it previously threw away or guessed:
 * recency-weighted support, the classification confidence of the records behind
 * it, and how often the traveller actually did it per documented travel day.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { aggregateTrends, travelDays } from '../../scripts/preprocess/build_candidate_memories.ts'
import type { EvidenceRecord } from '../../scripts/preprocess/types.ts'

const evidence = JSON.parse(
  readFileSync('data/demo_tokyo_v1/evidence.json', 'utf8'),
) as EvidenceRecord[]

function record(overrides: Partial<EvidenceRecord> & Pick<EvidenceRecord, 'id'>): EvidenceRecord {
  return {
    kind: 'photo',
    sourcePath: 'source_inputs/x.jpg',
    summary: 'a photo',
    category: 'sushi',
    categoryConfidence: 0.9,
    categorySource: 'vision',
    observedAt: '2026-08-19T12:00:00',
    ...overrides,
  }
}

describe('travelDays', () => {
  it('counts distinct days from dated photos only', () => {
    const days = travelDays([
      record({ id: 'a', observedAt: '2026-08-19T09:00:00' }),
      record({ id: 'b', observedAt: '2026-08-19T18:00:00' }),
      record({ id: 'c', observedAt: '2026-08-20T09:00:00' }),
      // A screenshot's timestamp is when it was SAVED, not a day out.
      record({ id: 'd', kind: 'screenshot', observedAt: '2026-08-21T09:00:00' }),
      // A Takeout saved place carries no date at all.
      record({ id: 'e', kind: 'saved_place', observedAt: null }),
    ])
    expect([...days].sort()).toEqual(['2026-08-19', '2026-08-20'])
  })
})

describe('aggregateTrends over the real bundle', () => {
  const trends = aggregateTrends(evidence)
  const byCategory = new Map(trends.map((trend) => [trend.category, trend]))

  it('emits the category trends the bundle supports', () => {
    expect(trends.length).toBeGreaterThan(0)
    expect(byCategory.has('sushi')).toBe(true)
  })

  it('discounts a trend whose evidence is older', () => {
    for (const trend of trends) {
      expect(trend.decayedSupport).toBeLessThanOrEqual(trend.support)
    }
    // Izakaya's evidence is older than sushi's, so it loses proportionally more.
    const sushi = byCategory.get('sushi')!
    const izakaya = byCategory.get('izakaya')!
    expect(izakaya.decayedSupport / izakaya.support).toBeLessThan(
      sushi.decayedSupport / sushi.support,
    )
  })

  it('carries the classification confidence it used to discard', () => {
    for (const trend of trends) {
      expect(trend.classificationConfidence).toBeGreaterThan(0)
      expect(trend.classificationConfidence).toBeLessThanOrEqual(1)
    }
    // Market classifications are measurably shakier than ramen ones, which the
    // old flat name-lookup discount could not express.
    expect(byCategory.get('grocery_market')!.classificationConfidence).toBeLessThan(
      byCategory.get('ramen')!.classificationConfidence,
    )
  })

  it('derives a per-travel-day rate inside (0, 1]', () => {
    for (const trend of trends) {
      if (trend.ratePerTravelDay === null) continue
      expect(trend.ratePerTravelDay).toBeGreaterThan(0)
      expect(trend.ratePerTravelDay).toBeLessThanOrEqual(1)
    }
  })

  it('separates how often from how many: ramen is rarer than sushi per day', () => {
    expect(byCategory.get('ramen')!.ratePerTravelDay).toBeLessThan(
      byCategory.get('sushi')!.ratePerTravelDay!,
    )
  })

  it('is reproducible over the same evidence', () => {
    expect(JSON.stringify(aggregateTrends(evidence))).toBe(JSON.stringify(trends))
  })
})

describe('aggregateTrends edge cases', () => {
  it('has no rate when only screenshots and saved places back the trend', () => {
    const interestOnly = [
      record({ id: 's1', kind: 'screenshot' }),
      record({ id: 's2', kind: 'screenshot' }),
      record({ id: 'p1', kind: 'saved_place', observedAt: null }),
    ]
    const [trend] = aggregateTrends(interestOnly)
    expect(trend.support).toBe(3)
    expect(trend.ratePerTravelDay).toBeNull()
  })

  it('puts classification confidence in the middle when no record carries one', () => {
    const unscored = [1, 2, 3].map((n) =>
      record({ id: `u${n}`, categoryConfidence: undefined }),
    )
    expect(aggregateTrends(unscored)[0].classificationConfidence).toBe(0.5)
  })

  it('gates on raw support, so recency decides how much a trend matters, not whether', () => {
    // Three old records still clear the support gate; they just count for less.
    const old = [1, 2, 3].map((n) => record({ id: `o${n}`, observedAt: '2020-01-01T09:00:00' }))
    const [trend] = aggregateTrends(old)
    expect(trend.support).toBe(3)
  })
})
