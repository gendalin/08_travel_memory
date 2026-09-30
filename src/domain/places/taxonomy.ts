/**
 * The shared category vocabulary.
 *
 * One list, read by everything. Photos, screenshots and saved places must resolve
 * to the *same* ids, otherwise a trend cannot be aggregated across them ("mostly
 * izakaya" has to be able to count a screenshot, a saved place and a photo as the
 * same thing) — and per-trip retrieval has to map a Google type onto the same id a
 * memory's subject points at, or a preference can never match a place.
 *
 * It lives in the domain because the product is what needs it. Preprocessing
 * re-exports it, which keeps the dependency pointing the right way: scripts serve
 * the product, never the other way round. It used to live under
 * `scripts/preprocess/`, which left product code unable to read it at all — so
 * `dayRoles.ts` kept a second copy of the interest categories, and two lists that
 * must agree had no way of being checked against each other.
 *
 * Why not just use Google Places types: they are coarser than this product
 * needs. `sushi_restaurant` and `ramen_restaurant` exist, but there is no
 * izakaya, kissaten or sentō type — exactly the distinctions that carry the
 * personal signal here. Google types are therefore an *input* to classification,
 * not the vocabulary itself.
 *
 * Three signals feed a category, in descending order of trust:
 *   1. Google Places type      (needs a Maps API key)
 *   2. Vision / OCR            (needs a vision API key)
 *   3. Name + note keywords    (no key needed; weakest, used as fallback)
 */

export type CategoryGroup = 'food' | 'retail' | 'culture' | 'nature_body' | 'context'

export interface CategoryDef {
  id: string
  labelEn: string
  labelZh: string
  group: CategoryGroup
  /**
   * Whether this category can become an interest point. Context categories
   * describe how a day moved, not what the user likes, and never produce
   * "arrange at least one of these" constraints.
   */
  interestPoint: boolean
  /** Google Places (New) primary types mapping here. Empty = Google has no equivalent. */
  googleTypes: string[]
  /** Fallback matching against place names, notes and OCR text. */
  keywords: string[]
}

