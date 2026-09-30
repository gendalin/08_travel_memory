/**
 * A trip planned from places retrieved for it, end to end in the product.
 *
 * Runs WITHOUT the stub, so the real HTTP clients are exercised: the lodging lookup,
 * the query planner and the Places search all go out over `fetch`. Every one of them
 * is intercepted with a fixture, so nothing reaches a provider and nothing is billed —
 * what is under test is the wiring, not Google.
 *
 * The claim: after Generate, the trip is planned from what the search returned and NOT
 * from the bundled thirty-four places. That is checkable in the strongest possible way,
 * because the two sets share no names.
 */

import { expect, test, type Page } from '@playwright/test'

import {
  APP, closeItinerary, expectPlanVersion, fillSetup, openItinerary, openPoiOnMap, say,
} from './helpers.ts'

/** Open every day across a window, so capacity is about the set and not the clock. */
const hours = (openHour: number, closeHour: number) => ({
  periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
    open: { day, hour: openHour, minute: 0 },
    close: { day, hour: closeHour, minute: 0 },
  })),
})

const place = (id: string, type: string, open: [number, number]) => ({
  id,
  displayName: { text: id },
  primaryType: type,
  types: [type],
  photos: [
    {
      name: `places/${id.replace(/[^A-Za-z0-9_-]/g, '')}/photos/ref${id.slice(-1)}`,
      authorAttributions: [{ displayName: `Photographer ${id.slice(-1)}` }],
    },
  ],
  // Spread along a street near the lodging, so ranking has geography to work with.
  location: { latitude: 35.7 + Number(id.slice(-1)) * 0.002, longitude: 139.79 },
  regularOpeningHours: hours(open[0], open[1]),
  addressComponents: [{ longText: 'Taito City', types: ['locality'] }],
  editorialSummary: { text: `Retrieved ${id}.` },
})

/**
 * Enough for five days to have a main thing, a lunch and a dinner each.
 *
 * Named so no assertion can confuse them with the bundle: nothing in
 * `tokyo_places.json` is called "Retrieved-anything".
 */
const RETRIEVED = [
  ...[1, 2, 3, 4, 5].map((n) => place(`Retrieved-museum-${n}`, 'museum', [10, 18])),
  ...[1, 2, 3, 4, 5].map((n) => place(`Retrieved-ramen-${n}`, 'ramen_restaurant', [11, 23])),
  ...[1, 2, 3].map((n) => place(`Retrieved-izakaya-${n}`, 'japanese_izakaya_restaurant', [17, 23])),
]

/** A 1x1 PNG, so the photo route can answer with a real image and nothing is fetched. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/**
 * Answers every outward call with a fixture. Nothing leaves the browser.
 *
 * Photos included, and not as an afterthought: the fixture places carry photo
 * references, so a spec that left this route alone would send one real request per
 * stop to Google — with this machine's key — to be told the reference is invented.
 * That is slow, and it is someone's quota.
 */
async function interceptApi(
  page: Page,
  options: {
    places?: unknown[]
    /** Words the "model" says every search was written for. Absent: no model wording. */
    servesWords?: string
  } = {},
) {
  await page.route('**/api/photo*', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }),
  )

  await page.route('**/api/lodging', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        lodging: { lat: 35.703164, lng: 139.790828, matchedAddress: 'Kuramae, Taito City' },
      }),
    }),
  )

  await page.route('**/api/decompose', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        intent: ['Slow-paced', 'Time in local neighbourhoods'],
        considering: ['Moderate budget'],
      }),
    }),
  )

  // A valid answer that adds no wording of its own, so the application writes plain
  // queries and labels them as its own. No degradation, no model text.
  await page.route('**/api/query-plan', (route) => {
    const body = route.request().postDataJSON() as { searches: Array<{ category: string }> }
    const queries = options.servesWords
      ? body.searches.map((search) => ({
          category: search.category,
          textQuery: `${search.category} in a quiet street`,
          servesWords: options.servesWords,
        }))
      : []
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ queries, alsoSearch: [] }),
    })
  })

  await page.route('**/api/places', async (route) => {
    const body = route.request().postDataJSON() as { searches: Array<{ textQuery: string }> }
    // Every search gets the same set. Duplicates are the searcher's normal case — one
    // place legitimately answers several searches — and the quality gate dedupes.
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: body.searches.map((search) => ({
          textQuery: search.textQuery,
          places: options.places ?? RETRIEVED,
        })),
        calls: body.searches.length,
        fromCache: 0,
      }),
    })
  })

  await page.route('**/api/replacement', (route) =>
    route.fulfill({ status: 503, body: 'not under test here' }),
  )
}

