/**
 * Profile-level Memory management (product_spec §10.1, §10.3).
 *
 * A memory enters the Profile active only when it is seeded with `autoActivate`
 * and clears `qualifiesForAutoActivation`; everything else waits for the user.
 * After that, status changes only by an explicit user act.
 *
 * Delete is a hard delete; there is no archived state.
 */

import {
  activateMemory,
  deactivateMemory,
  normalizeProvenanceType,
  qualifiesForAutoActivation,
} from '../../domain/memory/snapshot.ts'
import type { Memory, MemoryKind, MemorySubject } from '../../domain/memory/types.ts'
import type { ID } from '../../domain/trip/types.ts'
import type { MemoryRepository } from '../../services/persistence/types.ts'

/** Shape of a memory as it appears in data/demo_tokyo_v1/memories.json. */
export interface BundledMemory {
  id: string
  text: string
  status: string
  kind: string
  subject: { facet: string; value: string | number }
  polarity: number
  strength: number
  confidence: number
  scope?: { ratePerDay?: number }
  provenance: { type: string; sourceRefs: string[] }
}

/** The part of an evidence record a memory's examples are read from. */
export interface BundledEvidence {
  id: string
  kind: string
  placeName?: string
}

/**
 * How many saved-place names a memory keeps. All of them are matched against a
 * stop ("you saved this one"); the rationale shows the first few.
 */
export const MAX_MEMORY_EXAMPLES = 12

/**
 * The places behind a memory the traveller saved on Maps, by name.
 *
 * Saved places only. They are the most deliberate act — someone chose to keep them
 * — and their names come from Maps. A screenshot's name is read off the image, and
 * in the demo bundle two of the izakaya screenshots name an Instagram account.
 */
function examplesFor(sourceRefs: string[], evidence: ReadonlyMap<string, BundledEvidence>): string[] {
  const named = sourceRefs
    .map((id) => evidence.get(id))
    .filter((record) => record?.kind === 'saved_place' && record.placeName)
    .map((record) => record!.placeName!.trim())
  return [...new Set(named)].slice(0, MAX_MEMORY_EXAMPLES)
}

/** Evidence behind a memory, counted by kind. Empty when the bundle has none. */
function sourceCountsFor(
  sourceRefs: string[],
  evidence: ReadonlyMap<string, BundledEvidence>,
): NonNullable<Memory['sourceCounts']> {
  const counts: NonNullable<Memory['sourceCounts']> = {}
  for (const id of sourceRefs) {
    const kind = evidence.get(id)?.kind
    if (kind === 'photo' || kind === 'screenshot' || kind === 'saved_place') {
      counts[kind] = (counts[kind] ?? 0) + 1
    }
  }
  return counts
}

export async function loadProfileMemories(repository: MemoryRepository): Promise<Memory[]> {
  const memories = await repository.list()
  // Candidates first, strongest first: confidence orders the review queue,
  // which is the one use §10.2 permits.
  return [...memories].sort(
    (a, b) =>
      Number(a.status === 'active') - Number(b.status === 'active') ||
      b.confidence - a.confidence,
  )
}

export async function confirmCandidate(memoryId: ID, repository: MemoryRepository): Promise<Memory[]> {
  const memories = await repository.list()
  const memory = memories.find((candidate) => candidate.id === memoryId)
  if (memory) await repository.save(activateMemory(memory))
  return loadProfileMemories(repository)
}

export async function deactivateProfileMemory(
  memoryId: ID,
  repository: MemoryRepository,
): Promise<Memory[]> {
  const memories = await repository.list()
  const memory = memories.find((candidate) => candidate.id === memoryId)
  if (memory) await repository.save(deactivateMemory(memory))
  return loadProfileMemories(repository)
}

/**
 * Corrects the wording of a memory (UI draft 06: every row is inline-editable).
 *
 * Text only. Status, confidence and provenance are untouched: how a memory was
 * arrived at does not change because the user rephrased it, and an edit is not
 * a confirmation.
 */
export async function editMemoryText(
  memoryId: ID,
  text: string,
  repository: MemoryRepository,
): Promise<Memory[]> {
  const memories = await repository.list()
  const memory = memories.find((candidate) => candidate.id === memoryId)
  const trimmed = text.trim()
  if (memory && trimmed !== '') await repository.save({ ...memory, text: trimmed })
  return loadProfileMemories(repository)
}

/** Hard delete (§10.1). */
export async function dismissMemory(memoryId: ID, repository: MemoryRepository): Promise<Memory[]> {
  await repository.remove(memoryId)
  return loadProfileMemories(repository)
}

