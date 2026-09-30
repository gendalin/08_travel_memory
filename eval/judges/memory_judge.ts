/**
 * Memory quality rubric (eval spec §16).
 *
 * Five 0-2 dimensions, each decided from the memory record, its evidence, and
 * whether the planner has a door for it — never from wording alone.
 *
 *   Accuracy      evidence behind it: ≥3 resolvable refs and confidence ≥ .65 → 2
 *   Specificity   names a facet value the planner can match, and the text says what
 *   Stability     cross-trip provenance (behaviour / saved places / explicit) → 2
 *   Provenance    every sourceRef resolves to evidence or a scenario turn → 2
 *   Actionability the planner reads this subject/kind somewhere → 2; representable
 *                 but unused at the trip's pace → 1; unrepresentable → 0
 */

import type { Memory } from '../../src/domain/memory/types.ts'

export interface MemoryScore {
  id: string
  text: string
  status: string
  accuracy: number
  specificity: number
  stability: number
  provenance: number
  actionability: number
  total: number
  issue: string
}

export interface MemoryJudgeInput {
  memory: Memory | { id: string; text: string; status: string; representable: false; sourceRef?: string }
  /** Evidence ids that exist (bundle evidence + scenario turn ids). */
  knownRefs: Set<string>
  /** True when some role at the evaluated pace admits this memory's category. */
  usableAtPace?: boolean
  /** Extra issue text the scenario found (e.g. part of the sentence dropped). */
  note?: string
}

const VAGUE = /^(likes?|enjoys?|prefers?)\s+(culture|food|travel|nice|good)\b/i

export function judgeMemory(input: MemoryJudgeInput): MemoryScore {
  const issues: string[] = []
  if (input.note) issues.push(input.note)

  if ('representable' in input.memory) {
    const hasRef = input.memory.sourceRef !== undefined && input.knownRefs.has(input.memory.sourceRef)
    const scores = { accuracy: 1, specificity: 1, stability: 1, provenance: hasRef ? 2 : 0, actionability: 0 }
    issues.push('No MemorySubject facet can express it (no crowd/quiet or neighbourhood facet); the planner cannot read it')
    return finish(input.memory.id, input.memory.text, input.memory.status, scores, issues)
  }

  const memory = input.memory
  const refs = memory.provenance.sourceRefs
  const resolved = refs.filter((ref) => input.knownRefs.has(ref)).length

  const accuracy = memory.provenance.type === 'explicit_statement'
    ? 2
    : resolved >= 3 && memory.confidence >= 0.65 ? 2 : resolved >= 3 ? 1 : 0
  if (accuracy < 2) issues.push(`confidence ${memory.confidence} on ${resolved} refs`)

  const specificity = VAGUE.test(memory.text) ? 0 : ['category', 'popularity', 'area_character'].includes(memory.subject.facet) || typeof memory.subject.value === 'number' ? 2 : 1

  const stability =
    memory.provenance.type === 'agent_inference' ? 1
    : memory.provenance.type === 'historical_behavior' && memory.confidence < 0.5 ? 1
    : 2
  if (stability < 2) issues.push('cross-trip stability uncertain (low-confidence behaviour)')

  const provenance = refs.length === 0 ? 0 : resolved === refs.length ? 2 : 1
  if (provenance < 2) issues.push(`${refs.length - resolved}/${refs.length} sourceRefs do not resolve`)

  const consumed =
    ((memory.kind === 'preference' || memory.kind === 'aversion') && ['category', 'popularity', 'area_character'].includes(memory.subject.facet)) ||
    (memory.kind === 'pattern' && ['stops_per_day', 'day_span_metres', 'start_minutes'].includes(memory.subject.facet))
  const actionability = !consumed ? 0 : input.usableAtPace === false ? 1 : 2
  if (actionability === 1) issues.push('no role at the evaluated pace admits this category — cannot claim a slot')
  if (actionability === 0) issues.push('the planner has no door for this kind/facet')

  return finish(memory.id, memory.text, memory.status, { accuracy, specificity, stability, provenance, actionability }, issues)
}

function finish(
  id: string,
  text: string,
  status: string,
  scores: { accuracy: number; specificity: number; stability: number; provenance: number; actionability: number },
  issues: string[],
): MemoryScore {
  const total = scores.accuracy + scores.specificity + scores.stability + scores.provenance + scores.actionability
  return { id, text, status, ...scores, total, issue: issues.join('; ') || '—' }
}
