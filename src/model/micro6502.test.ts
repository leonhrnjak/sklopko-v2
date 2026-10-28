import { describe, expect, it } from 'vitest'
import { assemble6502 } from '../engine/asm6502'
import { cycle as stepCore, newCpu, reset } from '../engine/cpu6502'
import { MICRO_OPCODES } from '../engine/micro6502'
import { BY_OPCODE_6502, OPCODES_6502 } from '../engine/opcodes6502'
import { Simulator } from '../engine/simulator'
import { toNum } from '../engine/types'
import { flatten } from './buses'
import { micro6502, micro6502Builder } from './micro6502'

const hex = (bytes: number[]) => bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')

/** The circuit, not routed (the simulation does not need the wires' paths), ready to run: the reset button is not pressed yet. */
function start(rom: number[]) {
  const { b, keys } = micro6502Builder({ hz: 100, rom: hex(rom) })
  const sim = new Simulator()
  sim.load(flatten(b.c))
  sim.settle()
  const bits = (id: string, prefix: string, n: number) => toNum(Array.from({ length: n }, (_, i) => sim.pinValue(keys[id], `${prefix}${i}`)), 0, n)
  const m = {
    sim,
    keys,
    /** One whole clock cycle: the clock rises (every register loads) and falls. */
    cycle() {
      sim.stepClock()
      sim.stepClock()
    },
    reg: (id: string) => bits(id, 'Q', 8),
    addr: () => bits('abus', 'Y', 16),
    result: () => bits('result', 'Y', 8),
    sync: () => sim.pinValue(keys.sync, 'A'),
    writing: () => sim.pinValue(keys.writing, 'A'),
    pc: () => m.reg('PCL') | (m.reg('PCH') << 8),
    press(down: boolean) {
      sim.setState(keys.reset, { pressed: down })
      sim.settle()
    },
  }
  return m
}

/** A program in 6502 assembly, as the bytes of the ROM from $F000. */
function assembled(source: string): number[] {
  const r = assemble6502(source, 0x1000)
  expect(r.errors).toEqual([])
  return r.bytes
}

/** A ROM image of 4 KB with `bytes` at $F000 and the reset vector at $F000. */
function image(bytes: number[]) {
  const rom = new Array<number>(0x1000).fill(0xea)
  bytes.forEach((v, i) => (rom[i] = v))
  rom[0xffc] = 0x00
  rom[0xffd] = 0xf0
  return rom
}

/** The 6502 core, with the board's memory map, to run next to the circuit. */
function reference(rom: number[]) {
  const ram = new Uint8Array(0x800)
  const leds: number[] = []
  const cpu = newCpu()
  cpu.sp = 0 // the circuit's stack pointer starts at 0, and the reset counts it down three times
  cpu.p = 0x20 // ... and its interrupt-disable flag is set by the reset sequence
  reset(cpu)
  return {
    cpu,
    leds,
    ram,
    step() {
      let d = 0
      if (cpu.read) d = cpu.addr & 0x8000 ? rom[cpu.addr & 0xfff] : ram[cpu.addr & 0x7ff]
      else if (cpu.addr < 0x4000) ram[cpu.addr & 0x7ff] = cpu.out
      else if (cpu.addr < 0x8000) leds.push(cpu.out)
      stepCore(cpu, d)
    },
  }
}

describe('the 6502 built from parts', () => {
  it('is a circuit that builds and routes', () => {
    const c = micro6502()
    expect(Object.keys(c.comps).length).toBeGreaterThan(100)
    expect(Object.values(c.comps).filter((k) => k.type === 'rom')).toHaveLength(5)
  })

  it('has microcode for every one of the 151 documented opcodes', () => {
    expect(MICRO_OPCODES).toHaveLength(151)
    expect(MICRO_OPCODES.sort()).toEqual(OPCODES_6502.map((o) => o.opcode).sort())
  })

  it('goes through the reset sequence on the bus as the core does, and starts at the vector', () => {
    const rom = image([0xa9, 0x42, 0xea]) // LDA #$42; NOP
    const m = start(rom)
    const ref = reference(rom)
    for (let n = 0; n < 12; n++) {
      expect(m.addr(), `cycle ${n}`).toBe(ref.cpu.addr)
      expect(m.writing(), `cycle ${n}`).toBe(ref.cpu.read ? 0 : 1)
      expect(m.sync(), `cycle ${n}`).toBe(ref.cpu.sync ? 1 : 0)
      ref.step()
      m.cycle()
    }
    expect(m.reg('A')).toBe(0x42)
    expect(m.reg('SP')).toBe(0xfd)
  })
})

