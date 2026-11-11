/**
 * The simulator's Rust engine, compiled to WebAssembly (docs/spec-sim-wasm.md; the source is engine-rs/, the built module is committed at
 * src/engine/wasm/engine.wasm by `npm run build:wasm`).
 *
 * E1: loading the module and checking it speaks the interface this code expects. The engine itself arrives in E2.
 */

/** Where the built module is, for `fetch` (Vite turns this into the asset's address). */
export const engineUrl = new URL('./wasm/engine.wasm', import.meta.url)

/** The version of the interface between this code and the module: engine-rs/src/lib.rs has the same number. */
export const ABI_VERSION = 12

/** What the module exports. */
export interface EngineExports {
  memory: WebAssembly.Memory
  abi_version(): number
  alloc(len: number): number
  free(ptr: number, len: number): void
  checksum(ptr: number, len: number): number
  init(ptr: number, len: number): void
  edge(part: number): number
  set_phase(part: number, phase: number): void
  mark_all(fast: number): void
  tick(): number
  set_force(net: number, v: number): void
  set_net(net: number, v: number): void
  pipe_ptr(part: number): number
  pipe_len(part: number): number
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
  via_ptr(): number
  lcd_ptr(): number
  cpu_ptr(): number
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

/** Compile the module once (checking it is the one this code was written for); `instantiateEngine` then makes an engine for each circuit. */
export async function compileEngine(source: BufferSource): Promise<WebAssembly.Module> {
  const module = await WebAssembly.compile(source)
  await loadEngine(module) // (throws if the interface differs)
  return module
}

/** A fresh copy of the engine (its own memory and circuit) from a compiled module, at once. */
export function instantiateEngine(module: WebAssembly.Module): EngineExports {
  return new WebAssembly.Instance(module, {}).exports as unknown as EngineExports
}

/** The page's side of `checksum` in the module: a check that bytes written into its memory arrive as they were. */
export function checksum(bytes: Uint8Array): number {
  let a = 0
  for (const b of bytes) a = (Math.imul(a, 31) + b) >>> 0
  return a
}

/**
 * Start-up for the page and for the worker: fetch and compile the module, and make it every new Simulator's engine
 * (`Simulator.defaultOpener`). Done before the first Simulator exists. If the module cannot be loaded the error is thrown to the caller.
 */
export async function installEngine(): Promise<void> {
  // The three downloads run together: the module's bytes and the two chunks that use them.
  const bytes = fetch(engineUrl).then((r) => r.arrayBuffer())
  bytes.catch(() => {}) // (the error is thrown below; this only keeps an early failure from being reported as unhandled)
  const [{ Simulator }, { openerFor }] = await Promise.all([import('./simulator'), import('./wasmengine')])
  const module = await compileEngine(await bytes)
  Simulator.defaultOpener = openerFor(module)
}
