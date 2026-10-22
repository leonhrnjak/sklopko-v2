import { describe, expect, it } from 'vitest'
import { assemble, SKASM } from '../engine/isa'
import { newMachine, run } from '../engine/skasm-ref'
import { SKASM_EXAMPLES } from './skasm-examples'

describe('the examples in the SKASM reference', () => {
  for (const ex of SKASM_EXAMPLES) {
    it(`"${ex.title}" assembles and ends with ACC = ${ex.result}`, () => {
      const r = assemble(SKASM, ex.text, 256)
      expect(r.errors).toEqual([])
      const m = newMachine()
      const steps = run(m, r.words, {})
      expect(m.halted).toBe(true)
      expect(steps).toBeLessThan(1000)
      expect(m.acc).toBe(ex.result)
    })
  }

  it('the 16-bit sum leaves 0x0310 in RAM', () => {
    const ex = SKASM_EXAMPLES.find((e) => e.id === 'sixteen')!
    const m = newMachine()
    run(m, assemble(SKASM, ex.text, 256).words)
    expect([m.ram[5], m.ram[4]]).toEqual([0x03, 0x10])
  })

  it('the message example prints "Hi!"', () => {
    const ex = SKASM_EXAMPLES.find((e) => e.id === 'hello')!
    const printed: number[] = []
    run(newMachine(), assemble(SKASM, ex.text, 256).words, { out: (p, v) => p === 1 && printed.push(v) })
    expect(String.fromCharCode(...printed)).toBe('Hi!')
  })

  it('the mask example splits 0xA5', () => {
    const ex = SKASM_EXAMPLES.find((e) => e.id === 'mask')!
    const m = newMachine()
    run(m, assemble(SKASM, ex.text, 256).words)
    expect([m.ram[0], m.ram[1]]).toEqual([0xa, 0x5])
  })
})
