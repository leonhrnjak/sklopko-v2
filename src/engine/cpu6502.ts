import { BY_OPCODE_6502, type Mode6502, type Opcode6502 } from './opcodes6502'

/**
 * The MOS 6502 as a cycle-exact model: no DOM, no simulator. One call of `cycle` is one clock, and in every clock the CPU does
 * one bus access, as the real chip does (including the dummy reads and writes). The numbers of cycles, the addresses and the
 * data on the bus in each clock follow the NMOS 6502; they are checked against the SingleStepTests vectors.
 *
 * How to drive it: the CPU says what is on its pins for the cycle it is in (`addr`, `read`, and `out` when it writes). The
 * caller does that access (for a read it looks up the byte) and calls `cycle(cpu, byte)`, which finishes the cycle and
 * sets up the pins for the next one. `sync` is true in the cycle that fetches an opcode.
 *
 *     const cpu = newCpu(); reset(cpu)
 *     for (;;) { const d = cpu.read ? mem[cpu.addr] : (mem[cpu.addr] = cpu.out, 0); cycle(cpu, d) }
 *
 * Not modelled: undocumented opcodes (they are a 2-cycle NOP of one byte), the exact cycle in which an interrupt line is
 * sampled (it is looked at when the next opcode fetch is set up), the 7-cycle interrupt "hijack" of a vector.
 */

/** Flag bits of the status register P. */
export const FLAG = { C: 1, Z: 2, I: 4, D: 8, B: 16, U: 32, V: 64, N: 128 } as const
const { C, Z, I, D, B, U, V, N } = FLAG

export interface Step {
  /** Put the cycle's access on the pins. */
  a(c: Cpu6502): void
  /** What the cycle does when it ends; `d` is the byte read (or 0 for a write). */
  e?(c: Cpu6502, d: number): void
}

export interface Cpu6502 {
  a: number
  x: number
  y: number
  sp: number
  pc: number
  /** The flags NV-BDIZC. Bit 5 is always 1 and bit 4 (B) is 0: it only exists in the copy pushed on the stack. */
  p: number
  // The pins, for the cycle the CPU is in.
  addr: number
  /** true: the CPU reads `addr`; false: it writes `out` there. */
  read: boolean
  out: number
  /** The cycle is the fetch of an opcode. */
  sync: boolean
  /** IRQ is asserted (the pin is low); a level. */
  irq: boolean
  /** NMI was asserted since the last one was taken (it is an edge). */
  nmiPending: boolean
  nmiPin: boolean
  // Inside.
  op: number
  /**
   * Which steps are being run: an opcode (0–255), `PROG_INTERRUPT` or `PROG_RESET`, or -1 in an opcode fetch. A number and not
   * the steps themselves, so that the state of the CPU is plain numbers (it is copied at every clock edge, for stepping back).
   */
  prog: number
  /** The step of that program that is now on the pins. */
  t: number
  /** What the opcode fetch about to happen will turn into, if an interrupt is waiting. */
  intr: 'irq' | 'nmi' | null
  /** The interrupt vector in use. */
  vec: number
  ea: number
  lo: number
  ptr: number
  val: number
  base: number
  cross: boolean
  off: number
  newpc: number
  /** The cycles done since the part was created or `reset` (for the inspector). */
  cycles: number
}

export function newCpu(): Cpu6502 {
  return {
    a: 0, x: 0, y: 0, sp: 0xfd, pc: 0, p: U | I,
    addr: 0, read: true, out: 0, sync: false,
    irq: false, nmiPending: false, nmiPin: false,
    op: 0, prog: -1, t: 0, intr: null, vec: 0xfffe, ea: 0, lo: 0, ptr: 0, val: 0, base: 0, cross: false, off: 0, newpc: 0, cycles: 0,
  }
}