export const CATEGORIES: CategoryDef[] = [
  // --- food & drink ---------------------------------------------------------
  { id: 'sushi', labelEn: 'Sushi', labelZh: '壽司', group: 'food', interestPoint: true,
    googleTypes: ['sushi_restaurant'], keywords: ['sushi', '鮨', '寿司', '壽司', 'すし', '鮓'] },
  { id: 'ramen', labelEn: 'Ramen', labelZh: '拉麵', group: 'food', interestPoint: true,
    googleTypes: ['ramen_restaurant'], keywords: ['ramen', 'ラーメン', '拉麺', '拉麵', '麺処'] },
  { id: 'izakaya', labelEn: 'Izakaya', labelZh: '居酒屋', group: 'food', interestPoint: true,
    googleTypes: ['japanese_izakaya_restaurant', 'izakaya_restaurant'], keywords: ['izakaya', '居酒屋', '酒場', '立ち飲み', 'たちのみ'] },
  { id: 'yakiniku_grill', labelEn: 'Yakiniku / grill', labelZh: '燒肉・燒烤', group: 'food', interestPoint: true,
    googleTypes: ['yakiniku_restaurant', 'barbecue_restaurant'], keywords: ['yakiniku', '焼肉', '焼き肉', '燒肉', 'yakitori', '焼き鳥', '炭火'] },
  { id: 'soba_udon', labelEn: 'Soba / udon', labelZh: '蕎麥麵・烏龍麵', group: 'food', interestPoint: true,
    googleTypes: ['japanese_soba_noodle_shop', 'udon_noodle_shop'], keywords: ['soba', 'udon', '蕎麦', 'そば', 'うどん'] },
  { id: 'tempura_tonkatsu', labelEn: 'Tempura / tonkatsu', labelZh: '天婦羅・豬排', group: 'food', interestPoint: true,
    googleTypes: [], keywords: ['tempura', '天ぷら', '天婦羅', 'tonkatsu', 'とんかつ', '豚カツ'] },
  { id: 'teishoku', labelEn: 'Set meal / home-style', labelZh: '定食・家常', group: 'food', interestPoint: true,
    // `japanese_restaurant` deliberately absent. A live run found it on 21 of 37
    // retrieved places, which turned this category into a bucket for every Japanese
    // eatery whose specific type Google does not give — an udon shop among them. It
    // is now treated as too coarse to name a category, and a place carrying only it
    // takes the category of the search that found it.
    googleTypes: [], keywords: ['定食', 'teishoku', '食堂', 'kappo', '割烹'] },
  { id: 'cafe_kissaten', labelEn: 'Cafe / kissaten', labelZh: '咖啡・喫茶店', group: 'food', interestPoint: true,
    googleTypes: ['cafe', 'coffee_shop'], keywords: ['cafe', 'café', 'coffee', '珈琲', '喫茶', 'コーヒー', '咖啡'] },
  { id: 'bakery_sweets', labelEn: 'Bakery / sweets', labelZh: '烘焙・甜點', group: 'food', interestPoint: true,
    googleTypes: ['bakery', 'dessert_shop'], keywords: ['bakery', 'patisserie', 'ベーカリー', '和菓子', '甘味', 'パン'] },
  { id: 'bar_cocktail', labelEn: 'Bar', labelZh: '酒吧', group: 'food', interestPoint: true,
    googleTypes: ['bar'], keywords: ['bar', 'cocktail', 'whisky', 'sake bar', 'バー'] },

  // --- retail ---------------------------------------------------------------
  { id: 'bookstore', labelEn: 'Bookstore', labelZh: '書店', group: 'retail', interestPoint: true,
    googleTypes: ['book_store'], keywords: ['books', 'bookstore', '書店', '本屋', 'ブックス'] },
  { id: 'lifestyle_homeware', labelEn: 'Lifestyle / homeware', labelZh: '生活用品・選物', group: 'retail', interestPoint: true,
    // `store` removed: it is too coarse to name a category — the guard in
    // tests/services caught it claiming a type retrieval skips, the third instance of
    // the same contradiction. Reached through the search category instead.
    googleTypes: ['home_goods_store'], keywords: ['akomeya', '生活', '雑貨', '選物', 'lifestyle', 'kitchen'] },
  { id: 'fashion_vintage', labelEn: 'Fashion / vintage', labelZh: '服飾・古著', group: 'retail', interestPoint: true,
    googleTypes: ['clothing_store'], keywords: ['vintage', '古著', '古着', 'select shop', 'apparel'] },
  { id: 'grocery_market', labelEn: 'Market / grocery', labelZh: '市場・食材', group: 'retail', interestPoint: true,
    googleTypes: ['market', 'supermarket', 'grocery_store', 'food_store'], keywords: ['market', '市場', 'depachika', 'デパ地下', '商店街'] },
  { id: 'craft_stationery', labelEn: 'Craft / stationery', labelZh: '工藝・文具', group: 'retail', interestPoint: true,
    googleTypes: [], keywords: ['stationery', '文具', '工芸', 'craft', '陶器', 'pottery'] },
  { id: 'discount_variety', labelEn: 'Discount / variety store', labelZh: '量販・雜貨店', group: 'retail', interestPoint: true,
    googleTypes: ['discount_store', 'department_store'], keywords: ['don quijote', 'donki', 'ドンキ', 'loft', 'tokyu hands'] },

  // --- culture --------------------------------------------------------------
  { id: 'museum_gallery', labelEn: 'Museum / gallery', labelZh: '美術館・藝廊', group: 'culture', interestPoint: true,
    googleTypes: ['art_museum', 'museum', 'art_gallery'], keywords: ['museum', 'gallery', '美術館', '博物館', 'ギャラリー'] },
  { id: 'architecture_design', labelEn: 'Architecture / design site', labelZh: '建築・設計', group: 'culture', interestPoint: true,
    // `tourist_attraction` cannot tell an architecture site from a viewpoint, and
    // retrieval skips it as too coarse — claiming it here left BOTH categories
    // unreachable, and a live search for this one returned nothing usable.
    googleTypes: [], keywords: ['測候所', 'observatory', 'architecture', '建築', 'design'] },
  { id: 'temple_shrine', labelEn: 'Temple / shrine', labelZh: '寺廟・神社', group: 'culture', interestPoint: true,
    // `place_of_worship` added from a live run: three retrieved shrines carried it
    // with no more specific type.
    googleTypes: ['buddhist_temple', 'shinto_shrine', 'hindu_temple', 'place_of_worship'], keywords: ['temple', 'shrine', '寺', '神社', '神宮', 'お寺'] },
  { id: 'exhibition_event', labelEn: 'Exhibition / event', labelZh: '展覽・活動', group: 'culture', interestPoint: true,
    googleTypes: ['event_venue'], keywords: ['exhibition', '展', 'fair', 'festival', '祭'] },

  // --- nature & body --------------------------------------------------------
  { id: 'park_garden', labelEn: 'Park / garden', labelZh: '公園・庭園', group: 'nature_body', interestPoint: true,
    googleTypes: ['park', 'garden'], keywords: ['park', 'garden', '公園', '庭園', '庭'] },
  { id: 'onsen_sento', labelEn: 'Onsen / sento', labelZh: '溫泉・錢湯', group: 'nature_body', interestPoint: true,
    googleTypes: ['spa', 'public_bath'], keywords: ['onsen', 'sento', '温泉', '銭湯', '湯', '-yu', 'spa'] },
  { id: 'viewpoint_scenic', labelEn: 'Viewpoint / scenic', labelZh: '景點・觀景', group: 'nature_body', interestPoint: true,
    googleTypes: [], keywords: ['view', 'observation', '展望', '海', 'river', '川'] },

  // --- context (never an interest point) ------------------------------------
  { id: 'street_neighborhood', labelEn: 'Street / neighbourhood', labelZh: '街景・街區', group: 'context', interestPoint: false,
    googleTypes: [], keywords: ['street', '街', '路地', 'alley'] },
  { id: 'transit', labelEn: 'Transit', labelZh: '交通', group: 'context', interestPoint: false,
    googleTypes: ['train_station', 'subway_station', 'bus_station'], keywords: ['station', '駅', 'metro', 'line', '電車'] },
  { id: 'accommodation', labelEn: 'Accommodation', labelZh: '住宿', group: 'context', interestPoint: false,
    googleTypes: ['hotel', 'lodging'], keywords: ['hotel', 'hostel', 'ryokan', 'ホテル', '旅館'] },
]

