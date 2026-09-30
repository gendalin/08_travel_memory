/**
 * Tokyo neighbourhoods by character (decided 2026-09-30).
 *
 * The one place the product knows what a neighbourhood is LIKE, rather than which
 * places happen to be in it. Two things read it:
 *
 *   - an `area_character` memory ("literary neighbourhoods"), which ranks a place up
 *     when it sits in an area with that character;
 *   - area discovery in retrieval, which turns an Intent like "Showa-era literary
 *     atmosphere" into searches in Jimbocho or Yanaka instead of only around the hotel.
 *
 * Code-owned on purpose. A model may CHOOSE among these areas; it may not add one, so
 * a search can never be sent to a neighbourhood that was invented. Centres are
 * approximate station-area centres; `radiusKm` is how far a stop can sit from one and
 * still be "in" it on foot.
 */

import { kmBetween, type Coordinates } from './geo.ts'

export type AreaCharacter =
  | 'literary'
  | 'used_books'
  | 'kissaten'
  | 'showa'
  | 'vintage'
  | 'live_music'
  | 'craft'
  | 'traditional'
  | 'independent'
  | 'coffee'
  | 'antiques'

export interface TokyoArea {
  id: string
  name: string
  center: Coordinates
  radiusKm: number
  characters: readonly AreaCharacter[]
}

export const TOKYO_AREAS: readonly TokyoArea[] = [
  { id: 'jimbocho', name: 'Jimbocho', center: { lat: 35.6958, lng: 139.7577 }, radiusKm: 0.8, characters: ['literary', 'used_books', 'kissaten', 'showa', 'independent'] },
  { id: 'yanaka', name: 'Yanaka', center: { lat: 35.7266, lng: 139.7669 }, radiusKm: 0.9, characters: ['showa', 'traditional', 'craft', 'literary', 'kissaten'] },
  { id: 'hongo', name: 'Hongo', center: { lat: 35.7078, lng: 139.7600 }, radiusKm: 0.7, characters: ['literary', 'used_books', 'showa'] },
  { id: 'koenji', name: 'Koenji', center: { lat: 35.7054, lng: 139.6497 }, radiusKm: 0.9, characters: ['vintage', 'live_music', 'showa', 'used_books', 'independent', 'kissaten'] },
  { id: 'shimokitazawa', name: 'Shimokitazawa', center: { lat: 35.6616, lng: 139.6680 }, radiusKm: 0.8, characters: ['vintage', 'live_music', 'kissaten', 'independent'] },
  { id: 'nishiogikubo', name: 'Nishi-Ogikubo', center: { lat: 35.7038, lng: 139.5995 }, radiusKm: 0.8, characters: ['antiques', 'used_books', 'independent', 'showa'] },
  { id: 'kichijoji', name: 'Kichijoji', center: { lat: 35.7031, lng: 139.5798 }, radiusKm: 0.9, characters: ['independent', 'kissaten', 'coffee', 'vintage'] },
  { id: 'nakano', name: 'Nakano', center: { lat: 35.7074, lng: 139.6659 }, radiusKm: 0.7, characters: ['showa', 'vintage', 'independent'] },
  { id: 'kagurazaka', name: 'Kagurazaka', center: { lat: 35.7022, lng: 139.7400 }, radiusKm: 0.7, characters: ['traditional', 'literary'] },
  { id: 'kuramae', name: 'Kuramae', center: { lat: 35.7040, lng: 139.7910 }, radiusKm: 0.8, characters: ['craft', 'independent', 'coffee'] },
  { id: 'asakusa', name: 'Asakusa', center: { lat: 35.7148, lng: 139.7967 }, radiusKm: 0.8, characters: ['traditional', 'showa'] },
  { id: 'kiyosumi_shirakawa', name: 'Kiyosumi-Shirakawa', center: { lat: 35.6818, lng: 139.8003 }, radiusKm: 0.8, characters: ['coffee', 'craft', 'independent'] },
]

