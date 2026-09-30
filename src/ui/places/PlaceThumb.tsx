/**
 * The picture at the top of a stop.
 *
 * A real photo of that place when the trip has one, and the place's initial when it
 * does not. The monogram was the only option while the product planned from the
 * bundled set, and the reasoning then still holds now: a stock photo of somewhere
 * else would be worse than no photo. What changed is that a retrieved trip carries a
 * photo OF THE PLACE, taken by someone who was there.
 *
 * Three things the photo has to get right, and each is a line of code with a reason:
 *
 *   - **the key stays server-side** (§13.1), so the image is proxied through
 *     `/api/photo` rather than fetched from Google with a key in the URL
 *   - **the credit is shown**, because the terms that permit the photo are the ones
 *     that require it — so the credit renders with the image and disappears with it
 *   - **a failure is not a broken row.** A reference can outlive the image behind it,
 *     and the server answers 404 rather than pretending; the row falls back to the
 *     monogram it would have had anyway.
 */

import { useState, type CSSProperties } from 'react'

import type { DemoPlace } from '../../services/places/types.ts'

/** Widths the photo route will serve. Bounded there; named here. */
export type ThumbWidth = 160 | 480

/**
 * A hue for a place with no photograph, from its id.
 *
 * Stable, so a place keeps the same colour every time it is drawn and a day reads as
 * a set of distinct cards rather than a column of identical grey boxes. Derived from
 * the id rather than the category: two ramen counters next to each other should still
 * look like two places.
 *
 * The letter is hand-drawn for the same reason the monogram exists at all — it should
 * be legible as a STAND-IN. A flat grey rectangle reads as an image that failed to
 * load; a coloured card with a written initial reads as a place nobody has
 * photographed yet.
 */
function hueFor(seed: string): number {
  let hash = 0
  for (let index = 0; index < seed.length; index++) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360
  }
  return hash
}

export function photoUrl(name: string, width: ThumbWidth): string {
  return `/api/photo?ref=${encodeURIComponent(name)}&w=${width}`
}

export function PlaceThumb({
  place,
  width,
  className = 'thumb',
}: {
  place: DemoPlace | undefined
  width: ThumbWidth
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const photo = place?.photo

  // The prototype has no server to resolve a reference through, so it carries the
  // image itself. Everywhere else it is proxied, cached and keyed server-side.
  const source = photo?.src ?? (photo ? photoUrl(photo.name, width) : undefined)

  if (!photo || !source || failed) {
    return (
      <span
        className={`${className} thumb-blank`}
        aria-hidden="true"
        style={{ '--thumb-hue': hueFor(place?.placeId ?? '?') } as CSSProperties}
      >
        {(place?.name ?? '?').trim().charAt(0).toUpperCase()}
      </span>
    )
  }

  return (
    <>
      <img
        className={className}
        data-testid="place-photo"
        src={source}
        /* Decorative: the place's name is the next line, and reading it twice is
           noise to anyone listening rather than looking. */
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
      {photo.attribution && (
        <span className="photo-credit" data-testid="photo-credit">
          Photo: {photo.attribution.name}
        </span>
      )}
    </>
  )
}