export const CATEGORY_IDS = CATEGORIES.map((category) => category.id)
export const CATEGORY_BY_ID = new Map(CATEGORIES.map((category) => [category.id, category]))

/** Used when no signal is strong enough. Never counts toward a trend. */
export const UNCLASSIFIED = 'unclassified'

/** Categories a stop can be. Context ones describe how a day moved, not a taste. */
export const INTEREST_CATEGORY_IDS: readonly string[] = CATEGORIES.filter(
  (category) => category.interestPoint,
).map((category) => category.id)

/** Our category for a Google place type, when one maps. */
export function categoryForGoogleType(type: string): string | undefined {
  return CATEGORIES.find((category) => category.googleTypes.includes(type))?.id
}

/**
 * Categories a piece of free text names, by keyword.
 *
 * The lowest-trust signal in the vocabulary, and used as such: preprocessing falls
 * back to it when a place's own Google types say nothing, and retrieval reads a
 * traveller's "avoid …" sentence with it. It lived in the preprocessing script,
 * which meant the product could not read its own sentences the way its own pipeline
 * reads a place name.
 *
 * Matches the category id, its English label and its keyword list, so "avoid
 * izakaya", "avoid Izakaya" and "avoid 居酒屋" all land on the same category. A
 * phrase that names none returns nothing, which is the honest answer — "avoid
 * queues" is not about a category.
 */
export function categoriesNamedBy(text: string): string[] {
  const haystack = text.toLowerCase()
  return CATEGORIES.filter(
    (category) =>
      haystack.includes(category.id.replace(/_/g, ' ')) ||
      haystack.includes(category.labelEn.toLowerCase()) ||
      category.keywords.some((keyword) => haystack.includes(keyword.toLowerCase())),
  ).map((category) => category.id)
}
