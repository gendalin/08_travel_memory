/**
 * Evidence -> a structured POI Brief, by the model, from the evidence only (spec §15).
 *
 * The model writes prose and tags and says which evidence items it drew on. It never
 * writes a URL: sources are attached here from the evidence it was shown. Two things
 * it proposes are then checked by code rather than taken:
 *
 *   - confidence is capped by what the evidence can support — no official or
 *     institutional page, no "high", whatever the model says
 *   - mainstreamness is not asked of it at all; it is measured from review volume
 */

import { structured } from '../../server/openai.ts'
import { popularity } from '../../src/domain/places/facets.ts'
import type {
  DescriptionConfidence,
  Mainstreamness,
  PoiBrief,
  PoiEnrichmentEvidence,
} from '../../src/services/places/poiBrief.ts'
import type { FetchedEvidence } from './fetch_poi_evidence.ts'

export interface GeneratedBrief {
  shortDescription: string
  brief: PoiBrief
  /** What the model said before code capped it, for the report. */
  modelConfidence: DescriptionConfidence
  /** The evidence records behind the brief's sources. */
  evidence: PoiEnrichmentEvidence[]
  /**
   * Numbers in the description that no cited page contains — a year, a count, a
   * price the model may have brought in from elsewhere. Reported, for a person to check.
   */
  ungroundedNumbers: string[]
}

/** Numbers as they appear in prose: "1952", "14,000", "3.5". */
function numbersIn(text: string): string[] {
  return [...new Set(text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [])].map((number) => number.replace(/,/g, ''))
}

/**
 * The tag vocabularies, closed. These are machine-facing features for ranking, so a
 * tag has to mean the same thing on every place: left open, the pilot put
 * "independent" on a 1,300-year-old shrine and "museum" under setting.
 */
export const SIGNAL_VOCABULARY = {
  cultural: {
    edo: 'Edo-period history or culture',
    meiji_taisho: 'Meiji or Taisho era',
    showa: 'Showa-era character or history',
    traditional_japanese: 'traditional Japanese culture or craft practice',
    shinto: 'Shinto shrine or practice',
    buddhist: 'Buddhist temple or practice',
    modern_art: 'modern art (roughly 1860s-1970s)',
    contemporary_art: 'contemporary art',
    design: 'product, graphic or industrial design',
    architecture: 'notable architecture or architects',
    craft: 'handmade craft, makers, artisans',
    literary: 'books, literature, publishing',
    anime_manga: 'anime, manga, games',
    food_culture: 'a food tradition or specialty',
    coffee_culture: 'coffee roasting or kissaten culture',
    independent_business:
      'a small shop, cafe or bar the evidence shows is owner-run or independent — never a museum, shrine, temple, foundation or public body',
    local_community: 'rooted in and used by its neighbourhood',
  },
  experience: {
    browsing: 'looking through goods or books at leisure',
    shopping: 'buying goods',
    exhibition_viewing: 'seeing exhibitions or collections',
    worship: 'visiting to pray or pay respects',
    festival: 'known for a festival or event',
    dining: 'a meal',
    drinking: 'alcohol',
    coffee: 'coffee or tea',
    dessert: 'sweets or desserts',
    bathing: 'bathhouse or onsen',
    slow_walk: 'walking around the grounds or area',
    workshop: 'hands-on class or workshop',
    learning: 'talks, archives, explanation of history',
    viewpoint: 'views over the city or landscape',
  },
  setting: {
    quiet: 'described as quiet or calm',
    lively: 'described as busy or lively',
    small_scale: 'a small shop or room',
    spacious: 'large rooms or grounds',
    retro: 'old-fashioned interior or building',
    minimal: 'minimal, pared-back design',
    historic_building: 'a historic building or grounds',
    modern_building: 'a modern building',
    backstreet: 'on a side street or in a residential area',
    riverside: 'by a river or water',
    greenery: 'garden, trees or park',
    in_a_complex: 'inside a larger complex or building',
  },
} as const

