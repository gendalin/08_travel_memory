/**
 * Single-file prototype.
 *
 * Folds the static review build (vite.demo.config.ts) into one HTML file with
 * no sibling assets, so the prototype can be opened from disk or sent as an
 * attachment and still run: deterministic stub model, no server, no API key.
 * The only thing it asks of the network is map tiles.
 *
 *   npm run build:prototype
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const build = resolve(root, 'dist-demo')
const out = resolve(root, 'prototype/the_next_trip_prototype.html')

const css = readFileSync(resolve(build, 'app.css'), 'utf8')
const js = readFileSync(resolve(build, 'app.js'), 'utf8')

/** A closing tag inside the payload would end the element that carries it. */
const safe = (source: string, tag: string) =>
  source.replaceAll(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`)

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>The Next Trip</title>
    <style>
${safe(css, 'style')}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">
${safe(js, 'script')}
    </script>
  </body>
</html>
`

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, html)

const kb = (value: string) => `${Math.round(Buffer.byteLength(value) / 1024)} kB`
console.log(`prototype/the_next_trip_prototype.html  ${kb(html)}  (css ${kb(css)}, js ${kb(js)})`)
