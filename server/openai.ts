/**
 * Server-side OpenAI calls with structured outputs.
 *
 * The key lives here and never leaves. The schemas are deliberately narrow: none
 * can express a change type, so the model cannot classify a transaction even by
 * accident, and none can express a place.
 *
 * The query planner is the one schema that accepts free text, and only for the
 * WORDS of a search. What comes back from those words is whatever the Places API
 * matches — real businesses with real ids, hours and coordinates — so a badly
 * phrased query costs quality, not truth. Every category it names is pinned to an
 * enum, and the application re-checks the lot regardless.
 */

import { envOrThrow } from '../scripts/preprocess/env.ts'

export const MODEL = process.env.LLM_MODEL ?? 'gpt-5.4-mini'

export async function structured<T>(system: string, user: string, schema: unknown, name: string): Promise<T> {
  const apiKey = envOrThrow('OPENAI_API_KEY', 'trip planning')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
    }),
  })

  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`)

  const body = (await res.json()) as { choices: Array<{ message: { content: string } }> }
  return JSON.parse(body.choices[0].message.content) as T
}

const DECOMPOSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'considering', 'proposed_priority'],
  properties: {
    intent: { type: 'array', items: { type: 'string' } },
    considering: { type: 'array', items: { type: 'string' } },
    proposed_priority: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['name', 'reason'],
      properties: { name: { type: 'string' }, reason: { type: 'string' } },
    },
  },
}

export async function decomposeTripState(input: {
  intentText: string
  consideringText: string
  destination: string
  days: number
}) {
  const result = await structured<{
    intent: string[]
    considering: string[]
    proposed_priority: { name: string; reason: string } | null
  }>(
    `Split a traveller's free text into two lists for a ${input.days}-day trip to ${input.destination}.

INTENT = what kind of trip they want (pace, mood, themes). Not a constraint.
CONSIDERING = concrete constraints the itinerary must respect (must-visits,
fixed times, budget, things to avoid, days that are short).

Rules:
- One idea per item. Short phrases, the traveller's own words where possible.
- Never invent a constraint they did not state.
- Do not restate an Intent as a Priority.
- You may suggest ONE additional optimisation priority (e.g. "Photographic
  potential") in proposed_priority if the text clearly implies one, else null.
  It is only a suggestion; the user must accept it.`,
    `What kind of trip: ${input.intentText || '(not stated)'}\n\nShould consider: ${input.consideringText || '(not stated)'}`,
    DECOMPOSE_SCHEMA,
    'decomposed_state',
  )

  return {
    intent: result.intent,
    considering: result.considering,
    ...(result.proposed_priority ? { proposedPriority: result.proposed_priority } : {}),
  }
}

export async function chooseReplacement(input: {
  message: string
  outgoing: { placeId: string; name: string; category: string; neighborhood: string }
  candidates: Array<{ placeId: string; name: string; category: string; neighborhood: string; shortDescription: string }>
}) {
  const allowed = input.candidates.map((place) => place.placeId)

  return structured<{ placeId: string; rationale: string }>(
    `A place in the traveller's itinerary needs replacing. Choose ONE replacement
from the candidate list.

Rules:
- placeId MUST be one of: ${allowed.join(', ')}
- Never invent a place or an id.
- Prefer a candidate close to the original's neighbourhood and of the same kind.
- rationale: one short sentence, addressed to the traveller, saying why this one.
- Do not mention internal terms like "replace", "proposal" or "diff".`,
    `The traveller said: "${input.message}"

Currently scheduled: ${input.outgoing.name} (${input.outgoing.category}, ${input.outgoing.neighborhood})

Candidates:
${input.candidates.map((place) => `- ${place.placeId}: ${place.name} — ${place.category}, ${place.neighborhood}. ${place.shortDescription}`).join('\n')}`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['placeId', 'rationale'],
      properties: {
        placeId: { type: 'string', enum: allowed },
        rationale: { type: 'string' },
      },
    },
    'replacement_choice',
  )
}

/**
 * Search text for each thing the retrieval profile wants to find.
 *
 * `category` is enum-constrained to what the caller allows, the same way
 * `chooseReplacement` pins a placeId. `alsoSearch` is bounded in the prompt and
 * bounded again by the caller, because a model with an open budget will find
 * something to add to every trip.
 */
export async function planQueries(input: {
  destination: string
  baseLodgingName: string
  intentText: string
  consideringText: string
  searches: Array<{ category: string; preferred: boolean }>
  allowedCategories: string[]
}) {
  const allowed = input.allowedCategories

  return structured<{
    queries: Array<{ category: string; textQuery: string; servesWords: string }>
    alsoSearch: string[]
  }>(
    `Write the text of a place search for each category below, for a trip to
${input.destination} based at ${input.baseLodgingName}.

You are writing SEARCH TEXT for a places database. You are not naming places, and
you must not name a specific business — a search that names one returns only that
one, and the traveller loses the choice.

Rules:
- One query per category given, using that exact category value.
- Work the traveller's own words into the wording: what they said is the difference
  between "sushi" and "a neighbourhood sushi counter away from the crowds".
- Keep each query under ten words, and phrase it as something a person would type.
- Mention ${input.baseLodgingName} or a nearby area when the traveller's words
  suggest staying local; leave location out when they suggest ranging further.
- A category marked (their own habit) is something they return to. Make that query
  more specific, not less.
- servesWords: the exact words from "What kind of trip" or "Should consider" that
  this query was written for, copied character for character — a phrase, not a
  paraphrase. Never copy a label from these instructions, such as "(their own
  habit)". Use "" when the query does not serve anything they wrote.
- alsoSearch: at most three FURTHER categories from the allowed list that their
  words clearly point at and the list below missed. Empty is the right answer when
  nothing is missing.
- Never invent a category value. Use only: ${allowed.join(', ')}`,
    `What kind of trip: ${input.intentText || '(not stated)'}

Should consider: ${input.consideringText || '(not stated)'}

Write a query for each of these:
${input.searches.map((search) => `- ${search.category}${search.preferred ? ' (their own habit)' : ''}`).join('\n')}`,
    {
      type: 'object',
      additionalProperties: false,
      required: ['queries', 'alsoSearch'],
      properties: {
        queries: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['category', 'textQuery', 'servesWords'],
            properties: {
              category: { type: 'string', enum: allowed },
              textQuery: { type: 'string' },
              servesWords: { type: 'string' },
            },
          },
        },
        alsoSearch: { type: 'array', items: { type: 'string', enum: allowed } },
      },
    },
    'query_plan',
  )
}
