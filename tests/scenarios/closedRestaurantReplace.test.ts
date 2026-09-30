/**
 * scenario_replace_closed_restaurant (product_spec §17.3, Gate 3 steps 6-9).
 *
 * The scripted input is the one bound in demo_scenario.json:
 *   "The ramen place on Day 2 is closed today."
 */

import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  confirmReview,
  defaultPriorities,
  toFrame,
  type StageAInput,
} from '../../src/application/createTrip/createTrip.ts'
import { generateFirstPlan } from '../../src/application/generatePlan/generatePlan.ts'
import { handleChatMessage } from '../../src/application/handleChat/handleChat.ts'
import {
  confirmProposal,
  rejectProposal,
} from '../../src/application/commitProposal/commitProposalUseCase.ts'
import { createPlaceCatalogue, toValidationPlaces } from '../../src/services/places/catalogue.ts'
import { pacePattern } from './tokyoTrip.ts'
import { validatePlan } from '../../src/domain/validation/validate.ts'
import { isOpenFor, weekdayKey } from '../../src/domain/places/openingHours.ts'
import { dateOfDay } from '../../src/domain/trip/phase.ts'
import { createStubLlm } from '../../src/services/llm/stubLlm.ts'
import { createRepositories } from '../../src/services/persistence/inMemory.ts'
import { allItems } from '../../src/domain/plan/types.ts'
import type { Plan } from '../../src/domain/plan/types.ts'
import type { TripState } from '../../src/domain/state/types.ts'
import type { TripFrame } from '../../src/domain/trip/types.ts'
import type { DemoPlace } from '../../src/services/places/types.ts'

const places = JSON.parse(readFileSync('data/demo_tokyo_v1/tokyo_places.json', 'utf8')) as DemoPlace[]
const scenario = JSON.parse(readFileSync('data/demo_tokyo_v1/demo_scenario.json', 'utf8')) as {
  events: Array<{ id: string; day: number; text: string; placeId?: string; alternativePlaceIds?: string[] }>
}
const catalogue = createPlaceCatalogue(places)
const NOW = new Date('2026-09-21T09:00:00')

const EVENT = scenario.events.find((event) => event.id === 'evt_closed_restaurant')!

const SETUP: StageAInput = {
  name: 'Tokyo Slow Week',
  startDate: '2026-10-05', endDate: '2026-10-09',
  baseLodgingPlaceId: 'kuramae_base', baseLodgingName: 'Kuramae',
  intentText: 'Slow-paced.', consideringText: 'Moderate budget.',
}

let frame: TripFrame
let state: TripState
let plan: Plan

/**
 * The scripted message, with its day taken from the plan in front of it.
 *
 * The scenario names Day 2 because that is where the ramen sat when the script was
 * written. Which day it sits on now is the planner's call, and forcing the plan to
 * match the script meant swapping two stops between days — which quietly scheduled a
 * sushi counter on the Monday it shuts, and then became impossible altogether when
 * the lunch role stopped accepting markets.
 *
 * The product already answers this question the same way: `phraseForPlan` re-words a
 * scripted request for the plan each condition actually produced (§15.2). Doing it
 * here keeps the test about the Replace rather than about the fixture.
 */
function ramenDayIndex(source: Plan): number {
  const stop = allItems(source).find((item) => item.placeId === EVENT.placeId)
  if (!stop) throw new Error(`no ${EVENT.placeId} in the generated plan`)
  return stop.dayIndex
}

function messageFor(source: Plan): string {
  return EVENT.text.replace(/\bday\s*\d+\b/i, `Day ${ramenDayIndex(source) + 1}`)
}

beforeEach(() => {
  frame = toFrame(SETUP)
  const confirmed = confirmReview({
    tripId: 'trip_1', frame,
    draft: { intent: [], considering: [], priorities: defaultPriorities() },
    // The traveller's own measured pace, so this plans the same three-stop day the
    // rest of the scenarios do. Without it the day attempts all eight roles, which
    // this catalogue cannot fill — and the test would be exercising that rather than
    // the replacement it is about.
    profileMemories: [pacePattern()], catalogue, createdAt: NOW.toISOString(),
  })
  state = confirmed.state
  plan = generateFirstPlan({
    frame,
    state,
    catalogue,
    days: 5,
    now: NOW,
    memorySnapshot: confirmed.trip.memorySnapshot,
  }).plan

  // A generated plan should never be invalid. Fail here rather than eleven
  // assertions later.
  const seeded = validatePlan(plan, {
    frame,
    state,
    places: toValidationPlaces(catalogue),
    now: NOW,
  })
  if (!seeded.valid) {
    throw new Error(`fixture plan is invalid: ${JSON.stringify(seeded.errors)}`)
  }
})

async function proposeReplacement(replacementPlaceId = 'ramen_afuri') {
  return handleChatMessage({
    message: messageFor(plan), tripId: 'trip_1', frame, state, plan, catalogue,
    llm: createStubLlm({ replacementPlaceId }),
    now: NOW, proposalId: 'prop_1', createdAt: NOW.toISOString(),
  })
}

