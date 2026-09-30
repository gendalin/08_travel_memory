/**
 * Candidate ranking (product_spec §12.2, §3.3).
 *
 * The claims this file is here to hold:
 *   - a Priority weight actually changes which place wins
 *   - a missing fact scores null and is dropped, never scored as zero
 *   - novelty genuinely opposes memoryMatch, so both Priorities stay meaningful
 *   - `avoid`, which validation deliberately does not enforce, bites here
 */

import { describe, expect, it } from 'vitest'

import {
  lostOn,
  PRECEDENCE,
  rankPlaces,
  scorePlace,
  toTerms,
  weightMultiplier,
  type RankablePlace,
  type RankingContext,
} from '../../src/domain/ranking/score.ts'

/** Kuramae, the demo trip's base lodging. */
const ANCHOR = { lat: 35.703164, lng: 139.790828 }

const BASE: RankingContext = {
  preferences: [],
  avoid: [],
  stateTerms: [],
  dayPoints: [],
  usedCategories: [],
  weights: { convenience: 1, cost: 1, novelty: 1 },
}

function context(overrides: Partial<RankingContext> = {}): RankingContext {
  return { ...BASE, ...overrides }
}

function place(overrides: Partial<RankablePlace> & { placeId: string }): RankablePlace {
  return {
    category: 'ramen',
    neighborhood: 'Kuramae',
    tags: [],
    shortDescription: '',
    ...overrides,
  }
}

/** Close to the lodging, and expensive. */
const NEAR = place({ placeId: 'near', lat: 35.7035, lng: 139.7935, priceLevel: 3 })
/** Across town, and cheap. The two trade off, so a weight change can flip them. */
const FAR = place({
  placeId: 'far',
  neighborhood: 'Shinjuku',
  lat: 35.6896,
  lng: 139.7006,
  priceLevel: 1,
})

const order = (places: RankablePlace[], ctx: RankingContext) =>
  rankPlaces(places, ctx).map((scored) => scored.place.placeId)

describe('priority weights decide between otherwise valid options (§3.3)', () => {
  it('prefers the near, pricey place when convenience outweighs cost', () => {
    expect(
      order([NEAR, FAR], context({
        anchor: ANCHOR,
        weights: { convenience: 2, cost: 0.5, novelty: 1 },
      })),
    ).toEqual(['near', 'far'])
  })

  it('prefers the far, cheap place when cost outweighs convenience', () => {
    expect(
      order([NEAR, FAR], context({
        anchor: ANCHOR,
        weights: { convenience: 0.5, cost: 2, novelty: 1 },
      })),
    ).toEqual(['far', 'near'])
  })

  it('maps State weights onto multipliers with medium as the neutral one', () => {
    expect(weightMultiplier('medium')).toBe(1)
    expect(weightMultiplier('low')).toBeLessThan(weightMultiplier('medium'))
    expect(weightMultiplier('high')).toBeGreaterThan(weightMultiplier('medium'))
  })

  it('drops a component entirely when its Priority was removed', () => {
    const withoutCost = context({ anchor: ANCHOR, weights: { convenience: 1, cost: 0, novelty: 1 } })

    // FAR's only advantage is its price. Take cost out of the weighting and the
    // closer place wins on every remaining dimension.
    expect(order([NEAR, FAR], withoutCost)).toEqual(['near', 'far'])
  })
})

