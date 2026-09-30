/**
 * Search text for each thing the profile wants (B2).
 *
 * The division of labour: the model writes the WORDS of a search, Places supplies
 * the places, and code decides what to search for and re-checks everything that
 * comes back. These tests hold the third part — every guard the application puts
 * between the model and a real API call.
 */

import { describe, expect, it } from 'vitest'

import {
  categoryWords,
  defaultTextQuery,
  resolveQueryPlan,
  MAX_EXTRA_CATEGORIES,
} from '../../src/application/planning/queryPlan.ts'
import {
  buildRetrievalProfile,
  searchPlan,
} from '../../src/application/planning/retrievalProfile.ts'
import { INTEREST_CATEGORIES } from '../../src/domain/plan/dayRoles.ts'
import { createStubLlm } from '../../src/services/llm/stubLlm.ts'
import type { QueryPlanResult } from '../../src/services/llm/types.ts'

const CONTEXT = {
  destination: 'Tokyo',
  baseLodgingName: 'Kuramae',
  intentText: 'Slow-paced. Time in local neighbourhoods.',
  consideringText: 'Moderate budget.',
}

/** Full pace, so every role — and so every category gate — is in play. */
const profile = buildRetrievalProfile({ days: 5 })
const asked = searchPlan(profile)
const askedCategories = asked.map((entry) => entry.category)

const resolve = (planned?: QueryPlanResult) =>
  resolveQueryPlan({ profile, ...CONTEXT, planned })

describe('without a model', () => {
  const resolved = resolve()

  /**
   * The degradation path has to be real rather than aspirational: retrieval must
   * work when the model call fails, so a run with no model produces a complete,
   * usable plan.
   */
  it('produces one usable search for everything the profile asked for', () => {
    expect(resolved.map((query) => query.category)).toEqual(askedCategories)
    for (const query of resolved) {
      expect(query.textQuery.length).toBeGreaterThan(0)
      expect(query.source).toBe('default')
      expect(query.retrieve).toBeGreaterThan(0)
    }
  })

  it('carries the depth the profile asked for, unchanged', () => {
    for (const query of resolved) {
      const wanted = asked.find((entry) => entry.category === query.category)!
      expect(query.retrieve).toBe(wanted.retrieve)
    }
  })

  it('adds nothing of its own', () => {
    expect(resolved.every((query) => !query.addedByModel)).toBe(true)
  })
})

describe('with a model', () => {
  it('uses the words the model wrote', async () => {
    const planned = await createStubLlm().planQueries({
      ...CONTEXT,
      searches: asked.map((entry) => ({ category: entry.category, preferred: entry.preferred })),
      allowedCategories: INTEREST_CATEGORIES,
    })
    const resolved = resolve(planned)

    expect(resolved.every((query) => query.source === 'model')).toBe(true)
    // And the words are not merely the fallback wearing a different label.
    for (const query of resolved) {
      expect(query.textQuery).not.toBe(
        defaultTextQuery({ category: query.category, ...CONTEXT }),
      )
    }
  })

  /**
   * The guard that matters most. A category the model invented is not a category,
   * and the plan must survive the whole answer being unusable.
   */
  it('drops every query naming a category nobody asked for', async () => {
    const planned = await createStubLlm({ hallucinateCategory: 'michelin_starred' }).planQueries({
      ...CONTEXT,
      searches: asked.map((entry) => ({ category: entry.category, preferred: entry.preferred })),
      allowedCategories: INTEREST_CATEGORIES,
    })
    const resolved = resolve(planned)

    expect(resolved.map((query) => query.category)).toEqual(askedCategories)
    expect(resolved.every((query) => query.source === 'default')).toBe(true)
  })

  it('falls back on an empty or blank query rather than searching for nothing', () => {
    const resolved = resolve({
      queries: askedCategories.map((category) => ({ category, textQuery: '   ' })),
      alsoSearch: [],
    })
    expect(resolved.every((query) => query.source === 'default')).toBe(true)
    expect(resolved.every((query) => query.textQuery.trim().length > 0)).toBe(true)
  })

  it('keeps the first query when the model answers a category twice', () => {
    const category = askedCategories[0]
    const resolved = resolve({
      queries: [
        { category, textQuery: 'first answer' },
        { category, textQuery: 'second answer' },
      ],
      alsoSearch: [],
    })
    expect(resolved.find((query) => query.category === category)!.textQuery).toBe('first answer')
  })

  it('never lets the model change the subject', () => {
    // A well-formed query for something the profile never asked about.
    const unasked = INTEREST_CATEGORIES.find((category) => !askedCategories.includes(category))!
    const resolved = resolve({
      queries: [{ category: unasked, textQuery: 'a perfectly good query' }],
      alsoSearch: [],
    })
    expect(resolved.map((query) => query.category)).toEqual(askedCategories)
  })
})

