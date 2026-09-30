/**
 * Gate 8 — the scripted Tokyo demo, completed repeatedly without manual repair.
 *
 * The required journey, in one run rather than in seven independent ones:
 *
 *   New Trip -> Plan -> Replace -> Reorganize -> Reframe -> Receipt -> Profile
 *   -> New Trip using Memory
 *
 * One run matters because the gate's Definition of Done is about the demo holding
 * together, not about each transaction working in isolation. Every other spec starts
 * from a fresh trip; this is the only one that asks whether a trip that has already
 * been through a Replace can survive a Reorganize, and whether the Reframe after both
 * still has something left to reframe.
 *
 * The rest of the file is what Gate 8 adds around it: the trip surviving a reload,
 * starting over actually starting over, and the product finishing the job with the
 * planning service down.
 *
 * **No visual-regression baselines**, which the gate leaves to "if practical". A
 * screenshot baseline is only a test if the thing that renders it is pinned, and here
 * it is one laptop's Chrome and one laptop's font stack — so the first run on any other
 * machine fails for reasons that have nothing to do with the product. What those
 * baselines would have been guarding is asserted directly instead, in
 * `gate6UiSystem.spec.ts`: no sideways scroll at 390 and 360, 44px targets, a visible
 * focus ring, one sheet open at a time.
 */

import { expect, test } from '@playwright/test'

import {
  APP,
  closeChat,
  closeItinerary,
  fillSetup,
  confirmMemory,
  createTrip,
  dayHolding,
  expectPlanVersion,
  openChat,
  openDecisions,
  openItinerary,
  say,
} from './helpers.ts'

const RAIN = "It's going to rain all day on Day 2."
const TIRED = 'I feel tired. Fewer spots.'

test('the whole scripted demo runs through in one trip', async ({ page }) => {
  await createTrip(page)

  // --- Replace --------------------------------------------------------------
  const ramenDay = await dayHolding(page, 'ramen_rokurinsha')
  await closeItinerary(page)

  await say(page, `The ramen place on Day ${ramenDay} is closed today.`)
  const proposal = page.getByTestId('proposal')
  await expect(proposal).toHaveAttribute('data-change-type', 'replace')
  await proposal.getByTestId('confirm-change').click()
  await expectPlanVersion(page, 2)

  // --- Reorganize -----------------------------------------------------------
  await say(page, RAIN)
  await expect(proposal).toHaveAttribute('data-change-type', 'reorganize')
  await proposal.getByTestId('confirm-change').click()
  await expectPlanVersion(page, 3)

  // --- Reframe --------------------------------------------------------------
  await say(page, TIRED)
  await expect(proposal).toHaveAttribute('data-change-type', 'reframe')
  await proposal.getByTestId('confirm-change').click()
  await expectPlanVersion(page, 4)

  // --- Receipts: one per transaction, in order, read-only -------------------
  await openDecisions(page)
  await expect(page.getByTestId('receipt')).toHaveCount(3)
  // Newest first: the last thing that happened is the thing being asked about.
  await expect(page.getByTestId('receipt').first()).toHaveAttribute('data-change-type', 'reframe')
  await expect(page.getByTestId('receipt').last()).toHaveAttribute('data-change-type', 'replace')
  // No undo anywhere (§7).
  await expect(page.getByRole('button', { name: /undo|revert/i })).toHaveCount(0)

  // --- Profile: confirm a memory -------------------------------------------
  // (The decisions are on the State screen, so the chat is already closed.)
  await page.getByTestId('open-index').click()
  await page.getByTestId('open-profile').click()
  await confirmMemory(page, 'mem_003')
  await expect(page.getByTestId('memory-active')).toHaveCount(3)
  await page.getByTestId('profile-back').click()

  // --- New Trip using that memory ------------------------------------------
  // Opening the Profile closes the Index behind it, so this comes back through it.
  await page.getByTestId('open-index').click()
  await page.getByTestId('new-trip').click()
  await expect(page.getByTestId('memory-disclosure')).toContainText('Using 3 memories')

  await page.locator('#trip-name').fill('Tokyo Again')
  await page.locator('#start-date').fill('2026-11-02')
  await page.locator('#end-date').fill('2026-11-06')
  await page.locator('#lodging').fill('Kuramae')
  await page.locator('#intent').fill('Slow-paced. Time in local neighbourhoods.')
  await page.locator('#considering').fill('Moderate budget.')
  await page.getByTestId('review-trip-state').click()
  await page.getByTestId('generate-itinerary').click()
  await expectPlanVersion(page, 1)

  // The memory materially reached this trip, and says which memory it was.
  await openItinerary(page)
  const cited = page.getByTestId('memory-citation').first()
  // Any memory in use: sushi and izakaya were active from the start, market by hand.
  await expect(cited).toHaveAttribute('data-memory-id', /^mem_00[123]$/)
})