describe('missing facts score null, not zero', () => {
  it('scores convenience null with no anchor to measure from', () => {
    expect(scorePlace(NEAR, context()).components.convenience).toBeNull()
  })

  it('scores convenience null when the place has no coordinates', () => {
    const noCoordinates = place({ placeId: 'unmapped', priceLevel: 2 })
    expect(scorePlace(noCoordinates, context({ anchor: ANCHOR })).components.convenience).toBeNull()
  })

  it('scores cost null when the place has no price level', () => {
    expect(scorePlace(place({ placeId: 'unpriced' }), context()).components.cost).toBeNull()
  })

  it('scores routeFit null on a day with nothing placed yet', () => {
    expect(scorePlace(NEAR, context({ anchor: ANCHOR })).components.routeFit).toBeNull()
  })

  it('does not penalise a place for the facts it is missing', () => {
    const ctx = context({ anchor: ANCHOR })
    const unpriced = place({ placeId: 'unpriced', lat: NEAR.lat, lng: NEAR.lng })
    const cheap = place({ placeId: 'cheap', lat: NEAR.lat, lng: NEAR.lng, priceLevel: 0 })
    const pricey = place({ placeId: 'pricey', lat: NEAR.lat, lng: NEAR.lng, priceLevel: 4 })

    // Identical but for price: the unpriced one must land between them, not at
    // the bottom, which is what a null-as-zero would produce.
    const scores = Object.fromEntries(
      rankPlaces([unpriced, cheap, pricey], ctx).map((s) => [s.place.placeId, s.total]),
    )
    expect(scores.unpriced).toBeLessThan(scores.cheap)
    expect(scores.unpriced).toBeGreaterThan(scores.pricey)
  })
})

describe('memory and novelty pull against each other', () => {
  const preferences = [{ category: 'ramen', memoryId: 'mem_005', weight: 0.8 }]

  it('raises memoryMatch for a category the snapshot carries', () => {
    const scored = scorePlace(NEAR, context({ preferences }))
    expect(scored.components.memoryMatch).toBe(0.8)
    expect(scored.memoryId).toBe('mem_005')
  })

  it('lowers novelty by the same familiarity', () => {
    expect(scorePlace(NEAR, context({ preferences })).components.novelty).toBeCloseTo(0.2)
  })

  it('leaves no memoryId on a category the snapshot says nothing about', () => {
    const sushi = place({ placeId: 'sushi_1', category: 'sushi' })
    expect(scorePlace(sushi, context({ preferences })).memoryId).toBeUndefined()
  })

  it('lets a high novelty weight outweigh the memory it opposes', () => {
    const sushi = place({ placeId: 'sushi_1', category: 'sushi', lat: NEAR.lat, lng: NEAR.lng, priceLevel: 3 })
    const familiar = { ...NEAR, placeId: 'ramen_1' }

    const memoryLeads = context({ preferences, anchor: ANCHOR, weights: { convenience: 1, cost: 1, novelty: 0.5 } })
    const noveltyLeads = context({ preferences, anchor: ANCHOR, weights: { convenience: 1, cost: 1, novelty: 2 } })

    expect(order([familiar, sushi], memoryLeads)[0]).toBe('ramen_1')
    expect(order([familiar, sushi], noveltyLeads)[0]).toBe('sushi_1')
  })

  it('counts repetition inside the plan as familiarity too', () => {
    const once = scorePlace(NEAR, context({ usedCategories: ['ramen'] })).components.novelty!
    const twice = scorePlace(NEAR, context({ usedCategories: ['ramen', 'ramen'] })).components.novelty!
    const never = scorePlace(NEAR, context()).components.novelty!

    expect(never).toBe(1)
    expect(once).toBeLessThan(never)
    expect(twice).toBeLessThan(once)
  })
})

describe('State terms and avoid', () => {
  it('rewards a place whose tags match what the user said', () => {
    const quiet = place({ placeId: 'quiet', tags: ['quiet', 'counter'] })
    const plain = place({ placeId: 'plain' })
    const ctx = context({ stateTerms: ['quiet', 'counter'] })

    expect(scorePlace(quiet, ctx).components.stateMatch!).toBeGreaterThan(
      scorePlace(plain, ctx).components.stateMatch!,
    )
  })

  it('zeroes stateMatch for an avoided place, which validation does not catch (§8)', () => {
    const crowded = place({ placeId: 'crowded', tags: ['crowds', 'queue'] })
    expect(scorePlace(crowded, context({ avoid: ['crowds'] })).components.stateMatch).toBe(0)
  })

  it('ranks an avoided place below one that matches nothing at all', () => {
    const crowded = place({ placeId: 'crowded', tags: ['crowds'] })
    const neutral = place({ placeId: 'neutral' })
    expect(order([crowded, neutral], context({ avoid: ['crowds'] }))).toEqual(['neutral', 'crowded'])
  })

  it('drops words too short or too common to mean anything', () => {
    expect(toTerms('We want a slow trip with really good ramen')).toEqual(['slow', 'ramen'])
  })
})

