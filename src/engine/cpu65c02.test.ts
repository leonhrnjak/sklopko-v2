import { describe, expect, it } from 'vitest'
import { FLAG, cycle, newCpu, reset, setIrq, setNmi } from './testdata/oracle/cpu6502'
import { BY_OPCODE_65C02 } from './opcodes65c02'
import vectors from './testdata/65c02-singlestep.json'
import { BY_OPCODE_6502 } from './opcodes6502'
import { OPCODES_65C02 } from './opcodes65c02'

type Ram = [number, number][]
interface State {
  pc: number
  s: number
  a: number
  x: number
  y: number
  p: number
  ram: Ram
}
type Vector = [string, State, State, [number, number, 'read' | 'write'][]]

/** A 65C02 at an opcode fetch with `state`, over a 64 KB memory. */
function setup(state: State) {
  const c = newCpu(true)
  Object.assign(c, { pc: state.pc, sp: state.s, a: state.a, x: state.x, y: state.y, p: state.p })
  c.prog = -1
  c.sync = true
  c.read = true
  c.addr = c.pc
  const mem = new Uint8Array(65536)
  for (const [addr, v] of state.ram) mem[addr] = v
  return { c, mem }
}

describe('SingleStepTests, WDC 65C02 (a sample of every opcode but WAI and STP)', () => {
  for (const [hex, cases] of Object.entries(vectors as unknown as Record<string, Vector[]>)) {
    const o = BY_OPCODE_65C02[parseInt(hex, 16)]
    it(`opcode ${hex}: ${o.mnemonic} ${o.mode}`, () => {
      for (const [name, initial, final, cycles] of cases) {
        const { c, mem } = setup(initial)
        const trace: [number, number, string][] = []
        do {
          const read = c.read
          const addr = c.addr
          const d = read ? mem[addr] : ((mem[addr] = c.out), c.out)
          trace.push([addr, d, read ? 'read' : 'write'])
          cycle(c, read ? d : 0)
        } while (!c.sync)
        const where = `${name} (${JSON.stringify(initial)})`
        expect(trace, where).toEqual(cycles)
        expect({ pc: c.pc, s: c.sp, a: c.a, x: c.x, y: c.y, p: c.p }, where).toEqual({ pc: final.pc, s: final.s, a: final.a, x: final.x, y: final.y, p: final.p })
        for (const [addr, v] of final.ram) expect(mem[addr], `${where}: RAM[${addr}]`).toBe(v)
      }
    })
  }
})

describe('the 65C02 opcode table', () => {
  it('has every opcode defined, and keeps the 151 of the NMOS chip (a few with other cycles)', () => {
    expect(BY_OPCODE_65C02.every(Boolean)).toBe(true)
    for (const o of BY_OPCODE_6502.filter((x) => x !== undefined)) {
      const n = BY_OPCODE_65C02[o.opcode]
      expect([n.mnemonic, n.mode]).toEqual([o.mnemonic, o.mode])
    }
    expect(OPCODES_65C02.filter((o) => !BY_OPCODE_6502[o.opcode])).toHaveLength(61) // 29 new opcodes, and the 32 of RMB, SMB, BBR and BBS (the NOPs are not counted)
  })

  it('shifts by X take one cycle less, and JMP (address) one more', () => {
    expect([BY_OPCODE_6502[0x1e]!.cycles, BY_OPCODE_65C02[0x1e].cycles]).toEqual([7, 6])
    expect([BY_OPCODE_6502[0xfe]!.cycles, BY_OPCODE_65C02[0xfe].cycles]).toEqual([7, 7]) // INC abs,X still takes 7
    expect([BY_OPCODE_6502[0x6c]!.cycles, BY_OPCODE_65C02[0x6c].cycles]).toEqual([5, 6])
  })
})