test('the trip is still there after a reload', async ({ page }) => {
  await createTrip(page)

  const ramenDay = await dayHolding(page, 'ramen_rokurinsha')
  await closeItinerary(page)
  await say(page, `The ramen place on Day ${ramenDay} is closed today.`)
  await page.getByTestId('proposal').getByTestId('confirm-change').click()
  await expectPlanVersion(page, 2)

  // Deliberately WITHOUT the reset flag: this is a returning traveller, not a new one.
  await page.goto('/?stub=1')

  // Back on the trip, at the version it was committed to — not back at the Index.
  await expectPlanVersion(page, 2)
  await openItinerary(page)
  await expect(page.getByRole('heading', { name: 'Tokyo Slow Week' })).toBeVisible()
  await closeItinerary(page)

  // The receipt survived with it: a decision record that vanishes on reload is not a
  // record (§9.3).
  await openDecisions(page)
  await expect(page.getByTestId('receipt')).toHaveCount(1)
})

test('a pending proposal does not come back after a reload', async ({ page }) => {
  await createTrip(page)

  const ramenDay = await dayHolding(page, 'ramen_rokurinsha')
  await closeItinerary(page)
  await say(page, `The ramen place on Day ${ramenDay} is closed today.`)
  await expect(page.getByTestId('proposal')).toBeVisible()

  await page.goto('/?stub=1')
  await expectPlanVersion(page, 1)

  // It was never confirmed, so nothing on screen reflects it; putting a change the
  // traveller walked away from back in front of them is not continuity (§7.7).
  await openChat(page)
  await expect(page.getByTestId('proposal')).toHaveCount(0)
  await expect(page.getByTestId('receipt')).toHaveCount(0)
})

test('starting over leaves a first run', async ({ page }) => {
  await createTrip(page)

  await page.getByTestId('open-index').click()
  await page.getByTestId('open-profile').click()
  await confirmMemory(page, 'mem_003')
  await page.getByTestId('profile-back').click()

  // Destructive, so it asks first — and taking it back leaves everything alone.
  await page.getByTestId('open-index').click()
  await page.getByTestId('reset-demo').click()
  await expect(page.getByTestId('confirm-reset')).toBeVisible()
  await page.getByTestId('reset-cancel').click()
  await expect(page.getByTestId('confirm-reset')).toHaveCount(0)

  await page.getByTestId('reset-demo').click()
  await page.getByTestId('reset-confirm').click()

  // Back at the Index with the drawer put away — there is no trip behind it to
  // slide back to.
  await expect(page.getByRole('navigation', { name: 'Trips and profile' })).toHaveCount(0)
  await expect(page.getByTestId('plan-version')).toHaveCount(0)
  await expect(page.getByTestId('open-trip')).toHaveCount(0)
  await expect(page.getByText('Nothing planned yet')).toBeVisible()

  // The Profile is back to a first run: the confirmation went with the reset,
  // and only the strongly evidenced memories are in use again.
  await page.getByTestId('open-profile').click()
  await expect(page.getByTestId('memory-active')).toHaveCount(2)
  await expect(page.locator('[data-memory-id="mem_003"]')).toHaveAttribute('data-testid', 'memory-candidate')

  // And it is gone for good, not just off screen.
  await page.goto('/?stub=1')
  await expect(page.getByTestId('plan-version')).toHaveCount(0)
})

test('a request it cannot route is answered, not failed', async ({ page }) => {
  await createTrip(page)

  // §6 routes deterministically, and "none of the above" is one of the answers it can
  // give. What must not happen is an error: nothing about this request is broken, and
  // an error banner would say the product is, while telling the traveller nothing
  // about what to say instead.
  await say(page, 'Which neighbourhood is the hotel in?')

  const thread = page.getByTestId('chat-thread')
  await expect(thread).toContainText(/which day and which stop/i)
  await expect(page.getByTestId('proposal')).toHaveCount(0)
  await expect(page.locator('.banner.error')).toHaveCount(0)
  await expectPlanVersion(page, 1)
})

test('what the product is doing is announced, not only drawn (§14.5)', async ({ page }) => {
  await createTrip(page)

  // A traveller using a screen reader gets none of the visual cues: a pill that
  // appears, a banner that slides in. Both have to be live regions or they are
  // invisible twice over.
  const ramenDay = await dayHolding(page, 'ramen_rokurinsha')
  await closeItinerary(page)
  await say(page, `The ramen place on Day ${ramenDay} is closed today.`)

  await expect(page.getByTestId('proposal')).toBeVisible()
  await closeChat(page)

  // The waiting badge and the pending pill share a spot, and both report status.
  await expect(page.getByTestId('waiting-badge')).toBeVisible()

  // Every sheet is a named dialog, which is how it is reachable and announced at all.
  await openItinerary(page)
  await expect(page.getByRole('dialog', { name: 'Itinerary' })).toBeVisible()
})

