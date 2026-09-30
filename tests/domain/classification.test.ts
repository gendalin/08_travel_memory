/**
 * Change classification boundaries (product_spec §7.1).
 * Gate 2 requires every one of these cases to be covered.
 */

import { describe, expect, it } from 'vitest'

import { diffPlans } from '../../src/domain/plan/diff.ts'
import { diffStates } from '../../src/domain/state/diff.ts'
import { classifyChange } from '../../src/domain/proposals/classify.ts'
import { basePlan, day, emptyState, item, plan, state } from './fixtures.ts'

function classify(beforePlan = basePlan(), afterPlan = basePlan(), beforeState = emptyState(), afterState = emptyState()) {
  return classifyChange(diffStates(beforeState, afterState), diffPlans(beforePlan, afterPlan))
}

describe('classifyChange', () => {
  it('empty diff -> answer / focus', () => {
    expect(classify()).toBe('answer')
  })

  it('one POI swapped for another in the same slot -> replace', () => {
    const after = plan([
      day(0, [
        item({ id: 'a', placeId: 'place_d', startTime: '10:00', endTime: '11:00' }),
        item({ id: 'b', placeId: 'place_b', startTime: '13:00', endTime: '14:00' }),
        item({ id: 'c', placeId: 'place_c', startTime: '16:00', endTime: '17:00' }),
      ]),
    ])
    expect(classify(basePlan(), after)).toBe('replace')
  })

  it('remove one item, nothing else moves -> replace', () => {
    const after = plan([
      day(0, [
        item({ id: 'a', placeId: 'place_a', startTime: '10:00', endTime: '11:00' }),
        item({ id: 'c', placeId: 'place_c', startTime: '16:00', endTime: '17:00' }),
      ]),
    ])
    expect(classify(basePlan(), after)).toBe('replace')
  })

  it('one replacement that shifts later items -> reorganize', () => {
    const after = plan([
      day(0, [
        item({ id: 'a', placeId: 'place_d', startTime: '10:00', endTime: '11:00' }),
        item({ id: 'b', placeId: 'place_b', startTime: '13:30', endTime: '14:30' }),
        item({ id: 'c', placeId: 'place_c', startTime: '16:30', endTime: '17:30' }),
      ]),
    ])
    expect(classify(basePlan(), after)).toBe('reorganize')
  })

  it('add an item -> reorganize', () => {
    const after = plan([
      day(0, [
        ...basePlan().days[0].items,
        item({ id: 'd', placeId: 'place_d', startTime: '18:00', endTime: '19:00' }),
      ]),
    ])
    expect(classify(basePlan(), after)).toBe('reorganize')
  })

  it('retime a single item -> reorganize, not replace', () => {
    const after = plan([
      day(0, [
        item({ id: 'a', placeId: 'place_a', startTime: '11:00', endTime: '12:00' }),
        item({ id: 'b', placeId: 'place_b', startTime: '13:00', endTime: '14:00' }),
        item({ id: 'c', placeId: 'place_c', startTime: '16:00', endTime: '17:00' }),
      ]),
    ])
    expect(classify(basePlan(), after)).toBe('reorganize')
  })

  it('reorder items -> reorganize', () => {
    const after = plan([
      day(0, [
        item({ id: 'a', placeId: 'place_a', startTime: '16:00', endTime: '17:00' }),
        item({ id: 'b', placeId: 'place_b', startTime: '13:00', endTime: '14:00' }),
        item({ id: 'c', placeId: 'place_c', startTime: '10:00', endTime: '11:00' }),
      ]),
    ])
    expect(classify(basePlan(), after)).toBe('reorganize')
  })

  it('move an item to another day -> reorganize', () => {
    const after = plan([
      day(0, [
        item({ id: 'b', placeId: 'place_b', startTime: '13:00', endTime: '14:00' }),
        item({ id: 'c', placeId: 'place_c', startTime: '16:00', endTime: '17:00' }),
      ]),
      day(1, [item({ id: 'a', placeId: 'place_a', dayIndex: 1, startTime: '10:00', endTime: '11:00' })]),
    ])
    expect(classify(basePlan(), after)).toBe('reorganize')
  })

  it('multiple items changed -> reorganize', () => {
    const after = plan([
      day(0, [
        item({ id: 'a', placeId: 'place_d', startTime: '10:00', endTime: '11:00' }),
        item({ id: 'b', placeId: 'place_a', startTime: '13:00', endTime: '14:00' }),
        item({ id: 'c', placeId: 'place_c', startTime: '16:00', endTime: '17:00' }),
      ]),
    ])
    expect(classify(basePlan(), after)).toBe('reorganize')
  })

  describe('any State diff -> reframe', () => {
    it('intent change', () => {
      const after = state({ intent: [{ id: 'i1', text: 'Slow-paced' }] })
      expect(classify(basePlan(), basePlan(), emptyState(), after)).toBe('reframe')
    })

    it('considering change', () => {
      const after = state({ considering: [{ id: 'c1', text: 'No taxis' }] })
      expect(classify(basePlan(), basePlan(), emptyState(), after)).toBe('reframe')
    })

    it('priority weight change', () => {
      const before = state({ priorities: [{ id: 'p1', name: 'convenience', weight: 'medium' }] })
      const after = state({ priorities: [{ id: 'p1', name: 'convenience', weight: 'high' }] })
      expect(classify(basePlan(), basePlan(), before, after)).toBe('reframe')
    })

    it('priority addition', () => {
      const before = state({ priorities: [{ id: 'p1', name: 'convenience', weight: 'medium' }] })
      const after = state({
        priorities: [
          { id: 'p1', name: 'convenience', weight: 'medium' },
          { id: 'p2', name: 'craft_and_design', weight: 'medium', proposedByAgent: true },
        ],
      })
      expect(classify(basePlan(), basePlan(), before, after)).toBe('reframe')
    })

    // Decided 2026-09-30 (eval spec §11-12): any State change is a Reframe, however
    // little of the itinerary it moves. Reverses the 2026-09-29 single-swap Replace.
    it('a State edit that swaps one stop is still a Reframe', () => {
      const base = basePlan()
      const swapped = base.days[0].items[0]
      const afterPlan = {
        ...base,
        days: base.days.map((d) => ({
          ...d,
          items: d.items.map((entry) => (entry.id === swapped.id ? { ...entry, placeId: 'place_d' } : entry)),
        })),
      }
      const afterState = state({ intent: [{ id: 'i1', text: 'Recover and relax' }] })
      expect(classify(base, afterPlan, emptyState(), afterState)).toBe('reframe')
    })
  })
})
