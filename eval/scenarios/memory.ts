/**
 * M1, M2, M3 — Personal Memory (eval spec §6-§8).
 */

import { readFileSync } from 'node:fs'

import { handleChatMessage, routeMessage } from '../../src/application/handleChat/handleChat.ts'
import { loadProfileMemories, seedProfile, type BundledMemory } from '../../src/application/manageMemory/manageMemory.ts'
import { tagConsidering } from '../../src/application/decompose/tagConsidering.ts'
import { claimsAllowed } from '../../src/domain/memory/preferences.ts'
import { allItems } from '../../src/domain/plan/types.ts'
import { createStubLlm } from '../../src/services/llm/stubLlm.ts'
import { createRepositories } from '../../src/services/persistence/inMemory.ts'
import { createTokyoTrip } from '../../tests/scenarios/tokyoTrip.ts'
import { check, scoreScenario } from '../judges/scenario_judge.ts'
import { judgePoi, LITERARY_SHOWA } from '../judges/recommendation_judge.ts'
import { buildTrip, catalogues, evalMemory, NOW, pacePattern } from '../lib/fixture.ts'
import { neutralRanking, rolesAdmitting, routeOf } from '../lib/trace.ts'
import { buildRankingContext } from '../../src/application/planning/rankCandidates.ts'
import { scorePlace } from '../../src/domain/ranking/score.ts'
import type { ScenarioResult } from '../schemas/scenario_result.ts'
import type { Memory } from '../../src/domain/memory/types.ts'

export const M1_MEMORY_ID = 'mem_eval_m1_bookstores'

export function m1Memory(): Memory {
  return evalMemory({
    id: M1_MEMORY_ID,
    text: 'Prefers independent bookstores and literary neighborhoods.',
    kind: 'preference',
    subject: { facet: 'category', value: 'bookstore' },
    strength: 0.8,
    sourceRef: 'turn:M1:setup',
  })
}

/** The other half of the same sentence, since area_character exists (2026-09-30). */
export function m1AreaMemory(): Memory {
  return evalMemory({
    id: `${M1_MEMORY_ID}_area`,
    text: 'Prefers independent bookstores and literary neighborhoods.',
    kind: 'preference',
    subject: { facet: 'area_character', value: 'literary' },
    strength: 0.8,
    sourceRef: 'turn:M1:setup',
  })
}

function rankMap(trip: ReturnType<typeof buildTrip>): Map<string, number> {
  return new Map(neutralRanking(trip).map((scored, index) => [scored.place.placeId, index + 1]))
}

// ─────────────────────────────────────────────── M1

