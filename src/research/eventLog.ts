/**
 * Research event log (product_spec §15.3).
 *
 * Local and exportable. Export must not appear in normal product navigation —
 * nothing outside `src/research` and `scripts/research` may import this.
 *
 * The log records what a participant DID and what the system showed them, not
 * what it concluded. Metrics are derived from it afterwards, so a claim about a
 * session can always be walked back to the events it was computed from.
 */

import type { ConditionId } from './conditions.ts'

export type ResearchEventType =
  | 'trip_created'
  | 'plan_generated'
  | 'memory_confirmed'
  | 'message_sent'
  | 'change_previewed'
  | 'change_confirmed'
  | 'change_rejected'
  | 'change_applied_without_confirmation'
  | 'conflict_shown'
  /** The request was understood and the plan already meets it. */
  | 'answered_no_change'
  | 'receipt_written'
  | 'survey_submitted'

export interface ResearchEvent {
  /** Monotonic within a log, so order survives export and re-import. */
  seq: number
  at: string
  condition: ConditionId
  type: ResearchEventType
  /** Free-form, and never used for a metric that is not also derivable elsewhere. */
  detail?: Readonly<Record<string, unknown>>
}

export interface ResearchLog {
  append(
    condition: ConditionId,
    type: ResearchEventType,
    detail?: Record<string, unknown>,
  ): ResearchEvent
  entries(): readonly ResearchEvent[]
  countOf(condition: ConditionId, type: ResearchEventType): number
  /** One JSON document, for an export file. */
  toJson(): string
  /** One event per line, for streaming into an analysis tool. */
  toJsonl(): string
}

/**
 * @param clock Injected so an exported log is reproducible in a scripted run
 *   and honest in a live one. §15's demo clock is the same idea.
 */
export function createResearchLog(clock: () => Date = () => new Date()): ResearchLog {
  const events: ResearchEvent[] = []

  return {
    append(condition, type, detail) {
      const event: ResearchEvent = {
        seq: events.length + 1,
        at: clock().toISOString(),
        condition,
        type,
        ...(detail ? { detail: Object.freeze({ ...detail }) } : {}),
      }
      events.push(event)
      return event
    },

    entries: () => [...events],

    countOf: (condition, type) =>
      events.filter((event) => event.condition === condition && event.type === type).length,

    toJson: () => JSON.stringify(events, null, 2),
    toJsonl: () => events.map((event) => JSON.stringify(event)).join('\n'),
  }
}