const rd = (c: Cpu6502, addr: number) => {
  c.addr = addr & 0xffff
  c.read = true
}
const wr = (c: Cpu6502, addr: number, v: number) => {
  c.addr = addr & 0xffff
  c.read = false
  c.out = v & 255
}
const step = (a: Step['a'], e?: Step['e']): Step => ({ a, e })
const SKIP = 99

const setNZ = (c: Cpu6502, v: number) => {
  c.p = (c.p & ~(N | Z)) | (v & N) | (v & 255 ? 0 : Z)
}
const flag = (c: Cpu6502, f: number, on: boolean) => {
  c.p = on ? c.p | f : c.p & ~f
}
const push = (c: Cpu6502) => 0x100 | c.sp

// ---- Operations ----------------------------------------------------------------------------------

function adc(c: Cpu6502, m: number) {
  const a = c.a
  const cin = c.p & C
  const sum = a + m + cin
  if (c.p & D) {
    // NMOS decimal mode: Z comes from the binary sum, N and V from the half-corrected one (Bruce Clark's description).
    let al = (a & 15) + (m & 15) + cin
    if (al >= 10) al = ((al + 6) & 15) + 16
    const signed = (v: number) => ((v & 0xf0) ^ 0x80) - 0x80
    const ss = signed(a) + signed(m) + al
    let s = (a & 0xf0) + (m & 0xf0) + al
    flag(c, Z, (sum & 255) === 0)
    flag(c, N, (ss & 0x80) !== 0)
    flag(c, V, ss < -128 || ss > 127)
    if (s >= 0xa0) s += 0x60
    flag(c, C, s >= 0x100)
    c.a = s & 255
    return
  }
  flag(c, V, ((a ^ sum) & (m ^ sum) & 0x80) !== 0)
  flag(c, C, sum > 255)
  c.a = sum & 255
  setNZ(c, c.a)
}

function sbc(c: Cpu6502, m: number) {
  const a = c.a
  const cin = c.p & C
  const diff = a - m - (1 - cin)
  flag(c, V, ((a ^ m) & (a ^ diff) & 0x80) !== 0)
  flag(c, C, diff >= 0)
  setNZ(c, diff & 255)
  if (c.p & D) {
    // The flags above are the binary ones, as on the NMOS chip; only the result is corrected.
    let al = (a & 15) - (m & 15) + cin - 1
    if (al < 0) al = ((al - 6) & 15) - 16
    let r = (a & 0xf0) - (m & 0xf0) + al
    if (r < 0) r -= 0x60
    c.a = r & 255
    return
  }
  c.a = diff & 255
}

function compare(c: Cpu6502, r: number, m: number) {
  flag(c, C, r >= m)
  setNZ(c, (r - m) & 255)
}

/** Instructions that read a value (`d`) and do something with it. */
const READ_OPS: Record<string, (c: Cpu6502, d: number) => void> = {
  LDA: (c, d) => ((c.a = d), setNZ(c, d)),
  LDX: (c, d) => ((c.x = d), setNZ(c, d)),
  LDY: (c, d) => ((c.y = d), setNZ(c, d)),
  ADC: adc,
  SBC: sbc,
  AND: (c, d) => ((c.a &= d), setNZ(c, c.a)),
  ORA: (c, d) => ((c.a |= d), setNZ(c, c.a)),
  EOR: (c, d) => ((c.a ^= d), setNZ(c, c.a)),
  CMP: (c, d) => compare(c, c.a, d),
  CPX: (c, d) => compare(c, c.x, d),
  CPY: (c, d) => compare(c, c.y, d),
  BIT: (c, d) => {
    flag(c, Z, (c.a & d) === 0)
    flag(c, N, (d & 0x80) !== 0)
    flag(c, V, (d & 0x40) !== 0)
  },
}

