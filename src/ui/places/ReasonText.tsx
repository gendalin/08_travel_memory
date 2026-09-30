/**
 * A stop's reasons, set as one paragraph.
 *
 * Primary and secondary read on together, as prose; the primary reason — the one
 * that decided the stop — is set heavier, which is the only difference between
 * them. A stop written before reasons existed falls back to its one-string
 * rationale.
 */

import type { StopReason } from '../../domain/plan/types.ts'

export function ReasonText({
  reasons,
  rationale,
  className,
}: {
  reasons?: readonly StopReason[]
  rationale?: string
  className?: string
}) {
  if (reasons && reasons.length > 0) {
    return (
      <span className={className} data-testid="stop-reasons">
        {reasons.map((reason, index) => (
          <span
            key={`${reason.strength}-${index}`}
            className={`reason reason-${reason.strength}`}
            data-strength={reason.strength}
          >
            {index > 0 ? ' ' : ''}
            {reason.text}
          </span>
        ))}
      </span>
    )
  }

  return rationale ? <span className={className}>{rationale}</span> : null
}
