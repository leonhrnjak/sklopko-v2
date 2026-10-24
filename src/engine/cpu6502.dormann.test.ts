import { describe, expect, it } from 'vitest'
import { cycle, newCpu } from './cpu6502'

/**
 * Klaus Dormann's 6502 functional test, the usual whole-chip check. It is GPL, so it is not in the repository: get
 * `6502_functional_test.bin` from https://github.com/Klaus2m5/6502_65C02_functional_tests (bin_files) and run
 * `VITE_DORMANN=/path/6502_functional_test.bin npx vitest run src/engine/cpu6502.dormann`.
 * The program starts at $0400 and ends in a jump to itself at $3469 when every check passed; a failure traps earlier.
 */
const file = import.meta.env.VITE_DORMANN as string | undefined
/** The 65C02 version: `65C02_extended_opcodes_test.bin` from the same place; its success trap is at $24F1. */
const file65c02 = import.meta.env.VITE_DORMANN_65C02 as string | undefined

/** Run the test program at `path` on a CPU until it jumps to itself, and say where. */
async function run(path: string, cmos: boolean) {
  // The app's tsconfig has no Node types, so the module is loaded by a name the compiler does not look at.
  const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readFileSync(path: string): Uint8Array }
  const mem = new Uint8Array(65536)
  mem.set(fs.readFileSync(path), 0)
  const c = newCpu(cmos)
  Object.assign(c, { pc: 0x400, addr: 0x400, read: true, sync: true, prog: -1 })
  let last = -1
  for (;;) {
    const d = c.read ? mem[c.addr] : ((mem[c.addr] = c.out), 0)
    cycle(c, d)
    if (c.sync) {
      if (c.pc === last) break // a jump to itself: the test stops here
      last = c.pc
    }
  }
  return c
}

describe.skipIf(!file65c02)('Dormann extended opcodes test (65C02)', () => {
  it('reaches the success trap at $24F1', { timeout: 300000 }, async () => {
    const c = await run(file65c02!, true)
    expect(c.pc.toString(16)).toBe('24f1')
    console.log(`passed after ${c.cycles} cycles`)
  })
})

describe.skipIf(!file)('Dormann functional test', () => {
  it('reaches the success trap at $3469', { timeout: 300000 }, async () => {
    const c = await run(file!, false)
    expect(c.pc.toString(16)).toBe('3469')
    console.log(`passed after ${c.cycles} cycles`)
  })
})