describe('ordering is total and reproducible', () => {
  it('breaks ties on placeId so the same inputs give the same plan', () => {
    const a = place({ placeId: 'aaa' })
    const b = place({ placeId: 'bbb' })
    expect(order([b, a], context())).toEqual(['aaa', 'bbb'])
    expect(order([a, b], context())).toEqual(['aaa', 'bbb'])
  })

  it('keeps every score inside 0-1', () => {
    for (const scored of rankPlaces([NEAR, FAR], context({ anchor: ANCHOR, dayPoints: [ANCHOR] }))) {
      expect(scored.total).toBeGreaterThanOrEqual(0)
      expect(scored.total).toBeLessThanOrEqual(1)
    }
  })
})

describe('a confirmed memory must actually move the ranking', () => {
  const preferences = [{ category: 'ramen', memoryId: 'mem_005', weight: 0.9 }]

  /**
   * Regression: with memoryMatch and novelty at equal base weight, a remembered
   * category scored `w` on one and `1 - w` on the other while an unremembered
   * one scored `0` and `1`. Both summed to the same number, so confirming a
   * memory changed nothing and the component was decoration. The research
   * harness measured the net effect as exactly 0.
   */
  it('has a non-zero net effect at default Priority weights', () => {
    const ctx = context({ preferences })
    const remembered = scorePlace(place({ placeId: 'ramen_1' }), ctx)
    const other = scorePlace(place({ placeId: 'sushi_1', category: 'sushi' }), ctx)

    expect(remembered.total).toBeGreaterThan(other.total)
  })

  it('still loses to a high novelty weight, which is what opposes it', () => {
    const ctx = context({ preferences, weights: { convenience: 1, cost: 1, novelty: 2 } })
    const remembered = scorePlace(place({ placeId: 'ramen_1' }), ctx)
    const other = scorePlace(place({ placeId: 'sushi_1', category: 'sushi' }), ctx)

    expect(remembered.total).toBeLessThan(other.total)
  })

  it('still loses to what the user said, which outranks what was inferred', () => {
    // The remembered category, against an unremembered place the user described.
    const ctx = context({ preferences, stateTerms: ['quiet', 'counter'] })
    const remembered = scorePlace(place({ placeId: 'ramen_1' }), ctx)
    const asked = scorePlace(
      place({ placeId: 'sushi_1', category: 'sushi', tags: ['quiet', 'counter'] }),
      ctx,
    )

    expect(asked.total).toBeGreaterThan(remembered.total)
  })
})

