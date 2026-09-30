/**
 * The catalogue the single-file prototype plans from — absent in every other build.
 *
 * The prototype is the one artefact a reviewer opens, and until now it planned from
 * the bundled thirty-four places: curated before per-trip retrieval existed, and
 * before photos were asked for. So the file that was supposed to show the product
 * showed neither what it retrieves nor what it looks like when it does.
 *
 * `vite.demo.config.ts` swaps this module for the one that carries the real set. The
 * swap is at the module rather than behind a flag on purpose: four megabytes of
 * inlined photography must not end up in the app's own bundle, and a build-time
 * constant would leave it there, loaded or not.
 */

import type { DemoPlace } from '../services/places/types.ts'

/** Undefined everywhere but the prototype, where the bundled set is used instead. */
export const PROTOTYPE_CATALOGUE: DemoPlace[] | undefined = undefined
