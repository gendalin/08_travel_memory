/**
 * The three change surfaces (product_spec §7.2–7.4).
 *
 *   Replace    -> "Change this place?"        compact Before / After
 *   Reorganize -> "Update Day 3"              affected range, diff, Impact
 *   Reframe    -> "Change the trip direction" State diff, then Plan preview
 *
 * The internal names are never shown. The heading is chosen from
 * `proposal.type`, which the domain classifier computed from the diff — this
 * component decides nothing about what kind of change it is showing.
 *
 * One primary CTA, one secondary, on every variant (§14.3).
 */

import { useState } from 'react'

import type { ChangeUnit, Proposal } from '../../domain/proposals/types.ts'
import type { PlaceCatalogue } from '../../services/places/types.ts'
import { ImpactStrip } from './ImpactStrip.tsx'
import { PlanDiffList } from './PlanDiffList.tsx'
import { StateDiffList } from './StateDiffList.tsx'
import { VersionCompare } from './VersionCompare.tsx'
import type { Plan } from '../../domain/plan/types.ts'

interface Props {
  proposal: Proposal
  catalogue: PlaceCatalogue
  /** Stops in the committed plan, to say how many this leaves alone. */
  stopsInPlan?: number
  /** The committed plan, compared side by side with what this proposes. */
  currentPlan?: Plan
  busy: string | null
  /** Called with the changes the traveller chose to keep the original stop for. */
  onConfirm: (declinedUnitIds: string[]) => void
  onKeep: () => void
}

/**
 * How much of the trip this touches, said up front: the point of scoping a change is
 * that most of the trip stays as it was, and the card should say so before anything
 * else.
 */
function scopeLine(proposal: Proposal, stopsInPlan: number | undefined): string | undefined {
  const touched = new Set([
    ...proposal.planDiff.added.map((item) => item.id),
    ...proposal.planDiff.removed.map((item) => item.id),
    ...proposal.planDiff.modified.map((entry) => entry.after.id),
  ]).size
  if (touched === 0 || stopsInPlan === undefined) return undefined
  const kept = Math.max(0, stopsInPlan - proposal.planDiff.removed.length - proposal.planDiff.modified.length)
  return `Only ${touched} stop${touched === 1 ? '' : 's'} change${touched === 1 ? 's' : ''}; the other ${kept} stay as they are.`
}

/**
 * The proposal change by change, each with its reason. A change the traveller can
 * decline has Accept / Keep original; one that IS the request is marked as such.
 */