describe('facets give places a surface the traveller can match (§12.2)', () => {
  const LUNCH_COUNTER = place({
    placeId: 'lunch_counter',
    priceLevel: 1,
    typicalDurationMin: 45,
    openingHours: {
      mon: '11:00-15:30', tue: '11:00-15:30', wed: '11:00-15:30', thu: '11:00-15:30',
      fri: '11:00-15:30', sat: '11:00-15:30', sun: 'closed',
    },
  })

  /**
   * The measurement that motivated facets: the demo Intent "Slow-paced. Time in
   * local neighbourhoods." matched ZERO of thirty-three places against category,
   * neighbourhood, tags and description, so stateMatch sat at its no-match floor
   * for every stop in every plan.
   */
  it('matches a facet value the authored fields never carried', () => {
    const ctx = context({ weekday: 'wed', stateTerms: ['lunch', 'budget'] })
    expect(scorePlace(LUNCH_COUNTER, ctx).components.stateMatch).toBe(1)
  })

  it('leaves facets out when no weekday is given, rather than guessing a day', () => {
    const ctx = context({ stateTerms: ['lunch', 'budget'] })
    expect(scorePlace(LUNCH_COUNTER, ctx).components.stateMatch).toBe(0.4)
  })

  it('leaves facets out on a day the place is shut', () => {
    const ctx = context({ weekday: 'sun', stateTerms: ['lunch'] })
    expect(scorePlace(LUNCH_COUNTER, ctx).components.stateMatch).toBe(0.4)
  })

  /**
   * Plain inflection, without a stemmer. Exact substring matching measurably lost
   * ordinary phrasing: "mornings only" failed to reach the `morning` band and
   * "short lunches" failed to reach `lunch`.
   */
  it('matches a pluralised term against a singular facet', () => {
    const ctx = context({ weekday: 'wed', stateTerms: ['lunches'] })
    expect(scorePlace(LUNCH_COUNTER, ctx).components.stateMatch).toBeGreaterThan(0.4)
  })

  it('matches a singular term against a pluralised description word', () => {
    const gardens = place({ placeId: 'garden', tags: ['gardens'] })
    const ctx = context({ stateTerms: ['garden'] })
    expect(scorePlace(gardens, ctx).components.stateMatch).toBeGreaterThan(0.4)
  })

  it('does not match on a fragment too short to mean anything', () => {
    // `toTerms` drops anything under four characters before matching begins, so
    // "mid" never becomes a term even though it is a real price band.
    expect(toTerms('a an the mid bar')).toEqual([])
    const ctx = context({ weekday: 'wed', stateTerms: toTerms('go to a bar') })
    expect(scorePlace(LUNCH_COUNTER, ctx).components.stateMatch).toBe(0.4)
  })

  /**
   * The gap facets do NOT close, stated as a test so it is not mistaken for
   * solved: mapping a phrase onto a facet is semantic, and belongs to the query
   * planner rather than to string comparison.
   */
  it('still fails on a phrase that means a facet without naming it', () => {
    const ctx = context({ weekday: 'wed', stateTerms: toTerms('Slow-paced trip') })
    expect(scorePlace(LUNCH_COUNTER, ctx).components.stateMatch).toBe(0.4)

    const dinner = context({ weekday: 'wed', stateTerms: ['dinners'] })
    const evening = place({
      placeId: 'evening_only',
      openingHours: {
        mon: '17:00-23:00', tue: '17:00-23:00', wed: '17:00-23:00', thu: '17:00-23:00',
        fri: '17:00-23:00', sat: '17:00-23:00', sun: '17:00-23:00',
      },
    })
    expect(scorePlace(evening, dinner).components.stateMatch).toBe(0.4)
  })

  it('keeps avoid as an exact substring rule, so an exclusion does not widen', () => {
    const queueing = place({ placeId: 'queues', tags: ['queues form early'] })
    expect(scorePlace(queueing, context({ avoid: ['queue'] })).components.stateMatch).toBe(0)
    // "queuing" is not a substring of anything here, so it must NOT exclude.
    expect(scorePlace(queueing, context({ avoid: ['queuing'] })).components.stateMatch).toBe(0.4)
  })
})