function vocabularyLines(group: keyof typeof SIGNAL_VOCABULARY): string {
  return Object.entries(SIGNAL_VOCABULARY[group])
    .map(([tag, meaning]) => `      ${tag} — ${meaning}`)
    .join('\n')
}

const SYSTEM = `You write a factual brief about ONE place for travellers deciding whether to visit.
Use ONLY the evidence supplied. The place record says which place it is; the evidence
items say what it is.

Rules:
- Never add a fact the evidence does not state: no invented history, dates, people,
  awards, prices, dishes, atmosphere or specialties. If the evidence is thin, write less.
- Write as plain description of the place. Never mention "the evidence", "sources",
  "the website" or "listings". A venue's own claims about what it offers may be stated
  plainly as what it offers.
- Evidence may be in Japanese. Write in English.
- shortDescription: ONE sentence of 8 to 18 words — count them. Factual and neutral:
  what the place is, and what sets it apart if the evidence says. No "you", no
  "perfect for", no itinerary advice.
- overview: 40 to 80 words. Concept, history, specialisation, cultural significance —
  only what the evidence supports. No promotional language or superlatives.
- atmosphere: 0 to 4 words for how the place FEELS to be in (e.g. quiet, cosy, solemn,
  bustling, retro, airy) — and only if the evidence describes that feel. Not what the
  place is about: never "cultural", "design-focused", "retail", "contemporary",
  "traditional". Empty is the right answer when the feel is not described.
- knownFor: concrete things or experiences named in the evidence ("secondhand art books").
- goodFor: general visitor uses the evidence supports ("slow browsing", "an hour of
  contemporary design"). Not personal recommendations.
- decisionSignals: choose ONLY from these tags, and only when the evidence supports the
  meaning given. Fewer, correct tags are better than many.
    cultural:
${vocabularyLines('cultural')}
    experience:
${vocabularyLines('experience')}
    setting:
${vocabularyLines('setting')}
- descriptionConfidence: "high" only when the evidence clearly identifies this place and
  gives specific facts; "medium" when it is consistent but general; "low" when it is
  sparse or you are unsure it is about this place — and then keep the overview cautious.
- sourcesUsed: the numbers of the evidence items you actually drew on.
- Never write a URL.`

const tagList = (group: keyof typeof SIGNAL_VOCABULARY) => ({
  type: 'array',
  items: { type: 'string', enum: Object.keys(SIGNAL_VOCABULARY[group]) },
})

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'shortDescription', 'overview', 'atmosphere', 'knownFor', 'goodFor',
    'decisionSignals', 'descriptionConfidence', 'sourcesUsed',
  ],
  properties: {
    shortDescription: { type: 'string' },
    overview: { type: 'string' },
    atmosphere: { type: 'array', items: { type: 'string' } },
    knownFor: { type: 'array', items: { type: 'string' } },
    goodFor: { type: 'array', items: { type: 'string' } },
    decisionSignals: {
      type: 'object',
      additionalProperties: false,
      required: ['cultural', 'experience', 'setting'],
      properties: {
        cultural: tagList('cultural'),
        experience: tagList('experience'),
        setting: tagList('setting'),
      },
    },
    descriptionConfidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    sourcesUsed: { type: 'array', items: { type: 'integer' } },
  },
}

interface ModelBrief {
  shortDescription: string
  overview: string
  atmosphere: string[]
  knownFor: string[]
  goodFor: string[]
  decisionSignals: { cultural: string[]; experience: string[]; setting: string[] }
  descriptionConfidence: DescriptionConfidence
  sourcesUsed: number[]
}

const ORDER: DescriptionConfidence[] = ['low', 'medium', 'high']

/** Page text needed before a source can carry a confident description. */
const RICH_TEXT = 800
const SOME_TEXT = 400

/**
 * The most confidence the evidence can support (spec §11).
 *
 *   high    an official, tourism or institutional page with real content
 *   medium  any identity-checked page with some content, or two agreeing sources
 *   low     otherwise
 */
