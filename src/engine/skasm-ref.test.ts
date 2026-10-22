import { describe, expect, it } from 'vitest'
import { assemble, SKASM } from './isa'
import { newMachine, run, step, type Machine } from './skasm-ref'

/** Assemble and run a program; returns the machine and what was sent to the ports. */
function exec(source: string, setup?: (m: Machine) => void, input: Record<number, number> = {}) {
  const r = assemble(SKASM, source, 256)
  expect(r.errors).toEqual([])
  const m = newMachine()
  setup?.(m)
  const out: [number, number][] = []
  run(m, r.words, { out: (p, v) => out.push([p, v]), in: (p) => input[p] ?? 0 })
  return { m, out }
}
const flags = (m: Machine) => `${m.c}${m.z}`

describe('SKASM reference machine', () => {
  it('loads, stores and halts', () => {
    const { m } = exec('LDI 200\nSTA 3\nLDI 1\nLDA 3\nHALT')
    expect(m.acc).toBe(200)
    expect(m.ram[3]).toBe(200)
    expect(m.halted).toBe(true)
    expect(m.pc).toBe(4) // stays on HALT
  })

  it('ADD sets carry on overflow and zero on a zero result', () => {
    expect(flags(exec('LDI 200\nSTA 0\nLDI 100\nADD 0\nHALT').m)).toBe('10')
    expect(exec('LDI 200\nSTA 0\nLDI 100\nADD 0\nHALT').m.acc).toBe(44)
    expect(flags(exec('LDI 200\nSTA 0\nLDI 56\nADD 0\nHALT').m)).toBe('11') // 256: carry and zero
    expect(flags(exec('LDI 1\nSTA 0\nLDI 2\nADD 0\nHALT').m)).toBe('00')
  })

  it('SUB sets carry when it borrows, and zero on equal values', () => {
    expect(exec('LDI 5\nSTA 0\nLDI 3\nSUB 0\nHALT').m.acc).toBe(254)
    expect(flags(exec('LDI 5\nSTA 0\nLDI 3\nSUB 0\nHALT').m)).toBe('10')
    expect(flags(exec('LDI 5\nSTA 0\nLDI 5\nSUB 0\nHALT').m)).toBe('01')
    expect(flags(exec('LDI 5\nSTA 0\nLDI 9\nSUB 0\nHALT').m)).toBe('00')
  })

  it('ADDI, SUBI and CMPI work on constants; CMPI keeps ACC', () => {
    expect(exec('LDI 250\nADDI 10\nHALT').m).toMatchObject({ acc: 4, c: 1, z: 0 })
    expect(exec('LDI 3\nSUBI 3\nHALT').m).toMatchObject({ acc: 0, c: 0, z: 1 })
    expect(exec('LDI 3\nCMPI 4\nHALT').m).toMatchObject({ acc: 3, c: 1, z: 0 })
    expect(exec('LDI 3\nCMPI 3\nHALT').m).toMatchObject({ acc: 3, c: 0, z: 1 })
  })

  it('CMP compares with RAM and keeps ACC', () => {
    expect(exec('LDI 9\nSTA 1\nLDI 4\nCMP 1\nHALT').m).toMatchObject({ acc: 4, c: 1, z: 0 })
    expect(exec('LDI 9\nSTA 1\nCMP 1\nHALT').m).toMatchObject({ acc: 9, c: 0, z: 1 })
  })

  it('shifts drop the bit that falls out and leave the flags alone', () => {
    expect(exec('LDI 0x81\nSHL\nHALT').m).toMatchObject({ acc: 2, c: 0, z: 0 })
    expect(exec('LDI 0x81\nSHR\nHALT').m).toMatchObject({ acc: 0x40, c: 0, z: 0 })
    expect(exec('LDI 255\nADDI 1\nLDI 3\nSHL\nHALT').m).toMatchObject({ acc: 6, c: 1, z: 1 }) // flags from ADDI survive
  })

  it('logic instructions set zero from the result and clear carry', () => {
    expect(exec('LDI 0xF0\nSTA 0\nLDI 0x3C\nAND 0\nHALT').m).toMatchObject({ acc: 0x30, c: 0, z: 0 })
    expect(exec('LDI 0xF0\nSTA 0\nLDI 0x0F\nOR 0\nHALT').m.acc).toBe(0xff)
    expect(exec('LDI 0xFF\nSTA 0\nLDI 0xFF\nXOR 0\nHALT').m).toMatchObject({ acc: 0, c: 0, z: 1 })
    expect(exec('LDI 255\nADDI 1\nLDI 0x0F\nANDI 0xF0\nHALT').m).toMatchObject({ acc: 0, c: 0, z: 1 }) // carry was 1
    expect(exec('LDI 0x0F\nORI 0x80\nHALT').m.acc).toBe(0x8f)
    expect(exec('LDI 0xAA\nXORI 0xFF\nHALT').m.acc).toBe(0x55)
    expect(exec('LDI 0xAA\nNOT\nHALT').m.acc).toBe(0x55)
  })

  it('ADC and SBC chain the carry, so two bytes make a 16-bit number', () => {
    // 0x01F0 + 0x0120 = 0x0310, low bytes first.
    const { m } = exec(['LDI 0xF0', 'STA 0', 'LDI 0x01', 'STA 1', 'LDI 0x20', 'STA 2', 'LDI 0x01', 'STA 3', 'LDA 0', 'ADD 2', 'STA 4', 'LDA 1', 'ADC 3', 'STA 5', 'HALT'].join('\n'))
    expect([m.ram[5], m.ram[4]]).toEqual([0x03, 0x10])
    // 0x0200 − 0x0001 = 0x01FF
    const s = exec(['LDI 0x00', 'STA 0', 'LDI 0x02', 'STA 1', 'LDI 1', 'STA 2', 'LDI 0', 'STA 3', 'LDA 0', 'SUB 2', 'STA 4', 'LDA 1', 'SBC 3', 'STA 5', 'HALT'].join('\n'))
    expect([s.m.ram[5], s.m.ram[4]]).toEqual([0x01, 0xff])
  })

  it('jumps follow the flags', () => {
    const loop = exec('LDI 5\nloop: DEC\nJNZ loop\nHALT')
    expect(loop.m.acc).toBe(0)
    expect(exec('LDI 255\nINC\nJC taken\nLDI 1\nHALT\ntaken: LDI 2\nHALT').m.acc).toBe(2)
    expect(exec('LDI 3\nSUBI 3\nJZ yes\nLDI 1\nHALT\nyes: LDI 2\nHALT').m.acc).toBe(2)
    expect(exec('LDI 3\nADDI 1\nJNC yes\nLDI 1\nHALT\nyes: LDI 2\nHALT').m.acc).toBe(2)
  })

  it('jumps reach all 256 instructions', () => {
    const lines = ['JMP far', ...Array.from({ length: 199 }, () => 'NOP'), 'far: LDI 7', 'HALT']
    expect(exec(lines.join('\n')).m.acc).toBe(7)
  })

  it('OUT sends ACC to a port; IN reads one, 0 when nothing is there; neither touches RAM', () => {
    const { m, out } = exec('LDI 65\nOUT CHAR\nLDI 9\nOUT NUMBER\nIN KEY\nSTA 0\nIN 9\nHALT', undefined, { 5: 0x13 })
    expect(out).toEqual([[1, 65], [0, 9]])
    expect(m.ram[0]).toBe(0x13)
    expect(m.acc).toBe(0)
    expect(m.ram.filter((v) => v).length).toBe(1)
  })

  it('IN and OUT leave the flags alone', () => {
    expect(flags(exec('LDI 255\nADDI 1\nIN KEY\nOUT NUMBER\nHALT').m)).toBe('11')
  })

  it('NOP and words that are not instructions do nothing', () => {
    const m = newMachine()
    step(m, [0x00a0 | 0x0f, 0xb0f0], {}) // not instructions
    expect(m).toMatchObject({ pc: 1, acc: 0 })
    const n = exec('LDI 4\nNOP\nNOP\nHALT').m
    expect(n.acc).toBe(4)
  })

  it('the program counter wraps round after 256 instructions', () => {
    const m = newMachine()
    m.pc = 255
    step(m, Array.from({ length: 256 }, () => 0xa0f0))
    expect(m.pc).toBe(0)
  })

  it('runs the Fibonacci program', () => {
    const { m, out } = exec(`
      SHOW = 15
      LDI 0
      STA 0
      LDI 1
      STA 1
      loop: LDA 1
      OUT NUMBER
      ADD 0
      STA 2
      LDA 1
      STA 0
      LDA 2
      STA 1
      JNC loop
      HALT`)
    expect(out.map(([, v]) => v)).toEqual([1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233])
    expect(m.c).toBe(1)
  })
})
