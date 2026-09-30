/** Personal Memory (product_spec §10). */

import { describe, expect, it } from 'vitest'

import {
  activateMemory,
  createMemorySnapshot,
  deactivateMemory,
  normalizeProvenanceType,
  qualifiesForAutoActivation,
} from '../../src/domain/memory/snapshot.ts'
import { provenanceLabel } from '../../src/domain/memory/types.ts'
import { memory } from './fixtures.ts'

const AT = '2026-09-21T10:00:00.000Z'

describe('auto-activation on seed', () => {
  const strong = (overrides: Parameters<typeof memory>[0]) =>
    memory({
      confidence: 0.7,
      ...overrides,
      provenance: {
        type: 'saved_places',
        sourceRefs: ['ev_1', 'ev_2', 'ev_3'],
        createdAt: AT,
        ...overrides.provenance,
      },
    })

  it('qualifies a well-evidenced preference or pattern from photos or saved places', () => {
    expect(qualifiesForAutoActivation(strong({ id: 'm1' }))).toBe(true)
    expect(
      qualifiesForAutoActivation(
        strong({ id: 'm2', kind: 'pattern', subject: { facet: 'stops_per_day', value: 3 } }),
      ),
    ).toBe(true)
  })

  it('leaves low confidence, thin evidence, inference and aversions for the user', () => {
    expect(qualifiesForAutoActivation(strong({ id: 'm1', confidence: 0.64 }))).toBe(false)
    expect(
      qualifiesForAutoActivation(
        strong({ id: 'm2', provenance: { type: 'saved_places', sourceRefs: ['ev_1', 'ev_2'], createdAt: AT } }),
      ),
    ).toBe(false)
    expect(
      qualifiesForAutoActivation(
        strong({ id: 'm3', provenance: { type: 'agent_inference', sourceRefs: ['a', 'b', 'c'], createdAt: AT } }),
      ),
    ).toBe(false)
    expect(qualifiesForAutoActivation(strong({ id: 'm4', kind: 'aversion', polarity: -1 }))).toBe(false)
  })
})

describe('memory status', () => {
  it('a memory is never active merely because its confidence is high', () => {
    const highConfidence = memory({ id: 'm1', confidence: 0.99 })
    expect(highConfidence.status).toBe('candidate')

    const snapshot = createMemorySnapshot('trip_1', [highConfidence], AT)
    expect(snapshot.memories).toHaveLength(0)
  })

  it('confidence is independent from status', () => {
    const lowButActive = activateMemory(memory({ id: 'm1', confidence: 0.2 }))
    expect(lowButActive.status).toBe('active')
    expect(lowButActive.confidence).toBe(0.2)
  })

  it('round-trips between candidate and active', () => {
    const m = memory({ id: 'm1' })
    expect(deactivateMemory(activateMemory(m)).status).toBe('candidate')
  })

  it('exposes a provenance label instead of a number', () => {
    expect(provenanceLabel('saved_places')).toBe('From your saved places')
    expect(provenanceLabel('historical_behavior')).toBe('From past travel behavior')
  })
})

describe('trip memory snapshot', () => {
  it('captures only active memories', () => {
    const snapshot = createMemorySnapshot(
      'trip_1',
      [
        activateMemory(memory({ id: 'm1' })),
        memory({ id: 'm2' }),
        activateMemory(memory({ id: 'm3' })),
      ],
      AT,
    )
    expect(snapshot.memories.map((m) => m.id)).toEqual(['m1', 'm3'])
  })

  it('is immutable — a later Profile change cannot alter it', () => {
    const active = activateMemory(memory({ id: 'm1', text: 'original' }))
    const snapshot = createMemorySnapshot('trip_1', [active], AT)

    expect(() => {
      ;(snapshot.memories as unknown as Array<{ text: string }>)[0].text = 'mutated'
    }).toThrow()
    expect(snapshot.memories[0].text).toBe('original')
  })

  it('cannot have memories appended after creation', () => {
    const snapshot = createMemorySnapshot('trip_1', [activateMemory(memory({ id: 'm1' }))], AT)
    expect(() => {
      ;(snapshot.memories as unknown as Array<unknown>).push(memory({ id: 'm2' }))
    }).toThrow()
    expect(snapshot.memories).toHaveLength(1)
  })

  it('does not alias the caller array — later activation does not leak in', () => {
    const profile = [activateMemory(memory({ id: 'm1' }))]
    const snapshot = createMemorySnapshot('trip_1', profile, AT)
    profile.push(activateMemory(memory({ id: 'm2' })))
    expect(snapshot.memories).toHaveLength(1)
  })

  it('freezes provenance sourceRefs too', () => {
    const snapshot = createMemorySnapshot('trip_1', [activateMemory(memory({ id: 'm1' }))], AT)
    expect(() => {
      ;(snapshot.memories[0].provenance.sourceRefs as string[]).push('ev_999')
    }).toThrow()
  })
})

describe('normalizeProvenanceType', () => {
  it('maps preprocessing provenance onto the four domain types', () => {
    expect(normalizeProvenanceType('category_trend:sushi')).toBe('saved_places')
    expect(normalizeProvenanceType('photo_gps')).toBe('historical_behavior')
    expect(normalizeProvenanceType('photo_timestamps')).toBe('historical_behavior')
    expect(normalizeProvenanceType('explicit_statement')).toBe('explicit_statement')
    expect(normalizeProvenanceType('something_unexpected')).toBe('agent_inference')
  })
})
