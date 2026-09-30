/**
 * Decision Receipts (product_spec §9).
 *
 * Read-only history. Receipts provide accountability, explainability and
 * traceability — not undo, rollback, restore, or a version-control UI (§9.3),
 * so there is deliberately no action on a row.
 *
 * Summary and timestamp first; everything §9.2 requires is one tap away
 * (§14.4 progressive disclosure).
 */

import { useState } from 'react'

import { RECEIPT_LABEL } from '../../domain/proposals/classify.ts'
import type { Receipt } from '../../domain/receipts/types.ts'
import type { PlaceCatalogue } from '../../services/places/types.ts'
import { impactMetrics } from '../proposals/ImpactStrip.tsx'
import { PlanDiffList } from '../proposals/PlanDiffList.tsx'
import { StateDiffList } from '../proposals/StateDiffList.tsx'

interface Props {
  receipts: Receipt[]
  catalogue: PlaceCatalogue
  /** Off where the surrounding section already names the list. */
  showTitle?: boolean
}

function ReceiptRow({ receipt, catalogue }: { receipt: Receipt; catalogue: PlaceCatalogue }) {
  const [open, setOpen] = useState(false)
  const metrics = impactMetrics(receipt.impact)

  return (
    <li data-testid="receipt" data-change-type={receipt.type}>
      <button
        className="receipt-head"
        aria-expanded={open}
        data-testid="receipt-toggle"
        onClick={() => setOpen((shown) => !shown)}
      >
        <span className="summary">{receipt.summary}</span>
        <span className="detail">
          {RECEIPT_LABEL[receipt.type]} · {new Date(receipt.timestamp).toLocaleString()}
        </span>
      </button>

      {open && (
        <div className="receipt-detail" data-testid="receipt-detail">
          <div className="detail">
            {receipt.initiator === 'user' ? 'You asked' : 'I suggested'}: “{receipt.trigger}”
          </div>
          <div className="detail">{receipt.rationale}</div>

          <StateDiffList diff={receipt.stateDiff} />
          <PlanDiffList diff={receipt.planDiff} catalogue={catalogue} />

          {metrics.length > 0 && (
            <div className="impact">
              {metrics.map((metric) => (
                <span key={metric}>{metric}</span>
              ))}
            </div>
          )}

          <div className="detail">
            Trip state v{receipt.resultingStateVersion} · itinerary v{receipt.resultingPlanVersion}
          </div>
        </div>
      )}
    </li>
  )
}

export function ReceiptList({ receipts, catalogue, showTitle = true }: Props) {
  if (receipts.length === 0) return null

  return (
    <>
      {showTitle && <div className="section-title">Decisions</div>}
      <ul className="receipts" data-testid="receipts" style={{ padding: 0, margin: 0 }}>
        {[...receipts].reverse().map((receipt) => (
          <ReceiptRow key={receipt.id} receipt={receipt} catalogue={catalogue} />
        ))}
      </ul>
    </>
  )
}
