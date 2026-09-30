/**
 * Shared E2E steps.
 *
 * The app's interaction grammar changed at Gate 6 (map-first Plan, chat as a
 * sheet, Profile actions behind an overflow menu). Keeping the navigation in
 * one place means a later change to the grammar is one edit, not twenty.
 */

import { readFileSync } from 'node:fs'

import { expect, type Page } from '@playwright/test'

/**
 * The demo catalogue, read the way the app reads it.
 *
 * A spec that needs "a place the plan does not hold" has to know what places there
 * are. Read from the bundle rather than listed in the spec, because a name written
 * into a test is a name that goes stale the next time the data is rebuilt.
 */
const PLACES: Array<{
  placeId: string
  name: string
  category: string
  typicalDurationMin: number
}> = JSON.parse(readFileSync('data/demo_tokyo_v1/tokyo_places.json', 'utf8'))

/**
 * The app, as a test should find it.
 *
 * `stub` is the deterministic model. `reset` matters as of Gate 8: a trip now
 * survives a reload, so without it the second test in a file would open on the first
 * one's trip and every "New Trip" step would be looking at the wrong screen.
 */
export const APP = '/?stub=1&reset=1'

export const SETUP = {
  name: 'Tokyo Slow Week',
  start: '2026-10-05',
  end: '2026-10-09',
  lodging: 'Kuramae',
  intent: 'Slow-paced. Time in local neighbourhoods.',
  considering: 'Moderate budget.',
}

export async function fillSetup(page: Page, considering = SETUP.considering) {
  await page.locator('#trip-name').fill(SETUP.name)
  await page.locator('#start-date').fill(SETUP.start)
  await page.locator('#end-date').fill(SETUP.end)
  await page.locator('#lodging').fill(SETUP.lodging)
  await page.locator('#intent').fill(SETUP.intent)
  await page.locator('#considering').fill(considering)
}

/** Index -> Stage A -> Stage B -> Plan. */
export async function createTrip(page: Page, considering?: string) {
  await page.goto(APP)
  await page.getByTestId('new-trip').click()
  await fillSetup(page, considering)
  await page.getByTestId('review-trip-state').click()
  await page.getByTestId('generate-itinerary').click()
  await expectPlanVersion(page, 1)
}

export async function expectPlanVersion(page: Page, version: number) {
  await expect(page.getByTestId('plan-version')).toHaveText(`v${version}`)
}

/** Profile actions live behind each row's ••• menu (UI draft 06). */
export async function confirmMemory(page: Page, memoryId: string) {
  await page.getByTestId(`memory-menu-${memoryId}`).click()
  await page.getByTestId(`confirm-${memoryId}`).click()
}

export async function openChat(page: Page) {
  if (await page.getByRole('dialog', { name: 'Chat' }).isVisible()) return
  // The chat is opened from the Plan view; the State view has no composer.
  if (await page.getByTestId('state-screen').isVisible()) await page.getByTestId('view-plan').click()
  await page.getByTestId('open-chat').click()
  await expect(page.getByRole('dialog', { name: 'Chat' })).toBeVisible()
}

/**
 * The record of confirmed decisions — on the State screen, under Priorities, since
 * 2026-10-01 (it used to sit at the foot of the chat).
 */
export async function openDecisions(page: Page) {
  if (await page.getByRole('dialog', { name: 'Chat' }).isVisible()) await closeChat(page)
  if (!(await page.getByTestId('state-screen').isVisible())) await page.getByTestId('view-state').click()
  await expect(page.getByTestId('decisions')).toBeVisible()
}

export async function closeChat(page: Page) {
  await page.getByTestId('close-chat').click()
  await expect(page.getByRole('dialog', { name: 'Chat' })).toHaveCount(0)
}

/** Opens the chat sheet if it is closed, then sends from inside it. */
export async function say(page: Page, message: string) {
  await openChat(page)
  const sheet = page.getByRole('dialog', { name: 'Chat' })
  await sheet.getByTestId('chat-input').fill(message)
  await sheet.getByTestId('chat-send').click()
}

export async function openItinerary(page: Page, day?: number) {
  if (await page.getByRole('dialog', { name: 'Chat' }).isVisible()) await closeChat(page)
  // Idempotent: callers chain it, and the launcher is gone once it is open.
  if (!(await page.getByRole('dialog', { name: 'Itinerary' }).isVisible())) {
    await page.getByTestId('open-itinerary').click()
  }
  if (day !== undefined) await page.getByRole('tab', { name: `Day ${day}` }).click()
}

export async function closeItinerary(page: Page) {
  await page.getByTestId('close-itinerary').click()
}

/**
 * Opens a planned stop from its map pin, with that stop's day in focus.
 *
 * Addressed by placeId, not by display name: names come from the Places API and
 * have changed under this suite before, and which place sits where is decided
 * by ranking (§12.2) rather than fixed.
 *
 * The day is derived from the itinerary rather than passed in. Which day a stop
 * lands on is the planner's call, and writing it into three specs is how all three
 * broke the moment the day structure changed. Pass one only to assert a stop is on
 * a particular day, which is a different claim.
 *
 * The day is focused first so the map frames that day's stops rather than the
 * whole trip. Opening the POI sheet from there also exercises the rule the
 * sheets are meant to follow: a POI REPLACES the itinerary rather than stacking
 * on it (§5.7).
 *
 * The event is dispatched at the pin rather than clicked at its coordinates,
 * because a neighbouring pin or the resting itinerary sheet may sit over it —
 * central Tokyo stops are within a kilometre of each other and pins do not
 * currently spread when they collide. That overlap is a real thing to fix on
 * the map; it is not what the tests calling this are about, and hit-testing it
 * here would fail them for a reason none of them claims to check.
 */