/** The areas a point sits in, nearest first. */
export function areasAt(point: Coordinates): TokyoArea[] {
  return TOKYO_AREAS.filter((area) => kmBetween(area.center, point) <= area.radiusKm).sort(
    (a, b) => kmBetween(a.center, point) - kmBetween(b.center, point),
  )
}

export function hasCharacter(point: Coordinates, character: AreaCharacter): boolean {
  return areasAt(point).some((area) => area.characters.includes(character))
}

/**
 * Characters a piece of the traveller's own text asks for.
 *
 * Deterministic and narrow: a word list, in English, Chinese and Japanese. It maps
 * what people say onto the table above and nothing else.
 */
const CHARACTER_WORDS: ReadonlyArray<[RegExp, AreaCharacter[]]> = [
  [/\bliterary\b|\bliterature\b|\bnovels?\b|\bwriters?\b|文學|文学/i, ['literary']],
  [/\bbook(?:store|shop)?s?\b|\bused books\b|\bsecond-?hand books\b|\bantiquarian\b|書店|古書|舊書|古本/i, ['used_books', 'literary']],
  [/\bkissaten\b|\bkissa\b|喫茶/i, ['kissaten']],
  [/\bshowa\b|\bshōwa\b|\bretro\b|\bnostalgic\b|昭和|懷舊|レトロ/i, ['showa']],
  [/\bvintage\b|\bthrift\b|古著|古着/i, ['vintage']],
  [/\blive music\b|\bjazz\b|\bindie music\b|\bgigs?\b|ライブ/i, ['live_music']],
  [/\bcrafts?\b|\bartisan\b|\bstationery\b|工藝|工芸|手作/i, ['craft']],
  [/\btraditional\b|\bold tokyo\b|\bshitamachi\b|下町|傳統|伝統/i, ['traditional']],
  [/\bindependent\b|\bindie\b|\bsmall shops?\b|獨立|独立/i, ['independent']],
  [/\bantiques?\b|骨董/i, ['antiques']],
  [/\bcoffee\b|\bcafés?\b|\bcafes?\b|咖啡|コーヒー/i, ['coffee']],
]

export function charactersIn(text: string): AreaCharacter[] {
  return [...new Set(CHARACTER_WORDS.flatMap(([pattern, characters]) => (pattern.test(text) ? characters : [])))]
}

/** The exact words in `text` that asked for each character — spans of what was written. */
export function characterSpans(text: string): Array<{ character: AreaCharacter; span: string }> {
  return CHARACTER_WORDS.flatMap(([pattern, characters]) => {
    const match = text.match(pattern)
    return match ? characters.map((character) => ({ character, span: match[0] })) : []
  })
}

/** What to look for in an area with this character. */
export const CHARACTER_CATEGORIES: Record<AreaCharacter, readonly string[]> = {
  literary: ['bookstore', 'cafe_kissaten'],
  used_books: ['bookstore'],
  kissaten: ['cafe_kissaten'],
  showa: ['cafe_kissaten', 'bookstore'],
  vintage: ['fashion_vintage'],
  live_music: ['bar_cocktail'],
  craft: ['craft_stationery', 'lifestyle_homeware'],
  traditional: ['temple_shrine', 'soba_udon'],
  independent: ['bookstore', 'lifestyle_homeware'],
  coffee: ['cafe_kissaten'],
  antiques: ['lifestyle_homeware'],
}

/**
 * Areas that best match the characters asked for, best first. Ties go to the area
 * closer to `near`, so discovery prefers what is reachable.
 */