/** Instructions that change a value in place (in memory, or in A): value in, value out. */
const RMW_OPS: Record<string, (c: Cpu6502, v: number) => number> = {
  ASL: (c, v) => {
    flag(c, C, (v & 0x80) !== 0)
    setNZ(c, (v << 1) & 255)
    return (v << 1) & 255
  },
  LSR: (c, v) => {
    flag(c, C, (v & 1) !== 0)
    setNZ(c, v >> 1)
    return v >> 1
  },
  ROL: (c, v) => {
    const r = ((v << 1) | (c.p & C)) & 255
    flag(c, C, (v & 0x80) !== 0)
    setNZ(c, r)
    return r
  },
  ROR: (c, v) => {
    const r = (v >> 1) | ((c.p & C) << 7)
    flag(c, C, (v & 1) !== 0)
    setNZ(c, r)
    return r
  },
  INC: (c, v) => {
    setNZ(c, (v + 1) & 255)
    return (v + 1) & 255
  },
  DEC: (c, v) => {
    setNZ(c, (v - 1) & 255)
    return (v - 1) & 255
  },
}

const STORE_OPS: Record<string, (c: Cpu6502) => number> = { STA: (c) => c.a, STX: (c) => c.x, STY: (c) => c.y }

/** Instructions that need no operand: they change registers or flags. */
const IMPLIED_OPS: Record<string, (c: Cpu6502) => void> = {
  INX: (c) => ((c.x = (c.x + 1) & 255), setNZ(c, c.x)),
  INY: (c) => ((c.y = (c.y + 1) & 255), setNZ(c, c.y)),
  DEX: (c) => ((c.x = (c.x - 1) & 255), setNZ(c, c.x)),
  DEY: (c) => ((c.y = (c.y - 1) & 255), setNZ(c, c.y)),
  TAX: (c) => ((c.x = c.a), setNZ(c, c.x)),
  TAY: (c) => ((c.y = c.a), setNZ(c, c.y)),
  TXA: (c) => ((c.a = c.x), setNZ(c, c.a)),
  TYA: (c) => ((c.a = c.y), setNZ(c, c.a)),
  TSX: (c) => ((c.x = c.sp), setNZ(c, c.x)),
  TXS: (c) => (c.sp = c.x),
  CLC: (c) => flag(c, C, false),
  SEC: (c) => flag(c, C, true),
  CLI: (c) => flag(c, I, false),
  SEI: (c) => flag(c, I, true),
  CLV: (c) => flag(c, V, false),
  CLD: (c) => flag(c, D, false),
  SED: (c) => flag(c, D, true),
  NOP: () => {},
}

const BRANCHES: Record<string, (c: Cpu6502) => boolean> = {
  BCC: (c) => !(c.p & C),
  BCS: (c) => !!(c.p & C),
  BNE: (c) => !(c.p & Z),
  BEQ: (c) => !!(c.p & Z),
  BPL: (c) => !(c.p & N),
  BMI: (c) => !!(c.p & N),
  BVC: (c) => !(c.p & V),
  BVS: (c) => !!(c.p & V),
}

// ---- The cycles of each instruction --------------------------------------------------------------

const rdPc = (c: Cpu6502) => rd(c, c.pc)
const incPc = (c: Cpu6502) => {
  c.pc = (c.pc + 1) & 0xffff
}
const dummyPc = step(rdPc)

