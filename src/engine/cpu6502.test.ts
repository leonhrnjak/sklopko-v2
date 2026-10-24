import { describe, expect, it } from 'vitest'
import { cycle, FLAG, newCpu, reset, runInstruction, setIrq, setNmi, type Cpu6502 } from './cpu6502'
import { disassemble6502 } from './disasm6502'
import { modesOf6502, opcodeOf6502 } from './asm6502'
import { BY_OPCODE_6502, OPCODES_6502 } from './opcodes6502'
import vectors from './testdata/6502-singlestep.json'

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

/** A CPU at an opcode fetch with `state`, over a 64 KB memory. */
function setup(state: State) {
  const c = newCpu()
  Object.assign(c, { pc: state.pc, sp: state.s, a: state.a, x: state.x, y: state.y, p: state.p })
  c.prog = -1
  c.sync = true
  c.read = true
  c.addr = c.pc
  const mem = new Uint8Array(65536)
  for (const [addr, v] of state.ram) mem[addr] = v
  return { c, mem }
}

describe('opcode table', () => {
  it('has the 151 documented opcodes, each once', () => {
    expect(OPCODES_6502).toHaveLength(151)
    expect(new Set(OPCODES_6502.map((o) => o.opcode)).size).toBe(151)
    expect(BY_OPCODE_6502.filter(Boolean)).toHaveLength(151)
  })

  it('looks opcodes up by mnemonic and mode', () => {
    expect(opcodeOf6502('lda', 'imm')).toBe(0xa9)
    expect(opcodeOf6502('STA', 'imm')).toBeUndefined()
    expect(modesOf6502('JMP')).toEqual(['abs', 'ind'])
  })

  it('knows the lengths and cycles of familiar instructions', () => {
    const at = (op: number) => BY_OPCODE_6502[op]!
    expect([at(0xa9).bytes, at(0xa9).cycles]).toEqual([2, 2])
    expect([at(0x8d).bytes, at(0x8d).cycles]).toEqual([3, 4])
    expect([at(0x9d).bytes, at(0x9d).cycles]).toEqual([3, 5])
    expect([at(0xbd).bytes, at(0xbd).cycles, at(0xbd).pageCross]).toEqual([3, 4, true])
    expect([at(0xfe).bytes, at(0xfe).cycles]).toEqual([3, 7])
    expect([at(0x20).bytes, at(0x20).cycles]).toEqual([3, 6])
    expect([at(0x00).bytes, at(0x00).cycles]).toEqual([1, 7])
  })

  it('disassembles', () => {
    expect(disassemble6502([0xa9, 0x10])).toEqual({ text: 'LDA #$10', length: 2 })
    expect(disassemble6502([0xb1, 0x20]).text).toBe('LDA ($20),Y')
    expect(disassemble6502([0x6c, 0x34, 0x12]).text).toBe('JMP ($1234)')
    expect(disassemble6502([0xd0, 0xfe], 0x8000).text).toBe('BNE $8000')
    expect(disassemble6502([0x02]).text).toBe('? $02')
  })
})