export function confidenceCap(evidence: readonly FetchedEvidence[]): DescriptionConfidence {
  const authoritative = evidence.some(
    (entry) =>
      ['official_website', 'official_tourism', 'institutional'].includes(entry.record.sourceType) &&
      entry.text.length >= RICH_TEXT,
  )
  if (authoritative) return 'high'
  if (evidence.length >= 2 || evidence.some((entry) => entry.text.length >= SOME_TEXT)) return 'medium'
  return 'low'
}

function lower(a: DescriptionConfidence, b: DescriptionConfidence): DescriptionConfidence {
  return ORDER[Math.min(ORDER.indexOf(a), ORDER.indexOf(b))]
}

function mainstreamnessOf(reviews: number | undefined): Mainstreamness | undefined {
  switch (popularity({ userRatingCount: reviews } as never)) {
    case 'local':
      return 'low'
    case 'known':
      return 'medium'
    case 'landmark':
      return 'high'
    default:
      return undefined
  }
}

/**
 * Categories that are institutions by nature. The model kept tagging them
 * `independent_business` — a national museum, a foundation-run gallery — so the
 * definition is enforced here rather than hoped for.
 */
const INSTITUTIONAL_CATEGORIES = new Set(['museum_gallery', 'temple_shrine', 'park_garden', 'viewpoint_scenic'])

function tidy(items: string[], limit = 6): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, limit)
}

function snake(items: string[]): string[] {
  return tidy(items.map((item) => item.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')))
}

export async function generateBrief(input: {
  place: { placeId: string; name: string; category: string; neighborhood: string; userRatingCount?: number }
  nameJa?: string
  address?: string
  evidence: FetchedEvidence[]
}): Promise<GeneratedBrief> {
  const { place, evidence } = input
  const user = [
    'Place record (Google Places):',
    `- name: ${place.name}${input.nameJa && input.nameJa !== place.name ? ` (${input.nameJa})` : ''}`,
    `- kind: ${place.category.replace(/_/g, ' ')}`,
    `- area: ${place.neighborhood}, Tokyo${input.address ? ` — ${input.address}` : ''}`,
    '',
    ...evidence.flatMap((entry, index) => [
      `Evidence ${index + 1} (${entry.record.sourceType.replace(/_/g, ' ')}${entry.record.title ? `: ${entry.record.title}` : ''}):`,
      entry.text,
      '',
    ]),
  ].join('\n')

  const output = await structured<ModelBrief>(SYSTEM, user, SCHEMA, 'poi_brief')

  const used = output.sourcesUsed
    .filter((number) => Number.isInteger(number) && number >= 1 && number <= evidence.length)
    .map((number) => evidence[number - 1])
  // The model was shown nothing but this evidence, so if it names none, all of it
  // is what the brief rests on.
  const backing = used.length > 0 ? [...new Set(used)] : evidence

  const cap = confidenceCap(backing)
  const cited = backing.map((entry) => entry.text.replace(/,/g, '')).join('\n')
  const ungroundedNumbers = numbersIn(`${output.shortDescription} ${output.overview}`).filter(
    (number) => !cited.includes(number),
  )
  const mainstreamness = mainstreamnessOf(place.userRatingCount)

  return {
    shortDescription: output.shortDescription.trim(),
    modelConfidence: output.descriptionConfidence,
    evidence: backing.map((entry) => entry.record),
    ungroundedNumbers,
    brief: {
      overview: output.overview.trim(),
      atmosphere: tidy(output.atmosphere.map((item) => item.toLowerCase())),
      knownFor: tidy(output.knownFor),
      goodFor: tidy(output.goodFor),
      decisionSignals: {
        cultural: snake(output.decisionSignals.cultural).filter(
          (tag) => !(tag === 'independent_business' && INSTITUTIONAL_CATEGORIES.has(place.category)),
        ),
        experience: snake(output.decisionSignals.experience),
        setting: snake(output.decisionSignals.setting),
        ...(mainstreamness ? { mainstreamness } : {}),
      },
      descriptionSources: backing.map((entry) => ({
        url: entry.record.sourceUrl,
        type: entry.record.sourceType,
        ...(entry.record.title ? { title: entry.record.title } : {}),
      })),
      descriptionConfidence: lower(output.descriptionConfidence, cap),
    },
  }
}