/** Steps that find the operand's address (left in `ea`), for modes that have one. For an indexed mode also `base` (the address before a page crossing is fixed) and `cross`. */
function addressSteps(mode: Mode6502): Step[] {
  const zp = step(rdPc, (c, d) => (incPc(c), (c.ea = d)))
  const lo = step(rdPc, (c, d) => (incPc(c), (c.lo = d)))
  const abs = step(rdPc, (c, d) => (incPc(c), (c.ea = c.lo | (d << 8))))
  const indexed = (reg: 'x' | 'y') => (c: Cpu6502, hi: number) => {
    const sum = c.lo + c[reg]
    c.cross = sum > 255
    c.base = (hi << 8) | (sum & 255)
    c.ea = ((hi << 8) + sum) & 0xffff
  }
  switch (mode) {
    case 'zp':
      return [zp]
    case 'zpx':
      return [zp, step((c) => rd(c, c.ea), (c) => (c.ea = (c.ea + c.x) & 255))]
    case 'zpy':
      return [zp, step((c) => rd(c, c.ea), (c) => (c.ea = (c.ea + c.y) & 255))]
    case 'abs':
      return [lo, abs]
    case 'abx':
      return [lo, step(rdPc, (c, d) => (incPc(c), indexed('x')(c, d)))]
    case 'aby':
      return [lo, step(rdPc, (c, d) => (incPc(c), indexed('y')(c, d)))]
    case 'izx':
      return [
        step(rdPc, (c, d) => (incPc(c), (c.ptr = d))),
        step((c) => rd(c, c.ptr), (c) => (c.ptr = (c.ptr + c.x) & 255)),
        step((c) => rd(c, c.ptr), (c, d) => (c.lo = d)),
        step((c) => rd(c, (c.ptr + 1) & 255), (c, d) => (c.ea = c.lo | (d << 8))),
      ]
    case 'izy':
      return [
        step(rdPc, (c, d) => (incPc(c), (c.ptr = d))),
        step((c) => rd(c, c.ptr), (c, d) => (c.lo = d)),
        step((c) => rd(c, (c.ptr + 1) & 255), (c, d) => indexed('y')(c, d)),
      ]
    default:
      return []
  }
}

const isIndexed = (m: Mode6502) => m === 'abx' || m === 'aby' || m === 'izy'

