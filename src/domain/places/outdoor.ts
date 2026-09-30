/**
 * Which kinds of place are out in the weather (decided 2026-09-30).
 *
 * Rain changes where a traveller can comfortably be, not how long their day is. A
 * museum, a counter, a bathhouse are the same in rain; a garden, a viewpoint, an
 * open-air market street or a temple's grounds are not. Only these are re-planned
 * when the weather turns — before this, rain was read as "end the day", and an indoor
 * dinner was dropped for it.
 */

export const OUTDOOR_CATEGORIES: readonly string[] = [
  'park_garden',
  'viewpoint_scenic',
  'temple_shrine',
  'grocery_market',
  'street_neighborhood',
]

export function isOutdoor(category: string): boolean {
  return OUTDOOR_CATEGORIES.includes(category)
}
