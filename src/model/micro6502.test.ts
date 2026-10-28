import { describe, expect, it } from 'vitest'
import { assemble6502 } from '../engine/asm6502'
import { cycle as stepCore, newCpu, reset, setIrq, setNmi } from '../engine/cpu6502'
import { MICRO_OPCODES, microRows } from '../engine/micro6502'
import { BY_OPCODE_6502, OPCODES_6502 } from '../engine/opcodes6502'
import { Simulator } from '../engine/simulator'
import { toNum } from '../engine/types'
import { flatten } from './buses'
import { boundsRect } from './circuit'
import { micro6502, micro6502Basic, micro6502Builder } from './micro6502'

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

  it('has notes that explain each section, and none of them lies on a part, a frame or another note', () => {
    for (const [name, c] of [['LED board', micro6502()], ['BASIC board', micro6502Basic()]] as const) {
      const comps = Object.values(c.comps)
      const notes = comps.filter((k) => k.type === 'note')
      expect(notes.length, name).toBeGreaterThan(14)
      // A note about one part is joined to it by a letter: "(a)" starts the note and the labels of the parts it explains.
      for (const letter of ['a', 'b', 'c', 'd', 'e', 'f']) {
        expect(notes.some((k) => String(k.params.text).startsWith(`(${letter}) `)), `${name}: note (${letter})`).toBe(true)
        expect(comps.some((k) => k.type !== 'note' && (k.label ?? '').startsWith(`(${letter}) `)), `${name}: parts of note (${letter})`).toBe(true)
      }
      const others = comps // (the frames too: a note stands above the frame of its section)
      const touch = (a: ReturnType<typeof boundsRect>, b: ReturnType<typeof boundsRect>) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
      // (A frame that holds the whole note is fine: the grey frames of the CPU and the board hold their sections and their notes.)
      const inside = (a: ReturnType<typeof boundsRect>, b: ReturnType<typeof boundsRect>) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h
      for (const n of notes)
        for (const k of others)
          if (k !== n && !(k.type === 'frame' && inside(boundsRect(n), boundsRect(k))))
            expect(touch(boundsRect(n), boundsRect(k)), `${name}: the note "${String(n.params.text).slice(0, 30)}…" is on ${k.type} ${k.label ?? k.id}`).toBe(false)
    }
  }, 60_000)

  it('keeps the CPU and the board apart: the CPU is one grey frame, the memory, clock and devices another, and they do not touch', () => {
    for (const [name, c] of [['LED board', micro6502()], ['BASIC board', micro6502Basic()]] as const) {
      const comps = Object.values(c.comps)
      const frames = comps.filter((k) => k.type === 'frame' && k.params.color === 'grey')
      const cpu = frames.find((f) => String(f.params.title).startsWith('THE 6502 CPU'))!
      const board = frames.find((f) => String(f.params.title).startsWith('THE BOARD'))!
      expect(cpu && board, name).toBeTruthy()
      const a = boundsRect(cpu)
      const b = boundsRect(board)
      expect(a.x + a.w, `${name}: room between the frames`).toBeLessThan(b.x - 200)
      const inFrame = (k: (typeof comps)[number], f: ReturnType<typeof boundsRect>) => boundsRect(k).x >= f.x && boundsRect(k).x + boundsRect(k).w <= f.x + f.w
      for (const k of comps) {
        if (['rom', 'ram', 'clock', 'button', 'led', 'bar', 'acia6551'].includes(k.type) && !(k.label ?? '').startsWith('Microcode')) expect(inFrame(k, b) && !inFrame(k, a), `${name}: ${k.type} ${k.label} is on the board`).toBe(true)
        if (['dff', 'busctr', 'busadd', 'busgate'].includes(k.type)) expect(inFrame(k, a) && !inFrame(k, b), `${name}: ${k.type} ${k.label} is in the CPU`).toBe(true)
      }
      // No wire runs from one to the other: what joins them is the named nets.
      for (const w of Object.values(c.wires)) {
        const ends = [w.from.comp, w.to.comp].map((id) => c.comps[id])
        const side = (k: (typeof comps)[number]) => (inFrame(k, a) ? 'cpu' : inFrame(k, b) ? 'board' : 'between')
        expect(new Set(ends.map(side)).has('cpu') && new Set(ends.map(side)).has('board'), `${name}: a wire from ${ends[0].type} ${ends[0].label ?? ''} to ${ends[1].type} ${ends[1].label ?? ''}`).toBe(false)
      }
      // The pins between them are nets with names, each with a Send label on the CPU's side and a Receive label on the board's.
      for (const pin of ['ADDRESS', 'R', 'DI', 'RWB', 'SYNC', 'PHI2', 'RES', 'IRQB', 'NMIB']) {
        const named = comps.filter((k) => (k.type === 'netsend' || k.type === 'netrecv') && k.params.name === pin)
        expect(named.some((k) => k.type === 'netsend'), `${name}: pin ${pin} is sent`).toBe(true)
        expect(named.some((k) => k.type === 'netrecv'), `${name}: pin ${pin} is received`).toBe(true)
      }
    }
  }, 60_000)

  it('lists the rows of an instruction: the fetch, then its cycles', () => {
    expect(microRows(0xa9)).toHaveLength(2) // LDA #: fetch, read the constant
    expect(microRows(0xbd)).toHaveLength(5) // LDA abs,X: fetch, two address bytes, the read before the fix, the read after it
    expect(microRows(0xbd)[0].FETCH).toBe(true)
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
 * (JMP indirect, JSR, RTS, BRK, RTI). SED and PLP are in: with the decimal flag set, ADC and SBC work on decimal digits.
 */
const BY_HAND = [0x6c, 0x20, 0x60, 0x00, 0x40]
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
function lockstep(rom: number[], cycles: number, label: string, pins?: (n: number) => { irq: boolean; nmi: boolean }) {
  const m = start(rom)
  const ref = reference(rom)
  const ops = new Set<number>()
  let writes = 0
  let crossed = 0
  const taken = { irq: 0, nmi: 0 }
  for (let n = 0; n < cycles; n++) {
    const c = ref.cpu
    const here = `${label}, cycle ${n}`
    if (pins) {
      // The buttons hold IRQ and NMI low for this cycle; the core is told the same before the cycle ends.
      const { irq, nmi } = pins(n)
      m.sim.setState(m.keys.irqButton, { pressed: irq })
      m.sim.setState(m.keys.nmiButton, { pressed: nmi })
      m.sim.settle()
      setIrq(c, irq)
      setNmi(c, nmi)
    }
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
    if (c.prog === 256 && c.t === 0) taken[c.vec === 0xfffa ? 'nmi' : 'irq']++
    if (c.prog >= 0 && c.prog < 256) {
      ops.add(c.op)
      if (c.cross && ['abx', 'aby', 'izy'].includes(BY_OPCODE_6502[c.op]!.mode)) crossed++
    }
  }
  return { ops, writes, crossed, taken }
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

  // Decimal mode: ADC and SBC on many pairs of bytes, valid decimal digits and not, with and without a carry in. The registers at every
  // opcode fetch (A, and the flags N V Z C) must be the core's.
  it('adds and subtracts decimal digits as the core does, with the flags of the NMOS chip', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const rnd = prng(seed * 104729)
      const digit = () => (rnd() < 0.6 ? Math.floor(rnd() * 10) : Math.floor(rnd() * 16))
      const byte = () => (digit() << 4) | digit()
      const bytes = [0xf8] // SED
      for (let i = 0; i < 280; i++) {
        const sub = rnd() < 0.5
        bytes.push(0xa9, byte(), rnd() < 0.5 ? 0x18 : 0x38, sub ? 0xe9 : 0x69, byte(), 0x85, 0x20) // LDA #a; CLC or SEC; SBC or ADC #m; STA $20
      }
      bytes.push(0x4c, 0x00 + bytes.length & 255, 0xf0 + (bytes.length >> 8)) // done: stay here
      lockstep(image(bytes), 280 * 9 + 40, `decimal seed ${seed}`)
    }
  }, 120_000)

  // Interrupts: pins held low for a few cycles at random, while random programs run; the vectors lead to short handlers.
  it('takes IRQ and NMI exactly as the core does, whatever the program is doing', () => {
    const IRQ_AT = 0xf800
    const NMI_AT = 0xf820
    const withHandlers = (bytes: number[]) => {
      const rom = image(bytes)
      const irq = assembled('.org $F800\n INC $10\n RTI')
      const nmi = assembled('.org $F820\n INC $11\n RTI')
      irq.slice(0x800).forEach((v, i) => (rom[0x800 + i] = v))
      nmi.slice(0x820).forEach((v, i) => (rom[0x820 + i] = v))
      // The reset vector leads to CLI and a jump to the program, so that IRQ can be taken (the reset sets I).
      ;[0x58, 0x4c, 0x00, 0xf0].forEach((v, i) => (rom[0x7f0 + i] = v))
      rom[0xffc] = 0xf0
      rom[0xffd] = 0xf7
      rom[0xffe] = IRQ_AT & 255
      rom[0xfff] = IRQ_AT >> 8
      rom[0xffa] = NMI_AT & 255
      rom[0xffb] = NMI_AT >> 8
      return rom
    }
    let irqs = 0
    let nmis = 0
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = prng(seed * 7919)
      let irqLeft = 0
      let nmiLeft = 0
      // (Not while the reset sequence runs: the circuit forgets an NMI seen then, the core's model keeps it.)
      const r = lockstep(withHandlers(randomProgram(seed, 150)), 2500, `seed ${seed}`, (n) => {
        if (n < 8) return { irq: false, nmi: false }
        if (irqLeft === 0 && rnd() < 1 / 40) irqLeft = 1 + Math.floor(rnd() * 6)
        if (nmiLeft === 0 && rnd() < 1 / 90) nmiLeft = 1 + Math.floor(rnd() * 4)
        const pins = { irq: irqLeft > 0, nmi: nmiLeft > 0 }
        irqLeft = Math.max(0, irqLeft - 1)
        nmiLeft = Math.max(0, nmiLeft - 1)
        return pins
      })
      irqs += r.taken.irq
      nmis += r.taken.nmi
    }
    expect(irqs, 'IRQs taken').toBeGreaterThan(20)
    expect(nmis, 'NMIs taken').toBeGreaterThan(20)
  }, 120_000)

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
