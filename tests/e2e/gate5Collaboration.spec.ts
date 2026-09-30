/**
 * Gate 5 — full human–agent collaboration, end to end.
 *
 * The five required demo scenarios:
 *   1. restaurant closed      -> Replace
 *   2. rain all day on Day 2  -> Reorganize (outdoor stops move indoors)
 *   3. "I feel tired."        -> Reframe
 *   4. direct State edit      -> Reframe
 *   5. impossible must-visit  -> Conflict
 *
 * plus the proposal lifecycle, Alternatives and the Receipt history the gate
 * also asks for.
 */

import { expect, test, type Page } from '@playwright/test'

import {
  busiestDayStops, closeChat, closeItinerary, createTrip, dayHolding, expectPlanVersion,
  openChat,
  openDecisions, openItinerary, openPoiOnMap, openStopWithSameSlotAlternative, say, unplannedPlace,
} from './helpers.ts'

/** The demo script's rain (2026-09-30): all day on Day 2, which has two outdoor stops. */
const RAIN = "It's going to rain all day on Day 2."
const TIRED = 'I feel tired. Fewer spots.'

/**
 * The scripted closed-restaurant message, with the day filled in from the itinerary.
 *
 * Which day the ramen lands on is the planner's call and has moved with every change
 * to the day structure.
 */
const closedOn = (day: number) => `The ramen place on Day ${day} is closed today.`

/** The day the scripted ramen stop is actually on, with the itinerary left closed. */
async function ramenDay(page: Page): Promise<number> {
  const day = await dayHolding(page, 'ramen_rokurinsha')
  await closeItinerary(page)
  return day
}

/** New Trip -> Plan, with the deterministic stub model. */
async function openPlan(page: Page, considering = 'Moderate budget.') {
  await createTrip(page, considering)
}

/** The Trip State view, reached from the Plan / State control (draft 03). */
async function openState(page: Page) {
  if (await page.getByRole('dialog', { name: 'Chat' }).isVisible()) await closeChat(page)
  await page.getByTestId('view-state').click()
  await expect(page.getByTestId('state-screen')).toBeVisible()
}

// --- Scenario 2: rain -> Reorganize -----------------------------------------

test('rain on Day 2 moves its outdoor stops indoors as a Reorganize, previewed then committed', async ({ page }) => {
  await openPlan(page)
  await say(page, RAIN)

  const proposal = page.getByTestId('proposal')
  await expect(proposal).toBeVisible()
  await expect(proposal).toHaveAttribute('data-change-type', 'reorganize')
  await expect(proposal.getByRole('heading', { name: /Update Day 2/ })).toBeVisible()

  // §7.3: affected range, Before / After, Expected Impact.
  await expect(proposal.getByTestId('plan-diff')).toBeVisible()
  await expect(proposal.getByTestId('expected-impact')).toBeVisible()

  // Pending means pending: the itinerary has not moved.
  await expectPlanVersion(page, 1)

  await proposal.getByTestId('confirm-change').click()
  await expectPlanVersion(page, 2)

  // Day 2 keeps its length; the park and the market street are now indoors.
  await openItinerary(page, 2)
  const timeline = page.getByTestId('timeline')
  await expect(timeline).toContainText('is indoors, in place of Ueno Park')
  await expect(timeline).toContainText('is indoors, in place of Ameyoko market')
  await expect(timeline.getByTestId('updated-badge')).toHaveCount(2)
})

// --- Scenario 3: tired -> Reframe -------------------------------------------