/** The steps of one instruction after its opcode fetch. */
function program(o: Opcode6502): Step[] {
  const { mnemonic: m, mode } = o
  const stackPush = (value: (c: Cpu6502) => number) => step((c) => wr(c, push(c), value(c)), (c) => (c.sp = (c.sp - 1) & 255))
  const stackPull = (e: Step['e']) => step((c) => rd(c, push(c)), e)
  const pullSp = step((c) => rd(c, push(c)), (c) => (c.sp = (c.sp + 1) & 255))
  const vector = (lowAddr: (c: Cpu6502) => number) => [
    step((c) => rd(c, lowAddr(c)), (c, d) => (c.lo = d)),
    step((c) => rd(c, lowAddr(c) + 1), (c, d) => (c.pc = c.lo | (d << 8))),
  ]
  switch (m) {
    case 'PHA':
      return [dummyPc, stackPush((c) => c.a)]
    case 'PHP':
      return [dummyPc, stackPush((c) => c.p | B | U)]
    case 'PLA':
      return [dummyPc, pullSp, stackPull((c, d) => ((c.a = d), setNZ(c, d)))]
    case 'PLP':
      return [dummyPc, pullSp, stackPull((c, d) => (c.p = (d | U) & ~B))]
    case 'JMP':
      return mode === 'abs'
        ? [step(rdPc, (c, d) => (incPc(c), (c.lo = d))), step(rdPc, (c, d) => (c.pc = c.lo | (d << 8)))]
        : [
            step(rdPc, (c, d) => (incPc(c), (c.lo = d))),
            step(rdPc, (c, d) => (incPc(c), (c.ea = c.lo | (d << 8)))),
            step((c) => rd(c, c.ea), (c, d) => (c.lo = d)),
            // The 6502 does not carry into the high byte of the pointer: JMP ($12FF) reads $12FF and $1200.
            step((c) => rd(c, (c.ea & 0xff00) | ((c.ea + 1) & 255)), (c, d) => (c.pc = c.lo | (d << 8))),
          ]
    case 'JSR':
      return [
        step(rdPc, (c, d) => (incPc(c), (c.lo = d))),
        step((c) => rd(c, push(c))),
        stackPush((c) => c.pc >> 8),
        stackPush((c) => c.pc & 255),
        step(rdPc, (c, d) => (c.pc = c.lo | (d << 8))),
      ]
    case 'RTS':
      return [
        dummyPc,
        pullSp,
        step((c) => rd(c, push(c)), (c, d) => ((c.lo = d), (c.sp = (c.sp + 1) & 255))),
        step((c) => rd(c, push(c)), (c, d) => (c.pc = c.lo | (d << 8))),
        step(rdPc, incPc),
      ]
    case 'RTI':
      return [
        dummyPc,
        pullSp,
        step((c) => rd(c, push(c)), (c, d) => ((c.p = (d | U) & ~B), (c.sp = (c.sp + 1) & 255))),
        step((c) => rd(c, push(c)), (c, d) => ((c.lo = d), (c.sp = (c.sp + 1) & 255))),
        step((c) => rd(c, push(c)), (c, d) => (c.pc = c.lo | (d << 8))),
      ]
    case 'BRK':
      return [
        step(rdPc, incPc),
        stackPush((c) => c.pc >> 8),
        stackPush((c) => c.pc & 255),
        step((c) => wr(c, push(c), c.p | B | U), (c) => ((c.sp = (c.sp - 1) & 255), (c.p |= I))),
        ...vector(() => 0xfffe),
      ]
  }
  if (m in BRANCHES) {
    const taken = BRANCHES[m]
    return [
      step(rdPc, (c, d) => {
        incPc(c)
        if (taken(c)) c.off = d
        else c.t = SKIP
      }),
      // The offset is added to the low byte first; the high byte is fixed in one more cycle if that carried.
      step(rdPc, (c) => {
        c.newpc = (c.pc + (c.off < 128 ? c.off : c.off - 256)) & 0xffff
        c.cross = (c.newpc & 0xff00) !== (c.pc & 0xff00)
        c.pc = (c.pc & 0xff00) | (c.newpc & 255)
        if (!c.cross) c.t = SKIP
      }),
      step(rdPc, (c) => (c.pc = c.newpc)),
    ]
  }
  if (mode === 'imp') return [step(rdPc, IMPLIED_OPS[m])]
  if (mode === 'acc') return [step(rdPc, (c) => (c.a = RMW_OPS[m](c, c.a)))]
  if (mode === 'imm') return [step(rdPc, (c, d) => (incPc(c), READ_OPS[m](c, d)))]
  const address = addressSteps(mode)
  const indexed = isIndexed(mode)
  if (o.kind === 'read') {
    const op = READ_OPS[m]
    // An indexed read takes a cycle less when the address did not cross a page; the first access was at the right address.
    return indexed
      ? [...address, step((c) => rd(c, c.base), (c, d) => (c.cross ? undefined : (op(c, d), (c.t = SKIP)))), step((c) => rd(c, c.ea), (c, d) => op(c, d))]
      : [...address, step((c) => rd(c, c.ea), (c, d) => op(c, d))]
  }
  if (o.kind === 'write') {
    const value = STORE_OPS[m]
    return [...address, ...(indexed ? [step((c) => rd(c, c.base))] : []), step((c) => wr(c, c.ea, value(c)))]
  }
  // Read-modify-write: read, write the old value back (the chip does), write the new one.
  const fn = RMW_OPS[m]
  return [
    ...address,
    ...(mode === 'abx' ? [step((c) => rd(c, c.base))] : []),
    step((c) => rd(c, c.ea), (c, d) => (c.val = d)),
    step((c) => wr(c, c.ea, c.val), (c) => (c.val = fn(c, c.val))),
    step((c) => wr(c, c.ea, c.val)),
  ]
}

/** Opcodes that are not documented act as a one-byte, two-cycle NOP. */
const OPCODE_PROGRAMS: Step[][] = Array.from({ length: 256 }, (_, op) => {
  const o = BY_OPCODE_6502[op]
  return o ? program(o) : [dummyPc]
})

export const PROG_INTERRUPT = 256
export const PROG_RESET = 257

