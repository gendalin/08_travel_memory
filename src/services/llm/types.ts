/**
 * LLM service contract.
 *
 * Hard boundaries, enforced by the shape of this interface:
 *   - the model NEVER returns a change type. Replace / Reorganize / Reframe is
 *     computed by the domain classifier from the diff.
 *   - the model may only return placeIds drawn from the bounded candidate set
 *     it was given; callers re-check against the catalogue regardless.
 *   - the model NEVER returns a place. It may write the text of a SEARCH, and the
 *     places come back from the Places API — real businesses with real ids, hours
 *     and coordinates. A model asked for places instead would supply names it
 *     cannot stand behind, with no hours to schedule against and nothing for the
 *     validator to check, and §8's "no invented POI ids" would become a rule the
 *     catalogue was built by the very thing it is meant to guard against.
 */

import type { DemoPlace } from '../places/types.ts'

export interface DecomposedState {
  intent: string[]
  considering: string[]
  /** An extra Priority the agent suggests. Requires explicit user acceptance (§3.4). */
  proposedPriority?: { name: string; reason: string }
}

export interface ReplacementChoice {
  /** Must be one of the offered candidate ids. */
  placeId: string
  /** Short user-facing reason. Prose only — never a classification. */
  rationale: string
}

/** What the query planner is told. */
export interface QueryPlanRequest {
  destination: string
  /** Where the trip is based, so a search can be local rather than city-wide. */
  baseLodgingName: string
  /** The traveller's own words, verbatim. */
  intentText: string
  consideringText: string
  /** What the retrieval profile already decided to look for. */
  searches: ReadonlyArray<{ category: string; preferred: boolean }>
  /** The only category names the model may use. Enforced by the schema. */
  allowedCategories: readonly string[]
}

export interface PlannedQuery {
  /** Must be one of the allowed categories; callers re-check regardless. */
  category: string
  /**
   * Text to search Places with.
   *
   * Free text is safe here and nowhere else in this interface: what comes back is
   * whatever the Places API matches, so a badly phrased query returns poor places
   * rather than imaginary ones.
   */
  textQuery: string
  /**
   * The traveller's own words this search is for, copied exactly from what they
   * wrote. Empty or absent when it serves none of them.
   *
   * Claimed by the model and checked by code: `resolveQueryPlan` keeps it only when
   * it really is a span of the traveller's text, so a stop can later say which of
   * their words it was found for without the model putting words in their mouth.
   */
  servesWords?: string
}

export interface QueryPlanResult {
  queries: PlannedQuery[]
  /**
   * A few more categories the traveller's own words point at that the profile had
   * not thought to look for. Bounded, and re-checked against what a day can
   * actually use.
   */
  alsoSearch: string[]
}

/**
 * What one line of the traveller's own words asks of the plan (2026-10-01).
 *
 * The model's reading, in a closed vocabulary. It names a KIND of instruction and
 * the words it hangs on ("Yokohama", "last"); code turns those into a day index, a
 * place, a category — so a model can misunderstand a sentence, but cannot invent a
 * place id or a day the trip does not have.
 */
export type LineKind =
  | 'must_visit'
  | 'day_in_place'
  | 'avoid'
  | 'budget'
  | 'pace'
  | 'finish_by'
  | 'half_day'
  | 'free_time'
  | 'slot_meal'
  | 'event'
  | 'transport'
  | 'theme'
  | 'unclear'

export interface LineReading {
  id: string
  kind: LineKind
  /** 1-based day number, or the words "first" / "last". */
  day: number | 'first' | 'last' | null
  /** A place or area, as the traveller named it. */
  place: string | null
  /** An interest category id, for a meal or an avoid. */
  category: string | null
  meal: 'lunch' | 'dinner' | 'nightcap' | null
  /** HH:MM. */
  time: string | null
  minutes: number | null
  budget: 'low' | 'moderate' | 'high' | null
  /** What to avoid: a category id, or "crowds". */
  avoid: string | null
  activity: string | null
  pace: 'slow' | 'normal' | 'packed' | null
  /** Area characters (areas.ts) an Intent line asks for. */
  characters: string[]
  /** For `unclear`: one short question that would settle it. */
  question: string | null
}

export interface LinesRequest {
  destination: string
  days: number
  startDate: string
  lines: ReadonlyArray<{ id: string; text: string; section: 'intent' | 'considering' }>
  allowedCategories: readonly string[]
  allowedCharacters: readonly string[]
}

/** What a chat message asks for (2026-10-01). */
export type MessageAction =
  | 'replace_stop'
  | 'weather'
  | 'finish_by'
  | 'lighter'
  | 'preference'
  | 'state_line'
  | 'unclear'

export interface MessageReading {
  action: MessageAction
  day: number | 'first' | 'last' | 'today' | null
  /** Words that identify the stop: its name, its kind, or its meal. */
  stop: string | null
  time: string | null
  /** For a preference: +1 likes, -1 dislikes. */
  polarity: 1 | -1 | null
  /** A line to add to State, in the traveller's words, for `state_line`. */
  stateLine: string | null
  section: 'intent' | 'considering' | null
  /** For `unclear`: one short question back. */
  question: string | null
}

export interface MessageRequest {
  message: string
  days: number
  /** 1-based day the traveller is looking at. */
  focusDay: number | null
  stops: ReadonlyArray<{ day: number; time: string; name: string; category: string; role: string | null }>
}

export interface LlmService {
  /**
   * Readings for lines of Intent / Considering. May return fewer readings than lines,
   * or none: a line without one is read by rules.
   */
  interpretLines(input: LinesRequest): Promise<{ readings: LineReading[] }>

  /** A reading of one chat message, or null to let the rules route it. */
  interpretMessage(input: MessageRequest): Promise<MessageReading | null>

  decomposeTripState(input: {
    intentText: string
    consideringText: string
    destination: string
    days: number
  }): Promise<DecomposedState>

  chooseReplacement(input: {
    /** What the user said, verbatim. */
    message: string
    outgoing: DemoPlace
    candidates: DemoPlace[]
  }): Promise<ReplacementChoice>

  /**
   * Turns the retrieval profile plus the traveller's own words into search text.
   *
   * The one thing code demonstrably cannot do: the demo Intent "Slow-paced. Time in
   * local neighbourhoods." matched zero of thirty-three places by any string rule,
   * because mapping a phrase onto a kind of place is a semantic step.
   */
  planQueries(input: QueryPlanRequest): Promise<QueryPlanResult>
}