describe('SingleStepTests (a sample of every documented opcode)', () => {
  for (const [hex, cases] of Object.entries(vectors as unknown as Record<string, Vector[]>)) {
    it(`opcode ${hex}: ${BY_OPCODE_6502[parseInt(hex, 16)]!.mnemonic} ${BY_OPCODE_6502[parseInt(hex, 16)]!.mode}`, () => {
      for (const [name, initial, final, cycles] of cases) {
        const { c, mem } = setup(initial)
        const trace: [number, number, string][] = []
        // One instruction: cycle by cycle, with the bus recorded.
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

/** Run `code` at `$0200`, with the reset vector pointing there, until `done` or `limit` cycles. */
function machine(code: number[], vectors: Record<number, number> = {}) {
  const mem = new Uint8Array(65536)
  mem.set(code, 0x200)
  mem[0xfffc] = 0x00
  mem[0xfffd] = 0x02
  for (const [addr, target] of Object.entries(vectors)) {
    mem[+addr] = target & 255
    mem[+addr + 1] = target >> 8
  }
  const c = newCpu()
  reset(c)
  const step = () => {
    const d = c.read ? mem[c.addr] : ((mem[c.addr] = c.out), 0)
    cycle(c, d)
  }
  /** Cycles until the CPU is about to fetch the opcode at `pc` (SYNC high with the PC there). */
  const runTo = (pc: number, limit = 100000) => {
    let n = 0
    while (!(c.sync && c.addr === pc) && n++ < limit) step()
    expect(n, `ran out of cycles looking for $${pc.toString(16)}`).toBeLessThan(limit)
    return n
  }
  return { c, mem, step, runTo }
}

describe('reset', () => {
  it('takes 7 cycles, lowers the stack pointer by 3, sets I and loads PC from $FFFC', () => {
    const { c, step } = machine([0xea])
    c.sp = 0xff
    const trace: number[] = []
    for (let i = 0; i < 7; i++) {
      trace.push(c.addr)
      step()
    }
    expect(trace.slice(2)).toEqual([0x1ff, 0x1fe, 0x1fd, 0xfffc, 0xfffd])
    expect(c.sync).toBe(true)
    expect(c.pc).toBe(0x200)
    expect(c.sp).toBe(0xfc)
    expect(c.p & FLAG.I).toBe(FLAG.I)
    expect(c.cycles).toBe(7)
  })
})

describe('programs', () => {
  it('sums 1 to 10 with a loop', () => {
    // LDX #10; LDA #0; loop: CLC; ADC #1?? no: add X; DEX; BNE loop; STA $10; BRK
    const { c, mem, runTo } = machine([0xa2, 10, 0xa9, 0, /*loop*/ 0x86, 0x20, 0x18, 0x65, 0x20, 0xca, 0xd0, 0xf8, 0x85, 0x10, 0x00])
    runTo(0x20e)
    expect(mem[0x10]).toBe(55)
    expect(c.x).toBe(0)
  })

  it('JSR and RTS come back to the instruction after the call', () => {
    // 200: JSR $0210; 203: LDX #7; 205: BRK    210: LDA #42; RTS
    const code = new Array(0x20).fill(0xea)
    code.splice(0, 6, 0x20, 0x10, 0x02, 0xa2, 7, 0x00)
    code.splice(0x10, 3, 0xa9, 42, 0x60)
    const { c, runTo } = machine(code)
    runTo(0x205)
    expect([c.a, c.x, c.sp]).toEqual([42, 7, 0xfa])
  })

  it('BRK pushes PC + 2 and the flags with B set, and RTI returns', () => {
    // 200: LDA #1; 202: BRK; 203: (padding byte); 204: LDX #5     handler at 0300: LDY #9; RTI
    const code = [0xa9, 1, 0x00, 0xff, 0xa2, 5]
    const { c, mem, runTo } = machine(code, { 0xfffe: 0x300 })
    mem.set([0xa0, 9, 0x40], 0x300)
    runTo(0x300)
    const sp = c.sp // after the three pushes
    expect(mem[0x100 + sp + 3]).toBe(0x02)
    expect(mem[0x100 + sp + 2]).toBe(0x04)
    expect(mem[0x100 + sp + 1] & FLAG.B).toBe(FLAG.B)
    expect(c.p & FLAG.I).toBe(FLAG.I)
    runTo(0x204)
    expect(c.y).toBe(9)
    expect(c.sp).toBe(sp + 3)
  })

  it('takes an IRQ only when I is clear, and pushes B = 0', () => {
    const { c, mem, runTo } = machine([0xea, 0x58, 0xea, 0xea], { 0xfffe: 0x300 }) // NOP; CLI; NOP; NOP
    mem.set([0xe8, 0x40], 0x300) // INX; RTI
    runTo(0x200) // reset done: I is set
    setIrq(c, true)
    runTo(0x202) // NOP and CLI ran; the IRQ was ignored while I was set
    expect(c.pc).toBe(0x202)
    runTo(0x300) // I is clear now: the IRQ is taken instead of the next opcode
    expect(mem[0x100 + c.sp + 1] & FLAG.B).toBe(0)
    expect(c.p & FLAG.I).toBe(FLAG.I)
    setIrq(c, false)
    runTo(0x202) // INX, RTI: back at the instruction that was interrupted
    expect(c.x).toBe(1)
  })

  it('takes an NMI on the falling edge even when I is set, once', () => {
    const { c, runTo } = machine([0xea, 0xea, 0xea, 0xea], { 0xfffa: 0x300 })
    runTo(0x200)
    setNmi(c, true)
    runTo(0x300)
    // The pin is still low: no second NMI. Releasing it and pulling it again gives one.
    expect(c.nmiPending).toBe(false)
    setNmi(c, false)
    setNmi(c, true)
    expect(c.nmiPending).toBe(true)
  })

  it('JMP ($12FF) reads its high byte from $1200, not $1300', () => {
    const { c, mem, runTo } = machine([0x6c, 0xff, 0x12])
    mem[0x12ff] = 0x34
    mem[0x1200] = 0x03
    mem[0x1300] = 0x99
    runTo(0x334)
    expect(c.pc).toBe(0x334)
  })

  it('decimal mode adds and subtracts BCD', () => {
    // SED; SEC? no: CLC; LDA #$19; ADC #$28 -> $47. SEC; SBC #$13 -> $34.
    const { c, runTo } = machine([0xf8, 0x18, 0xa9, 0x19, 0x69, 0x28, 0x85, 0x00, 0x38, 0xe9, 0x13, 0xea])
    runTo(0x208)
    expect(c.a).toBe(0x47)
    runTo(0x20b)
    expect(c.a).toBe(0x34)
    expect(c.p & FLAG.C).toBe(FLAG.C)
  })

  it('an undocumented opcode is a two-cycle, one-byte NOP', () => {
    const { c, mem } = machine([0x02, 0xea])
    c.prog = -1
    c.sync = true
    c.addr = c.pc = 0x200
    expect(runInstruction(c as Cpu6502, mem)).toBe(2)
    expect(c.pc).toBe(0x201)
  })

  it('counts a branch as 2, 3 or 4 cycles', () => {
    const cycles = (code: number[], at: number, flags: number) => {
      const { c, mem } = machine([])
      mem.set(code, at)
      Object.assign(c, { prog: -1, sync: true, pc: at, addr: at, p: flags | FLAG.U })
      return runInstruction(c, mem)
    }
    expect(cycles([0xd0, 0x05], 0x300, FLAG.Z)).toBe(2) // BNE, not taken
    expect(cycles([0xd0, 0x05], 0x300, 0)).toBe(3) // taken, same page
    expect(cycles([0xd0, 0x7f], 0x3f0, 0)).toBe(4) // taken, into the next page
    expect(cycles([0xd0, 0x80], 0x300, 0)).toBe(4) // taken, back into the page before
  })
})
