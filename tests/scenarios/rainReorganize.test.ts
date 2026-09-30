/**
 * scenario_reorganize_rain (§17.3, Gate 5 demo scenario 2; revised 2026-09-30).
 *
 * Scripted input from demo_scenario.json:
 *   "It's going to rain after 3pm on Day 3."
 *
 * Rain changes where the traveller can comfortably be, not how long the day is.
 * Before 2026-09-30 it was read as "finish the day by 15:00", which dropped an
 * indoor dinner. Now only what is outdoors after the rain starts is re-planned —
 * indoors, in the same slot — and a day with nothing outdoors then is left alone.
 *
 * As before, nothing in the pipeline says what kind of change it is: the classifier
 * reads the diff.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { handleChatMessage } from '../../src/application/handleChat/handleChat.ts'
import { routeMessage } from '../../src/application/handleChat/route.ts'
import { confirmProposal } from '../../src/application/commitProposal/commitProposalUseCase.ts'
import { isOutdoor } from '../../src/domain/places/outdoor.ts'
import { createStubLlm } from '../../src/services/llm/stubLlm.ts'
import { createRepositories } from '../../src/services/persistence/inMemory.ts'
import { allItems, type PlanItem } from '../../src/domain/plan/types.ts'
import { catalogue, createTokyoTrip, eventText, NOW, type TokyoTrip } from './tokyoTrip.ts'

/** The eval spec's sentence. The demo script now uses an all-day rain (see below). */
const MESSAGE = "It's going to rain after 3pm on Day 3."
const DAY_INDEX = 2

let trip: TokyoTrip

beforeEach(() => {
  trip = createTokyoTrip()
})

function propose(message = MESSAGE) {
  return handleChatMessage({
    message,
    tripId: 'trip_1',
    frame: trip.frame,
    state: trip.state,
    plan: trip.plan,
    catalogue,
    llm: createStubLlm(),
    now: NOW,
    proposalId: 'prop_rain',
    createdAt: NOW.toISOString(),
    memorySnapshot: trip.trip.memorySnapshot,
  })
}

const outdoor = (item: PlanItem) => isOutdoor(catalogue.get(item.placeId)!.category)

/** A message that brings rain on while an outdoor stop is still running. */
function rainDuringOutdoorStop(): { message: string; item: PlanItem } {
  const item = allItems(trip.plan).find(outdoor)
  if (!item) throw new Error('fixture plan has no outdoor stop')
  // Half an hour after it starts, so the stop is still running when the rain comes.
  const [hours] = item.startTime.split(':').map(Number)
  const clock = hours > 12 ? `${hours - 12}:30pm` : hours === 12 ? '12:30pm' : `${hours}:30am`
  return { message: `It's going to rain after ${clock} on Day ${item.dayIndex + 1}.`, item }
}

