/**
 * On-disk cache for POI enrichment. Every paid step caches its answer, so a re-run —
 * or a resumed run — costs nothing for what was already fetched.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { REPO_ROOT } from '../preprocess/types.ts'

export const ENRICH_CACHE = resolve(REPO_ROOT, '.cache/poi_enrichment')

export function cacheKey(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16)
}

export function readCache<T>(area: string, key: string): T | undefined {
  const file = join(ENRICH_CACHE, area, `${key}.json`)
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return undefined
  }
}

export function writeCache(area: string, key: string, value: unknown): void {
  const dir = join(ENRICH_CACHE, area)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${key}.json`), JSON.stringify(value, null, 2), 'utf8')
}

/** Place ids carry characters a filename should not. */
export function fileSafe(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_')
}
