/**
 * Expected Impact (product_spec §7.5).
 *
 * Renders only the metrics the domain actually computed. A null metric is
 * omitted, never filled in with a guess, and the distance figure is labelled as
 * approximate because it is straight-line, not street routing.
 */

import type { ExpectedImpact } from '../../domain/proposals/impact.ts'

function hours(minutes: number): string {
  const whole = Math.abs(minutes)
  const h = Math.floor(whole / 60)
  const m = whole % 60
  return h > 0 ? `${h}h ${m > 0 ? `${m}m` : ''}`.trim() : `${m}m`
}

export function impactMetrics(impact: ExpectedImpact): string[] {
  const metrics: string[] = []

  if (impact.itemsAffected > 0) {
    metrics.push(`${impact.itemsAffected} stop${impact.itemsAffected === 1 ? '' : 's'} affected`)
  }
  if (impact.poiCountDelta !== 0) {
    const count = Math.abs(impact.poiCountDelta)
    metrics.push(
      `${impact.poiCountDelta > 0 ? '+' : '−'}${count} stop${count === 1 ? '' : 's'} overall`,
    )
  }
  if (impact.walkingDistanceDeltaM !== null && Math.abs(impact.walkingDistanceDeltaM) >= 100) {
    const km = (Math.abs(impact.walkingDistanceDeltaM) / 1000).toFixed(1)
    metrics.push(`≈ ${impact.walkingDistanceDeltaM > 0 ? '+' : '−'}${km} km on the day's path`)
  }
  if (impact.freeTimeDeltaMin !== null && Math.abs(impact.freeTimeDeltaMin) >= 15) {
    metrics.push(
      `${impact.freeTimeDeltaMin > 0 ? '+' : '−'}${hours(impact.freeTimeDeltaMin)} unscheduled`,
    )
  }
  if (impact.budgetWarning) metrics.push(impact.budgetWarning)

  return metrics
}

export function ImpactStrip({ impact }: { impact: ExpectedImpact }) {
  const metrics = impactMetrics(impact)
  if (metrics.length === 0) return null

  return (
    <div className="impact" data-testid="expected-impact">
      {metrics.map((metric) => (
        <span key={metric}>{metric}</span>
      ))}
    </div>
  )
}
