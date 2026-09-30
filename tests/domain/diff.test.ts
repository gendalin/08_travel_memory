import { describe, expect, it } from 'vitest'

import { affectedItemIds, diffPlans, isPlanDiffEmpty, movedInSchedule } from '../../src/domain/plan/diff.ts'
import { diffStates, isStateDiffEmpty } from '../../src/domain/state/diff.ts'
import { basePlan, day, emptyState, item, plan, state } from './fixtures.ts'

describe('diffPlans', () => {
  it('reports no change for an identical plan', () => {
    expect(isPlanDiffEmpty(diffPlans(basePlan(), basePlan()))).toBe(true)
  })

  it('detects an added item', () => {
    const after = plan([day(0, [...basePlan().days[0].items, item({ id: 'd' })])])
    const diff = diffPlans(basePlan(), after)
    expect(diff.added.map((i) => i.id)).toEqual(['d'])
    expect(diff.removed).toHaveLength(0)
  })

  it('detects a removed item', () => {
    const after = plan([day(0, basePlan().days[0].items.filter((i) => i.id !== 'b'))])
    expect(diffPlans(basePlan(), after).removed.map((i) => i.id)).toEqual(['b'])
  })

  it('reports exactly which fields changed', () => {
    const after = plan([
      day(0, [
        item({ id: 'a', placeId: 'place_d', startTime: '11:00', endTime: '12:00' }),
        ...basePlan().days[0].items.slice(1),
      ]),
    ])
    const diff = diffPlans(basePlan(), after)
    expect(diff.modified).toHaveLength(1)
    expect(diff.modified[0].fields.sort()).toEqual(['endTime', 'placeId', 'startTime'])
  })

  it('does not treat rationale changes as a plan change', () => {
    const after = plan([
      day(0, [
        { ...basePlan().days[0].items[0], rationale: 'newly generated copy' },
        ...basePlan().days[0].items.slice(1),
      ]),
    ])
    expect(isPlanDiffEmpty(diffPlans(basePlan(), after))).toBe(true)
  })

  it('movedInSchedule distinguishes identity swaps from schedule moves', () => {
    const swap = plan([day(0, [item({ id: 'a', placeId: 'place_d' }), ...basePlan().days[0].items.slice(1)])])
    const retime = plan([day(0, [item({ id: 'a', startTime: '12:00', endTime: '13:00' }), ...basePlan().days[0].items.slice(1)])])
    expect(diffPlans(basePlan(), swap).modified.map(movedInSchedule)).toEqual([false])
    expect(diffPlans(basePlan(), retime).modified.map(movedInSchedule)).toEqual([true])
  })

  it('affectedItemIds covers added, removed and modified', () => {
    const after = plan([
      day(0, [item({ id: 'a', placeId: 'place_d' }), item({ id: 'd' })]),
    ])
    expect(new Set(affectedItemIds(diffPlans(basePlan(), after)))).toEqual(new Set(['a', 'b', 'c', 'd']))
  })
})

describe('diffStates', () => {
  it('reports no change for identical state', () => {
    expect(isStateDiffEmpty(diffStates(emptyState(), emptyState()))).toBe(true)
  })

  it('detects a considering tag change even when the text is identical', () => {
    const before = state({ considering: [{ id: 'c1', text: 'Leave for the airport', tag: { kind: 'fixed_time', dayIndex: 4, time: '17:20' } }] })
    const after = state({ considering: [{ id: 'c1', text: 'Leave for the airport', tag: { kind: 'fixed_time', dayIndex: 4, time: '15:20' } }] })
    expect(isStateDiffEmpty(diffStates(before, after))).toBe(false)
    expect(diffStates(before, after).considering.modified).toHaveLength(1)
  })

  it('detects priority removal', () => {
    const before = state({ priorities: [{ id: 'p1', name: 'cost', weight: 'high' }] })
    expect(diffStates(before, emptyState()).priorities.removed).toHaveLength(1)
  })
})