describe('scenario_replace_closed_restaurant', () => {
  it('has a bound scenario event with alternatives', () => {
    // Bound to a real ramen place, whichever one — the id is demo data, and
    // the assertions below all read it from here rather than repeating it.
    expect(catalogue.get(EVENT.placeId!)?.category).toBe('ramen')
    // Three, which is §5.6's floor. It was briefly two, while the catalogue
    // recorded only each day's first opening period and most counters therefore
    // looked lunch-only. Ichiran Shibuya is still left out: it genuinely opens on
    // Sundays only, so it could never be taken on a Monday-to-Friday trip.
    expect(EVENT.alternativePlaceIds?.length).toBeGreaterThanOrEqual(3)
    for (const id of EVENT.alternativePlaceIds!) expect(catalogue.has(id)).toBe(true)
  })

  it('resolves the message to the ramen stop, on whichever day it sits', async () => {
    const outcome = await proposeReplacement()
    expect(outcome.kind).toBe('proposal')
    if (outcome.kind !== 'proposal') return

    const [change] = outcome.proposal.planDiff.modified
    expect(change.before.placeId).toBe(EVENT.placeId)
    expect(change.before.dayIndex).toBe(ramenDayIndex(plan))
  })

  it('is classified Replace by code, not by the model', async () => {
    const outcome = await proposeReplacement()
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')
    expect(outcome.proposal.type).toBe('replace')
    expect(outcome.proposal.stateDiff).toBeDefined()
    expect(outcome.proposal.planDiff.modified).toHaveLength(1)
    expect(outcome.proposal.planDiff.added).toHaveLength(0)
    expect(outcome.proposal.planDiff.removed).toHaveLength(0)
  })

  it('keeps the slot time unchanged — identity swap only', async () => {
    const outcome = await proposeReplacement()
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')
    const [change] = outcome.proposal.planDiff.modified
    expect(change.fields).toEqual(['placeId'])
  })

  it('chooses a replacement that exists in the bundle', async () => {
    const outcome = await proposeReplacement()
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')
    const [change] = outcome.proposal.planDiff.modified
    expect(catalogue.has(change.after.placeId)).toBe(true)
    expect(catalogue.get(change.after.placeId)?.category).toBe('ramen')
  })

  it('rejects a hallucinated placeId instead of proposing it', async () => {
    const outcome = await handleChatMessage({
      message: messageFor(plan), tripId: 'trip_1', frame, state, plan, catalogue,
      llm: createStubLlm({ hallucinatePlaceId: 'ramen_that_does_not_exist' }),
      now: NOW, proposalId: 'prop_1', createdAt: NOW.toISOString(),
    })
    expect(outcome.kind).toBe('conflict')
  })

  it('leaves the current Plan untouched while the proposal is pending', async () => {
    const before = JSON.stringify(plan)
    const outcome = await proposeReplacement()
    expect(outcome.kind).toBe('proposal')
    expect(JSON.stringify(plan)).toBe(before)
    expect(plan.version).toBe(1)
  })

  it('commits on Confirm: plan version up, State preserved, one Receipt', async () => {
    const outcome = await proposeReplacement()
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')

    const repositories = createRepositories()
    const result = await confirmProposal({
      proposal: outcome.proposal, state, plan, catalogue, repositories,
      receiptId: 'rcpt_1', timestamp: NOW.toISOString(),
    })

    expect(result.plan.version).toBe(2)
    expect(result.state.version).toBe(1)
    expect(result.proposal.status).toBe('committed')

    const receipts = await repositories.receipts.listByTrip('trip_1')
    expect(receipts).toHaveLength(1)
    expect(receipts[0].type).toBe('replace')
    expect(receipts[0].trigger).toBe(messageFor(plan))
    expect(receipts[0].resultingPlanVersion).toBe(2)
    expect(receipts[0].rationale.length).toBeGreaterThan(0)
    expect(receipts[0].timestamp).toBe(NOW.toISOString())
  })

  it('updates the itinerary to the replacement', async () => {
    const outcome = await proposeReplacement('ramen_afuri')
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')

    const result = await confirmProposal({
      proposal: outcome.proposal, state, plan, catalogue,
      repositories: createRepositories(), receiptId: 'rcpt_1', timestamp: NOW.toISOString(),
    })

    const day = result.plan.days.find((entry) => entry.dayIndex === ramenDayIndex(plan))!
    expect(day.items.some((item) => item.placeId === 'ramen_afuri')).toBe(true)
    expect(day.items.some((item) => item.placeId === EVENT.placeId)).toBe(false)
  })

  it('writes exactly one Receipt per committed transaction, not one per POI', async () => {
    const outcome = await proposeReplacement()
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')

    const repositories = createRepositories()
    await confirmProposal({
      proposal: outcome.proposal, state, plan, catalogue, repositories,
      receiptId: 'rcpt_1', timestamp: NOW.toISOString(),
    })
    expect(await repositories.receipts.listByTrip('trip_1')).toHaveLength(1)
  })

  it('on Keep current: proposal rejected, plan unchanged, no Receipt', async () => {
    const outcome = await proposeReplacement()
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')

    const repositories = createRepositories()
    const rejected = await rejectProposal({ proposal: outcome.proposal, repositories })

    expect(rejected.status).toBe('rejected')
    expect(plan.version).toBe(1)
    expect(
      plan.days.find((entry) => entry.dayIndex === ramenDayIndex(plan))!.items.some((i) => i.placeId === EVENT.placeId),
    ).toBe(true)
    expect(await repositories.receipts.listByTrip('trip_1')).toHaveLength(0)
  })

  it('reports a Conflict rather than proposing an invalid plan', async () => {
    // A catalogue with a single ramen place leaves nothing to swap to.
    const thin = createPlaceCatalogue(
      places.filter((place) => place.category !== 'ramen' || place.placeId === EVENT.placeId),
    )
    const outcome = await handleChatMessage({
      message: messageFor(plan), tripId: 'trip_1', frame, state, plan, catalogue: thin,
      llm: createStubLlm(), now: NOW, proposalId: 'prop_1', createdAt: NOW.toISOString(),
    })
    expect(outcome.kind).toBe('conflict')
  })
})