/** Seven cycles that push the return address and the flags, then jump through a vector. `B` is 0 for an interrupt. */
const INTERRUPT: Step[] = [
  dummyPc,
  step((c) => wr(c, push(c), c.pc >> 8), (c) => (c.sp = (c.sp - 1) & 255)),
  step((c) => wr(c, push(c), c.pc & 255), (c) => (c.sp = (c.sp - 1) & 255)),
  step((c) => wr(c, push(c), (c.p | U) & ~B), (c) => ((c.sp = (c.sp - 1) & 255), (c.p |= I))),
  step((c) => rd(c, c.vec), (c, d) => (c.lo = d)),
  step((c) => rd(c, c.vec + 1), (c, d) => (c.pc = c.lo | (d << 8))),
]

/** The reset sequence: like an interrupt, but nothing is written (the stack pointer still goes down three times). */
const RESET: Step[] = [
  dummyPc,
  dummyPc,
  step((c) => rd(c, push(c)), (c) => (c.sp = (c.sp - 1) & 255)),
  step((c) => rd(c, push(c)), (c) => (c.sp = (c.sp - 1) & 255)),
  step((c) => rd(c, push(c)), (c) => ((c.sp = (c.sp - 1) & 255), (c.p |= I))),
  step((c) => rd(c, 0xfffc), (c, d) => (c.lo = d)),
  step((c) => rd(c, 0xfffd), (c, d) => (c.pc = c.lo | (d << 8))),
]

const PROGRAMS: Step[][] = [...OPCODE_PROGRAMS, INTERRUPT, RESET]

// ---- Running -------------------------------------------------------------------------------------

/** Set up an opcode fetch at `pc`, or, if an interrupt is waiting, one that turns into the interrupt sequence. */
function startFetch(c: Cpu6502) {
  c.prog = -1
  if (c.nmiPending) {
    c.intr = 'nmi'
    c.nmiPending = false
    c.vec = 0xfffa
  } else if (c.irq && !(c.p & I)) {
    c.intr = 'irq'
    c.vec = 0xfffe
  } else c.intr = null
  c.sync = true
  rd(c, c.pc)
}

/** Start the reset sequence (what happens when RES goes high after being low). The registers keep their values, as on the chip. */
export function reset(c: Cpu6502) {
  c.prog = PROG_RESET
  c.t = 0
  c.intr = null
  c.nmiPending = false
  c.sync = false
  RESET[0].a(c)
}

/** Finish the cycle on the pins (`d` is the byte read, ignored for a write) and set up the next one. */
export function cycle(c: Cpu6502, d: number) {
  c.cycles++
  if (c.prog < 0) {
    // The opcode fetch ends: an interrupt takes the place of the instruction (the opcode is dropped and PC is not moved on).
    c.sync = false
    if (c.intr) {
      c.intr = null
      c.prog = PROG_INTERRUPT
    } else {
      c.op = d & 255
      incPc(c)
      c.prog = c.op
    }
    c.t = 0
    PROGRAMS[c.prog][0].a(c)
    return
  }
  const steps = PROGRAMS[c.prog]
  steps[c.t].e?.(c, d & 255)
  c.t++
  if (c.t < steps.length) steps[c.t].a(c)
  else startFetch(c)
}

/** The state of the IRQ pin (true: asserted, the line is low). It is a level: the CPU takes it whenever I is 0. */
export const setIrq = (c: Cpu6502, asserted: boolean) => {
  c.irq = asserted
}

/** The state of the NMI pin (true: asserted). Going from not asserted to asserted is what the CPU notices. */
export function setNmi(c: Cpu6502, asserted: boolean) {
  if (asserted && !c.nmiPin) c.nmiPending = true
  c.nmiPin = asserted
}

/** Run until the next opcode fetch is on the pins, with `mem` as memory. Returns the cycles used. For tests and tools. */
export function runInstruction(c: Cpu6502, mem: { [i: number]: number }): number {
  let n = 0
  do {
    const d = c.read ? mem[c.addr] : ((mem[c.addr] = c.out), 0)
    cycle(c, d)
    n++
  } while (!c.sync)
  return n
}