function UnitList({
  units,
  declined,
  onToggle,
}: {
  units: ChangeUnit[]
  declined: Set<string>
  onToggle: (unitId: string, keepOriginal: boolean) => void
}) {
  return (
    <ul className="unit-list" data-testid="change-units">
      {units.map((unit) => {
        const keep = declined.has(unit.id)
        return (
          <li key={unit.id} className={keep ? 'declined' : undefined} data-testid="change-unit" data-unit-id={unit.id}>
            <span className="unit-summary">{unit.summary}</span>
            <span className="unit-reason">{unit.reason}</span>
            {unit.required ? (
              <span className="unit-required">Part of what you asked for</span>
            ) : (
              <span className="unit-choice" role="group" aria-label={`Choice for ${unit.summary}`}>
                <button
                  className="chip"
                  aria-pressed={!keep}
                  data-testid="unit-accept"
                  onClick={() => onToggle(unit.id, false)}
                >
                  {unit.adds ? 'Add' : 'Accept'}
                </button>
                <button
                  className="chip"
                  aria-pressed={keep}
                  data-testid="unit-keep"
                  onClick={() => onToggle(unit.id, true)}
                >
                  {unit.adds ? 'Skip' : 'Keep original'}
                </button>
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Noon, after which "this afternoon" is the natural way to say it. */
const AFTERNOON = '12:00'
/** And after which it is the evening. */
const EVENING = '17:00'

/**
 * "Update Day 3 evening" when every change is after five on one day, "afternoon"
 * after noon,
 * "Update Day 3" when it is one day, "Update the plan" when it is more.
 */
function reorganizeHeading(proposal: Proposal): string {
  const touched = [
    ...proposal.planDiff.modified.map((change) => change.after),
    ...proposal.planDiff.added,
    ...proposal.planDiff.removed,
  ]
  if (touched.length === 0) return 'Update the plan'

  const days = new Set(touched.map((item) => item.dayIndex))
  if (days.size > 1) return 'Update the plan'

  const dayIndex = touched[0].dayIndex
  if (touched.every((item) => item.startTime >= EVENING)) return `Update Day ${dayIndex + 1} evening`
  const afternoonOnly = touched.every((item) => item.startTime >= AFTERNOON)
  return afternoonOnly ? `Update Day ${dayIndex + 1} afternoon` : `Update Day ${dayIndex + 1}`
}

/** True when every plan change is on one day. */
function singleDay(proposal: Proposal): boolean {
  const days = new Set([
    ...proposal.planDiff.added.map((item) => item.dayIndex),
    ...proposal.planDiff.removed.map((item) => item.dayIndex),
    ...proposal.planDiff.modified.map((change) => change.after.dayIndex),
  ])
  return days.size === 1
}

function headingFor(proposal: Proposal): string {
  switch (proposal.type) {
    case 'replace':
      return 'Change this place?'
    case 'reorganize':
      return reorganizeHeading(proposal)
    case 'reframe':
      // Every State change is a Reframe (§7.1, 2026-09-30), but one that lands on a
      // single day is headed by where it lands, not as a new direction for the whole
      // trip. The State diff is still shown first below.
      return singleDay(proposal) ? reorganizeHeading(proposal) : 'Change the trip direction'
    default:
      return 'Update the plan'
  }
}

/** §7.2: Before, After, short reason. Nothing else — a Replace is one swap. */
function ReplaceBody({ proposal, catalogue }: { proposal: Proposal; catalogue: PlaceCatalogue }) {
  const change = proposal.planDiff.modified[0]
  const before = change ? catalogue.get(change.before.placeId) : undefined
  const after = change ? catalogue.get(change.after.placeId) : undefined

  return (
    <div className="ba">
      <span className="col">
        <span className="label">Now</span>
        <span className="value strike" data-testid="proposal-before">
          {before?.name ?? change?.before.placeId}
        </span>
      </span>
      <span className="arrow" aria-hidden="true">→</span>
      <span className="col">
        <span className="label">Instead</span>
        <span className="value" data-testid="proposal-after">{after?.name ?? change?.after.placeId}</span>
      </span>
    </div>
  )
}

export function ChangeProposalCard({ proposal, catalogue, stopsInPlan, currentPlan, busy, onConfirm, onKeep }: Props) {
  const [comparing, setComparing] = useState(false)
  // Progressive disclosure (§14.4): title, short reason and key impact first;
  // the full itinerary diff is one tap away on a Reframe, where it is long.
  const [showPreview, setShowPreview] = useState(false)
  const [declined, setDeclined] = useState<Set<string>>(new Set())

  const units = proposal.units ?? []
  // Changes are listed one by one — with a choice on each — whenever there is more
  // than one, or any can be declined.
  const byUnit = units.length > 1 || units.some((unit) => !unit.required)
  const applying = units.filter((unit) => unit.required || !declined.has(unit.id)).length
  const scope = scopeLine(proposal, stopsInPlan)

  const toggle = (unitId: string, keepOriginal: boolean) =>
    setDeclined((current) => {
      const next = new Set(current)
      if (keepOriginal) next.add(unitId)
      else next.delete(unitId)
      return next
    })

  return (
    <div className="proposal" data-testid="proposal" data-change-type={proposal.type}>
      <h3>{headingFor(proposal)}</h3>
      {scope && <p className="scope-line" data-testid="proposal-scope">{scope}</p>}

      {proposal.type === 'replace' && <ReplaceBody proposal={proposal} catalogue={catalogue} />}

      {proposal.type === 'reframe' && (
        <>
          <div className="section-title" style={{ marginTop: 4 }}>What changes about the trip</div>
          <StateDiffList diff={proposal.stateDiff} />
        </>
      )}

      <p className="why">{proposal.rationale}</p>

      <ImpactStrip impact={proposal.impact} />

      {byUnit && <UnitList units={units} declined={declined} onToggle={toggle} />}

      {!byUnit && (proposal.type === 'reorganize' || (proposal.type === 'reframe' && singleDay(proposal))) && (
        <PlanDiffList diff={proposal.planDiff} catalogue={catalogue} />
      )}

      {!byUnit && proposal.type === 'reframe' && !singleDay(proposal) && (
        <>
          <button
            className="btn-ghost"
            data-testid="toggle-plan-preview"
            aria-expanded={showPreview}
            onClick={() => setShowPreview((open) => !open)}
          >
            {showPreview ? 'Hide the itinerary changes' : 'Preview the itinerary changes'}
          </button>
          {showPreview && <PlanDiffList diff={proposal.planDiff} catalogue={catalogue} />}
        </>
      )}

      {/* The two versions whole, side by side (2026-10-01). */}
      {currentPlan && proposal.type !== 'answer' && (
        <>
          <button
            className="btn-ghost"
            data-testid="toggle-compare"
            aria-expanded={comparing}
            onClick={() => setComparing((open) => !open)}
          >
            {comparing ? 'Hide the comparison' : `Compare v${currentPlan.version} with v${currentPlan.version + 1}`}
          </button>
          {comparing && (
            <VersionCompare
              before={currentPlan}
              after={proposal.candidatePlan}
              catalogue={catalogue}
              beforeLabel={`Now · v${currentPlan.version}`}
              afterLabel={`Proposed · v${currentPlan.version + 1}`}
            />
          )}
        </>
      )}

      <button
        className="btn-primary"
        data-testid="confirm-change"
        disabled={busy !== null}
        onClick={() => onConfirm([...declined])}
      >
        {busy ??
          (byUnit
            ? `Apply ${applying} change${applying === 1 ? '' : 's'}`
            : proposal.type === 'replace'
              ? 'Confirm change'
              : 'Confirm changes')}
      </button>
      <button className="btn-secondary" data-testid="keep-current" onClick={onKeep}>
        Keep current
      </button>
    </div>
  )
}