// ---- Random programs, cycle for cycle against the core -----------------------------------------------

/** A small deterministic random generator. */
function prng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** How many bytes an opcode takes. */
const length = (op: number) => BY_OPCODE_6502[op]!.bytes

/**
 * The opcodes random programs are made of. Left to tests by hand: the ones whose target is wherever the stack or a pointer says
 * (JMP indirect, JSR, RTS, BRK, RTI), PLP (it can load the decimal flag) and SED, since decimal arithmetic is not built yet.
 */
const BY_HAND = [0x6c, 0x20, 0x60, 0x00, 0x40, 0x28, 0xf8]
const RANDOM_OPCODES = MICRO_OPCODES.filter((op) => !BY_HAND.includes(op))

/** A program of random instructions (all of them ones the part has): branches and jumps land on the start of an instruction. */
function randomProgram(seed: number, count: number): number[] {
  const rnd = prng(seed)
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
  const ops = Array.from({ length: count }, () => pick(RANDOM_OPCODES))
  const at: number[] = []
  let pos = 0
  for (const op of ops) {
    at.push(pos)
    pos += length(op)
  }
  const bytes: number[] = []
  ops.forEach((op, i) => {
    const n = length(op)
    bytes.push(op)
    if (op === 0x4c) {
      const to = 0xf000 + at[Math.floor(rnd() * count)]
      bytes.push(to & 255, to >> 8)
    } else if (BY_OPCODE_6502[op]!.mode === 'rel') {
      // Mostly a near target (so that the loops are short and the branches both taken and not), sometimes the very next instruction.
      const to = at[Math.max(0, Math.min(count - 1, i + Math.floor(rnd() * 9) - 4))]
      const off = to - (at[i] + 2)
      bytes.push((off >= -128 && off <= 127 ? off : 0) & 255)
    } else {
      for (let k = 1; k < n; k++) bytes.push(Math.floor(rnd() * 256))
    }
  })
  // The branches' offsets were worked out from the addresses above, which the lengths fixed: check the program is as long as planned.
  expect(bytes.length).toBe(pos)
  return bytes
}

/**
 * Run the circuit and the core side by side from reset, for `cycles` clocks. In every cycle the address bus, R/W, SYNC and (when it
 * writes) the data must be the core's, and after every cycle so must the registers. Returns what ran, to see that a test covered something.
 */
function lockstep(rom: number[], cycles: number, label: string) {
  const m = start(rom)
  const ref = reference(rom)
  const ops = new Set<number>()
  let writes = 0
  let crossed = 0
  for (let n = 0; n < cycles; n++) {
    const c = ref.cpu
    const here = `${label}, cycle ${n}`
    expect(m.addr(), here).toBe(c.addr)
    expect(m.writing(), here).toBe(c.read ? 0 : 1)
    expect(m.sync(), here).toBe(c.sync ? 1 : 0)
    if (!c.read) {
      expect(m.result(), here).toBe(c.out)
      writes++
    }
    ref.step()
    m.cycle()
    expect([m.reg('A'), m.reg('X'), m.reg('Y'), m.reg('SP')], here).toEqual([c.a, c.x, c.y, c.sp])
    // The flags and the program counter are compared between instructions: inside one, the circuit may update them a cycle earlier or
    // later than the core does (a read-modify-write sets its flags as it writes the new value, the core as it writes the old one).
    if (c.sync) expect([m.reg('P'), m.pc()], here).toEqual([c.p, c.pc])
    if (c.prog >= 0 && c.prog < 256) {
      ops.add(c.op)
      if (c.cross && ['abx', 'aby', 'izy'].includes(BY_OPCODE_6502[c.op]!.mode)) crossed++
    }
  }
  return { ops, writes, crossed }
}

