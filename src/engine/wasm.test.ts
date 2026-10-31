import { describe, expect, it } from 'vitest'
import { ABI_VERSION, checksum, loadEngine } from './wasm'

/** The committed module, read from disk (a computed module name: the app's types do not include Node's). */
async function bytes() {
  const fs = await import(/* @vite-ignore */ ['node', 'fs'].join(':'))
  return fs.readFileSync('src/engine/wasm/engine.wasm') as Uint8Array
}

describe('the WebAssembly engine (docs/spec-sim-wasm.md, E1)', () => {
  it('loads and speaks the interface this code expects', async () => {
    const x = await loadEngine(await bytes())
    expect(x.abi_version()).toBe(ABI_VERSION)
  })

  it('reads the bytes the page writes into its memory', async () => {
    const x = await loadEngine(await bytes())
    const data = Uint8Array.from({ length: 1000 }, (_, i) => (i * 37 + 11) & 255)
    const ptr = x.alloc(data.length)
    new Uint8Array(x.memory.buffer, ptr, data.length).set(data)
    expect(x.checksum(ptr, data.length)).toBe(checksum(data))
  })

  it('refuses a module that is not an engine', async () => {
    // (the smallest valid module: no exports)
    const empty = Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])
    await expect(loadEngine(empty)).rejects.toThrow(/interface/)
  })
})