export async function openPoiOnMap(page: Page, placeId: string, day?: number) {
  await openItinerary(page, day ?? (await dayHolding(page, placeId)))
  await page
    .getByRole('img', { name: 'Trip map' })
    .locator(`[data-place-id="${placeId}"]`)
    .dispatchEvent('click')
  await expect(page.getByRole('dialog', { name: 'Itinerary' })).toHaveCount(0)
}

/**
 * Which day tab holds a given place, 1-based.
 *
 * Derived from the itinerary rather than written into each spec. Which day a stop
 * lands on is the planner's call and has moved three times as the day structure and
 * the data changed — every time taking a handful of hard-coded day numbers with it.
 * Throws when no day holds it, because a spec that silently tests nothing is worse
 * than one that fails.
 */
export async function dayHolding(page: Page, placeId: string, days = 5): Promise<number> {
  await openItinerary(page)

  for (let day = 1; day <= days; day++) {
    await page.getByRole('tab', { name: `Day ${day}` }).click()
    const row = page.getByTestId('timeline').locator(`[data-place-id="${placeId}"]`)
    if ((await row.count()) > 0) return day
  }

  throw new Error(`no day in the itinerary holds "${placeId}"`)
}

/** Every stop the itinerary currently holds, with the day it is on. */
export async function plannedStops(
  page: Page,
  days = 5,
): Promise<Array<{ placeId: string; day: number }>> {
  await openItinerary(page)
  const stops: Array<{ placeId: string; day: number }> = []

  for (let day = 1; day <= days; day++) {
    await page.getByRole('tab', { name: `Day ${day}` }).click()
    const rows = page.getByTestId('timeline').locator('[data-place-id]')
    for (const placeId of await rows.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-place-id') ?? ''),
    )) {
      if (placeId) stops.push({ placeId, day })
    }
  }

  return stops
}

/** Every placeId the itinerary currently holds, across all days. */
export async function plannedPlaceIds(page: Page, days = 5): Promise<string[]> {
  return (await plannedStops(page, days)).map((stop) => stop.placeId)
}

/**
 * Opens a stop that offers a SAME-SLOT alternative, with its Alternatives list
 * showing, and answers which stop that turned out to be.
 *
 * Which stop that is cannot be written into a spec. An option is same-slot only if
 * it fits the window the outgoing stop occupies, and that window is the outgoing
 * place's own typical duration — so a forty-minute ramen counter has no same-slot
 * option in a catalogue whose other dinners all run an hour and a half, while the
 * sushi counter two days later has four. The spec named a stop, the planner gave
 * that slot to a ramen counter, and a test about confirmation-by-selection failed
 * over the length of a meal.
 *
 * Longest stop first, because a longer window is what makes room for an option, and
 * the search stops at the first one that has any.
 */
export async function openStopWithSameSlotAlternative(page: Page, tries = 5): Promise<string> {
  const duration = (placeId: string) =>
    PLACES.find((place) => place.placeId === placeId)?.typicalDurationMin ?? 0

  const stops = (await plannedStops(page)).sort(
    (a, b) => duration(b.placeId) - duration(a.placeId),
  )

  for (const stop of stops.slice(0, tries)) {
    await openPoiOnMap(page, stop.placeId, stop.day)
    await page.getByTestId('open-alternatives').click()
    await expect(page.getByTestId('alternatives')).toBeVisible()

    if ((await page.locator('[data-testid="alternative"][data-shifts="false"]').count()) > 0) {
      return stop.placeId
    }

    await page.getByTestId('close-poi').click()
  }

  throw new Error(`no stop among the ${tries} longest offers a same-slot alternative`)
}

/**
 * A place of one of these categories that the plan does NOT already hold.
 *
 * For a must-visit that has to change something. Naming a fixed place instead was
 * how this broke: the day grew from three stops to five, the planner picked the
 * sushi counter the spec was about to ask for, and "add a must-visit" became a
 * State edit with an empty plan diff — a correct commit, and the wrong test.
 */
export async function unplannedPlace(
  page: Page,
  categories: string[],
): Promise<{ placeId: string; name: string }> {
  const planned = await plannedPlaceIds(page)
  const place = PLACES.find(
    (candidate) =>
      categories.includes(candidate.category) &&
      !planned.includes(candidate.placeId) &&
      // It has to FIT, or the must-visit comes back as a Conflict instead of a
      // Reframe: the first place this picked was a three-hour day trip to Odawara,
      // which no part of a day has room for.
      candidate.typicalDurationMin <= 90,
  )

  if (!place) throw new Error(`no free ${categories.join(' / ')} place the plan could take`)
  return { placeId: place.placeId, name: place.name }
}

/** Stops on the fullest day, which is what "fewer spots" is measured against. */
export async function busiestDayStops(page: Page, days = 5): Promise<number> {
  await openItinerary(page)
  let most = 0

  for (let day = 1; day <= days; day++) {
    await page.getByRole('tab', { name: `Day ${day}` }).click()
    most = Math.max(most, await page.getByTestId('timeline').locator('li').count())
  }

  return most
}
