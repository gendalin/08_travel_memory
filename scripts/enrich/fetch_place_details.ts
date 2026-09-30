/**
 * Canonical identity and the official website, from Google Places (spec §3.1).
 *
 * Google Places stays the identity layer: the place id is verified here, and the
 * website it lists is the one source a page can be tied to the place by without
 * reading it. Asked in Japanese, so the name is the one the venue's own pages use —
 * the dataset already holds the English one.
 *
 * Field mask: `websiteUri` and `rating` are Enterprise fields, so one call per POI
 * bills at Enterprise. Cached, so a re-run is free.
 */

import { envOrThrow } from '../preprocess/env.ts'
import { fileSafe, readCache, writeCache } from './cache.ts'

const FIELDS = ['id', 'displayName', 'websiteUri', 'rating', 'userRatingCount', 'shortFormattedAddress'].join(',')

export interface PlaceDetails {
  placeId: string
  /** The name in Japanese, as Places has it. */
  nameJa?: string
  websiteUri?: string
  rating?: number
  userRatingCount?: number
  address?: string
}

export async function fetchPlaceDetails(placeId: string): Promise<PlaceDetails> {
  const cached = readCache<PlaceDetails>('details', fileSafe(placeId))
  if (cached) return cached

  const key = envOrThrow('GOOGLE_MAPS_API_KEY', 'POI enrichment')
  const res = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=ja`,
    { headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS } },
  )
  if (!res.ok) {
    throw new Error(`Place Details ${res.status} for ${placeId}: ${(await res.text()).slice(0, 200)}`)
  }

  const body = (await res.json()) as {
    id?: string
    displayName?: { text?: string }
    websiteUri?: string
    rating?: number
    userRatingCount?: number
    shortFormattedAddress?: string
  }
  // The id Places answers with must be the id asked for: identity is the one
  // thing this step exists to confirm.
  if (body.id !== placeId) throw new Error(`Place Details answered ${body.id} for ${placeId}`)

  const details: PlaceDetails = {
    placeId,
    ...(body.displayName?.text ? { nameJa: body.displayName.text } : {}),
    ...(body.websiteUri ? { websiteUri: body.websiteUri } : {}),
    ...(typeof body.rating === 'number' ? { rating: body.rating } : {}),
    ...(typeof body.userRatingCount === 'number' ? { userRatingCount: body.userRatingCount } : {}),
    ...(body.shortFormattedAddress ? { address: body.shortFormattedAddress } : {}),
  }
  writeCache('details', fileSafe(placeId), details)
  return details
}