/** A 65C02 (or an NMOS 6502) running `code` at $0200 with the vectors given, and a way to run it. */
function machine(code: number[], cmos = true, vectors: Record<number, number> = {}) {
  const mem = new Uint8Array(65536)
  mem.set(code, 0x200)
  mem[0xfffc] = 0x00
  mem[0xfffd] = 0x02
  for (const [addr, target] of Object.entries(vectors)) {
    mem[+addr] = target & 255
    mem[+addr + 1] = target >> 8
  }
  const c = newCpu(cmos)
  reset(c)
  const step = () => cycle(c, c.read ? mem[c.addr] : ((mem[c.addr] = c.out), 0))
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) step()
  }
  return { c, mem, step, steps }
}

describe('what the 65C02 does differently', () => {
  it('BRK and interrupts clear the decimal flag; the NMOS chip leaves it', () => {
    for (const cmos of [true, false]) {
      const { c, steps } = machine([0xf8, 0x58, 0x00, 0xea], cmos, { 0xfffe: 0x300 }) // SED, CLI, BRK
      steps(7 + 2 + 2 + 7)
      expect(c.pc, String(cmos)).toBe(0x300)
      expect(!!(c.p & FLAG.D), String(cmos)).toBe(!cmos)
    }
  })

  it('JMP ($12FF) takes the high byte from $1300, not from $1200', () => {
    for (const cmos of [true, false]) {
      const { c, mem, steps } = machine([0x6c, 0xff, 0x12], cmos)
      mem[0x12ff] = 0x34
      mem[0x1300] = 0x56
      mem[0x1200] = 0x78
      steps(7 + (cmos ? 6 : 5))
      expect(c.pc.toString(16), String(cmos)).toBe(cmos ? '5634' : '7834')
    }
  })

  it('has the new instructions: BRA, STZ, PHX/PLY, INC A, TSB, RMB and BBS', () => {
    // LDX #$42; PHX; PLY; INC A; STZ $10; BRA +1; (skipped) INX; LDA #$0F; TSB $11; RMB0 $11; BBS3 $11,+1 ... ; NOP; BRK
    const code = [0xa2, 0x42, 0xda, 0x7a, 0x1a, 0x64, 0x10, 0x80, 0x01, 0xe8, 0xa9, 0x0f, 0x04, 0x11, 0x07, 0x11, 0xaf, 0x11, 0x01, 0xca, 0xea, 0x00]
    const { c, mem, steps } = machine(code, true, { 0xfffe: 0x300 })
    mem[0x10] = 0xff
    mem[0x11] = 0xf0
    steps(400)
    expect(c.y).toBe(0x42) // PHX, PLY
    expect(c.a).toBe(0x0f)
    expect(mem[0x10]).toBe(0) // STZ
    expect(c.x).toBe(0x42) // the INX after BRA was skipped, and DEX after BBS3 too
    expect(mem[0x11]).toBe(0xfe) // TSB set 0x0f: 0xff, RMB0 cleared bit 0
  })

  it('WAI waits for an interrupt: with I set it goes on, with I clear it takes the interrupt', () => {
    const { c, steps } = machine([0x78, 0xcb, 0xe8, 0xea]) // SEI, WAI, INX
    steps(7 + 2 + 3)
    const pc = c.pc
    steps(30)
    expect([c.pc, c.x, c.sync]).toEqual([pc, 0, false]) // waiting
    setIrq(c, true)
    steps(4)
    expect(c.x).toBe(1) // went on to INX without taking the interrupt (I is set)
    const m = machine([0x58, 0xcb, 0xea], true, { 0xfffa: 0x300 }) // CLI, WAI, NOP
    m.steps(7 + 2 + 3 + 20)
    setNmi(m.c, true)
    m.steps(12)
    expect(m.c.pc).toBeGreaterThanOrEqual(0x300) // the NMI routine
  })

  it('STP stops the CPU for good (interrupts do not wake it), until a reset', () => {
    const { c, steps } = machine([0xdb, 0xe8], true, { 0xfffa: 0x300 })
    steps(7 + 3 + 10)
    setNmi(c, true)
    setIrq(c, true)
    steps(50)
    expect([c.x, c.pc < 0x300]).toEqual([0, true])
    reset(c)
    steps(7 + 3)
    expect(c.pc).toBe(0x201)
  })
})
