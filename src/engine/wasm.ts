/**
 * The simulator's Rust engine, compiled to WebAssembly (docs/spec-sim-wasm.md; the source is engine-rs/, the built module is committed at
 * src/engine/wasm/engine.wasm by `npm run build:wasm`).
 *
 * E1: loading the module and checking it speaks the interface this code expects. The engine itself arrives in E2.
 */

/** Where the built module is, for `fetch` (Vite turns this into the asset's address). */
export const engineUrl = new URL('./wasm/engine.wasm', import.meta.url)

/** The version of the interface between this code and the module: engine-rs/src/lib.rs has the same number. */
export const ABI_VERSION = 4

/** What the module exports. */
export interface EngineExports {
  memory: WebAssembly.Memory
  abi_version(): number
  alloc(len: number): number
  checksum(ptr: number, len: number): number
  init(ptr: number, len: number): void
  edge(part: number): number
  set_phase(part: number, phase: number): void
  settle(): number
  edges(n: number): number
  ticks(): number
  values_ptr(): number
  pins_ptr(): number
  st_n_ptr(): number
  st_pc_ptr(): number
  st_q_ptr(): number
  ram_ptr(): number
  acia_regs_ptr(k: number): number
  acia_key(k: number, code: number): void
  acia_clear_keys(k: number): void
  acia_pending(k: number): number
  acia_queue_ptr(k: number): number
  fb_ptr(): number
  console_take_events(k: number): number
  console_events_ptr(k: number): number
  acia_take_events(k: number): number
  acia_events_ptr(k: number): number
}

/** Start the module from its bytes (or an already compiled `WebAssembly.Module`). Throws if it is not the module this code was written for. */
export async function loadEngine(source: BufferSource | WebAssembly.Module): Promise<EngineExports> {
  const instance =
    source instanceof WebAssembly.Module ? await WebAssembly.instantiate(source, {}) : (await WebAssembly.instantiate(source, {})).instance
  const x = instance.exports as unknown as EngineExports
  if (typeof x.abi_version !== 'function' || x.abi_version() !== ABI_VERSION) {
    throw new Error(`The WebAssembly engine speaks interface ${typeof x.abi_version === 'function' ? x.abi_version() : '?'}, not ${ABI_VERSION}: run npm run build:wasm.`)
  }
  return x
}

/** The page's side of `checksum` in the module: a check that bytes written into its memory arrive as they were. */
export function checksum(bytes: Uint8Array): number {
  let a = 0
  for (const b of bytes) a = (Math.imul(a, 31) + b) >>> 0
  return a
}
