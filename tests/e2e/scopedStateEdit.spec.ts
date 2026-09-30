/**
 * A State edit touches only what it affects (product_spec §7.1, §7.6).
 *
 * The traveller's rule, held end to end: adding one thing to State must not rewrite
 * the trip. One slot re-chosen is applied at once and changes that one stop; a
 * change that reaches several stops is shown change by change, and any of them can
 * be declined to keep the original.
 */

import { expect, test, type Page } from '@playwright/test'

import { closeChat, createTrip, expectPlanVersion, openItinerary, plannedStops } from './helpers.ts'

async function openState(page: Page) {
  if (await page.getByRole('dialog', { name: 'Chat' }).isVisible()) await closeChat(page)
  await page.getByTestId('view-state').click()
  await expect(page.getByTestId('state-screen')).toBeVisible()
}

async function addConsidering(page: Page, ...lines: string[]) {
  const sheet = page.getByTestId('state-screen')
  for (const text of lines) {
    await sheet.getByTestId('add-considering').click()
    await sheet.getByTestId('considering-input').last().fill(text)
  }
  await sheet.getByTestId('save-state').click()
}

/** "HH:MM place" per stop, per day — the whole itinerary as a comparable list. */
async function itinerary(page: Page) {
  const stops = await plannedStops(page)
  await page.getByTestId('close-itinerary').click()
  return stops.map((stop) => `${stop.day}:${stop.placeId}`)
}

test('one slot re-chosen changes that one stop, previewed first, and says so', async ({ page }) => {
  await createTrip(page)
  const before = await itinerary(page)

  await openState(page)
  await addConsidering(page, 'Day 2 dinner: sushi')

  // A State edit, so previewed even for one stop (2026-09-30), headed by where it lands.
  const proposal = page.getByTestId('proposal')
  await expect(proposal).toHaveAttribute('data-change-type', 'reframe')
  await expect(proposal.getByRole('heading', { name: 'Update Day 2 evening' })).toBeVisible()
  await expectPlanVersion(page, 1)
  await proposal.getByTestId('confirm-change').click()
  await expectPlanVersion(page, 2)
  const after = await itinerary(page)

  // Exactly one stop differs, and it is on Day 2.
  const changed = after.filter((stop) => !before.includes(stop))
  expect(changed).toHaveLength(1)
  expect(changed[0].startsWith('2:')).toBe(true)
  expect(after).toHaveLength(before.length)

  // It is marked, and says why it changed.
  await openItinerary(page, 2)
  await expect(page.getByTestId('updated-badge')).toHaveCount(1)
  const row = page.getByTestId('timeline').locator('li').filter({ has: page.getByTestId('updated-badge') })
  await expect(row.locator('[data-strength="primary"]')).toContainText('You asked for sushi for Day 2 dinner')
})

test('a change that reaches several stops is shown change by change, and one can be kept', async ({ page }) => {
  await createTrip(page)
  const before = await itinerary(page)

  await openState(page)
  // Two lines in one save, each reaching one stop. The named dinner is what was asked
  // for, so it is required; the museum the avoid reaches can be declined.
  await addConsidering(page, 'Avoid museums', 'Day 2 dinner: sushi')

  const proposal = page.getByTestId('proposal')
  await expect(proposal).toBeVisible()
  const units = proposal.getByTestId('change-unit')
  const count = await units.count()
  expect(count).toBeGreaterThan(1)
  await expect(proposal.getByTestId('proposal-scope')).toContainText(`Only ${count} stops change`)

  // The named dinner cannot be declined; the avoid can.
  await expect(units.filter({ hasText: 'Day 2 · 18:00' }).getByTestId('unit-keep')).toHaveCount(0)
  const optional = units.filter({ has: page.getByTestId('unit-keep') }).first()
  const kept = await optional.locator('.unit-summary').textContent()
  await optional.getByTestId('unit-keep').click()
  await expect(proposal.getByTestId('confirm-change')).toHaveText(
    `Apply ${count - 1} change${count - 1 === 1 ? '' : 's'}`,
  )
  await proposal.getByTestId('confirm-change').click()
  await expectPlanVersion(page, 2)

  const after = await itinerary(page)
  const changed = after.filter((stop) => !before.includes(stop))
  expect(changed).toHaveLength(count - 1)
  expect(after).toHaveLength(before.length)

  // The one kept is still in the itinerary, by name.
  const keptName = kept!.split(': ')[1].split(' → ')[0]
  await openItinerary(page)
  let found = false
  for (let day = 1; day <= 5 && !found; day++) {
    await page.getByRole('tab', { name: `Day ${day}` }).click()
    found = (await page.getByTestId('timeline').getByText(keptName, { exact: true }).count()) > 0
  }
  expect(found).toBe(true)
})

test('an event is found, picked, and planned around — nothing else moves', async ({ page }) => {
  await createTrip(page)
  const before = await itinerary(page)

  await openState(page)
  await addConsidering(page, 'At least one baseball game')

  // A real game, from a recorded search, saying where and when it was found (§7.8).
  const choice = page.getByTestId('event-choice')
  await expect(choice).toContainText('recorded on 2026-09-29 for this demo')
  await expect(choice.getByTestId('event-option').first()).toContainText('npb.jp')
  const picked = await choice.getByTestId('event-option').first().locator('.event-when').textContent()
  const day = Number(picked!.match(/\d+\/(\d+)/)![1]) - 4 // trip starts Oct 5
  await choice.getByTestId('event-option').first().click()

  const proposal = page.getByTestId('proposal')
  await expect(proposal).toHaveAttribute('data-change-type', 'reframe')
  await expect(proposal.locator('h3')).toHaveText(`Update Day ${day} evening`)
  await proposal.getByTestId('confirm-change').click()
  await expectPlanVersion(page, 2)

  // Other days are exactly as they were.
  const after = await itinerary(page)
  const offDay = (stops: string[]) => stops.filter((stop) => !stop.startsWith(`${day}:`))
  expect(offDay(after)).toEqual(offDay(before))

  // The game is on the day, cited to its source, and marked as the change.
  await openItinerary(page, day)
  const game = page.getByTestId('timeline').locator('li').filter({ hasText: 'ロッテ' })
  await expect(game).toContainText('You asked for baseball')
  await expect(game).toContainText('npb.jp')
  await expect(game.getByTestId('updated-badge')).toBeVisible()
})