describe('the 6502 built from parts, against the core', () => {
  // Every kind of instruction, each one many times over, with random operands.
  it('runs random programs cycle for cycle, and covers every opcode it has', () => {
    const seen = new Set<number>()
    let crossed = 0
    for (let seed = 1; seed <= 30; seed++) {
      const r = lockstep(image(randomProgram(seed, 200)), 2500, `seed ${seed}`)
      r.ops.forEach((op) => seen.add(op))
      crossed += r.crossed
    }
    expect(crossed).toBeGreaterThan(50) // indexed accesses that crossed a page, with their extra cycle
    expect(RANDOM_OPCODES.filter((op) => !seen.has(op)).map((op) => op.toString(16))).toEqual([])
  }, 60_000)

  it('takes a branch across a page boundary in four cycles, forwards and backwards', () => {
    // At $F0FC: BNE +8 (taken, from $F0FE to $F106, into the next page); there: BNE -12 (to $F0FA, into the one before).
    const program = new Array<number>(0x200).fill(0xea)
    const put = (at: number, ...bytes: number[]) => bytes.forEach((v, i) => (program[at + i] = v))
    put(0, 0xa2, 0x01, 0x4c, 0xfc, 0xf0) // LDX #1 (the zero flag is clear); JMP $F0FC
    put(0xfc, 0xd0, 0x08) // BNE $F106
    put(0x106, 0xd0, 0xf4) // BNE $F0FC: -12 from $F108 is $F0FC (and the flag is still clear)
    const r = lockstep(image([]).map((v, i) => program[i] ?? v), 120, 'page crossing')
    expect(r.ops.has(0xd0)).toBe(true)
  })

  it('does JMP (indirect) as the NMOS chip does: a pointer at the end of a page takes its high byte from the start of the same page', () => {
    const bytes = assembled(
      `.org $F000
        LDA #$20
        STA $02FF      ; the pointer's low byte, at the end of a page
        LDA #$F0
        STA $0200      ; its high byte, where the chip looks (the start of the same page)
        LDA #$F1
        STA $0300      ; and where a chip without the bug would look
        JMP ($02FF)
.org $F020
        LDX #$77
        INX
        JMP ($02FF)
.org $F120
        LDX #$99`,
    )
    const rom = image(bytes)
    const r = lockstep(rom, 120, 'jmp indirect')
    expect(r.ops.has(0x6c)).toBe(true)
  })

  it('calls a subroutine and returns, nests calls, and keeps the stack as the core does', () => {
    const bytes = assembled(
      `.org $F000
        LDX #$FF
        TXS
        LDA #$05
        JSR double
        JSR double
        PHA
        PHP
        LDA #$00
        PLP
        PLA
        TSX
        JMP end
double: ASL A
        PHA
        JSR bump
        PLA
        RTS
bump:   INX
        RTS
end:    NOP
        BIT $0000
        LDA #$C0
        STA $10
        BIT $10
        CLV
        SEI
        CLI
        SED
        CLD
        JMP end`,
    )
    const r = lockstep(image(bytes), 400, 'stack')
    expect([0x20, 0x60, 0x48, 0x08, 0x68, 0x28, 0xba, 0x24, 0xb8, 0x78, 0x58, 0xf8, 0xd8].filter((op) => !r.ops.has(op))).toEqual([])
  })

  it('takes a BRK through the interrupt vector and comes back with RTI, flags and all', () => {
    const bytes = assembled(
      `.org $F000
        LDX #$FF
        TXS
        SEC
        LDA #$80
        BRK
        .byte $EA      ; the byte after BRK is skipped
        LDX #$11
        JMP $F000
handler: PLA           ; the flags that were pushed, with the break flag
        ORA #$41       ; (a plain program that changes them before it returns)
        PHA
        LDY #$22
        RTI
.org $FFFC
        .word $F000
        .word handler`,
    )
    const r = lockstep(image(bytes), 300, 'brk')
    expect(r.ops.has(0x00) && r.ops.has(0x40)).toBe(true)
  })

  it('runs the demo program: the LEDs count in threes up to 63, and the RAM keeps the count', () => {
    const { b, keys } = micro6502Builder({ hz: 100 })
    const sim = new Simulator()
    sim.load(flatten(b.c))
    sim.settle()
    const led = () => toNum(Array.from({ length: 8 }, (_, i) => sim.pinValue(keys.ledReg, `Q${i}`)), 0, 8)
    const shown: number[] = []
    for (let n = 0; n < 600; n++) {
      sim.stepClock()
      sim.stepClock()
      if (shown[shown.length - 1] !== led() && led() !== 0) shown.push(led())
    }
    expect(shown.slice(0, 21)).toEqual(Array.from({ length: 21 }, (_, i) => 3 * (i + 1)))
    // ... and then it starts again.
    expect(shown[21]).toBe(3)
  })

  it('starts over when the Reset button is pressed: the vector is read again and the program begins at the top', () => {
    const m = start(image([0xa9, 0x01, 0x4c, 0x00, 0xf0]))
    for (let n = 0; n < 40; n++) m.cycle() // LDA #1; JMP $F000; LDA #1...
    m.press(true)
    m.cycle()
    m.press(false)
    const seen: [number, number][] = []
    for (let n = 0; n < 8; n++) {
      seen.push([m.addr(), m.sync()])
      m.cycle()
    }
    expect(seen.slice(5)).toEqual([[0xfffc, 0], [0xfffd, 0], [0xf000, 1]])
  })
})