describe('the day-span budget from a pattern memory (§10, A3)', () => {
  /** Kuramae, and two places at increasing distance from it. */
  const BASE = { lat: 35.703164, lng: 139.790828 }
  const NEARBY = place({ placeId: 'nearby', lat: 35.7035, lng: 139.7935 })
  const ACROSS_TOWN = place({ placeId: 'across_town', lat: 35.6896, lng: 139.7006 })

  const withBudget = (metres?: number) =>
    context({
      anchor: BASE,
      dayPoints: [BASE],
      ...(metres === undefined ? {} : { daySpanBudgetMetres: metres }),
    })

  it('leaves routeFit alone for a stop inside the budget', () => {
    const generous = scorePlace(NEARBY, withBudget(5000)).components.routeFit
    const unbounded = scorePlace(NEARBY, withBudget()).components.routeFit
    expect(generous).toBe(unbounded)
  })

  it('marks down a stop that would stretch the day past the budget', () => {
    const bounded = scorePlace(ACROSS_TOWN, withBudget(3000)).components.routeFit!
    const unbounded = scorePlace(ACROSS_TOWN, withBudget()).components.routeFit!
    expect(bounded).toBeLessThan(unbounded)
  })

  it('takes routeFit to nothing at twice the budget, as a ramp not a cliff', () => {
    // Across town is about 8 km from base, so a 4 km budget is exactly doubled.
    expect(scorePlace(ACROSS_TOWN, withBudget(4000)).components.routeFit).toBe(0)
    expect(scorePlace(ACROSS_TOWN, withBudget(6000)).components.routeFit).toBeGreaterThan(0)
  })

  it('measures the whole day, not just the distance from base', () => {
    // With a stop already across town, the day is wide before this one is added.
    const wideDay = context({
      anchor: BASE,
      dayPoints: [BASE, { lat: ACROSS_TOWN.lat!, lng: ACROSS_TOWN.lng! }],
      daySpanBudgetMetres: 3000,
    })
    // Even a nearby candidate is scored against a day that is already over.
    expect(scorePlace(NEARBY, wideDay).components.routeFit).toBe(0)
  })

  /**
   * The reason this is a budget and not a decay scale. `1/(1 + d/h)` falls
   * monotonically in `d` for every `h`, so rescaling `h` moves every candidate
   * the same way and cannot change which one wins — measured across no memory,
   * 5.6 km and 1.5 km, the generated plan came out identical three times. A
   * threshold touches only the candidates over it, so it can reorder.
   *
   * The reorder is bounded, though: it can only overturn a gap smaller than
   * routeFit's own weighted share. A free stop three kilometres out beats a
   * mid-priced one a kilometre out until the budget removes its routeFit; push
   * the near stop to the top price band and the far one wins either way.
   */
  it('can change an ordering, which a rescaled decay curve cannot', () => {
    /** North of base by roughly `km`, so distance is the only thing that varies. */
    const northOf = (km: number, placeId: string, priceLevel: 0 | 3 | 4) =>
      place({ placeId, priceLevel, lat: BASE.lat + km * 0.009, lng: BASE.lng })

    const freeFar = northOf(3, 'far', 0)
    const midNear = northOf(1, 'near', 3)

    expect(order([freeFar, midNear], withBudget())[0]).toBe('far')
    expect(order([freeFar, midNear], withBudget(1500))[0]).toBe('near')
  })

  it('cannot overturn a gap wider than routeFit is worth', () => {
    const northOf = (km: number, placeId: string, priceLevel: 0 | 4) =>
      place({ placeId, priceLevel, lat: BASE.lat + km * 0.009, lng: BASE.lng })

    const freeFar = northOf(3, 'far', 0)
    const premiumNear = northOf(1, 'near', 4)

    expect(order([freeFar, premiumNear], withBudget())[0]).toBe('far')
    expect(order([freeFar, premiumNear], withBudget(1500))[0]).toBe('far')
  })
})