test('the trip can still be made with the planning service down (C2)', async ({ page }) => {
  // The one spec that runs WITHOUT the stub: the real HTTP client, against a service
  // that answers 503. Everything is intercepted, so no provider is called and nothing
  // is billed — and the path under test is the one a real outage takes.
  await page.route('**/api/**', (route) => route.fulfill({ status: 503, body: 'down' }))

  await page.goto('/?reset=1')
  await page.getByTestId('new-trip').click()
  await fillSetup(page)
  await page.getByTestId('review-trip-state').click()

  // It says what it did by itself, rather than showing a provider's status code.
  const notice = page.getByTestId('degraded-notice')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText(/split your notes up myself/i)
  await expect(notice).not.toContainText(/503/)
  await expect(page.locator('.banner.error')).toHaveCount(0)

  // And Stage B still has the traveller's own words in it, split into editable items.
  await expect(page.getByLabel(/^Intent:/).first()).toHaveValue(/Slow-paced/)
  await expect(page.getByLabel(/^Considering:/).first()).toHaveValue(/Moderate budget/)

  await page.getByTestId('dismiss-degraded').click()
  await expect(notice).toHaveCount(0)

  // A full itinerary, from a deterministic generator that never needed the model.
  await page.getByTestId('generate-itinerary').click()
  await expectPlanVersion(page, 1)

  // And a Replace still works: ranking put the candidates in order, so what the
  // outage costs is the sentence, not the swap.
  const ramenDay = await dayHolding(page, 'ramen_rokurinsha')
  await closeItinerary(page)
  await say(page, `The ramen place on Day ${ramenDay} is closed today.`)

  const proposal = page.getByTestId('proposal')
  await expect(proposal).toHaveAttribute('data-change-type', 'replace')
  await expect(page.getByTestId('degraded-notice')).toContainText(/picked the closest fit myself/i)

  await proposal.getByTestId('confirm-change').click()
  await expectPlanVersion(page, 2)
})

test('a server with no key costs one attempt, not three (Gate 8)', async ({ page }) => {
  // 501 is what the API answers when it has no key for the job. Until Gate 8 the
  // server did not answer at all — it exited, taking the page with it.
  // Counted per job: Stage B asks two (splitting the notes, then reading each line —
  // 2026-10-01), and each must be tried once, not three times.
  const attempts = new Map<string, number>()
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname
    attempts.set(path, (attempts.get(path) ?? 0) + 1)
    route.fulfill({ status: 501, body: JSON.stringify({ error: 'not configured' }) })
  })

  await page.goto('/?reset=1')
  await page.getByTestId('new-trip').click()
  await fillSetup(page)
  await page.getByTestId('review-trip-state').click()

  await expect(page.getByTestId('degraded-notice')).toBeVisible()
  // The answer would be the same every time, so the stand-in takes over at once.
  expect(attempts.size).toBeGreaterThan(0)
  for (const [path, count] of attempts) expect(count, path).toBe(1)

  // And the trip is still made, from the places the product already has.
  await page.getByTestId('generate-itinerary').click()
  await expectPlanVersion(page, 1)
})

test('a stored trip whose places are gone is dropped, not shown', async ({ page }) => {
  // The shareable prototype carries its catalogue inside the file, so a viewer who
  // opened an earlier build has a trip built from places this build does not have.
  // Restoring it produced a column of raw place ids and no photographs.
  await page.goto(APP)
  await page.evaluate(() => {
    const now = '2026-09-20T00:00:00.000Z'
    localStorage.setItem(
      'the-next-trip:v1',
      JSON.stringify({
        format: 1,
        seededAt: now,
        trips: [
          {
            id: 'trip_old',
            createdAt: now,
            frame: {
              name: 'From another build',
              destination: 'Tokyo',
              startDate: '2026-10-05',
              endDate: '2026-10-09',
              baseLodging: { placeId: 'kuramae_base', name: 'Kuramae' },
            },
            memorySnapshot: { tripId: 'trip_old', createdAt: now, memories: [] },
          },
        ],
        states: [['trip_old', { version: 1, intent: [], considering: [], priorities: [] }]],
        plans: [
          [
            'trip_old',
            {
              version: 1,
              days: [
                {
                  dayIndex: 0,
                  startsAt: { placeId: 'kuramae_base', name: 'Kuramae' },
                  endsAt: { placeId: 'kuramae_base', name: 'Kuramae' },
                  items: [
                    {
                      id: 'item_d0_lunch',
                      placeId: 'a_place_this_build_never_had',
                      dayIndex: 0,
                      startTime: '12:45',
                      endTime: '13:45',
                    },
                  ],
                },
              ],
            },
          ],
        ],
        receipts: [],
        memories: [],
      }),
    )
  })

  await page.goto('/?stub=1')

  // A first run, not a broken trip.
  await expect(page.getByTestId('plan-version')).toHaveCount(0)
  await expect(page.getByText('Nothing planned yet')).toBeVisible()

  // And it is gone for good, rather than waiting to be restored again.
  await page.goto('/?stub=1')
  await expect(page.getByTestId('plan-version')).toHaveCount(0)
})
