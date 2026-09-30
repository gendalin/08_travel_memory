/**
 * classify_places.ts
 *
 * Resolves saved places to taxonomy categories.
 *
 * Two routes, in descending order of trust:
 *
 *   1. Google Places type  — authoritative, needs GOOGLE_MAPS_API_KEY.
 *      NOT YET ACTIVE: the key currently returns API_KEY_SERVICE_BLOCKED for
 *      places.googleapis.com. See the TODO below.
 *
 *   2. Name lookup by LLM  — this file's current behaviour. The model is asked
 *      what kind of establishment a name refers to. Workable for well-known
 *      restaurants, unreliable for generic names, and it can be confidently
 *      wrong. Recorded as categorySource "llm_name" so downstream code and
 *      review can see the weaker provenance.
 *
 * Note the ftid in the Takeout URL identifies the place but is NOT a Places API
 * place_id, so the Places route has to go through Text Search by name rather
 * than a direct id lookup.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { requireEnv } from './env.ts'
import { CATEGORIES, UNCLASSIFIED } from './taxonomy.ts'
import { REPO_ROOT } from './types.ts'

export const PLACE_MODEL = process.env.PLACE_MODEL ?? 'gpt-5.4-mini'
const PROMPT_VERSION = 1
const CACHE_DIR = resolve(REPO_ROOT, '.cache/places')

export interface PlaceClassification {
  category: string
  confidence: number
  /** Short factual note on what the place is. */
  summary: string
}

const CATEGORY_IDS = [...CATEGORIES.map((category) => category.id), UNCLASSIFIED]
const CATEGORY_LEGEND = CATEGORIES.map(
  (category) => `${category.id} (${category.labelEn} / ${category.labelZh})`,
).join('\n')

/**
 * Classifies saved-place names in one batched call.
 * Returns results keyed by place name.
 */
export async function classifyPlaceNames(
  names: string[],
  city = 'Tokyo',
): Promise<Map<string, PlaceClassification>> {
  const results = new Map<string, PlaceClassification>()
  if (names.length === 0) return results

  mkdirSync(CACHE_DIR, { recursive: true })
  const key = createHash('sha1')
    .update(JSON.stringify(names))
    .update(`|${city}|${PLACE_MODEL}|v${PROMPT_VERSION}`)
    .digest('hex')
  const cachePath = join(CACHE_DIR, `${key}.json`)

  if (existsSync(cachePath)) {
    for (const [name, value] of Object.entries(
      JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, PlaceClassification>,
    )) {
      results.set(name, value)
    }
    return results
  }

  const apiKey = requireEnv('OPENAI_API_KEY', 'saved-place classification')

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['places'],
    properties: {
      places: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'category', 'confidence', 'summary'],
          properties: {
            name: { type: 'string' },
            category: { type: 'string', enum: CATEGORY_IDS },
            confidence: { type: 'number' },
            summary: { type: 'string' },
          },
        },
      },
    },
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: PLACE_MODEL,
      messages: [
        {
          role: 'system',
          content: `You are given names of places saved in a Google Maps list for ${city}.
For each, say what kind of establishment it is.

Rules:
- Return one entry per input name, with the name copied EXACTLY as given.
- Use ${UNCLASSIFIED} when you do not actually recognise the place or cannot
  tell its type from the name. Do not guess — a wrong category is worse than
  ${UNCLASSIFIED} here.
- confidence reflects how sure you are of the establishment type.
- summary: one short factual phrase, max 12 words.

CATEGORIES:
${CATEGORY_LEGEND}`,
        },
        { role: 'user', content: names.map((name) => `- ${name}`).join('\n') },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'place_classifications', strict: true, schema },
      },
    }),
  })

  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }

  const body = (await res.json()) as { choices: Array<{ message: { content: string } }> }
  const parsed = JSON.parse(body.choices[0].message.content) as {
    places: Array<{ name: string; category: string; confidence: number; summary: string }>
  }

  for (const place of parsed.places) {
    results.set(place.name, {
      category: place.category,
      confidence: place.confidence,
      summary: place.summary,
    })
  }

  writeFileSync(cachePath, JSON.stringify(Object.fromEntries(results), null, 2), 'utf8')
  return results
}

// TODO(preprocess): Google Places route, once the key is unblocked.
//   POST https://places.googleapis.com/v1/places:searchText
//     body   { textQuery: `${name} ${city}`, languageCode: 'en', maxResultCount: 1 }
//     header X-Goog-FieldMask: places.id,places.displayName,places.primaryType,
//                              places.types,places.location,places.priceLevel,
//                              places.regularOpeningHours
//   Map primaryType/types through CategoryDef.googleTypes, and record
//   categorySource 'google_places'. Compare the returned displayName against the
//   saved name and flag mismatches rather than trusting the first hit blindly —
//   Text Search will always return something.
//   This also supplies lat/lng, price level and opening hours for tokyo_places.json.
