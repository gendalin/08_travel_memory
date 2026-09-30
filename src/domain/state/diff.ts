/**
 * State diff (product_spec §7).
 *
 * Any non-empty State diff makes the transaction a Reframe, so this needs to be
 * exact: a missed Priority weight change would silently downgrade a Reframe
 * into a Replace.
 */

import type { ID } from '../trip/types.ts'
import type { ConsideringItem, IntentItem, Priority, TripState } from './types.ts'

export interface ListDiff<T> {
  added: T[]
  removed: T[]
  modified: Array<{ before: T; after: T }>
}

export interface StateDiff {
  intent: ListDiff<IntentItem>
  considering: ListDiff<ConsideringItem>
  priorities: ListDiff<Priority>
}

function diffById<T extends { id: ID }>(
  before: T[],
  after: T[],
  equal: (a: T, b: T) => boolean,
): ListDiff<T> {
  const beforeById = new Map(before.map((item) => [item.id, item]))
  const afterById = new Map(after.map((item) => [item.id, item]))

  const added: T[] = []
  const removed: T[] = []
  const modified: Array<{ before: T; after: T }> = []

  for (const [id, afterItem] of afterById) {
    const beforeItem = beforeById.get(id)
    if (!beforeItem) added.push(afterItem)
    else if (!equal(beforeItem, afterItem)) modified.push({ before: beforeItem, after: afterItem })
  }
  for (const [id, beforeItem] of beforeById) {
    if (!afterById.has(id)) removed.push(beforeItem)
  }

  return { added, removed, modified }
}

export function diffStates(before: TripState, after: TripState): StateDiff {
  return {
    intent: diffById(before.intent, after.intent, (a, b) => a.text === b.text),
    considering: diffById(
      before.considering,
      after.considering,
      (a, b) => a.text === b.text && JSON.stringify(a.tag ?? null) === JSON.stringify(b.tag ?? null),
    ),
    priorities: diffById(
      before.priorities,
      after.priorities,
      (a, b) => a.name === b.name && a.weight === b.weight,
    ),
  }
}

function listIsEmpty<T>(diff: ListDiff<T>): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0
}

export function isStateDiffEmpty(diff: StateDiff): boolean {
  return listIsEmpty(diff.intent) && listIsEmpty(diff.considering) && listIsEmpty(diff.priorities)
}
