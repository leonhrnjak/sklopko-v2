import { describe, expect, it } from 'vitest'
import { cycle, newCpu } from './cpu6502'

/**
 * Klaus Dormann's 6502 functional test, the usual whole-chip check. It is GPL, so it is not in the repository: get
 * `6502_functional_test.bin` from https://github.com/Klaus2m5/6502_65C02_functional_tests (bin_files) and run
 * `VITE_DORMANN=/path/6502_functional_test.bin npx vitest run src/engine/cpu6502.dormann`.
 * The program starts at $0400 and ends in a jump to itself at $3469 when every check passed; a failure traps earlier.
 */
const file = import.meta.env.VITE_DORMANN as string | undefined

describe.skipIf(!file)('Dormann functional test', () => {
  it('reaches the success trap at $3469', { timeout: 300000 }, async () => {
    // The app's tsconfig has no Node types, so the module is loaded by a name the compiler does not look at.
    const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readFileSync(path: string): Uint8Array }
    const mem = new Uint8Array(65536)
    mem.set(fs.readFileSync(file!), 0)
    const c = newCpu()
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
    expect(c.pc.toString(16)).toBe('3469')
    console.log(`passed after ${c.cycles} cycles`)
  })
})