test('"fewer spots" becomes a Reframe that changes State and Plan together', async ({ page }) => {
  await openPlan(page)

  // What "fewer" is measured against: one stop off the fullest day, whatever the
  // day structure currently makes that. It was written here as a flat two, from
  // when a day was three stops.
  const busiest = await busiestDayStops(page)
  await closeItinerary(page)

  await say(page, TIRED)

  const proposal = page.getByTestId('proposal')
  await expect(proposal).toHaveAttribute('data-change-type', 'reframe')
  await expect(proposal.getByRole('heading', { name: 'Change the trip direction' })).toBeVisible()

  // §7.4: State diff first; each day's cut is its own change that can be kept
  // (2026-09-30), so "I'm tired" can mean just today.
  await expect(proposal.getByTestId('state-diff')).toContainText('Fewer stops')
  await expect(proposal.getByTestId('change-units')).toBeVisible()
  await expect(proposal.getByTestId('change-units')).toContainText('→ out')

  await proposal.getByTestId('confirm-change').click()
  await expectPlanVersion(page, 2)

  // The pace constraint is now part of what the agent plans against.
  await openState(page)
  await expect(page.getByTestId('considering-input').last()).toHaveValue(/Fewer stops/)
  await page.getByTestId('view-plan').click()

  // No day is fuller than the cut allows.
  await openItinerary(page)
  for (const day of ['Day 1', 'Day 3', 'Day 5']) {
    await page.getByRole('tab', { name: day }).click()
    await expect(page.getByTestId('timeline')).toBeVisible()
    expect(await page.getByTestId('timeline').locator('li').count()).toBeLessThanOrEqual(
      busiest - 1,
    )
  }
})

// --- Scenario 4: direct State edit, typed by its reach ------------------------

// §7.1 (2026-09-30): every State edit is a Reframe and is previewed; the heading still
// says where it lands when it touches one day.
test('a direct State edit is a previewed Reframe, and never moves the plan on its own', async ({ page }) => {
  await openPlan(page)

  // A must-visit the plan does not already hold — otherwise the edit changes State
  // and nothing else, which is the NEXT test, not this one.
  const wanted = await unplannedPlace(page, ['park_garden', 'museum_gallery'])
  await closeItinerary(page)

  await openState(page)
  const sheet = page.getByTestId('state-screen')
  await sheet.getByTestId('add-considering').click()
  await sheet.getByTestId('considering-input').last().fill(`We must visit ${wanted.name}.`)
  await sheet.getByTestId('save-state').click()

  const proposal = page.getByTestId('proposal')
  await expect(proposal).toHaveAttribute('data-change-type', 'reframe')
  await expect(proposal.getByRole('heading', { name: /Update Day \d/ })).toBeVisible()
  await expect(proposal.getByTestId('proposal-scope')).toContainText('Only 1 stop changes')
  await expectPlanVersion(page, 1)

  await expect(proposal.getByTestId('diff-added')).toContainText(wanted.name)

  await proposal.getByTestId('confirm-change').click()
  await expectPlanVersion(page, 2)

  // One Receipt, of the right kind, recording both sides of the transaction.
  await openDecisions(page)
  await expect(page.getByTestId('receipt')).toHaveCount(1)
  await expect(page.getByTestId('receipt')).toHaveAttribute('data-change-type', 'reframe')
  await page.getByTestId('receipt-toggle').click()
  await expect(page.getByTestId('receipt-detail')).toContainText(wanted.name)
  await expect(page.getByTestId('receipt-detail')).toContainText('Trip state v2')
})

test('a State edit that does not move the itinerary commits straight away', async ({ page }) => {
  await openPlan(page)

  await openState(page)
  const sheet = page.getByTestId('state-screen')
  await sheet.getByRole('button', { name: 'convenience high' }).click()
  await sheet.getByTestId('save-state').click()

  // §7.6: empty plan diff -> State commits immediately, one Receipt, and the
  // itinerary version must NOT move. The user is told, rather than watching
  // the Save button vanish.
  await expect(page.getByTestId('state-note')).toBeVisible()
  await expect(page.getByTestId('proposal')).toHaveCount(0)

  await page.getByTestId('view-plan').click()
  await expectPlanVersion(page, 1)
  await openDecisions(page)
  await expect(page.getByTestId('receipt')).toHaveCount(1)
  await page.getByTestId('receipt-toggle').click()
  await expect(page.getByTestId('receipt-detail')).toContainText('Trip state v2')
  await expect(page.getByTestId('receipt-detail')).toContainText('itinerary v1')
})

// --- Scenario 5: impossible must-visit -> Conflict ---------------------------

test('a must-visit outside the dataset is a Conflict, not a silent drop', async ({ page }) => {
  await openPlan(page)

  await openState(page)
  const sheet = page.getByTestId('state-screen')
  await sheet.getByTestId('add-considering').click()
  await sheet.getByTestId('considering-input').last().fill('We must visit teamLab Planets.')
  await sheet.getByTestId('save-state').click()

  const conflict = sheet.getByTestId('state-conflict')
  await expect(conflict).toBeVisible()
  await expect(conflict).toContainText('teamLab Planets')

  // Nothing was committed and the editor stays open on the offending row.
  await expect(page.getByTestId('proposal')).toHaveCount(0)
  await expect(sheet).toBeVisible()

  await sheet.getByTestId('cancel-state').click()
  await page.getByTestId('view-plan').click()
  await expectPlanVersion(page, 1)
  await openDecisions(page)
  await expect(page.getByTestId('receipts')).toHaveCount(0)
})

