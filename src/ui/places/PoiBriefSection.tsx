/**
 * "About this place" — the POI Brief, as the traveller reads it (poi_enrichment_spec §8).
 *
 * What the place IS, from its own site and trusted sources. Deliberately apart from
 * "Why this place", which is about this trip: the two answer different questions and
 * are never merged into one paragraph.
 *
 * Every brief shows where it came from. A low-confidence brief says so rather than
 * reading as authoritative.
 */

import type { PoiBrief, PoiSourceType } from '../../services/places/poiBrief.ts'

const SOURCE_LABEL: Record<PoiSourceType, string> = {
  official_website: 'Official site',
  official_tourism: 'Tourism board',
  institutional: 'Public institution',
  editorial: 'Editorial',
  other_trusted: 'Web',
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function PoiBriefSection({ brief }: { brief: PoiBrief }) {
  const facts: Array<[string, string[]]> = [
    ['Known for', brief.knownFor],
    ['Good for', brief.goodFor],
    ['Feels', brief.atmosphere],
  ]

  return (
    <div className="poi-brief" data-testid="poi-brief" data-confidence={brief.descriptionConfidence}>
      <div className="section-title">About this place</div>
      <p className="poi-overview">{brief.overview}</p>

      {brief.descriptionConfidence === 'low' && (
        <p className="sub" data-testid="poi-brief-limited">
          Little has been written about this place, so this is kept brief.
        </p>
      )}

      <dl className="poi-facts">
        {facts
          .filter(([, values]) => values.length > 0)
          .map(([label, values]) => (
            <div key={label} className="poi-fact">
              <dt>{label}</dt>
              <dd>{values.join(' · ')}</dd>
            </div>
          ))}
      </dl>

      <p className="poi-sources" data-testid="poi-sources">
        Sources:{' '}
        {brief.descriptionSources.map((source, index) => (
          <span key={source.url}>
            {index > 0 && ' · '}
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              {SOURCE_LABEL[source.type]} ({hostOf(source.url)})
            </a>
          </span>
        ))}
      </p>
    </div>
  )
}
