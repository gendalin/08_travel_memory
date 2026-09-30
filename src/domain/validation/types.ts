/** Validation results (product_spec §8). */

import type { ID } from '../trip/types.ts'

export type ValidationCode =
  | 'unknown_poi'
  | 'missing_opening_hours'
  | 'poi_closed_at_time'
  | 'overlapping_items'
  | 'locked_item_changed'
  | 'day_not_anchored_at_lodging'
  | 'must_visit_missing'
  | 'must_visit_wrong_day'
  | 'fixed_time_violated'
  | 'time_block_missing'
  | 'half_day_exceeded'

export interface ValidationError {
  code: ValidationCode
  message: string
  /** Plan items the error relates to, when applicable. */
  itemIds?: ID[]
  dayIndex?: number
  /**
   * The Considering item whose constraint failed. Set for constraint errors so
   * a Conflict can be shown against the user's own sentence (§3.6.5) instead of
   * against an internal tag.
   */
  consideringId?: ID
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
}
