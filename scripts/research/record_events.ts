/**
 * Records a live event search for the shareable prototype (product_spec §7.8).
 *
 * The prototype is one offline file — no server, no key — so it cannot search. It
 * carries this recording instead, labelled as recorded and dated, and the app says so
 * wherever it shows one of these events. The full app searches live.
 *
 * SPENDS MONEY on a cold cache: one web search, a model call per page read, a Places
 * lookup per venue. Results are cached for a day.
 *
 *   npx tsx scripts/research/record_events.ts baseball 2026-09-29 2026-10-31
 */

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { findEvents } from '../../server/events.ts'

const [activity = 'baseball', startDate = '2026-09-29', endDate = '2026-10-31'] = process.argv.slice(2)
const result = await findEvents({ activity, destination: 'Tokyo', startDate, endDate }, (line) => console.log(`  ${line.slice(0, 160)}`))

const out = resolve(process.cwd(), `data/demo_events/tokyo_${activity}.json`)
writeFileSync(out, JSON.stringify({ ...result, recorded: true, window: { startDate, endDate } }, null, 2))
console.log(`\n  ${result.events.length} ${activity} events, checked ${result.searchedAt} -> ${out}\n`)
for (const event of result.events) console.log(`  ${event.date} ${event.start}  ${event.title} @ ${event.venue.name}`)
