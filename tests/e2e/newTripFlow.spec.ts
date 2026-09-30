/**
 * v0.7 §3.6 — normative New Trip flow.
 * Covers only the behaviour §3.6 added over v0.6.
 */

import { expect, test } from '@playwright/test'

import {
  APP, confirmMemory,
} from './helpers.ts'

async function openStageA(page: import('@playwright/test').Page) {
  await page.goto(APP)
  await page.getByTestId('new-trip').click()
}

async function fillValidSetup(page: import('@playwright/test').Page) {
  await page.locator('#trip-name').fill('Tokyo Slow Week')
  await page.locator('#start-date').fill('2026-10-05')
  await page.locator('#end-date').fill('2026-10-09')
  await page.locator('#lodging').fill('Kuramae')
  await page.locator('#intent').fill('Slow-paced, local neighbourhoods.')
}

test('§3.6.1 New Trip opens from the Index, not as a modal', async ({ page }) => {
  await page.goto(APP)
  await expect(page.getByRole('heading', { name: 'The Next Trip' })).toBeVisible()
  await page.getByTestId('new-trip').click()
  await expect(page.getByRole('heading', { name: 'Tokyo' })).toBeVisible()
  await expect(page.getByTestId('close-new-trip')).toBeVisible()
})

test('§3.6.3 Intent is required and dates must be ordered', async ({ page }) => {
  await openStageA(page)

  // Intent missing -> blocked, with inline validation rather than an alert.
  await page.locator('#trip-name').fill('Tokyo Slow Week')
  await page.locator('#start-date').fill('2026-10-05')
  await page.locator('#end-date').fill('2026-10-09')
  await page.locator('#lodging').fill('Kuramae')
  await page.getByTestId('review-trip-state').click()
  await expect(page.getByTestId('intent-error')).toBeVisible()
  await expect(page.getByTestId('trip-summary-name')).toHaveCount(0)

  // End before start -> blocked.
  await page.locator('#intent').fill('Slow-paced.')
  await page.locator('#end-date').fill('2026-10-01')
  await page.getByTestId('review-trip-state').click()
  await expect(page.getByTestId('dates-error')).toBeVisible()

  // Considering may stay empty.
  await page.locator('#end-date').fill('2026-10-09')
  await page.getByTestId('review-trip-state').click()
  await expect(page.getByTestId('trip-summary-name')).toHaveText('Tokyo Slow Week')
})

test('§3.6.2 the Memory row is read-only inside New Trip', async ({ page }) => {
  await page.goto(APP)

  // Zero active memories -> the row is omitted entirely. A first run starts with
  // the strongly evidenced ones in use, so stop using them first.
  await page.getByTestId('open-profile').click()
  for (const id of ['mem_001', 'mem_002']) {
    await page.getByTestId(`memory-menu-${id}`).click()
    await page.getByTestId(`deactivate-${id}`).click()
  }
  await expect(page.getByTestId('memory-active')).toHaveCount(0)
  await page.getByTestId('profile-back').click()
  await page.getByTestId('new-trip').click()
  await expect(page.getByTestId('memory-disclosure')).toHaveCount(0)
  await page.getByTestId('close-new-trip').click()

  await page.getByTestId('open-profile').click()
  await confirmMemory(page, 'mem_001')
  await page.getByTestId('profile-back').click()
  await page.getByTestId('new-trip').click()

  await page.getByTestId('memory-disclosure').click()
  const sheet = page.getByTestId('memory-disclosure-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByTestId('disclosed-memory')).toHaveCount(1)
  // No way to edit Memory from inside the New Trip flow.
  await expect(sheet.getByRole('button', { name: 'Remember this' })).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: 'Stop using' })).toHaveCount(0)
})

test('§3.6.4 Stage B shows the trip frame and a memory row', async ({ page }) => {
  await page.goto(APP)
  await page.getByTestId('open-profile').click()
  await confirmMemory(page, 'mem_003')
  await page.getByTestId('profile-back').click()
  await page.getByTestId('new-trip').click()

  await fillValidSetup(page)
  await page.getByTestId('review-trip-state').click()

  await expect(page.getByTestId('trip-summary-name')).toHaveText('Tokyo Slow Week')
  await expect(page.getByText(/Oct 5 – Oct 9 · 5 days · Kuramae/)).toBeVisible()
  await expect(page.getByTestId('memory-disclosure-b')).toContainText('Using 3 memories')
})

test('§3.6.9 Back preserves free text and structured edits', async ({ page }) => {
  await openStageA(page)
  await fillValidSetup(page)
  await page.getByTestId('review-trip-state').click()

  // Edit a decomposed Intent item, then go back and forward again.
  const firstIntent = page.getByLabel(/^Intent:/).first()
  await firstIntent.fill('Deliberately unhurried')

  await page.getByTestId('back-to-setup').click()
  await expect(page.locator('#intent')).toHaveValue('Slow-paced, local neighbourhoods.')
  await expect(page.locator('#lodging')).toHaveValue('Kuramae')

  await page.getByTestId('review-trip-state').click()
  await expect(page.getByLabel(/^Intent:/).first()).toHaveValue('Deliberately unhurried')
})

test('§3.6.9 closing Stage A confirms before discarding', async ({ page }) => {
  await openStageA(page)
  await fillValidSetup(page)

  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByTestId('close-new-trip').click()
  await expect(page.locator('#intent')).toHaveValue('Slow-paced, local neighbourhoods.')

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByTestId('close-new-trip').click()
  await expect(page.getByRole('heading', { name: 'The Next Trip' })).toBeVisible()

  // Draft is gone, not half-created (§3.6.10).
  await page.getByTestId('new-trip').click()
  await expect(page.locator('#intent')).toHaveValue('')
})

test('§3.6.10 nothing is persisted until Generate', async ({ page }) => {
  await openStageA(page)
  await fillValidSetup(page)
  await page.getByTestId('review-trip-state').click()

  // Still only a draft: the Index shows no trip yet.
  await page.getByTestId('back-to-setup').click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByTestId('close-new-trip').click()
  await expect(page.getByTestId('open-trip')).toHaveCount(0)
})
