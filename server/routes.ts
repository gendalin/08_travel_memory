/**
 * API routes. Run inside the Vite dev server's Node process, so the OpenAI key
 * stays server-side and the browser only ever talks to /api/*.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import { MissingEnvError } from '../scripts/preprocess/env.ts'
import { chooseReplacement, decomposeTripState, interpretLines, interpretMessage, planQueries } from './openai.ts'
import { geocodeLodging, photoMedia, searchMany } from './places.ts'
import { findEvents } from './events.ts'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

/** Returns true when it handled the request. */
export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? ''
  if (!url.startsWith('/api/')) return false

  /**
   * Photos are the one GET, because they are the one response that is not JSON: an
   * `<img src>` is a GET or it is nothing. The bytes are proxied rather than the key
   * being handed to the browser (§13.1), and the resource name is checked against a
   * pattern before it is used — otherwise this route would fetch anything at all with
   * this server's key.
   */
  if (url.startsWith('/api/photo')) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'GET only' })
      return true
    }

    try {
      const query = new URL(url, 'http://localhost').searchParams
      const photo = await photoMedia({
        name: query.get('ref') ?? '',
        maxWidthPx: Number(query.get('w') ?? 0),
      })

      if (!photo) {
        // The UI falls back to a monogram: a missing picture is not a broken trip.
        sendJson(res, 404, { error: 'no such photo' })
        return true
      }

      res.statusCode = 200
      res.setHeader('Content-Type', photo.contentType)
      // Immutable: a photo reference names one image, and the bytes behind it do not
      // change. Re-fetching them would be a second bill for the same picture.
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      res.end(photo.body)
      return true
    } catch (error) {
      if (error instanceof MissingEnvError) {
        console.error('[api] not configured:', error.message)
        sendJson(res, 501, { error: 'This server is not configured for that.' })
        return true
      }
      console.error('[api]', error)
      sendJson(res, 502, { error: 'The photo could not be fetched.' })
      return true
    }
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'POST only' })
    return true
  }

  try {
    const payload = JSON.parse((await readBody(req)) || '{}')

    if (url.startsWith('/api/decompose')) {
      sendJson(res, 200, await decomposeTripState(payload))
      return true
    }

    if (url.startsWith('/api/replacement')) {
      sendJson(res, 200, await chooseReplacement(payload))
      return true
    }

    if (url.startsWith('/api/interpret-lines')) {
      sendJson(res, 200, await interpretLines(payload))
      return true
    }

    if (url.startsWith('/api/interpret-message')) {
      sendJson(res, 200, await interpretMessage(payload))
      return true
    }

    if (url.startsWith('/api/query-plan')) {
      sendJson(res, 200, await planQueries(payload))
      return true
    }

    if (url.startsWith('/api/lodging')) {
      sendJson(res, 200, { lodging: await geocodeLodging(payload) })
      return true
    }

    if (url.startsWith('/api/events')) {
      sendJson(res, 200, await findEvents(payload))
      return true
    }

    if (url.startsWith('/api/places')) {
      sendJson(res, 200, await searchMany(payload.searches ?? []))
      return true
    }

    sendJson(res, 404, { error: 'unknown route' })
    return true
  } catch (error) {
    // A key this server has not got is not a transient failure, and a server that
    // exits over one takes the whole product down with it — which was the behaviour
    // until Gate 8. 501 says "this server will never do that", so the client falls
    // straight through to what it can do without the service instead of spending its
    // retry budget proving the key is still missing.
    if (error instanceof MissingEnvError) {
      console.error('[api] not configured:', error.message)
      sendJson(res, 501, { error: 'This server is not configured for that.' })
      return true
    }

    // The message may carry provider detail; keep it server-side in the log and
    // return something the UI can show without leaking internals.
    console.error('[api]', error)
    sendJson(res, 500, { error: 'The planning service is unavailable.' })
    return true
  }
}
