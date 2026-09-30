/**
 * Gate 4 E2E: Memory -> recommendation -> rationale, end to end in the product.
 *
 *   Profile -> confirm a candidate -> disclosure -> New Trip -> snapshot
 *   -> plan -> POI rationale citing that memory
 */

import { expect, test } from '@playwright/test'

import {
  APP, confirmMemory, expectPlanVersion, openItinerary,
} from './helpers.ts'

test('a strongly evidenced memory is in use from the start, and reaches the plan', async ({ page }) => {
  await page.goto(APP)

  // --- Profile: strong memories are already in use, the rest wait ----------
  await page.getByTestId('open-profile').click()
  await expect(page.getByRole('heading', { name: 'What I remember' })).toBeVisible()
  await expect(page.getByTestId('memory-candidate').first()).toBeVisible()
  await expect(page.getByTestId('memory-active')).toHaveCount(2)
  await expect(page.getByTestId('memory-active').filter({ hasText: 'sushi' })).toHaveCount(1)

  // Provenance label stands in for confidence — no number is ever shown.
  const firstCandidate = page.getByTestId('memory-candidate').first()
  await expect(firstCandidate).toContainText(/From your saved places|From past travel behavior/)
  await expect(firstCandidate).not.toContainText(/0\.\d/)

  // --- Confirm a weaker one by hand ------------------------------------------
  await confirmMemory(page, 'mem_003')
  await expect(page.getByTestId('memory-active')).toHaveCount(3)

  await page.getByTestId('profile-back').click()
  await page.getByTestId('new-trip').click()

  // --- Stage A discloses the memories it will use --------------------------
  await expect(page.getByTestId('memory-disclosure')).toContainText('Using 3 memories')

  // --- Create the trip ------------------------------------------------------
  await page.locator('#trip-name').fill('Tokyo Slow Week')
  await page.locator('#start-date').fill('2026-10-05')
  await page.locator('#end-date').fill('2026-10-09')
  await page.locator('#lodging').fill('Kuramae')
  await page.locator('#intent').fill('Slow-paced. Time in local neighbourhoods.')
  await page.locator('#considering').fill('Moderate budget.')
  await page.getByTestId('review-trip-state').click()
  await page.getByTestId('generate-itinerary').click()
  await expectPlanVersion(page, 1)

  // --- The plan contains a sushi stop whose row cites the memory -----------
  await openItinerary(page, 1)

  const sushiRow = page.getByTestId('timeline').locator('li').filter({ hasText: 'sushi' }).first()
  await expect(sushiRow).toBeVisible()

  const citation = sushiRow.getByTestId('memory-citation')
  await expect(citation).toHaveAttribute('data-memory-id', 'mem_001')
  await expect(citation).toContainText('From your saved places')

  // The map stays in sync when the row is selected.
  await sushiRow.click()
  await expect(sushiRow).toHaveAttribute('aria-selected', 'true')
})
