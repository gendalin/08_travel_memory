/**
 * The prototype's catalogue, with its photography inlined.
 *
 * Built by `npm run build:demo-catalogue` from places live runs already fetched, read
 * back through the product's own quality gate. Only `vite.demo.config.ts` resolves to
 * this file — see `prototypeCatalogue.ts` for why the swap is at the module.
 */

import places from '../../data/demo_retrieved_v1/places.json'
import type { DemoPlace } from '../services/places/types.ts'

export const PROTOTYPE_CATALOGUE: DemoPlace[] | undefined = places as DemoPlace[]
