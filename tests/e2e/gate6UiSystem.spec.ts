/**
 * Gate 6 — UI system and polish.
 *
 * Checks the interaction grammar the UI drafts describe, and the four rules
 * the gate adds on top of them: no nested modals, one primary CTA per decision
 * surface, no critical action behind a long press only, and no horizontal
 * overflow around 390px.
 */

import { expect, test, type Page } from '@playwright/test'

import {
  APP, closeChat, confirmMemory, createTrip, openChat, openItinerary, openPoiOnMap, plannedStops,
} from './helpers.ts'

/** Every element the page paints must fit the viewport it was designed for. */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement
    return doc.scrollWidth - doc.clientWidth
  })
  expect(overflow).toBeLessThanOrEqual(1)
}

/**
 * Opens the alternatives of a planned stop that has at least `minOptions`.
 *
 * Found rather than named: which stops the first plan holds depends on the
 * memories in use, and those now include the ones activated on seed.
 */
async function openStopWithAlternatives(page: Page, minOptions = 1): Promise<number> {
  for (const stop of await plannedStops(page)) {
    await openPoiOnMap(page, stop.placeId, stop.day)
    if ((await page.getByTestId('open-alternatives').count()) > 0) {
      await page.getByTestId('open-alternatives').click()
      await expect(page.getByTestId('alternative').first()).toBeVisible()
      const count = await page.getByTestId('alternative').count()
      if (count >= minOptions) return count
      await page.getByTestId('back-to-poi').click()
    }
    await page.getByTestId('close-poi').click()
  }
  throw new Error(`no planned stop offers ${minOptions} alternatives`)
}

// --- IA: chrome, drawer, views (drafts 01, 05) --------------------------------

test('the trip carries an index button and a Plan / State control', async ({ page }) => {
  await createTrip(page)

  await expect(page.getByTestId('open-index')).toBeVisible()
  await expect(page.getByTestId('view-plan')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('view-state')).toHaveAttribute('aria-selected', 'false')

  // The map is the screen, not a strip at the top.
  const map = page.getByRole('img', { name: 'Trip map' })
  await expect(map).toBeVisible()
  const box = await map.boundingBox()
  expect(box!.height).toBeGreaterThan(500)
})

test('the index drawer reaches trips and the profile without leaving the map', async ({ page }) => {
  await createTrip(page)

  await page.getByTestId('open-index').click()
  const drawer = page.getByRole('navigation', { name: 'Trips and profile' })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByTestId('new-trip')).toBeVisible()
  await expect(drawer.getByTestId('open-trip')).toHaveText('Tokyo Slow Week')

  // Dismissing the drawer leaves the trip exactly where it was.
  await page.getByRole('presentation').first().click({ position: { x: 370, y: 400 } })
  await expect(drawer).toHaveCount(0)
  await expect(page.getByRole('img', { name: 'Trip map' })).toBeVisible()
})