describe('scenario_reorganize_rain', () => {
  it('routes the message to weather, not to a day cut-off', () => {
    expect(routeMessage({ message: MESSAGE, plan: trip.plan, catalogue })).toEqual({
      kind: 'weather_after',
      dayIndex: DAY_INDEX,
      from: '15:00',
      reason: MESSAGE,
    })
  })

  it('reads a bare "after 3" as the afternoon', () => {
    expect(routeMessage({ message: 'Rain is coming after 3 on Day 3.', plan: trip.plan, catalogue })).toMatchObject({
      kind: 'weather_after',
      from: '15:00',
    })
  })

  it('reads the demo script\'s all-day rain as weather from the start of that day', () => {
    expect(routeMessage({ message: eventText('evt_rain'), plan: trip.plan, catalogue })).toMatchObject({
      kind: 'weather_after',
      dayIndex: 1,
      from: '00:00',
    })
  })

  it('still reads "back by" as a cut-off for the day', () => {
    expect(routeMessage({ message: 'We need to be back by 3pm on Day 3.', plan: trip.plan, catalogue })).toMatchObject({
      kind: 'clear_after',
      endBy: '15:00',
    })
  })

  it('leaves a day alone when nothing is outdoors after the rain starts', async () => {
    const affected = trip.plan.days[DAY_INDEX].items.filter((item) => outdoor(item) && item.endTime > '15:00')
    const outcome = await propose()
    if (affected.length > 0) {
      expect(outcome.kind).toBe('proposal')
      return
    }
    expect(outcome.kind).toBe('answer')
    if (outcome.kind !== 'answer') return
    expect(outcome.noChangeNeeded).toBe(true)
    expect(outcome.text).toContain('outdoors')
  })

  describe('with an outdoor stop in the rain', () => {
    it('moves that stop indoors, in the same slot', async () => {
      const { message, item } = rainDuringOutdoorStop()
      const outcome = await propose(message)
      if (outcome.kind !== 'proposal') throw new Error(`expected a proposal, got ${outcome.kind}`)

      const after = outcome.proposal.candidatePlan.days[item.dayIndex].items.find((entry) => entry.id === item.id)
      if (after) {
        expect(outdoor(after)).toBe(false)
        expect(after.startTime).toBe(item.startTime)
        expect(after.reasons?.[0].text).toContain('indoors')
      } else {
        expect(outcome.proposal.rationale).toContain('nothing indoors is open')
      }
    })

    it('never touches an indoor stop, and keeps every meal', async () => {
      const { message, item } = rainDuringOutdoorStop()
      const outcome = await propose(message)
      if (outcome.kind !== 'proposal') throw new Error('expected a proposal')
      const touched = [
        ...outcome.proposal.planDiff.removed,
        ...outcome.proposal.planDiff.modified.map((entry) => entry.before),
      ]
      expect(touched.every(outdoor)).toBe(true)
      expect(touched.map((entry) => entry.id)).toContain(item.id)
      expect(touched.some((entry) => entry.role === 'lunch' || entry.role === 'dinner')).toBe(false)
    })

    it('keeps every other day exactly as it was', async () => {
      const { message, item } = rainDuringOutdoorStop()
      const outcome = await propose(message)
      if (outcome.kind !== 'proposal') throw new Error('expected a proposal')
      for (const day of trip.plan.days.filter((entry) => entry.dayIndex !== item.dayIndex)) {
        expect(outcome.proposal.candidatePlan.days[day.dayIndex]).toEqual(day)
      }
    })

    it('leaves the trip state alone, and is classified from the diff', async () => {
      const { message } = rainDuringOutdoorStop()
      const outcome = await propose(message)
      if (outcome.kind !== 'proposal') throw new Error('expected a proposal')
      expect(outcome.proposal.candidateState).toEqual(trip.state)
      expect(['replace', 'reorganize']).toContain(outcome.proposal.type)
    })

    it('carries an Expected Impact computed by code', async () => {
      const { message } = rainDuringOutdoorStop()
      const outcome = await propose(message)
      if (outcome.kind !== 'proposal') throw new Error('expected a proposal')
      const diff = outcome.proposal.planDiff
      expect(outcome.proposal.impact.itemsAffected).toBe(diff.added.length + diff.removed.length + diff.modified.length)
    })

    it('does not touch the committed plan until it is confirmed', async () => {
      const before = JSON.stringify(trip.plan)
      await propose(rainDuringOutdoorStop().message)
      expect(JSON.stringify(trip.plan)).toBe(before)
    })

    it('commits as one transaction with one Receipt', async () => {
      const outcome = await propose(rainDuringOutdoorStop().message)
      if (outcome.kind !== 'proposal') throw new Error('expected a proposal')

      const repositories = createRepositories()
      const result = await confirmProposal({
        proposal: outcome.proposal,
        state: trip.state,
        plan: trip.plan,
        catalogue,
        repositories,
        receiptId: 'rcpt_1',
        timestamp: NOW.toISOString(),
      })

      expect(result.plan.version).toBe(trip.plan.version + 1)
      expect(result.state.version).toBe(trip.state.version)
      expect(await repositories.receipts.listByTrip('trip_1')).toHaveLength(1)
    })
  })
})