async function createRetrievedTrip(page: Page) {
  await page.goto('/?reset=1')
  await page.getByTestId('new-trip').click()
  await fillSetup(page)
  await page.getByTestId('review-trip-state').click()
  await page.getByTestId('generate-itinerary').click()
  await expectPlanVersion(page, 1)
}

test('the trip is planned from what was retrieved for it, not from the bundle', async ({ page }) => {
  await interceptApi(page)
  await createRetrievedTrip(page)

  // Nothing fell back, so nothing is being explained away.
  await expect(page.getByTestId('degraded-notice')).toHaveCount(0)

  await openItinerary(page, 1)
  const timeline = page.getByTestId('timeline')
  await expect(timeline.locator('li').first()).toBeVisible()

  // Every stop came from the search.
  const names = await timeline.locator('li').allTextContents()
  expect(names.length).toBeGreaterThan(0)
  for (const name of names) expect(name).toMatch(/Retrieved-/)

  // And the bundle is nowhere in it: this trip could not have been planned from it.
  await expect(timeline).not.toContainText('Sensō-ji')
  await expect(page.getByRole('img', { name: 'Trip map' })).not.toContainText('Ameyoko')
})

test('the retrieved set is what the trip keeps reading afterwards (B4)', async ({ page }) => {
  await interceptApi(page)
  await createRetrievedTrip(page)

  // Alternatives for a retrieved stop come from the retrieved set. With the searches
  // now refused, an answer at all proves the trip is reading its own frozen snapshot
  // rather than looking anything up again.
  await page.unroute('**/api/places')
  await page.route('**/api/places', (route) => route.fulfill({ status: 503, body: 'no more' }))

  await openItinerary(page, 1)
  const first = page.getByTestId('timeline').locator('[data-place-id]').first()
  const placeId = await first.getAttribute('data-place-id')
  await closeItinerary(page)

  await page
    .getByRole('img', { name: 'Trip map' })
    .locator(`[data-place-id="${placeId}"]`)
    .dispatchEvent('click')

  // Either it offers options or it says it has none — both read the frozen set, and
  // neither needs the network (Gate 8's B8 rule).
  const offers = await page.getByTestId('open-alternatives').count()
  const saysNone = await page.getByTestId('no-alternatives').count()
  expect(offers + saysNone).toBe(1)
})

test('a search that cannot furnish a day falls back to the bundle, and says so', async ({ page }) => {
  // Five museums and nothing to eat: no day can have a lunch, which is the one kind of
  // thinness worth abandoning real places over.
  await interceptApi(page, {
    places: [1, 2, 3, 4, 5].map((n) => place(`Retrieved-museum-${n}`, 'museum', [10, 18])),
  })
  await createRetrievedTrip(page)

  const notice = page.getByTestId('degraded-notice')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText(/planned from the places I already know/i)

  // A real itinerary either way — from the seed set, which does have restaurants.
  await openItinerary(page, 1)
  await expect(page.getByTestId('timeline')).toContainText('Sensō-ji')
})

test('an unresolvable lodging falls back without searching', async ({ page }) => {
  await interceptApi(page)
  await page.unroute('**/api/lodging')
  await page.route('**/api/lodging', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ lodging: null }) }),
  )

  let searched = 0
  await page.unroute('**/api/places')
  await page.route('**/api/places', (route) => {
    searched++
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [], calls: 0, fromCache: 0 }) })
  })

  await createRetrievedTrip(page)

  await expect(page.getByTestId('degraded-notice')).toContainText('Kuramae')
  // Nothing was billed to find out what we already knew.
  expect(searched).toBe(0)
})

