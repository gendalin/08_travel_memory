/**
 * extract_photo_metadata.ts
 *
 * Responsibilities:
 *   - list photo files in source_inputs/tokyo_raw/photos/
 *   - preserve the source path of every original
 *   - extract EXIF when available
 *   - capture date/time
 *   - capture GPS
 *   - output normalized metadata
 *
 * Hard rules:
 *   - originals are read-only: no rename, overwrite, EXIF edit, compression or delete
 *   - never infer identity of people, relationships, or sensitive traits
 *
 * Output feeds build_evidence.ts. Nothing is written to disk by this module.
 */

import { readdirSync } from 'node:fs'
import { extname, join } from 'node:path'

import exifr from 'exifr'

import { PATHS, relPath, type GeoPoint, type PhotoMetadata } from './types.ts'

const PHOTO_EXTENSIONS = new Set(['.heic', '.heif', '.jpg', '.jpeg', '.png'])

export function listPhotoFiles(dir: string = PATHS.raw.photos): string[] {
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => PHOTO_EXTENSIONS.has(extname(name).toLowerCase()))
    .sort()
    .map((name) => join(dir, name))
}

/**
 * EXIF DateTimeOriginal is camera-local wall-clock with no timezone.
 * "2026:01:29 11:55:09" -> "2026-01-29T11:55:09".
 *
 * The raw string is used deliberately: reviving it into a Date and calling
 * toISOString() would re-interpret it in the machine's timezone and shift the
 * hour, which would corrupt every start-time and pace figure derived downstream.
 */
export function parseExifDateTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match
  if (year === '0000') return null
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`
}

function readGps(tags: Record<string, unknown> | undefined): GeoPoint | null {
  const lat = tags?.latitude
  const lng = tags?.longitude
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  // A literal 0,0 is Null Island, not a location.
  if (lat === 0 && lng === 0) return null
  return { lat, lng }
}

export async function extractPhotoMetadata(
  dir: string = PATHS.raw.photos,
): Promise<PhotoMetadata[]> {
  const files = listPhotoFiles(dir)

  return Promise.all(
    files.map(async (absolutePath) => {
      // Read-only parse. exifr opens the file for reading and never writes back.
      let tags: Record<string, unknown> | undefined
      try {
        tags = await exifr.parse(absolutePath, {
          tiff: true,
          exif: true,
          gps: true,
          reviveValues: false,
        })
      } catch {
        tags = undefined
      }

      return {
        sourcePath: relPath(absolutePath),
        fileName: absolutePath.split('/').pop() as string,
        // Null when the file carries no capture time. File mtime is deliberately
        // NOT used as a stand-in: it reflects copying, not when the photo was taken.
        capturedAt: parseExifDateTime(tags?.DateTimeOriginal ?? tags?.CreateDate),
        location: readGps(tags),
        // TODO(preprocess): non-identifying scene summary (street / interior / food /
        // nature / transit). Categories and settings only — never people.
      } satisfies PhotoMetadata
    }),
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const records = await extractPhotoMetadata()
  const withTime = records.filter((r) => r.capturedAt).length
  const withGps = records.filter((r) => r.location).length
  console.log(`photos: ${records.length} | capture time: ${withTime} | gps: ${withGps}`)
  console.log(JSON.stringify(records, null, 2))
}