export async function runM1(): Promise<ScenarioResult> {
  const catalogue = catalogues.retrieved()
  const intent = ['Explore Tokyo slowly, with Showa-era cultural atmosphere.']
  const considering = ['No taxis.']
  const memory = m1Memory()
  const area = m1AreaMemory()

  const withMemory = buildTrip({ catalogue, intent, considering, memories: [memory, area] })
  const without = buildTrip({ catalogue, intent, considering, memories: [] })

  // Same comparison with the traveller's own measured pace (3 stops/day) active too.
  const pacedWith = buildTrip({ catalogue, intent, considering, memories: [pacePattern(), memory, area] })
  const pacedWithout = buildTrip({ catalogue, intent, considering, memories: [pacePattern()] })

  const ranksA = rankMap(withMemory)
  const ranksB = rankMap(without)
  const moves = [...ranksA].map(([placeId, rank]) => ({ placeId, delta: ranksB.get(placeId)! - rank }))
  const movedUp = moves.filter((move) => move.delta > 0)
  const movedDown = moves.filter((move) => move.delta < 0)
  const material = moves.filter((move) => Math.abs(move.delta) >= 3)

  const itemsA = allItems(withMemory.plan)
  const itemsB = allItems(without.plan)
  const key = (item: { dayIndex: number; role?: string; placeId: string }) => `${item.dayIndex}:${item.role}:${item.placeId}`
  const changed = itemsA.filter((item) => !itemsB.some((other) => key(other) === key(item)))
  const memorySupported = itemsA.filter((item) => catalogue.get(item.placeId)?.category === 'bookstore')
  const bookstoresWithout = itemsB.filter((item) => catalogue.get(item.placeId)?.category === 'bookstore').length
  const placesAdded = [...new Set(itemsA.map((item) => item.placeId))].filter((placeId) => !itemsB.some((item) => item.placeId === placeId))
  const cited = itemsA.filter((item) => item.rationaleRefs?.memoryIds.includes(M1_MEMORY_ID))
  void area
  const fakeCitations = cited.filter((item) => catalogue.get(item.placeId)?.category !== 'bookstore')

  const pacedSupported = allItems(pacedWith.plan).filter((item) => catalogue.get(item.placeId)?.category === 'bookstore')
  const pacedChanged = allItems(pacedWith.plan).filter(
    (item) => !allItems(pacedWithout.plan).some((other) => key(other) === key(item)),
  )

  const claimLimit = claimsAllowed(memory, 5)
  const bookstoreRanks = [...ranksA]
    .filter(([placeId]) => catalogue.get(placeId)?.category === 'bookstore')
    .map(([placeId, rank]) => ({ name: catalogue.get(placeId)!.name, withMemory: rank, without: ranksB.get(placeId) }))

  const taxiTag = tagConsidering('No taxis.', catalogue)
  const route = routeOf(withMemory)
  const relevance: number[] = itemsA.filter((item) => item.role !== 'dinner' && item.role !== 'nightcap').map((item) => judgePoi(catalogue.get(item.placeId)!, LITERARY_SHOWA).score)
  const meanRelevance = relevance.reduce((sum, value) => sum + value, 0) / relevance.length

  const checks = [
    check('ranking_changes', 'correctness', 'At least one candidate ranking materially changes due to Memory (|Δrank| ≥ 3)',
      material.length > 0, { materialMoves: material.length, movedUp: movedUp.length, movedDown: movedDown.length, bookstoreRanks },
      { onFail: { severity: 'P1', category: 'MEMORY_FAILURE' } }),
    check('memory_supported_poi', 'correctness', 'Final recommendation set contains at least one Memory-supported POI (default pace)',
      memorySupported.length > 0, memorySupported.map((item) => `Day ${item.dayIndex + 1} ${item.role}: ${catalogue.get(item.placeId)?.name}`),
      { onFail: { severity: 'P1', category: 'MEMORY_FAILURE' } }),
    check('memory_supported_at_own_pace', 'relevance', "Memory still reaches the plan at the traveller's own measured pace (3 stops/day)",
      pacedSupported.length > 0,
      { pacedBookstores: pacedSupported.length, pacedChangedItems: pacedChanged.length, rolesAdmittingBookstoreAt3: rolesAdmitting(pacedWith, 'bookstore') },
      { weight: 'partial', onFail: { severity: 'P1', category: 'RANKING_FAILURE' } }),
    check('final_relevance', 'relevance', 'Final non-meal POIs (activities + lunch) mean relevance to the Showa/literary intent ≥ 1.0 (rubric)',
      meanRelevance >= 1, { meanRelevance: Number(meanRelevance.toFixed(2)), perItem: relevance },
      { weight: 'partial', onFail: { severity: 'P1', category: 'RANKING_FAILURE' } }),
    check('memory_refs', 'explainability', 'Trace shows which Memory affected which candidate (memoryRefs on memory-placed stops)',
      memorySupported.length > 0 && memorySupported.every((item) => item.rationaleRefs?.memoryIds.includes(M1_MEMORY_ID)),
      cited.map((item) => ({ item: item.id, place: catalogue.get(item.placeId)?.name, reasons: item.reasons?.map((reason) => reason.text) })),
      { onFail: { severity: 'P1', category: 'EVIDENCE_FAILURE' } }),
    check('no_fake_rationale', 'explainability', 'No rationale cites the Memory where its score contribution is zero',
      fakeCitations.length === 0, fakeCitations.map((item) => catalogue.get(item.placeId)?.name),
      { onFail: { severity: 'P1', category: 'EVIDENCE_FAILURE' } }),
    check('not_hard_constraint', 'control', 'Memory is not a hard constraint: non-bookstore stops remain on every day',
      withMemory.plan.days.every((day) => day.items.some((item) => catalogue.get(item.placeId)?.category !== 'bookstore')),
      { bookstoresInPlan: memorySupported.length, stops: itemsA.length },
      { onFail: { severity: 'P0', category: 'MEMORY_FAILURE' } }),
    check('claim_bound', 'efficiency', 'Memory adds no more bookstores than its own claim bound (claimsAllowed), counted against the no-memory plan',
      memorySupported.length - bookstoresWithout <= claimLimit,
      { bookstoresInPlan: memorySupported.length, bookstoresWithoutMemory: bookstoresWithout, claimLimit },
      { weight: 'partial', onFail: { severity: 'P1', category: 'RANKING_FAILURE' } }),
    check('provenance_truthful', 'explainability', 'Rationale states the Memory provenance truthfully (explicit statement ≠ photos/saved places)',
      !cited.some((item) => (item.reasons ?? []).some((reason) => /photos and saved places/i.test(reason.text))),
      cited.slice(0, 2).map((item) => item.reasons?.[0]?.text),
      { weight: 'partial', onFail: { severity: 'P1', category: 'EVIDENCE_FAILURE' } }),
    check('scoped_change', 'efficiency', 'Memory changes only a bounded set of places (≤ 2 × claim limit new places; moving a place to another day is not a change)',
      placesAdded.length <= claimLimit * 2, { placesAdded: placesAdded.map((placeId) => catalogue.get(placeId)?.name), stopsInDifferentSlots: changed.length, claimLimit },
      { weight: 'partial', onFail: { severity: 'P2', category: 'RANKING_FAILURE' } }),
    check('no_taxis_represented', 'efficiency', '"No taxis." is represented as a structured constraint (not a free-text ranking term)',
      taxiTag !== undefined, { tag: taxiTag ?? null, maxHopKm: Math.max(...route.map((day) => day.maxHopKm)), maxSpanKm: Math.max(...route.map((day) => day.spanKm)) },
      { weight: 'partial', onFail: { severity: 'P2', category: 'CONSTRAINT_FAILURE' } }),
  ]

  return scoreScenario({
    id: 'M1', title: 'Memory influence', smoke: true, checks,
    observations: {
      memoryInfluence: {
        movedUp: movedUp.length,
        movedDown: movedDown.length,
        finalSelectionsChanged: changed.length,
        memoryScoreContribution: 'memoryMatch = 0.8 for bookstores (weight 1.5 of Σ≈7.25 → ≈ +0.17 total); 0 elsewhere',
        bookstoreRanks,
      },
      finalWithMemory: itemsA.map((item) => `D${item.dayIndex + 1} ${item.role}: ${catalogue.get(item.placeId)?.name} [${catalogue.get(item.placeId)?.category}]`),
      finalWithoutMemory: itemsB.map((item) => `D${item.dayIndex + 1} ${item.role}: ${catalogue.get(item.placeId)?.name} [${catalogue.get(item.placeId)?.category}]`),
      atOwnPace: { bookstores: pacedSupported.length, changedStops: pacedChanged.length },
    },
  })
}

