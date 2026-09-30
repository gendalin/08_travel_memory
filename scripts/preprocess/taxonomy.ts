/**
 * Preprocessing's own taxonomy knobs, plus a re-export of the shared vocabulary.
 *
 * The vocabulary itself moved to `src/domain/places/taxonomy.ts`: the product is
 * what needs it, and leaving it here meant product code could not read it. The
 * thresholds below are preprocessing tuning and belong nowhere else.
 */

export {
  CATEGORIES,
  CATEGORY_BY_ID,
  CATEGORY_IDS,
  INTEREST_CATEGORY_IDS,
  UNCLASSIFIED,
  categoryForGoogleType,
  type CategoryDef,
  type CategoryGroup,
} from '../../src/domain/places/taxonomy.ts'

import { categoriesNamedBy } from '../../src/domain/places/taxonomy.ts'

/** A category needs this many evidence items before it counts as a trend. */
export const MIN_CATEGORY_SUPPORT = 3

/** At most this many categories are reported as trends. */
export const TOP_CATEGORIES = 5

/**
 * Name/OCR keyword match. Lowest-trust signal — used only as a fallback.
 *
 * The matching itself moved to the shared vocabulary, where the product can reach
 * it too: retrieval reads a traveller's "avoid …" sentence the same way.
 */
export const classifyByKeywords = categoriesNamedBy
