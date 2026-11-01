import { Simulator } from '../engine/simulator'
import { compileEngine } from '../engine/wasm'
import { openerFor } from '../engine/wasmengine'

// Every Simulator the tests make runs on the Rust engine, as in the app; a test that wants the TypeScript engine says `setWasm(null)`.
// (a computed module name: the app's types do not include Node's)
const fs = await import(/* @vite-ignore */ ['node', 'fs'].join(':'))
Simulator.defaultOpener = openerFor(await compileEngine(fs.readFileSync('src/engine/wasm/engine.wasm') as unknown as ArrayBuffer))