// --- Alternatives (§5.6) -----------------------------------------------------

test('picking a same-slot alternative commits a Replace on selection', async ({ page }) => {
  await openPlan(page)

  // Map pin -> POI sheet -> Alternatives, in the same sheet (§5.7). Which stop is
  // asked comes from the plan: a same-slot option only exists where the slot is long
  // enough to hold one.
  await openStopWithSameSlotAlternative(page)
  const options = page.getByTestId('alternative')
  await expect(options.first()).toBeVisible()
  expect(await options.count()).toBeLessThanOrEqual(5)

  // A same-slot option: the tap itself is the confirmation.
  const sameSlot = page.locator('[data-testid="alternative"][data-shifts="false"]').first()
  const chosen = await sameSlot.locator('.alt-name').textContent()
  await sameSlot.click()

  await expect(page.getByTestId('proposal')).toHaveCount(0)
  await expectPlanVersion(page, 2)

  await openDecisions(page)
  await expect(page.getByTestId('receipt')).toHaveCount(1)
  await expect(page.getByTestId('receipt')).toContainText(chosen!)
})

// --- Proposal lifecycle (§7.7) -----------------------------------------------

test('a new request supersedes the pending proposal, and only one can be open', async ({ page }) => {
  await openPlan(page)
  const day = await ramenDay(page)

  await say(page, RAIN)
  await expect(page.getByTestId('proposal')).toHaveAttribute('data-change-type', 'reorganize')

  await say(page, closedOn(day))
  await expect(page.getByTestId('proposal')).toHaveCount(1)
  await expect(page.getByTestId('proposal')).toHaveAttribute('data-change-type', 'replace')
  await expect(page.getByTestId('lifecycle-note')).toBeVisible()

  await page.getByTestId('confirm-change').click()
  // The superseded proposal wrote nothing: one commit, one Receipt (§9.1).
  await openDecisions(page)
  await expect(page.getByTestId('receipt')).toHaveCount(1)
})

test('a State edit invalidates the pending proposal', async ({ page }) => {
  await openPlan(page)

  await say(page, RAIN)
  await expect(page.getByTestId('proposal')).toBeVisible()

  await openState(page)
  const sheet = page.getByTestId('state-screen')
  await sheet.getByRole('button', { name: 'cost high' }).click()
  await sheet.getByTestId('save-state').click()

  await expect(page.getByTestId('state-note')).toBeVisible()
  await expect(page.getByTestId('proposal')).toHaveCount(0)

  await page.getByTestId('view-plan').click()
  await expectPlanVersion(page, 1)
  await openChat(page)
  // Only the State edit committed; the abandoned Reorganize left no trace.
  await expect(page.getByTestId('lifecycle-note')).toContainText('replaced')
  await openDecisions(page)
  await expect(page.getByTestId('receipt')).toHaveCount(1)
})

// --- Receipts history (§9) ---------------------------------------------------

test('receipts accumulate as read-only history with no undo', async ({ page }) => {
  await openPlan(page)
  const day = await ramenDay(page)

  await say(page, closedOn(day))
  await page.getByTestId('confirm-change').click()
  await openDecisions(page)
  await expect(page.getByTestId('receipt')).toHaveCount(1)

  await say(page, RAIN)
  await page.getByTestId('confirm-change').click()
  await openDecisions(page)
  await expect(page.getByTestId('receipt')).toHaveCount(2)

  // Newest first, each labelled with what kind of change it was.
  const kinds = await page.getByTestId('receipt').evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-change-type')),
  )
  expect(kinds).toEqual(['reorganize', 'replace'])

  // §9.3: no undo, rollback, restore or version control anywhere in the list.
  const text = await page.getByTestId('receipts').innerText()
  for (const forbidden of ['Undo', 'Revert', 'Restore', 'Roll back']) {
    expect(text).not.toContain(forbidden)
  }
})
