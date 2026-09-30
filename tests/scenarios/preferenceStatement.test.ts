/**
 * Something the traveller says about themselves (eval M3, 2026-09-30).
 *
 *   "I never enjoy crowded tourist spots."
 *
 * Two independent results: a CANDIDATE memory for future trips, whose provenance is
 * the chat turn, and a Reframe proposal for this trip. Neither activates anything.
 */

import { describe, expect, it } from 'vitest'

import { handleChatMessage, routeMessage } from '../../src/application/handleChat/handleChat.ts'
import { allItems } from '../../src/domain/plan/types.ts'
import { createStubLlm } from '../../src/services/llm/stubLlm.ts'
import { catalogue, createTokyoTrip, NOW } from './tokyoTrip.ts'

function say(message: string, trip = createTokyoTrip()) {
  return handleChatMessage({
    message, tripId: 'trip_1', frame: trip.frame, state: trip.state, plan: trip.plan, catalogue,
    llm: createStubLlm(), now: NOW, proposalId: 'prop_pref', createdAt: NOW.toISOString(),
    memorySnapshot: trip.trip.memorySnapshot, turnId: 'chat:trip_1:msg_7',
  })
}

describe('a preference statement', () => {
  it('is routed as a statement about the traveller, not a stop', () => {
    const trip = createTokyoTrip()
    expect(routeMessage({ message: 'I never enjoy crowded tourist spots.', plan: trip.plan, catalogue })).toMatchObject({
      kind: 'preference_statement',
      polarity: -1,
    })
  })

  it('becomes a candidate memory, never an active one, with the chat turn as provenance', async () => {
    const outcome = await say('I never enjoy crowded tourist spots.')
    expect(outcome.kind).not.toBe('conflict')
    if (outcome.kind === 'conflict') return
    expect(outcome.memoryCandidates).toHaveLength(1)
    const [memory] = outcome.memoryCandidates!
    expect(memory).toMatchObject({
      status: 'candidate',
      kind: 'aversion',
      polarity: -1,
      subject: { facet: 'popularity', value: 'landmark' },
      provenance: { type: 'explicit_statement', sourceRefs: ['chat:trip_1:msg_7'] },
    })
  })

  it('offers this trip a Reframe that takes the landmarks out, previewed first', async () => {
    const trip = createTokyoTrip()
    const before = JSON.stringify(trip.plan)
    const snapshot = JSON.stringify(trip.trip.memorySnapshot)
    const outcome = await say('I never enjoy crowded tourist spots.', trip)
    if (outcome.kind !== 'proposal') throw new Error(`expected a proposal, got ${outcome.kind}`)

    expect(outcome.proposal.type).toBe('reframe')
    expect(outcome.proposal.candidateState.considering.at(-1)).toMatchObject({
      text: 'Avoid crowded tourist spots',
      tag: { kind: 'avoid', value: 'crowded tourist spots' },
    })
    const landmarks = allItems(trip.plan).filter((item) => catalogue.get(item.placeId)?.tags.includes('landmark'))
    for (const item of landmarks) {
      expect(allItems(outcome.proposal.candidatePlan).some((stop) => stop.placeId === item.placeId)).toBe(false)
    }
    // Pending: nothing committed, and the trip's memory snapshot untouched.
    expect(JSON.stringify(trip.plan)).toBe(before)
    expect(JSON.stringify(trip.trip.memorySnapshot)).toBe(snapshot)
  })

  it('reads a kind of neighbourhood as an area character', async () => {
    const outcome = await say('I love literary neighbourhoods.')
    if (outcome.kind === 'conflict') throw new Error('unexpected conflict')
    expect(outcome.memoryCandidates?.map((memory) => memory.subject)).toContainEqual({ facet: 'area_character', value: 'literary' })
    expect(outcome.memoryCandidates?.every((memory) => memory.kind === 'preference')).toBe(true)
  })

  it('still treats a named stop as a swap, not a statement', () => {
    const trip = createTokyoTrip()
    const ramen = allItems(trip.plan).find((item) => catalogue.get(item.placeId)?.category === 'ramen')!
    expect(
      routeMessage({ message: `I don't like the ramen place on Day ${ramen.dayIndex + 1}.`, plan: trip.plan, catalogue }).kind,
    ).toBe('replace_place')
  })

  it('asks rather than guessing when it cannot tell what kind of place is meant', async () => {
    const outcome = await say('I really enjoy nice things.')
    expect(outcome.kind).toBe('answer')
    if (outcome.kind !== 'answer') return
    expect(outcome.memoryCandidates).toBeUndefined()
  })
})