// ─────────────────────────────────────────────── M2

const ICONIC = new Set(['sensoji', 'tokyo_national_museum', 'ueno_park', 'tsukiji_outer', 'ameyoko'])

export async function runM2(): Promise<ScenarioResult> {
  const catalogue = catalogues.bundled()
  // Since 2026-09-30 the spec memory is stored as itself: an aversion to landmarks.
  const proxy = evalMemory({
    id: 'mem_eval_m2_quiet',
    text: 'Prefers quiet, less crowded places.',
    kind: 'aversion',
    subject: { facet: 'popularity', value: 'landmark' },
    polarity: -1,
    strength: 0.8,
    sourceRef: 'turn:M2:setup',
  })
  const iconicIntent = ['This trip I want to experience iconic Tokyo landmarks even if crowded.']
  const neutralIntent = ['Slow-paced.']

  const stateWins = buildTrip({ catalogue, intent: iconicIntent, memories: [proxy] })
  const memoryOnly = buildTrip({ catalogue, intent: neutralIntent, memories: [proxy] })
  const stateOnly = buildTrip({ catalogue, intent: iconicIntent, memories: [] })

  const rank = (trip: ReturnType<typeof buildTrip>) => rankMap(trip).get('sensoji')!
  const iconicIn = (trip: ReturnType<typeof buildTrip>) => allItems(trip.plan).filter((item) => ICONIC.has(item.placeId))
  const sensojiItem = allItems(stateWins.plan).find((item) => item.placeId === 'sensoji')
  // Quoted Intent text is stripped first: it contains "this trip" and "crowded" itself.
  const reasonsText = allItems(stateWins.plan).flatMap((item) => item.reasons?.map((reason) => reason.text) ?? []).join(' ').replace(/“[^”]*”/g, '')
  const mentionsConflict = /quiet|less crowded|usually|even though|although|despite|your memory|you tend|would rather avoid/i.test(reasonsText)
  const candidatesInPool = catalogue.candidates({ category: 'temple_shrine' }).length

  const checks = [
    check('memory_representable', 'relevance', '"Quiet, less crowded" can be stored as a Memory the planner reads',
      proxy.subject.facet === 'popularity' && (scorePlace(catalogue.get('sensoji')!, buildRankingContext({ state: memoryOnly.state, memorySnapshot: memoryOnly.trip.memorySnapshot, catalogue, geography: { dayPlaceIds: [], usedPlaceIds: [] } })).components.memoryMatch ?? 0) < 0,
      { subject: proxy.subject, note: 'memoryMatch on Senso-ji must be negative' },
      { weight: 'partial', onFail: { severity: 'P1', category: 'MEMORY_FAILURE' } }),
    check('iconic_remain_candidates', 'correctness', 'Iconic / crowded POIs remain candidates under the conflicting Memory',
      candidatesInPool > 0 && rank(stateWins) !== undefined, { sensojiNeutralRank: rank(stateWins), templeShrineCandidates: candidatesInPool },
      { onFail: { severity: 'P0', category: 'FILTER_FAILURE' } }),
    check('state_over_memory', 'correctness', 'State > Memory is observable: Senso-ji ranks higher with the iconic Intent than with Memory alone, and reaches the plan',
      rank(stateWins) < rank(memoryOnly) && sensojiItem !== undefined,
      { sensojiRank: { stateAndMemory: rank(stateWins), memoryOnly: rank(memoryOnly), stateOnly: rank(stateOnly) }, sensojiInPlan: sensojiItem ? `Day ${sensojiItem.dayIndex + 1} ${sensojiItem.role}` : null },
      { onFail: { severity: 'P1', category: 'RANKING_FAILURE' } }),
    check('conflict_in_trace', 'explainability', 'Trace indicates the State/Memory conflict and the current-trip override',
      mentionsConflict, { sensojiReasons: sensojiItem?.reasons?.map((reason) => reason.text) ?? null },
      { weight: 'partial', onFail: { severity: 'P1', category: 'EVIDENCE_FAILURE' } }),
    check('memory_not_erased', 'explainability', 'The Memory is still visible as a signal (not silently dropped from the snapshot)',
      stateWins.trip.memorySnapshot.memories.some((memory) => memory.id === proxy.id), { snapshot: stateWins.trip.memorySnapshot.memories.map((memory) => memory.id) },
      { onFail: { severity: 'P1', category: 'EVIDENCE_FAILURE' } }),
    check('not_hard_exclusion', 'control', 'Memory is not applied as a hard exclusion',
      iconicIn(stateWins).length > 0, { iconicInPlan: iconicIn(stateWins).map((item) => item.placeId) },
      { onFail: { severity: 'P0', category: 'FILTER_FAILURE' } }),
    check('override_scoped', 'efficiency', 'Override is scoped: no more iconic stops than the no-Memory plan',
      iconicIn(stateWins).length <= iconicIn(stateOnly).length,
      { withMemory: iconicIn(stateWins).length, noMemory: iconicIn(stateOnly).length },
      { weight: 'partial', onFail: { severity: 'P2', category: 'RANKING_FAILURE' } }),
  ]

  return scoreScenario({
    id: 'M2', title: 'State override', smoke: true, checks,
    observations: {
      sensojiRank: { stateAndMemory: rank(stateWins), memoryOnly: rank(memoryOnly), stateOnly: rank(stateOnly) },
      iconicStops: { stateAndMemory: iconicIn(stateWins).map((i) => i.placeId), memoryOnly: iconicIn(memoryOnly).map((i) => i.placeId), stateOnly: iconicIn(stateOnly).map((i) => i.placeId) },
    },

  })
}