describe('the precedence lattice (§0.2, A6)', () => {
  /**
   * One ordering, declared once: what the traveller stated outranks what was
   * inferred about them, which outranks what the product optimises by default.
   */
  it('orders the tiers', () => {
    expect(PRECEDENCE.stated).toBeGreaterThan(PRECEDENCE.inferred)
    expect(PRECEDENCE.inferred).toBeGreaterThan(PRECEDENCE.default)
  })

  /**
   * The violation this fixed. `cost` sat at the default tier whether or not the
   * traveller had stated a budget, so a budget they actually typed was weighted
   * exactly the same as novelty — a rule the system invented. Measurement found a
   * stop in the demo trip above a stated moderate budget purely because ranking
   * preferred it.
   */
  it('lifts a stated budget above a system default, and only when it was stated', () => {
    // A mid-priced familiar option against a premium novel one. At p0 the cost
    // gap would be as wide as novelty can be, so nothing could ever outweigh it.
    const cheapDull = place({ placeId: 'cheap', priceLevel: 2, category: 'ramen' })
    const dearNovel = place({ placeId: 'dear', priceLevel: 4, category: 'sushi' })

    // The dear one is the novel category here, so without a stated budget the
    // default tier lets novelty carry it.
    const noBudget = context({ usedCategories: ['ramen', 'ramen'] })
    const stated = context({ usedCategories: ['ramen', 'ramen'], budgetLevel: 'moderate' })

    expect(order([cheapDull, dearNovel], noBudget)[0]).toBe('dear')
    expect(order([cheapDull, dearNovel], stated)[0]).toBe('cheap')
  })

  it('leaves the ordering alone when nothing is over the stated budget', () => {
    const a = place({ placeId: 'a', priceLevel: 1, category: 'ramen' })
    const b = place({ placeId: 'b', priceLevel: 2, category: 'sushi' })

    expect(order([a, b], context({ budgetLevel: 'high' }))).toEqual(
      order([a, b], context()),
    )
  })

  it('names what a runner-up lost on using the same tiering the ordering used', () => {
    const winner = scorePlace(place({ placeId: 'w', priceLevel: 0 }), context({ budgetLevel: 'low' }))
    const loser = scorePlace(place({ placeId: 'l', priceLevel: 4 }), context({ budgetLevel: 'low' }))

    expect(lostOn(winner.components, loser.components, context().weights, true)).toBe('cost')
  })
})

describe('fame lowers novelty (B3)', () => {
  const famous = place({ placeId: 'famous', userRatingCount: 50_000 })
  const obscure = place({ placeId: 'obscure', userRatingCount: 40 })
  const unknown = place({ placeId: 'unknown' })

  /**
   * Review COUNT, never rating. Ranking by rating would push every trip toward
   * crowd-pleasers, which is the definition of the generic itinerary. Fifty thousand
   * reviews only says a place is not a discovery.
   */
  it('reads a heavily reviewed place as familiar', () => {
    expect(scorePlace(famous, context()).components.novelty!).toBeLessThan(
      scorePlace(obscure, context()).components.novelty!,
    )
  })

  it('treats a place with no review count as neither famous nor obscure', () => {
    expect(scorePlace(unknown, context()).components.novelty).toBe(1)
  })

  it('separates 50 reviews from 500 more than 20,000 from 20,450', () => {
    const noveltyAt = (reviews: number) =>
      scorePlace(place({ placeId: 'p', userRatingCount: reviews }), context()).components.novelty!

    const smallGap = noveltyAt(50) - noveltyAt(500)
    const largeGap = noveltyAt(20_000) - noveltyAt(20_450)
    expect(smallGap).toBeGreaterThan(largeGap)
  })

  /**
   * Fame enters through novelty so the novelty Priority governs it. A traveller who
   * wants the famous things sets novelty low and gets them — the product does not
   * decide on their behalf that well known is bad.
   */
  it('lets a low novelty weight bring a landmark back', () => {
    const wantsNovelty = context({ weights: { convenience: 1, cost: 1, novelty: 2 } })
    const wantsLandmarks = context({ weights: { convenience: 1, cost: 1, novelty: 0 } })

    expect(order([famous, obscure], wantsNovelty)[0]).toBe('obscure')
    expect(order([famous, obscure], wantsLandmarks)[0]).not.toBe('obscure')
  })

  it('never takes novelty below zero, however famous', () => {
    const megaFamous = place({ placeId: 'mega', userRatingCount: 5_000_000 })
    expect(scorePlace(megaFamous, context()).components.novelty!).toBeGreaterThanOrEqual(0)
  })
})
