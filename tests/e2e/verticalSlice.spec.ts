/**
 * Gate 3 E2E: the complete Human-Agent Collaboration loop.
 *
 *   New Trip -> Review trip state -> Generate itinerary -> open Plan
 *   -> send closed-restaurant message -> proposal appears -> Confirm
 *   -> itinerary updates -> exactly one Receipt exists
 */

import { expect, test } from '@playwright/test'

import {
  APP, closeItinerary, dayHolding, expectPlanVersion, openChat, openItinerary, say,
} from './helpers.ts'

/**
 * The scripted message, with the day filled in from the itinerary.
 *
 * Which day the ramen lands on is the planner's call and has moved with every change
 * to the day structure. Naming it here is how a handful of specs broke three times
 * over; asking the itinerary keeps them about the flow they are testing.
 */
const closedMessageFor = (day: number) => `The ramen place on Day ${day} is closed today.`

test('new trip through to a committed change and one receipt', async ({ page }) => {
  await page.goto(APP)
  await page.getByTestId('new-trip').click()

  // --- Stage A: Trip Setup -------------------------------------------------
  await expect(page.getByRole('heading', { name: 'Tokyo' })).toBeVisible()
  await expect(page.locator('#destination')).toHaveValue('Tokyo')

  await page.locator('#trip-name').fill('Tokyo Slow Week')
  await page.locator('#start-date').fill('2026-10-05')
  await page.locator('#end-date').fill('2026-10-09')
  await page.locator('#lodging').fill('Kuramae')
  await page.locator('#trip-name').fill('Tokyo Slow Week')
  await page.locator('#start-date').fill('2026-10-05')
  await page.locator('#end-date').fill('2026-10-09')
  await page.locator('#lodging').fill('Kuramae')
  await page.locator('#intent').fill('Slow-paced. Time in local neighbourhoods.')
  await page.locator('#considering').fill('Keep the budget moderate. One proper sushi meal.')
  await page.getByTestId('review-trip-state').click()

  // --- Stage B: Review your trip -------------------------------------------
  await expect(page.getByTestId('trip-summary-name')).toHaveText('Tokyo Slow Week')

  // Decomposed into editable Intent and Considering items.
  await expect(page.getByLabel(/^Intent:/).first()).toBeVisible()
  await expect(page.getByLabel(/^Considering:/).first()).toBeVisible()

  // The three core priorities, each at medium by default.
  for (const name of ['convenience', 'cost', 'novelty']) {
    await expect(page.getByRole('button', { name: `${name} medium` })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  }

  // Priority weight is adjustable.
  await page.getByRole('button', { name: 'convenience high' }).click()
  await expect(page.getByRole('button', { name: 'convenience high' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await page.getByTestId('generate-itinerary').click()

  // --- Plan default view ----------------------------------------------------
  // The trip no longer names itself over the map: the map is the whole screen,
  // and the name is read in the Itinerary sheet and in the Index.
  await expectPlanVersion(page, 1)
  await expect(page.getByRole('img', { name: 'Trip map' })).toBeVisible()
  await expect(page.getByTestId('open-itinerary')).toBeVisible()
  await expect(page.getByTestId('open-chat')).toBeVisible()

  // --- Itinerary: Day 2 holds the ramen stop --------------------------------
  // Which ramen is the planner's call (§12.2); the scenario event is bound to
  // the same id in demo_scenario.json.
  // --- Itinerary: find the day the ramen stop landed on ---------------------
  const ramenDay = await dayHolding(page, 'ramen_rokurinsha')
  await expect(page.getByRole('heading', { name: 'Tokyo Slow Week' })).toBeVisible()
  const timeline = page.getByTestId('timeline')
  await expect(timeline.locator('[data-place-id="ramen_rokurinsha"]')).toBeVisible()
  await closeItinerary(page)

  // --- Chat: the scripted closed-restaurant message -------------------------
  const closedMessage = closedMessageFor(ramenDay)
  await say(page, closedMessage)

  // --- Proposal appears; plan is still v1 while it is pending ---------------
  const proposal = page.getByTestId('proposal')
  await expect(proposal).toBeVisible()
  await expect(proposal.getByRole('heading', { name: 'Change this place?' })).toBeVisible()
  // What it swaps to is the model's pick from a bounded set (§12.1); what matters is
  // that it named something, and that it is not the place being replaced.
  const replacement = (await proposal.getByTestId('proposal-after').textContent())!.trim()
  expect(replacement.length).toBeGreaterThan(0)
  await expect(proposal.getByTestId('proposal-before')).not.toHaveText(replacement)
  await expect(proposal.getByTestId('keep-current')).toBeVisible()
  await expectPlanVersion(page, 1)

  // --- Confirm --------------------------------------------------------------
  await page.getByTestId('confirm-change').click()
  await expect(proposal).toBeHidden()

  // --- Itinerary updated, version advanced ----------------------------------
  await expectPlanVersion(page, 2)
  await openItinerary(page, ramenDay)
  await expect(timeline.locator('[data-place-id="ramen_rokurinsha"]')).toHaveCount(0)
  await closeItinerary(page)

  // --- Exactly one Receipt ---------------------------------------------------
  // The summary is on the row; the rest of §9.2 is one tap away (§14.4).
  await openChat(page)
  await expect(page.getByTestId('receipt')).toHaveCount(1)
  const receipt = page.getByTestId('receipt')
  await expect(receipt).toContainText('Rokurinsha')
  await expect(receipt).toContainText(replacement)

  await page.getByTestId('receipt-toggle').click()
  const detail = page.getByTestId('receipt-detail')
  await expect(detail).toContainText(closedMessage)
  await expect(detail).toContainText('itinerary v2')
})

test('keep current leaves the plan unchanged and writes no receipt', async ({ page }) => {
  await page.goto(APP)
  await page.getByTestId('new-trip').click()

  await page.locator('#trip-name').fill('Tokyo Slow Week')
  await page.locator('#start-date').fill('2026-10-05')
  await page.locator('#end-date').fill('2026-10-09')
  await page.locator('#lodging').fill('Kuramae')
  await page.locator('#intent').fill('Slow-paced.')
  await page.locator('#considering').fill('Moderate budget.')
  await page.getByTestId('review-trip-state').click()
  await page.getByTestId('generate-itinerary').click()
  await expectPlanVersion(page, 1)

  const ramenDay = await dayHolding(page, 'ramen_rokurinsha')
  await closeItinerary(page)

  await say(page, closedMessageFor(ramenDay))
  await expect(page.getByTestId('proposal')).toBeVisible()

  await page.getByTestId('keep-current').click()
  await expect(page.getByTestId('proposal')).toBeHidden()

  await expectPlanVersion(page, 1)
  await expect(page.getByTestId('receipt')).toHaveCount(0)

  await openItinerary(page, ramenDay)
  await expect(page.getByTestId('timeline').locator('[data-place-id="ramen_rokurinsha"]')).toBeVisible()
})
