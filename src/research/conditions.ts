/**
 * The two research conditions (product_spec §15.1, §15.2).
 *
 * Held as data rather than as a boolean so a report can state what separates
 * the conditions instead of leaving a reader to infer it — and so a claim about
 * the comparison can be checked against the list it was measured under.
 *
 * Baseline is a RESEARCH FLAG. It is never offered to a user on New Trip, and
 * nothing under `src/app`, `src/ui`, `src/application` or `src/domain` may
 * import from this directory. That direction is the whole point of Gate 7:
 * evaluation without polluting the product.
 */

export type ConditionId = 'full' | 'baseline'

export interface Condition {
  id: ConditionId
  label: string
  /** What §15.2 takes away. */
  removes: readonly string[]
  /** What §15.2 insists stays identical, so a difference means something. */
  keeps: readonly string[]
}

/** Everything both conditions hold in common (§15.2: "Keep"). */
const SHARED: readonly string[] = [
  'the same LLM',
  'the same Tokyo places, with the same real opening hours',
  'the same validation engine',
  'the same daily structure and slot times',
]

export const FULL: Condition = {
  id: 'full',
  label: 'Full condition',
  removes: [],
  keeps: [
    ...SHARED,
    'Personal Memory, and the trip snapshot taken from it',
    'the State model: Intent, Considering, Priorities',
    'ranked candidate retrieval weighted by Priorities',
    'the proposal / diff / confirm / receipt model',
  ],
}

export const BASELINE: Condition = {
  id: 'baseline',
  label: 'Baseline condition',
  removes: [
    'Memory use',
    'the State model, and so every structured constraint derived from it',
    'recommendation rationale',
    'the proposal / receipt model — a change is regenerated and applied at once',
  ],
  keeps: SHARED,
}

export const CONDITIONS: readonly Condition[] = [FULL, BASELINE]

export function conditionById(id: ConditionId): Condition {
  return id === 'full' ? FULL : BASELINE
}
