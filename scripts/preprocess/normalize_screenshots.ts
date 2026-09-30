/**
 * normalize_screenshots.ts
 *
 * Responsibilities:
 *   - list screenshot files in source_inputs/tokyo_raw/screenshots/
 *   - preserve the source path
 *   - prepare screenshot evidence records
 *   - leave semantic extraction extensible
 *
 * Interpretation rule:
 *   Screenshot = intentional saved information / possible interest.
 *   A screenshot is never proof that the user visited the place.
 *   Screenshots stay a separate evidence kind from travel photos.
 *
 * Output feeds build_evidence.ts. Nothing is written to disk by this module.
 */

import { readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

import { PATHS, relPath, type ScreenshotRecord } from './types.ts'

const SCREENSHOT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.heic'])

/**
 * Local wall-clock, matching how photo EXIF timestamps are recorded.
 * toISOString() would write these as UTC while photo times stay camera-local,
 * so the same field would silently mean two different things across kinds.
 */
function toLocalWallClock(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

export function listScreenshotFiles(dir: string = PATHS.raw.screenshots): string[] {
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => SCREENSHOT_EXTENSIONS.has(extname(name).toLowerCase()))
    .sort()
    .map((name) => join(dir, name))
}

export async function normalizeScreenshots(
  dir: string = PATHS.raw.screenshots,
): Promise<ScreenshotRecord[]> {
  return listScreenshotFiles(dir).map((absolutePath) => {
    const stats = statSync(absolutePath)

    // TODO(preprocess): optional semantic extraction (OCR / vision) to fill `summary`
    // with what was saved — a restaurant, an exhibition, an article, a map result.
    // Must stay an interest signal. Never emit a visit, and never emit a
    // person-level description.
    return {
      sourcePath: relPath(absolutePath),
      fileName: absolutePath.split('/').pop() as string,
      // File mtime: when the screenshot was saved or last written, which is the
      // best signal iOS PNGs carry. Not a capture time in the EXIF sense.
      capturedAt: toLocalWallClock(stats.mtime),
    } satisfies ScreenshotRecord
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const records = await normalizeScreenshots()
  console.log(`screenshots: ${records.length}`)
  console.log(JSON.stringify(records, null, 2))
}