/**
 * Seeds the Profile from the demo bundle.
 *
 * The bundle now states `kind`, `subject`, `polarity` and `strength` outright, so
 * this boundary reads them rather than reverse-engineering a category out of a
 * provenance string ("category_trend:sushi"). That string remains what it always
 * was — a record of HOW the memory was arrived at — and is still normalised down
 * to the four display types §10.4 defines.
 *
 * The bundle is not trusted, though. Its status is ignored: a memory enters as
 * `candidate`, or — with `autoActivate` — as `active` when this side's own rule
 * (`qualifiesForAutoActivation`) says its evidence is strong enough. An
 * unreadable kind, subject or polarity is rejected rather than defaulted: a
 * memory the planner cannot act on predictably should not enter the Profile at all.
 *
 * A memory the Profile already holds is left exactly as it is. Once the Profile
 * survives a reload, re-seeding over the top would undo what the user did — a
 * memory they stopped using would come back on its own.
 */
export async function seedProfile(
  bundled: BundledMemory[],
  repository: MemoryRepository,
  createdAt: string,
  options: {
    autoActivate?: boolean
    /** The bundle's evidence, so each memory can name the places behind it. */
    evidence?: readonly BundledEvidence[]
  } = {},
): Promise<Memory[]> {
  const known = new Set((await repository.list()).map((memory) => memory.id))
  const evidence = new Map((options.evidence ?? []).map((record) => [record.id, record]))

  for (const memory of bundled) {
    if (known.has(memory.id)) continue
    const typed = toTypedMemory(memory, createdAt, evidence)
    if (!typed) continue
    await repository.save(
      options.autoActivate && qualifiesForAutoActivation(typed) ? activateMemory(typed) : typed,
    )
  }
  return loadProfileMemories(repository)
}

const MEMORY_KINDS = new Set<MemoryKind>([
  'preference',
  'aversion',
  'constraint',
  'pattern',
  'context',
])

const CATEGORICAL_FACETS = new Set(['category', 'price_band', 'time_fit', 'stay_length'])
const MEASURED_FACETS = new Set(['stops_per_day', 'day_span_metres', 'start_minutes'])

/** 0-1, clamped. A bundle figure outside the range is a bug, not a signal. */
function unitRange(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function toSubject(subject: BundledMemory['subject']): MemorySubject | undefined {
  if (CATEGORICAL_FACETS.has(subject.facet) && typeof subject.value === 'string') {
    return { facet: subject.facet, value: subject.value } as MemorySubject
  }
  if (MEASURED_FACETS.has(subject.facet) && typeof subject.value === 'number') {
    return { facet: subject.facet, value: subject.value } as MemorySubject
  }
  return undefined
}

/**
 * Bundle record -> domain Memory, or nothing when the record cannot be read.
 *
 * Dropping is deliberate. A memory with an unknown kind or a subject the facet
 * vocabulary does not contain cannot be ranked or validated against, so admitting
 * it with a default would put something in the Profile that looks active and does
 * nothing — the failure mode this whole step exists to remove.
 */
function toTypedMemory(
  memory: BundledMemory,
  createdAt: string,
  evidence: ReadonlyMap<string, BundledEvidence> = new Map(),
): Memory | undefined {
  const kind = memory.kind as MemoryKind
  if (!MEMORY_KINDS.has(kind)) return undefined

  const subject = toSubject(memory.subject)
  if (!subject) return undefined

  if (memory.polarity !== 1 && memory.polarity !== -1) return undefined

  const examples = examplesFor(memory.provenance.sourceRefs, evidence)
  const sourceCounts = sourceCountsFor(memory.provenance.sourceRefs, evidence)

  return {
    id: memory.id,
    text: memory.text,
    // The bundle's status is ignored rather than trusted, so a bad bundle cannot
    // pre-activate a memory. Activation on seed is `seedProfile`'s decision.
    status: 'candidate',
    kind,
    subject,
    polarity: memory.polarity,
    strength: unitRange(memory.strength),
    confidence: unitRange(memory.confidence),
    // A rate outside (0, 1] cannot be a per-travel-day frequency, so it is
    // dropped rather than clamped: the planner's fallback is a better answer
    // than a number the bundle got wrong.
    ...(typeof memory.scope?.ratePerDay === 'number' &&
    memory.scope.ratePerDay > 0 &&
    memory.scope.ratePerDay <= 1
      ? { scope: { ratePerDay: memory.scope.ratePerDay } }
      : {}),
    ...(examples.length > 0 ? { examples } : {}),
    ...(Object.keys(sourceCounts).length > 0 ? { sourceCounts } : {}),
    provenance: {
      type: normalizeProvenanceType(memory.provenance.type),
      sourceRefs: memory.provenance.sourceRefs,
      createdAt,
    },
  }
}
