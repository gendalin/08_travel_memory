/**
 * Plan diff (product_spec §7).
 *
 * Diffing is deterministic and owned by code. Change classification reads this
 * output and nothing else — the LLM never asserts what kind of change occurred.
 */

import type { ID } from '../trip/types.ts'
import type { Plan, PlanItem } from './types.ts'
import { allItems } from './types.ts'

/** Fields whose change matters to classification. */
export type PlanItemField = 'placeId' | 'dayIndex' | 'startTime' | 'endTime'

const COMPARED_FIELDS: PlanItemField[] = ['placeId', 'dayIndex', 'startTime', 'endTime']

/** A field that moves an item in the schedule, as opposed to swapping what it is. */
export const POSITIONAL_FIELDS: PlanItemField[] = ['dayIndex', 'startTime', 'endTime']

export interface ModifiedItem {
  before: PlanItem
  after: PlanItem
  fields: PlanItemField[]
}

export interface PlanDiff {
  added: PlanItem[]
  removed: PlanItem[]
  modified: ModifiedItem[]
}

export function diffPlans(before: Plan, after: Plan): PlanDiff {
  const beforeItems = new Map<ID, PlanItem>(allItems(before).map((item) => [item.id, item]))
  const afterItems = new Map<ID, PlanItem>(allItems(after).map((item) => [item.id, item]))

  const added: PlanItem[] = []
  const removed: PlanItem[] = []
  const modified: ModifiedItem[] = []

  for (const [id, afterItem] of afterItems) {
    const beforeItem = beforeItems.get(id)
    if (!beforeItem) {
      added.push(afterItem)
      continue
    }
    const fields = COMPARED_FIELDS.filter((field) => beforeItem[field] !== afterItem[field])
    if (fields.length > 0) modified.push({ before: beforeItem, after: afterItem, fields })
  }

  for (const [id, beforeItem] of beforeItems) {
    if (!afterItems.has(id)) removed.push(beforeItem)
  }

  return { added, removed, modified }
}

export function isPlanDiffEmpty(diff: PlanDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0
}

/** Every item id the diff touches. */
export function affectedItemIds(diff: PlanDiff): ID[] {
  return [
    ...diff.added.map((item) => item.id),
    ...diff.removed.map((item) => item.id),
    ...diff.modified.map((entry) => entry.after.id),
  ]
}

export function movedInSchedule(entry: ModifiedItem): boolean {
  return entry.fields.some((field) => POSITIONAL_FIELDS.includes(field))
}