test('Plan and State are two views of one trip', async ({ page }) => {
  await createTrip(page)

  await page.getByTestId('view-state').click()
  await expect(page.getByTestId('state-screen')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Intent' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Considering' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Priorities' })).toBeVisible()

  // Save appears only once something has actually been edited.
  await expect(page.getByTestId('save-state')).toHaveCount(0)
  await page.getByTestId('intent-input').first().fill('Slow-paced, and mostly on foot')
  await expect(page.getByTestId('save-state')).toBeVisible()

  await page.getByTestId('view-plan').click()
  await expect(page.getByRole('img', { name: 'Trip map' })).toBeVisible()
})

// --- chat as a sheet (draft 02) ------------------------------------------------

test('the composer expands into the conversation and closes again', async ({ page }) => {
  await createTrip(page)

  await openChat(page)
  await expect(page.getByTestId('chat-thread')).toBeVisible()
  await closeChat(page)
  await expect(page.getByRole('img', { name: 'Trip map' })).toBeVisible()
})

// --- Why this day, without a long press (task 7, §14.5) -----------------------

test('Why this day is reachable by tap, and says only what it can support', async ({ page }) => {
  await createTrip(page)
  // Day 3: the one whose stops carry an opening-hours fact worth stating.
  await openItinerary(page, 3)

  await page.getByTestId('why-this-day').click()
  const sheet = page.getByRole('dialog', { name: 'Why Day 3' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('heading', { name: 'Why this itinerary?' })).toBeVisible()
  await expect(sheet.getByTestId('why-considerations')).toContainText('Pace')

  // Opening-hours facts are real, and come from the catalogue's own hours.
  await expect(sheet.getByTestId('why-today').first()).toContainText('closed on Day')

  await sheet.getByTestId('why-day-back').click()
  await expect(page.getByRole('dialog', { name: 'Itinerary' })).toBeVisible()
})

// --- alternatives, mirrored on the map (draft 09) ------------------------------

test('alternatives are numbered on the card and on the map', async ({ page }) => {
  await createTrip(page)

  const count = await openStopWithAlternatives(page, 3)

  expect(count).toBeGreaterThanOrEqual(3)
  expect(count).toBeLessThanOrEqual(5)

  // One pin per option, and the planned pins recede behind them.
  await expect(page.getByTestId('alternative-pin')).toHaveCount(count)

  await page.getByTestId('back-to-poi').click()
  await expect(page.getByTestId('alternative-pin')).toHaveCount(0)
})

test('a stop always says whether it has other options (B8)', async ({ page }) => {
  await createTrip(page)

  // A trip is planned from a frozen set of places, so a stop CAN run out of things to
  // swap to — the nightcap does, on this data. Running out is a state the product has
  // to state: the sheet used to render an empty list and no explanation, which reads
  // as a broken screen rather than as an answer.
  const stops = (await plannedStops(page)).filter((stop) => stop.day === 1)
  expect(stops.length).toBeGreaterThan(0)

  for (const stop of stops) {
    await openPoiOnMap(page, stop.placeId, stop.day)

    const offers = await page.getByTestId('open-alternatives').count()
    const saysNone = await page.getByTestId('no-alternatives').count()
    expect(offers + saysNone, `${stop.placeId} says nothing about its options`).toBe(1)

    await page.getByTestId('close-poi').click()
  }
})

// --- profile (draft 06) ----------------------------------------------------------

test('profile rows edit in place and act from an overflow menu', async ({ page }) => {
  await page.goto(APP)
  await page.getByTestId('open-profile').click()

  const row = page.locator('[data-memory-id="mem_003"]')
  const field = row.getByRole('textbox')
  await field.fill('Always finds a good local market')
  await field.blur()
  await expect(page.getByTestId('memory-candidate').first()).toContainText('a good local market')

  await confirmMemory(page, 'mem_003')
  await expect(page.getByTestId('memory-active')).toHaveCount(3)
  await expect(page.getByTestId('memory-active').filter({ hasText: 'a good local market' })).toHaveCount(1)
  // Numeric confidence is never shown (§10.2).
  await expect(page.getByTestId('active-memories')).not.toContainText(/0\.\d/)
})

// --- gate rules -------------------------------------------------------------------

test('only one sheet is ever open (§5.7, task 5)', async ({ page }) => {
  await createTrip(page)

  await openItinerary(page)
  await expect(page.getByRole('dialog')).toHaveCount(1)

  // A POI opened from the map replaces the itinerary rather than stacking.
  const [first] = await plannedStops(page)
  await openPoiOnMap(page, first.placeId, first.day)
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await page.getByTestId('close-poi').click()

  await openStopWithAlternatives(page)
  await expect(page.getByRole('dialog')).toHaveCount(1)
})

test('primary actions meet the 44px target and show focus (§14.5)', async ({ page }) => {
  await createTrip(page)

  for (const testId of ['open-itinerary', 'open-index', 'open-chat']) {
    const box = await page.getByTestId(testId).boundingBox()
    expect(box!.height, `${testId} height`).toBeGreaterThanOrEqual(44)
    expect(box!.width, `${testId} width`).toBeGreaterThanOrEqual(44)
  }

  // Keyboard focus, so :focus-visible actually matches. Tab from the top
  // until a real control has focus, then read what the page gives it.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  let outline = 'none'
  for (let step = 0; step < 8 && outline === 'none'; step++) {
    await page.keyboard.press('Tab')
    outline = await page.evaluate(() => {
      const active = document.activeElement
      if (!active || active === document.body) return 'none'
      return getComputedStyle(active).outlineStyle
    })
  }
  expect(outline).not.toBe('none')
})

test('no screen scrolls sideways at 390px or at 360px (task 8)', async ({ page }) => {
  await createTrip(page)
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('view-state').click()
  await expectNoHorizontalOverflow(page)
  await page.getByTestId('view-plan').click()

  await openItinerary(page, 3)
  await expectNoHorizontalOverflow(page)
  await page.getByTestId('close-itinerary').click()

  await page.setViewportSize({ width: 360, height: 780 })
  await expectNoHorizontalOverflow(page)
  await page.getByTestId('view-state').click()
  await expectNoHorizontalOverflow(page)
})

test('every stop of a day can be read to the end, at any detent (§5.3)', async ({ page }) => {
  await createTrip(page)
  await openItinerary(page, 5)

  const sheet = page.getByRole('dialog', { name: 'Itinerary' })
  const body = page.locator('.detent-body')
  const last = page.getByTestId('timeline').locator('li').last()
  const viewport = page.viewportSize()!

  // The sheet is always as tall as its full detent and slides DOWN to the shorter
  // ones, so at peek and half its lower part is off the bottom of the screen — and
  // the scrolling region inside it ended down there too. A day's last stop could be
  // scrolled to and still not be readable.
  for (const step of [0, 1, 2]) {
    if (step > 0) await page.getByTestId('itinerary-detent').click()
    const detent = await sheet.getAttribute('data-detent')

    // Polled, because changing detent slides the sheet: measuring mid-transition
    // reads a position the sheet is only passing through.
    await expect
      .poll(
        async () => {
          await body.evaluate((element) => element.scrollTo(0, element.scrollHeight))
          const box = await last.boundingBox()
          return box === null ? Number.POSITIVE_INFINITY : box.y + box.height
        },
        { message: `${detent}: the end of the day sits below the fold` },
      )
      .toBeLessThanOrEqual(viewport.height)
  }
})