// ─────────────────────────────────────────────── M3

export async function runM3(): Promise<ScenarioResult> {
  const MESSAGE = 'I never enjoy crowded tourist spots.'
  const trip = createTokyoTrip()
  const catalogue = catalogues.bundled()
  const bundled = JSON.parse(readFileSync('data/demo_tokyo_v1/memories.json', 'utf8')) as BundledMemory[]
  const repositories = createRepositories()
  await seedProfile(bundled, repositories.memories, NOW.toISOString(), { autoActivate: true })
  const before = await loadProfileMemories(repositories.memories)
  const snapshotBefore = JSON.stringify(trip.trip.memorySnapshot)
  const planBefore = JSON.stringify(trip.plan)
  const stateBefore = JSON.stringify(trip.state)

  const operation = routeMessage({ message: MESSAGE, plan: trip.plan, catalogue })
  const outcome = await handleChatMessage({
    message: MESSAGE, tripId: 'trip_1', frame: trip.frame, state: trip.state, plan: trip.plan, catalogue,
    llm: createStubLlm(), now: NOW, proposalId: 'prop_m3', createdAt: NOW.toISOString(),
    memorySnapshot: trip.trip.memorySnapshot,
    turnId: 'chat:trip_1:turn_m3',
  })
  // As the app store does: candidates go to the Profile on their own path.
  if (outcome.kind !== 'conflict') {
    for (const memory of outcome.memoryCandidates ?? []) await repositories.memories.save(memory)
  }

  const after = await loadProfileMemories(repositories.memories)
  const added = after.filter((memory) => !before.some((old) => old.id === memory.id))
  const activeAdded = added.filter((memory) => memory.status === 'active')
  const fromTurn = added.filter((memory) => memory.provenance.sourceRefs.some((ref) => ref.includes('chat') || ref.includes('turn')))
  const proposalOk = outcome.kind !== 'proposal' || outcome.proposal.type === 'reframe'

  const checks = [
    check('candidate_created', 'correctness', 'A candidate Memory is created from the chat statement',
      added.length > 0, { outcome: outcome.kind, routedTo: operation.kind, memoriesAdded: added.length },
      { onFail: { severity: 'P1', category: 'MEMORY_FAILURE' } }),
    check('current_trip_state_proposal', 'relevance', 'Current-trip impact is offered as a State (Reframe) proposal',
      outcome.kind === 'proposal' && outcome.proposal.type === 'reframe',
      { outcome: outcome.kind, text: outcome.kind === 'answer' ? outcome.text : undefined },
      { weight: 'partial', onFail: { severity: 'P1', category: 'CLASSIFICATION_FAILURE' } }),
    check('provenance_to_turn', 'explainability', 'Candidate provenance points to the triggering chat turn',
      fromTurn.length > 0, { added: added.map((memory) => memory.provenance) },
      { onFail: { severity: 'P1', category: 'EVIDENCE_FAILURE' } }),
    check('independent_storage', 'explainability', 'Candidate Memory and any Reframe proposal are stored independently',
      added.length > 0, 'no candidate Memory exists to store', { weight: 'partial' }),
    check('not_auto_active', 'control', 'No silent conversion chat → active Memory',
      activeAdded.length === 0, { activeAdded: activeAdded.map((memory) => memory.id) },
      { onFail: { severity: 'P0', category: 'CONTROL_FAILURE' } }),
    check('snapshot_immutable', 'control', 'Active trip Memory snapshot unchanged',
      JSON.stringify(trip.trip.memorySnapshot) === snapshotBefore && Object.isFrozen(trip.trip.memorySnapshot), { frozen: Object.isFrozen(trip.trip.memorySnapshot) },
      { onFail: { severity: 'P0', category: 'CONTROL_FAILURE' } }),
    check('reframe_rules', 'control', 'If a current-trip State change is proposed it follows Reframe confirmation rules',
      proposalOk && JSON.stringify(trip.plan) === planBefore && JSON.stringify(trip.state) === stateBefore, { outcome: outcome.kind },
      { onFail: { severity: 'P0', category: 'CONTROL_FAILURE' } }),
    check('no_scope_creep', 'efficiency', 'Statement does not trigger an unrelated plan change',
      !(outcome.kind === 'proposal' && outcome.proposal.type === 'replace'), { routedTo: operation },
      { weight: 'partial', onFail: { severity: 'P1', category: 'CLASSIFICATION_FAILURE' } }),
  ]

  return scoreScenario({
    id: 'M3', title: 'Candidate Memory', smoke: false, checks,
    observations: {
      routedTo: operation.kind, outcome: outcome.kind, reply: outcome.kind === 'answer' ? outcome.text : null,
      memoriesBefore: before.length, memoriesAfter: after.length,
      candidates: added,
      proposal: outcome.kind === 'proposal' ? { type: outcome.proposal.type, rationale: outcome.proposal.rationale, stateAdded: outcome.proposal.candidateState.considering.at(-1)?.text, planChanges: outcome.proposal.planDiff.modified.length + outcome.proposal.planDiff.removed.length } : null,
    },
  })
}
