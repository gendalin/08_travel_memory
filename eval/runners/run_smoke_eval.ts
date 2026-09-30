/** Quick smoke eval (eval spec §32): M1, M2, H1, H3, H5, R1. */

process.argv.push('--smoke')
export {}

await import('./run_core_eval.ts')
