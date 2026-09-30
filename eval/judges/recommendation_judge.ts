/**
 * Recommendation relevance rubric (eval spec §17.1, §17.2).
 *
 * Offline and deterministic: a scenario rubric states which categories and which
 * words make a POI clearly / partially relevant to that scenario's Intent. It sees
 * only structured candidate records (category, name, tags, neighbourhood,
 * description) — never hidden reasoning — and returns the §20 judge schema, so a
 * model judge can later replace it behind the same signature.
 */

import type { DemoPlace } from '../../src/services/places/types.ts'

export interface RelevanceRubric {
  id: string
  /** Categories that are clearly on-intent. */
  strongCategories: string[]
  /** Categories that plausibly support the intent. */
  partialCategories: string[]
  /** Words in name / tags / description that make a place clearly on-intent. */
  strongWords: RegExp
  /** Areas a knowledgeable local would expect to surface for this intent. */
  expectedAreas: RegExp
}

export const LITERARY_SHOWA: RelevanceRubric = {
  id: 'literary_showa_v1',
  strongCategories: ['bookstore', 'cafe_kissaten'],
  partialCategories: ['museum_gallery', 'temple_shrine', 'park_garden', 'onsen_sento', 'soba_udon', 'teishoku', 'grocery_market', 'lifestyle_homeware', 'fashion_vintage'],
  strongWords: /\b(book|books|bookstore|shobo|shobō|kissa|kissaten|showa|shōwa|retro|literary|antiquarian|used books|second-hand|jazz|sabou|sabō)\b/i,
  expectedAreas: /jimbo|jinbo|jinbō|shimokita|koenji|kōenji|nishiogi|yanaka|sendagi|kichijoji|hongo|hongō/i,
}

export interface JudgeOutput {
  score: 0 | 1 | 2
  status: 'fail' | 'acceptable' | 'strong'
  reason: string
  failureCategory?: string
  evidenceRefs: string[]
}

export function judgePoi(place: DemoPlace, rubric: RelevanceRubric): JudgeOutput {
  const text = [place.name, ...place.tags, place.shortDescription ?? '', place.neighborhood].join(' ')
  const wordHit = rubric.strongWords.test(text)
  if (rubric.strongCategories.includes(place.category) || wordHit) {
    // A generic cafe (dessert shop, chain stand) is on-category but not on-atmosphere.
    const generic = place.category === 'cafe_kissaten' && !wordHit && /dessert|stand|cannele|sundae|takeaway|bakery/i.test(text)
    if (generic) {
      return { score: 1, status: 'acceptable', reason: `cafe_kissaten but reads as a generic cafe (${place.tags.slice(0, 3).join(', ')})`, evidenceRefs: [place.placeId] }
    }
    return {
      score: 2,
      status: 'strong',
      reason: wordHit ? `name/tags match the literary-Showa lexicon` : `category ${place.category} is on-intent`,
      evidenceRefs: [place.placeId],
    }
  }
  if (rubric.partialCategories.includes(place.category)) {
    return { score: 1, status: 'acceptable', reason: `${place.category} supports slow cultural exploration but is not literary/Showa-specific`, evidenceRefs: [place.placeId] }
  }
  return { score: 0, status: 'fail', reason: `${place.category} is unrelated to a literary / kissaten / Showa intent`, failureCategory: 'RANKING_FAILURE', evidenceRefs: [place.placeId] }
}

/** §17.1 candidate recall proxy, 0-2. */
export function candidateRecall(pool: DemoPlace[], rubric: RelevanceRubric): JudgeOutput & { detail: Record<string, number | string[]> } {
  const strong = pool.filter((place) => judgePoi(place, rubric).score === 2)
  const bookstores = pool.filter((place) => place.category === 'bookstore').length
  const kissaten = pool.filter((place) => place.category === 'cafe_kissaten').length
  // An area counts only if it contributes at least one strongly relevant place.
  const expectedAreaHits = [...new Set(strong.filter((place) => rubric.expectedAreas.test(place.neighborhood)).map((place) => place.neighborhood))]

  const typesPresent = bookstores > 0 && kissaten > 0
  const areasPresent = expectedAreaHits.length >= 2
  const score: 0 | 1 | 2 = typesPresent && areasPresent ? 2 : typesPresent || strong.length >= 3 ? 1 : 0
  return {
    score,
    status: score === 2 ? 'strong' : score === 1 ? 'acceptable' : 'fail',
    reason: `bookstores=${bookstores}, kissaten=${kissaten}, strong-relevance POIs=${strong.length}, expected literary areas present=${expectedAreaHits.join(', ') || 'none'}`,
    ...(score < 2 ? { failureCategory: 'DISCOVERY_FAILURE' } : {}),
    evidenceRefs: strong.slice(0, 10).map((place) => place.placeId),
    detail: { bookstores, kissaten, strong: strong.length, expectedAreaHits },
  }
}
