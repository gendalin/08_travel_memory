/**
 * classify_images.ts
 *
 * Reads photo and screenshot *content* and resolves each to one taxonomy
 * category, so interest trends can be aggregated across evidence kinds.
 *
 * Privacy constraints are enforced in the prompt and are binding:
 *   - no faces, appearance, age, gender, or identity
 *   - no relationships, no sensitive traits
 *   - scenes, settings, food, objects and signage only
 *
 * Interpretation:
 *   - a screenshot means saved interest, never a visit
 *   - a photographed subject is not automatically a stable preference
 *
 * Originals are never modified. Resized copies and results are cached under
 * .cache/ (git-ignored), keyed by file content, so re-runs cost nothing.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { requireEnv } from './env.ts'
import { CATEGORIES, UNCLASSIFIED } from './taxonomy.ts'
import { REPO_ROOT } from './types.ts'

export const VISION_MODEL = process.env.VISION_MODEL ?? 'gpt-5.4-mini'

/** Bump when the prompt or schema changes, so cached results are not reused. */
const PROMPT_VERSION = 1

const CACHE_DIR = resolve(REPO_ROOT, '.cache/vision')
const MAX_EDGE_PX = 1024
const CONCURRENCY = 4

export type ImageKind = 'photo' | 'screenshot'

export interface ImageClassification {
  category: string
  confidence: number
  summary: string
  /** Business name when legible, typically only in screenshots. */
  placeName: string | null
  /** Key legible text, any language. Carries the signal for Japanese signage. */
  textSeen: string | null
  model: string
}

const CATEGORY_IDS = [...CATEGORIES.map((category) => category.id), UNCLASSIFIED]
const CATEGORY_LEGEND = CATEGORIES.map(
  (category) => `${category.id} (${category.labelEn} / ${category.labelZh})`,
).join('\n')

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'confidence', 'summary', 'place_name', 'text_seen'],
  properties: {
    category: { type: 'string', enum: CATEGORY_IDS },
    confidence: { type: 'number' },
    summary: { type: 'string' },
    place_name: { type: ['string', 'null'] },
    text_seen: { type: ['string', 'null'] },
  },
} as const

function systemPrompt(kind: ImageKind): string {
  return `Classify a travel ${kind} into one category from the list.

PRIVACY — binding:
- Never describe faces, appearance, age, gender, or who anyone is.
- Never infer relationships or personal traits.
- Describe scenes, settings, food, objects and signage only.
- If the image is mainly of people, classify the SETTING and say so.

A screenshot means saved interest, never a visit.
Use ${UNCLASSIFIED} when no category clearly fits. Do not guess.
summary: one short factual phrase, max 12 words.
place_name: business name if legible, else null.
text_seen: key legible text (any language), else null.

CATEGORIES:
${CATEGORY_LEGEND}`
}

function cacheKey(bytes: Buffer, kind: ImageKind): string {
  return createHash('sha1')
    .update(bytes)
    .update(`|${kind}|${VISION_MODEL}|v${PROMPT_VERSION}`)
    .digest('hex')
}

/**
 * Downscales into the cache with macOS sips. Reads the original, writes only
 * into .cache/ — the source file is never touched.
 */
function resizedDataUrl(sourcePath: string, key: string): string {
  const out = join(CACHE_DIR, `${key}.jpg`)
  if (!existsSync(out)) {
    execFileSync(
      '/usr/bin/sips',
      ['-Z', String(MAX_EDGE_PX), '-s', 'format', 'jpeg', sourcePath, '--out', out],
      { stdio: 'ignore' },
    )
  }
  return `data:image/jpeg;base64,${readFileSync(out).toString('base64')}`
}

async function callVisionApi(
  dataUrl: string,
  kind: ImageKind,
  apiKey: string,
): Promise<ImageClassification> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        { role: 'system', content: systemPrompt(kind) },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Classify this ${kind}.` },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'classification', strict: true, schema: RESPONSE_SCHEMA },
      },
    }),
  })

  if (!res.ok) {
    throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }

  const body = (await res.json()) as { choices: Array<{ message: { content: string } }> }
  const parsed = JSON.parse(body.choices[0].message.content) as {
    category: string
    confidence: number
    summary: string
    place_name: string | null
    text_seen: string | null
  }

  return {
    category: parsed.category,
    confidence: parsed.confidence,
    summary: parsed.summary,
    placeName: parsed.place_name,
    textSeen: parsed.text_seen,
    model: VISION_MODEL,
  }
}

export interface ImageTarget {
  /** Absolute path to the original. */
  absolutePath: string
  /** Repo-relative path, used as the result key. */
  sourcePath: string
  kind: ImageKind
}

/**
 * Classifies every target, reusing cached results. Returns results keyed by
 * sourcePath. A single failure is reported and skipped rather than aborting a
 * 60-image run.
 */
export async function classifyImages(
  targets: ImageTarget[],
  onProgress?: (done: number, total: number, cached: number) => void,
): Promise<Map<string, ImageClassification>> {
  const results = new Map<string, ImageClassification>()
  if (targets.length === 0) return results

  mkdirSync(CACHE_DIR, { recursive: true })
  const apiKey = requireEnv('OPENAI_API_KEY', 'photo and screenshot classification')

  let done = 0
  let cached = 0
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < targets.length) {
      const target = targets[cursor++]
      const bytes = readFileSync(target.absolutePath)
      const key = cacheKey(bytes, target.kind)
      const cachePath = join(CACHE_DIR, `${key}.json`)

      try {
        if (existsSync(cachePath)) {
          results.set(target.sourcePath, JSON.parse(readFileSync(cachePath, 'utf8')))
          cached++
        } else {
          const classification = await callVisionApi(
            resizedDataUrl(target.absolutePath, key),
            target.kind,
            apiKey,
          )
          writeFileSync(cachePath, JSON.stringify(classification, null, 2), 'utf8')
          results.set(target.sourcePath, classification)
        }
      } catch (error) {
        console.error(`  ! ${target.sourcePath}: ${(error as Error).message}`)
      }

      done++
      onProgress?.(done, targets.length, cached)
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker))
  return results
}
