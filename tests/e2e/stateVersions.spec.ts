/**
 * Adding or removing a State line updates the itinerary as a new, reviewable version,
 * and any two versions can be compared (2026-10-01).
 *
 * Runs in stub mode: lines are read by the rules the model falls back to, and there is
 * no live search — so a day in a town the offline set does not cover is a Conflict
 * with options, which is itself the behaviour under test (never a silent save).
 */

import { expect, test, type Page } from '@playwright/test'

import { closeChat, createTrip, expectPlanVersion, openItinerary, unplannedPlace } from './helpers.ts'

async function openState(page: Page) {
  if (await page.getByRole('dialog', { name: 'Chat' }).isVisible()) await closeChat(page)
  await page.getByTestId('view-state').click()
  await expect(page.getByTestId('state-screen')).toBeVisible()
}

async function addConsidering(page: Page, text: string) {
  const sheet = page.getByTestId('state-screen')
  await sheet.getByTestId('add-considering').click()
  await sheet.getByTestId('considering-input').last().fill(text)
  await sheet.getByTestId('save-state').click()
}

test('"go to Yokohama on last day" is understood, and says why it cannot be planned offline', async ({ page }) => {
  await createTrip(page)
  await openState(page)
  await addConsidering(page, 'go to Yokohama on last day')

  const conflict = page.getByTestId('state-conflict')
  await expect(conflict).toContainText("I don't have places in Yokohama to plan Day 5 around yet")
  await expect(conflict.getByTestId('conflict-option-move_day').first()).toBeVisible()
  await expect(conflict.getByTestId('conflict-option-remove')).toBeVisible()
  // Nothing was committed.
  await page.getByTestId('view-plan').click()
  await expectPlanVersion(page, 1)
})

test('adding then removing a line: two versions, each previewed and compared, and the history keeps all three', async ({ page }) => {
  await createTrip(page)
  const wanted = await unplannedPlace(page, ['park_garden', 'museum_gallery'])
  await page.getByTestId('close-itinerary').click().catch(() => {})

  // --- add: a preview with the two versions side by side --------------------------
  await openState(page)
  await addConsidering(page, `We must visit ${wanted.name}.`)
  const proposal = page.getByTestId('proposal')
  await expect(proposal).toHaveAttribute('data-change-type', 'reframe')
  await proposal.getByTestId('toggle-compare').click()
  const compare = proposal.getByTestId('version-compare')
  await expect(compare).toBeVisible()
  await expect(compare.getByTestId('version-after')).toContainText(wanted.name)
  await expect(compare.getByTestId('version-before')).not.toContainText(wanted.name)
  await expectPlanVersion(page, 1)
  await proposal.getByTestId('confirm-change').click()
  await expectPlanVersion(page, 2)

  // The line shows how it was read.
  await openState(page)
  await expect(page.getByTestId('read-as').last()).toContainText(`Read as: Must visit ${wanted.name}`)

  // --- remove: the place leaves the plan, again as a reviewed version --------------
  await page.getByRole('button', { name: `Remove We must visit ${wanted.name}.` }).click()
  await page.getByTestId('save-state').click()
  const removal = page.getByTestId('proposal')
  await expect(removal).toHaveAttribute('data-change-type', 'reframe')
  await removal.getByTestId('toggle-compare').click()
  await expect(removal.getByTestId('version-before')).toContainText(wanted.name)
  await expect(removal.getByTestId('version-after')).not.toContainText(wanted.name)
  await removal.getByTestId('confirm-change').click()
  await expectPlanVersion(page, 3)

  // --- history: any earlier version against the current one -------------------------
  await closeChat(page)
  await openItinerary(page)
  const picker = page.getByTestId('version-picker')
  await expect(picker.locator('option')).toHaveCount(3) // the prompt, v2, v1
  await picker.selectOption('2')
  const history = page.getByTestId('version-compare')
  await expect(history).toBeVisible()
  await expect(history.getByTestId('version-before')).toContainText(wanted.name)
})

test('opening the chat puts the cursor in the field, and the chat no longer carries the decisions', async ({ page }) => {
  await createTrip(page)
  await page.getByTestId('open-chat').click()
  const chat = page.getByRole('dialog', { name: 'Chat' })
  await expect(chat).toBeVisible()
  // Focused, so a phone raises its keyboard at once; the tap's stand-in is gone.
  await expect(chat.getByTestId('chat-input')).toBeFocused()
  await expect(page.locator('input[aria-hidden="true"]')).toHaveCount(0)
  await expect(chat.getByTestId('receipts')).toHaveCount(0)

  // The decisions are on the State screen, under Priorities.
  await closeChat(page)
  await page.getByTestId('view-state').click()
  const decisions = page.getByTestId('decisions')
  await expect(decisions).toBeVisible()
  await expect(decisions).toContainText('No confirmed changes yet.')
})