describe('the categories a model may add', () => {
  /** Outside the cap on categories per role, so the extras path can recover them. */
  const outsideThePlan = INTEREST_CATEGORIES.filter(
    (category) => !askedCategories.includes(category),
  )

  it('accepts a few it was right about', () => {
    expect(outsideThePlan.length).toBeGreaterThan(0)
    const resolved = resolve({ queries: [], alsoSearch: [outsideThePlan[0]] })

    const added = resolved.filter((query) => query.addedByModel)
    expect(added.map((query) => query.category)).toEqual([outsideThePlan[0]])
  })

  it('drops anything that is not a category at all', () => {
    const resolved = resolve({ queries: [], alsoSearch: ['transit', 'not_a_category'] })
    expect(resolved.filter((query) => query.addedByModel)).toEqual([])
  })

  it('drops a category no role in play could use', () => {
    // At three stops a day only the anchor and the two meals exist, so an
    // "on the way" category has nowhere to go.
    const shortDay = buildRetrievalProfile({ days: 5 })
    const roleless = resolveQueryPlan({
      profile: { ...shortDay, stopsPerDay: 3, targets: shortDay.targets.slice(0, 3) },
      ...CONTEXT,
      planned: { queries: [], alsoSearch: ['onsen_sento'] },
    })
    expect(roleless.filter((query) => query.addedByModel)).toEqual([])
  })

  it('drops one it already asked for', () => {
    const resolved = resolve({ queries: [], alsoSearch: [askedCategories[0]] })
    expect(resolved.filter((query) => query.addedByModel)).toEqual([])
    expect(resolved.map((query) => query.category)).toEqual(askedCategories)
  })

  it('never adds the same one twice', () => {
    const resolved = resolve({
      queries: [],
      alsoSearch: [outsideThePlan[0], outsideThePlan[0]],
    })
    expect(resolved.filter((query) => query.addedByModel)).toHaveLength(1)
  })

  it('stops at the cap, because each one is a real API call', () => {
    const resolved = resolve({ queries: [], alsoSearch: outsideThePlan })
    expect(resolved.filter((query) => query.addedByModel).length).toBeLessThanOrEqual(
      MAX_EXTRA_CATEGORIES,
    )
  })

  /** A hedge on the model's reading, not a commitment to it. */
  it('searches an addition no deeper than the shallowest thing already planned', () => {
    const resolved = resolve({ queries: [], alsoSearch: [outsideThePlan[0]] })
    const added = resolved.find((query) => query.addedByModel)!
    const shallowest = Math.min(...asked.map((entry) => entry.retrieve))

    expect(added.retrieve).toBeLessThanOrEqual(shallowest)
  })

  it('says whether the words for an addition came from the model', () => {
    const withWords = resolve({
      queries: [{ category: outsideThePlan[0], textQuery: 'a quiet bathhouse' }],
      alsoSearch: [outsideThePlan[0]],
    })
    expect(withWords.find((query) => query.addedByModel)!.source).toBe('model')

    const withoutWords = resolve({ queries: [], alsoSearch: [outsideThePlan[0]] })
    expect(withoutWords.find((query) => query.addedByModel)!.source).toBe('default')
  })
})

describe('the wording written without a model', () => {
  it('names the kind of place, where the trip is based, and the city', () => {
    const query = defaultTextQuery({ category: 'grocery_market', ...CONTEXT })
    expect(query).toContain('grocery market')
    expect(query).toContain('Kuramae')
    expect(query).toContain('Tokyo')
  })

  it('spells a category the way the rest of the product does', () => {
    expect(categoryWords('cafe_kissaten')).toBe('cafe kissaten')
  })

  it('never leaks an internal id into something a person would read', () => {
    for (const category of INTEREST_CATEGORIES) {
      expect(defaultTextQuery({ category, ...CONTEXT })).not.toContain('_')
    }
  })
})

describe('the traveller words a search was written for', () => {
  const ownWords = `${CONTEXT.intentText}\n${CONTEXT.consideringText}`
  const plan = (textQuery: string, servesWords = ''): QueryPlanResult => ({
    queries: [{ category: askedCategories[0], textQuery, servesWords }],
    alsoSearch: [],
  })
  const first = (planned: QueryPlanResult, words = ownWords) =>
    resolveQueryPlan({ profile, ...CONTEXT, planned, ownWords: words })[0]

  it('reads the sentences a query was written for off the query itself', () => {
    // The model named nothing, but its query plainly carries two of their sentences.
    expect(first(plan('Kuramae kissaten local neighbourhoods on a moderate budget')).servesWords).toEqual([
      'Time in local neighbourhoods',
      'Moderate budget',
    ])
  })

  it('reads American spelling in a query as the traveller\'s British', () => {
    expect(first(plan('temple shrine quiet neighborhoods')).servesWords).toEqual([
      'Time in local neighbourhoods',
    ])
  })

  it('quotes the sentence whole, as the traveller wrote it', () => {
    expect(first(plan('slow sushi near Kuramae')).servesWords).toEqual(['Slow-paced'])
  })

  it('keeps a model claim that is a span of their text, whatever its case', () => {
    expect(first(plan('a quiet counter', 'LOCAL neighbourhoods.')).servesWords).toEqual([
      'LOCAL neighbourhoods',
    ])
  })

  it('drops a paraphrase, or a label copied from the prompt', () => {
    expect(first(plan('a quiet counter', 'quiet residential areas')).servesWords).toBeUndefined()
    expect(first(plan('a quiet counter', 'their own habit')).servesWords).toBeUndefined()
  })

  it('keeps nothing when it is not told what the traveller wrote', () => {
    expect(first(plan('local neighbourhoods', 'local neighbourhoods'), '').servesWords).toBeUndefined()
  })

  it('never attaches words to a query the application wrote itself', () => {
    const resolved = first(plan('  ', 'local neighbourhoods'))
    expect(resolved.source).toBe('default')
    expect(resolved.servesWords).toBeUndefined()
  })

  it('the stub quotes the first clause of the Intent verbatim', async () => {
    const planned = await createStubLlm().planQueries({
      ...CONTEXT,
      searches: asked.map((entry) => ({ category: entry.category, preferred: entry.preferred })),
      allowedCategories: INTEREST_CATEGORIES,
    })
    expect(first(planned).servesWords).toEqual(['Slow-paced'])
  })
})