export function areasFor(characters: readonly AreaCharacter[], near?: Coordinates): Array<{ area: TokyoArea; matched: AreaCharacter[] }> {
  if (characters.length === 0) return []
  return TOKYO_AREAS.map((area) => ({ area, matched: area.characters.filter((character) => characters.includes(character)) }))
    .filter((entry) => entry.matched.length > 0)
    .sort(
      (a, b) =>
        b.matched.length - a.matched.length ||
        (near ? kmBetween(a.area.center, near) - kmBetween(b.area.center, near) : 0) ||
        a.area.id.localeCompare(b.area.id),
    )
}

/**
 * Places a day can be spent in that are not neighbourhoods of the city — a day out
 * (2026-10-01). "Go to Yokohama on the last day" names one of these; the day is then
 * planned around its centre. Like the area table, code-owned: a model may name a
 * place, the code decides where it is.
 */
export const DAY_TRIP_AREAS: readonly TokyoArea[] = [
  { id: 'yokohama', name: 'Yokohama', center: { lat: 35.4478, lng: 139.6425 }, radiusKm: 2.2, characters: [] },
  { id: 'kamakura', name: 'Kamakura', center: { lat: 35.3192, lng: 139.5503 }, radiusKm: 2, characters: ['traditional'] },
  { id: 'enoshima', name: 'Enoshima', center: { lat: 35.2997, lng: 139.4806 }, radiusKm: 1.2, characters: [] },
  { id: 'kawagoe', name: 'Kawagoe', center: { lat: 35.9223, lng: 139.4852 }, radiusKm: 1.5, characters: ['traditional', 'showa'] },
  { id: 'nikko', name: 'Nikko', center: { lat: 36.7536, lng: 139.6035 }, radiusKm: 2.5, characters: ['traditional'] },
  { id: 'hakone', name: 'Hakone', center: { lat: 35.2324, lng: 139.1069 }, radiusKm: 4, characters: [] },
  { id: 'odawara', name: 'Odawara', center: { lat: 35.2564, lng: 139.1553 }, radiusKm: 1.8, characters: [] },
]

/** Other names a traveller uses for the same place. */
const AREA_ALIASES: Record<string, readonly string[]> = {
  yokohama: ['横浜', '橫濱', '横滨', 'minato mirai', 'minatomirai'],
  kamakura: ['鎌倉', '镰仓'],
  enoshima: ['江の島', '江之島', '江之岛'],
  kawagoe: ['川越'],
  nikko: ['日光', 'nikkō'],
  hakone: ['箱根'],
  odawara: ['小田原'],
  jimbocho: ['jinbocho', 'jinbōchō', 'jimbōchō', '神保町'],
  yanaka: ['谷中', 'yanesen'],
  koenji: ['kōenji', '高円寺', '高圓寺'],
  shimokitazawa: ['shimokita', '下北沢', '下北澤'],
  nishiogikubo: ['nishiogi', '西荻窪'],
  kichijoji: ['kichijōji', '吉祥寺'],
  nakano: ['中野'],
  kagurazaka: ['神楽坂', '神樂坂'],
  kuramae: ['蔵前', '藏前'],
  asakusa: ['浅草', '淺草'],
  kiyosumi_shirakawa: ['kiyosumi', '清澄白河'],
  hongo: ['hongō', '本郷', '本鄉'],
}

/**
 * A neighbourhood or day-trip place by what the traveller called it. `exact`: only
 * when the whole name is the area's name or an alias — "Yokohama", not "Shin-Yokohama
 * Ramen Museum".
 */
export function findArea(name: string, options: { exact?: boolean } = {}): TokyoArea | undefined {
  const wanted = name.trim().toLowerCase().normalize('NFKC').replace(/^the\s+/, '')
  if (wanted.length < 2) return undefined
  return [...TOKYO_AREAS, ...DAY_TRIP_AREAS].find((area) => {
    const names = [area.id.replace(/_/g, ' '), area.name.toLowerCase(), ...(AREA_ALIASES[area.id] ?? [])].map((candidate) => candidate.toLowerCase())
    return names.some((candidate) => wanted === candidate || (!options.exact && wanted.includes(candidate)))
  })
}