test('a retrieved stop is shown with its own photo, credited', async ({ page }) => {
  await interceptApi(page)

  const asked: string[] = []
  await page.unroute('**/api/photo*')
  await page.route('**/api/photo*', (route) => {
    asked.push(new URL(route.request().url()).searchParams.get('ref') ?? '')
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
  })

  await createRetrievedTrip(page)
  await openItinerary(page, 1)

  const photo = page.getByTestId('place-photo').first()
  await expect(photo).toBeVisible()

  // Proxied, never fetched from Google with a key in the browser (§13.1).
  expect(await photo.getAttribute('src')).toMatch(/^\/api\/photo\?ref=places%2F/)
  expect(asked.length).toBeGreaterThan(0)
  for (const ref of asked) expect(ref).toMatch(/^places\/[\w-]+\/photos\/[\w-]+$/)

  // The credit is what makes showing it permitted, so it is shown with it.
  await expect(page.getByTestId('photo-credit').first()).toContainText('Photographer')

  // The same stop opened from the map reads as fully as its row: when, photo, credit.
  const firstStop = await page
    .getByTestId('timeline')
    .locator('[data-place-id]')
    .first()
    .getAttribute('data-place-id')
  await openPoiOnMap(page, firstStop!, 1)
  const poi = page.getByRole('dialog')
  await expect(poi.getByTestId('poi-time')).toHaveText(/^Day 1 · \d{2}:\d{2}$/)
  await expect(poi.getByTestId('place-photo')).toBeVisible()
  await expect(poi.getByTestId('photo-credit')).toContainText('Photographer')
})

test('a stop quotes the words it was found for, and says what it is', async ({ page }) => {
  await interceptApi(page, { servesWords: 'local neighbourhoods' })
  await createRetrievedTrip(page)
  await openItinerary(page, 1)

  const reasons = page.getByTestId('timeline').getByTestId('stop-reasons').first()
  await expect(reasons).toContainText('Found for “local neighbourhoods”, from what you wrote.')
  // One reason decides the stop, and it is the one set heavier.
  const primary = reasons.locator('[data-strength="primary"]')
  await expect(primary).toHaveCount(1)
  const weight = (locator: typeof primary) =>
    locator.evaluate((node) => Number(getComputedStyle(node).fontWeight))
  const secondary = reasons.locator('[data-strength="secondary"]').first()
  if ((await secondary.count()) > 0) {
    expect(await weight(primary)).toBeGreaterThan(await weight(secondary))
  }

  // The Places summary is the stop's description, in the list and on the map.
  await expect(page.getByTestId('timeline').locator('.desc').first()).toContainText(/^Retrieved /)
  const firstStop = await page
    .getByTestId('timeline')
    .locator('[data-place-id]')
    .first()
    .getAttribute('data-place-id')
  await openPoiOnMap(page, firstStop!, 1)
  const poi = page.getByRole('dialog')
  await expect(poi).toContainText(`Retrieved ${firstStop}.`)
  await expect(poi.getByTestId('stop-reasons')).toContainText('Found for “local neighbourhoods”')
})

test('a photo that cannot be fetched leaves the stop readable', async ({ page }) => {
  await interceptApi(page)
  // A reference can outlive the image behind it. The row must not care.
  await page.unroute('**/api/photo*')
  await page.route('**/api/photo*', (route) => route.fulfill({ status: 404, body: '{}' }))

  await createRetrievedTrip(page)
  await openItinerary(page, 1)

  const rows = page.getByTestId('timeline').locator('li')
  await expect(rows.first()).toBeVisible()
  await expect(page.getByTestId('place-photo')).toHaveCount(0)
  // No picture means no credit to give, and no orphan caption either.
  await expect(page.getByTestId('photo-credit')).toHaveCount(0)
  await expect(rows.first()).toContainText('Retrieved-')
})

test('a trip planned from the bundle shows each stop\'s photo, with its credit', async ({ page }) => {
  // The bundled places were given photo references on 2026-10-01
  // (scripts/enrich/fetch_bundle_photos.ts). The image itself is stubbed here, so the
  // test buys nothing and does not depend on the network.
  await page.route('**/api/photo*', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }),
  )
  await page.goto(APP)
  await page.getByTestId('new-trip').click()
  await fillSetup(page)
  await page.getByTestId('review-trip-state').click()
  await page.getByTestId('generate-itinerary').click()
  await expectPlanVersion(page, 1)

  await openItinerary(page, 1)
  const stops = page.getByTestId('timeline').locator('li')
  await expect(stops.first()).toBeVisible()
  // Every stop on the day has its picture and its photographer's credit.
  const count = await stops.count()
  await expect(page.getByTestId('timeline').getByTestId('place-photo')).toHaveCount(count)
  await expect(page.getByTestId('timeline').getByTestId('photo-credit')).toHaveCount(count)
})
