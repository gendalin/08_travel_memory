/**
 * Recency weighting (A4).
 *
 * The property that matters most is not the shape of the curve — it is that
 * preprocessing stays reproducible. Anchoring decay to the wall clock would make
 * `memories.json` change every day it was rebuilt, and every test reading the
 * bundle would rot on a calendar rather than on a code change.
 */

import { describe, expect, it } from 'vitest'

import {
  newestObservedAt,
  recencyWeights,
  RECENCY_HALF_LIFE_DAYS,
} from '../../scripts/preprocess/evidenceWeight.ts'

const dated = (observedAt: string) => ({ observedAt })
const undated = () => ({ observedAt: null })

describe('newestObservedAt', () => {
  it('finds the latest date in the set', () => {
    expect(newestObservedAt([dated('2025-07-11'), dated('2026-08-19'), dated('2026-01-29')])).toBe(
      '2026-08-19',
    )
  })

  it('is null when nothing is datable', () => {
    expect(newestObservedAt([undated(), undated()])).toBeNull()
  })

  it('ignores a value too short to be a date', () => {
    expect(newestObservedAt([{ observedAt: '2026' }, dated('2026-01-01')])).toBe('2026-01-01')
  })
})

describe('recencyWeights', () => {
  it('gives the newest record full weight', () => {
    const [older, newest] = recencyWeights([dated('2025-08-19'), dated('2026-08-19')])
    expect(newest).toBe(1)
    expect(older).toBeLessThan(1)
  })

  it('halves at the half-life', () => {
    const reference = '2026-08-19'
    const aYearBefore = '2025-08-19'
    const [old] = recencyWeights([dated(aYearBefore), dated(reference)])
    // 2025-08-19 to 2026-08-19 is 365 days, exactly one half-life.
    expect(RECENCY_HALF_LIFE_DAYS).toBe(365)
    expect(old).toBeCloseTo(0.5, 5)
  })

  /**
   * Reproducibility. The reference is the newest record in the set, so the same
   * evidence always produces the same weights however long afterwards it is run.
   */
  it('anchors to the data, not to the clock', () => {
    const records = [dated('2025-01-01'), dated('2026-01-01')]
    const first = recencyWeights(records)
    const second = recencyWeights(records)
    expect(first).toEqual(second)
    // Shifting the whole set forward by a year leaves the weights unchanged,
    // which a wall-clock reference could not do.
    const shifted = recencyWeights([dated('2026-01-01'), dated('2027-01-01')])
    expect(shifted).toEqual(first)
  })

  /**
   * All fourteen saved places in the bundle carry no timestamp, and a Takeout
   * export cannot supply one. Weighting them 1.0 would treat every undated record
   * as though it happened today, quietly favouring whichever category holds the
   * most saved places.
   */
  it('treats an undated record as typical-aged, not as fresh', () => {
    const weights = recencyWeights([dated('2025-08-19'), dated('2026-08-19'), undated()])
    const [older, newest, unknown] = weights

    expect(unknown).toBeCloseTo((older + newest) / 2, 5)
    expect(unknown).toBeLessThan(newest)
    expect(unknown).toBeGreaterThan(older)
  })

  it('weights everything equally when nothing is datable', () => {
    expect(recencyWeights([undated(), undated()])).toEqual([1, 1])
  })

  it('never weights a future date above the reference', () => {
    // The reference IS the newest, so nothing can exceed it; a clock-based
    // reference would let a future-dated record score above 1.
    expect(recencyWeights([dated('2030-01-01'), dated('2026-01-01')])[0]).toBe(1)
  })
})
