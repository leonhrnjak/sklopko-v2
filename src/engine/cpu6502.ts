import { BY_OPCODE_65C02 } from './opcodes65c02'
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
  /** The step is left out (it takes no cycle) when this is true as the previous step ends. */
  skip?(c: Cpu6502): boolean
  /** The cycle fetches a vector (the VPB pin of the 65C02 is low). */
  vp?: boolean
  /** The cycle is part of a read-modify-write instruction (the MLB pin is low). */
  ml?: boolean
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
  /** It is a 65C02 (otherwise an NMOS 6502). */
  cmos: boolean
  /** Waiting after WAI (1) or STP (2): the CPU does nothing until an interrupt (WAI) or a reset (STP). */
  wait: number
  /** The bit RMB, SMB, BBR and BBS work on (set when the instruction starts). */
  bit: number
  /** This cycle reads an interrupt or reset vector (the 65C02's VPB pin is low). */
  vp: boolean
  /** This cycle is one of a read-modify-write instruction (the 65C02's MLB pin is low). */
  ml: boolean
}

export function newCpu(cmos = false): Cpu6502 {
  return {
    a: 0, x: 0, y: 0, sp: 0xfd, pc: 0, p: U | I,
    addr: 0, read: true, out: 0, sync: false,
    irq: false, nmiPending: false, nmiPin: false,
    op: 0, prog: -1, t: 0, intr: null, vec: 0xfffe, ea: 0, lo: 0, ptr: 0, val: 0, base: 0, cross: false, off: 0, newpc: 0, cycles: 0, cmos, wait: 0, bit: 0, vp: false, ml: false,
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
/** Put the access of a step on the pins, with its flags. */
const begin = (c: Cpu6502, s: Step) => {
  s.a(c)
  c.vp = !!s.vp
  c.ml = !!s.ml
}
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

/** The 65C02's decimal ADC: the flags N and Z are those of the corrected result (V is as on the NMOS chip). */
function adc65c02(c: Cpu6502, m: number) {
  if (!(c.p & D)) return adc(c, m)
  const a = c.a
  const cin = c.p & C
  let al = (a & 15) + (m & 15) + cin
  if (al >= 10) al = ((al + 6) & 15) + 16
  const signed = (v: number) => ((v & 0xf0) ^ 0x80) - 0x80
  const ss = signed(a) + signed(m) + al
  let s = (a & 0xf0) + (m & 0xf0) + al
  flag(c, V, ss < -128 || ss > 127)
  if (s >= 0xa0) s += 0x60
  flag(c, C, s >= 0x100)
  c.a = s & 255
  setNZ(c, c.a)
}

/** The 65C02's decimal SBC: the binary difference, less 6 for a borrow out of the low digit and less $60 for one out of the high digit. N and Z are those of the result. */
function sbc65c02(c: Cpu6502, m: number) {
  if (!(c.p & D)) return sbc(c, m)
  const a = c.a
  const borrow = 1 - (c.p & C)
  const diff = a - m - borrow
  flag(c, V, ((a ^ m) & (a ^ diff) & 0x80) !== 0)
  flag(c, C, diff >= 0)
  let r = diff
  if (diff < 0) r -= 0x60
  if ((a & 15) - (m & 15) - borrow < 0) r -= 6
  c.a = r & 255
  setNZ(c, c.a)
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
  ADC: (c, d) => (c.cmos ? adc65c02(c, d) : adc(c, d)),
  SBC: (c, d) => (c.cmos ? sbc65c02(c, d) : sbc(c, d)),
  AND: (c, d) => ((c.a &= d), setNZ(c, c.a)),
  ORA: (c, d) => ((c.a |= d), setNZ(c, c.a)),
  EOR: (c, d) => ((c.a ^= d), setNZ(c, c.a)),
  CMP: (c, d) => compare(c, c.a, d),
  CPX: (c, d) => compare(c, c.x, d),
  CPY: (c, d) => compare(c, c.y, d),
  NOP: () => {},
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
  TSB: (c, v) => (flag(c, Z, (c.a & v) === 0), v | c.a),
  TRB: (c, v) => (flag(c, Z, (c.a & v) === 0), v & ~c.a),
}

const STORE_OPS: Record<string, (c: Cpu6502) => number> = { STA: (c) => c.a, STX: (c) => c.x, STY: (c) => c.y, STZ: () => 0 }

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
/** The last byte of the instruction read so far (PC has moved past it): where the 65C02 reads when it has nothing to read. */
const lastByte = (c: Cpu6502) => rd(c, c.pc - 1)

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
    case 'izp':
      return [
        step(rdPc, (c, d) => (incPc(c), (c.ptr = d))),
        step((c) => rd(c, c.ptr), (c, d) => (c.lo = d)),
        step((c) => rd(c, (c.ptr + 1) & 255), (c, d) => (c.ea = c.lo | (d << 8))),
      ]
    default:
      return []
  }
}

const isIndexed = (m: Mode6502) => m === 'abx' || m === 'aby' || m === 'izy'

/**
 * The extra cycle of the 65C02's decimal ADC and SBC: a read of the operand's address again. After a constant there is no such
 * address; the test vectors read $007F for ADC and $0000 for SBC there, and so does this.
 */
const decimalCycle = (immediate: boolean, sbc = false): Step => ({ a: (c) => rd(c, immediate ? (sbc ? 0 : 0x7f) : c.ea), skip: (c) => !(c.p & D) })

/** The steps of one instruction after its opcode fetch, for the NMOS 6502 or (`cmos`) the 65C02. */
function program(o: Opcode6502, cmos: boolean): Step[] {
  const { mnemonic: m, mode } = o
  const stackPush = (value: (c: Cpu6502) => number) => step((c) => wr(c, push(c), value(c)), (c) => (c.sp = (c.sp - 1) & 255))
  const stackPull = (e: Step['e']) => step((c) => rd(c, push(c)), e)
  const pullSp = step((c) => rd(c, push(c)), (c) => (c.sp = (c.sp + 1) & 255))
  const vector = (lowAddr: (c: Cpu6502) => number): Step[] => [
    { ...step((c) => rd(c, lowAddr(c)), (c, d) => (c.lo = d)), vp: true },
    { ...step((c) => rd(c, lowAddr(c) + 1), (c, d) => (c.pc = c.lo | (d << 8))), vp: true },
  ]
  switch (m) {
    case 'PHA':
      return [dummyPc, stackPush((c) => c.a)]
    case 'PHX':
      return [dummyPc, stackPush((c) => c.x)]
    case 'PHY':
      return [dummyPc, stackPush((c) => c.y)]
    case 'PHP':
      return [dummyPc, stackPush((c) => c.p | B | U)]
    case 'PLA':
      return [dummyPc, pullSp, stackPull((c, d) => ((c.a = d), setNZ(c, d)))]
    case 'PLX':
      return [dummyPc, pullSp, stackPull((c, d) => ((c.x = d), setNZ(c, d)))]
    case 'PLY':
      return [dummyPc, pullSp, stackPull((c, d) => ((c.y = d), setNZ(c, d)))]
    case 'PLP':
      return [dummyPc, pullSp, stackPull((c, d) => (c.p = (d | U) & ~B))]
    case 'JMP':
      if (mode === 'abs') return [step(rdPc, (c, d) => (incPc(c), (c.lo = d))), step(rdPc, (c, d) => (c.pc = c.lo | (d << 8)))]
      if (mode === 'iax')
        return [
          step(rdPc, (c, d) => (incPc(c), (c.lo = d))),
          step(rdPc, (c, d) => (incPc(c), (c.ea = (c.lo | (d << 8)) + c.x))),
          step((c) => rd(c, c.pc - 2)),
          step((c) => rd(c, c.ea), (c, d) => (c.lo = d)),
          step((c) => rd(c, c.ea + 1), (c, d) => (c.pc = c.lo | (d << 8))),
        ]
      return cmos
        ? [
            step(rdPc, (c, d) => (incPc(c), (c.lo = d))),
            step(rdPc, (c, d) => (incPc(c), (c.ea = c.lo | (d << 8)))),
            step((c) => rd(c, c.ea), (c, d) => (c.lo = d)),
            step((c) => rd(c, c.ea + 1), (c, d) => (c.pc = c.lo | (d << 8))),
            step((c) => rd(c, c.ea + 1)),
          ]
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
        step((c) => wr(c, push(c), c.p | B | U), (c) => ((c.sp = (c.sp - 1) & 255), (c.p |= I), cmos && (c.p &= ~D))),
        ...vector(() => 0xfffe),
      ]
    case 'WAI':
    case 'STP': {
      const forever = m === 'STP' ? 2 : 1
      return [dummyPc, step(rdPc, (c) => (c.wait = forever))]
    }
  }
  if (m in BRANCHES || m === 'BRA') {
    const taken = m === 'BRA' ? () => true : BRANCHES[m]
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
  if (mode === 'zpr') {
    // BBR and BBS: test a bit of a zero-page byte, and branch on it.
    const want = m.startsWith('BBS') ? 1 : 0
    return [
      step(rdPc, (c, d) => (incPc(c), (c.ea = d))),
      step((c) => rd(c, c.ea), (c, d) => (c.val = d)),
      step((c) => rd(c, c.ea)),
      step(rdPc, (c, d) => {
        incPc(c)
        if (((c.val >> o.bit!) & 1) === want) c.off = d
        else c.t = SKIP
      }),
      // Unlike a branch, the 65C02 reads the address after the instruction in both of the extra cycles.
      step(rdPc, (c) => {
        c.newpc = (c.pc + (c.off < 128 ? c.off : c.off - 256)) & 0xffff
        c.cross = (c.newpc & 0xff00) !== (c.pc & 0xff00)
        if (!c.cross) {
          c.pc = c.newpc
          c.t = SKIP
        }
      }),
      step(rdPc, (c) => (c.pc = c.newpc)),
    ]
  }
  if (m === 'NOP' && mode === 'abs') return [...addressSteps('abs'), step(lastByte)]
  if (mode === 'imp') return o.cycles === 1 && m === 'NOP' ? [] : [step(rdPc, IMPLIED_OPS[m])]
  if (mode === 'acc') return [step(rdPc, (c) => (c.a = RMW_OPS[m](c, c.a)))]
  if (mode === 'imm') {
    if (m === 'BIT') return [step(rdPc, (c, d) => (incPc(c), flag(c, Z, (c.a & d) === 0)))]
    return [step(rdPc, (c, d) => (incPc(c), READ_OPS[m](c, d))), ...(cmos && (m === 'ADC' || m === 'SBC') ? [decimalCycle(true, m === 'SBC')] : [])]
  }
  const address = addressSteps(mode)
  const indexed = isIndexed(mode)
  // On the 65C02, the extra cycle of a page crossing reads the last byte of the instruction, and the chip adds a cycle to decimal ADC and SBC.
  const dummy = cmos ? (c: Cpu6502) => (c.cross ? lastByte(c) : rd(c, c.ea)) : (c: Cpu6502) => rd(c, c.base)
  if (o.kind === 'read') {
    const op = READ_OPS[m]
    const extra: Step[] = cmos && (m === 'ADC' || m === 'SBC') ? [decimalCycle(false)] : []
    // An indexed read takes a cycle less when the address did not cross a page; the first access was at the right address.
    // (With the decimal cycle to come, a read that did not cross goes on to it, not to the end.)
    const done = extra.length ? address.length + 1 : SKIP
    return indexed
      ? [...address, step(dummy, (c, d) => (c.cross ? undefined : (op(c, d), (c.t = done)))), step((c) => rd(c, c.ea), (c, d) => op(c, d)), ...extra]
      : [...address, step((c) => rd(c, c.ea), (c, d) => op(c, d)), ...extra]
  }
  if (o.kind === 'write') {
    const value = STORE_OPS[m]
    return [...address, ...(indexed ? [step(cmos ? lastByte : (c) => rd(c, c.base))] : []), step((c) => wr(c, c.ea, value(c)))]
  }
  // Read-modify-write: read, write the old value back (the 6502 does) or read it again (the 65C02 does), write the new one.
  const fn = o.bit === undefined ? RMW_OPS[m] : m.startsWith('RMB') ? (_c: Cpu6502, v: number) => v & ~(1 << o.bit!) : (_c: Cpu6502, v: number) => v | (1 << o.bit!)
  const again = cmos ? step((c) => rd(c, c.ea)) : step((c) => wr(c, c.ea, c.val), (c) => (c.val = fn(c, c.val)))
  const locked = (s: Step): Step => ({ ...s, ml: true })
  return [
    ...address,
    ...(mode === 'abx' ? [cmos ? { a: lastByte, skip: (c: Cpu6502) => !c.cross && o.pageCross, ml: true } : step((c) => rd(c, c.base))] : []),
    locked(step((c) => rd(c, c.ea), (c, d) => (c.val = d))),
    locked(cmos ? { a: again.a, e: (c: Cpu6502) => (c.val = fn(c, c.val)) } : again),
    locked(step((c) => wr(c, c.ea, c.val))),
  ]
}

/** Opcodes that are not documented act as a one-byte, two-cycle NOP (on the 65C02 every opcode is defined). */
const NMOS_PROGRAMS: Step[][] = Array.from({ length: 256 }, (_, op) => {
  const o = BY_OPCODE_6502[op]
  return o ? program(o, false) : [dummyPc]
})
const CMOS_PROGRAMS: Step[][] = Array.from({ length: 256 }, (_, op) => program(BY_OPCODE_65C02[op], true))

export const PROG_INTERRUPT = 256
export const PROG_RESET = 257
/** Waiting after WAI or STP (not a program: `prog` is this and not -1, so the fetch is not one). */
export const PROG_WAIT = -2

/** Seven cycles that push the return address and the flags, then jump through a vector. `B` is 0 for an interrupt. */
const INTERRUPT: Step[] = [
  dummyPc,
  step((c) => wr(c, push(c), c.pc >> 8), (c) => (c.sp = (c.sp - 1) & 255)),
  step((c) => wr(c, push(c), c.pc & 255), (c) => (c.sp = (c.sp - 1) & 255)),
  step((c) => wr(c, push(c), (c.p | U) & ~B), (c) => ((c.sp = (c.sp - 1) & 255), (c.p |= I), c.cmos && (c.p &= ~D))),
  { ...step((c) => rd(c, c.vec), (c, d) => (c.lo = d)), vp: true },
  { ...step((c) => rd(c, c.vec + 1), (c, d) => (c.pc = c.lo | (d << 8))), vp: true },
]

/** The reset sequence: like an interrupt, but nothing is written (the stack pointer still goes down three times). */
const RESET: Step[] = [
  dummyPc,
  dummyPc,
  step((c) => rd(c, push(c)), (c) => (c.sp = (c.sp - 1) & 255)),
  step((c) => rd(c, push(c)), (c) => (c.sp = (c.sp - 1) & 255)),
  step((c) => rd(c, push(c)), (c) => ((c.sp = (c.sp - 1) & 255), (c.p |= I), c.cmos && (c.p &= ~D))),
  { ...step((c) => rd(c, 0xfffc), (c, d) => (c.lo = d)), vp: true },
  { ...step((c) => rd(c, 0xfffd), (c, d) => (c.pc = c.lo | (d << 8))), vp: true },
]

const NMOS: Step[][] = [...NMOS_PROGRAMS, INTERRUPT, RESET]
const CMOS: Step[][] = [...CMOS_PROGRAMS, INTERRUPT, RESET]
const programsOf = (c: Cpu6502) => (c.cmos ? CMOS : NMOS)

// ---- Running -------------------------------------------------------------------------------------

/** Set up an opcode fetch at `pc`, or, if an interrupt is waiting, one that turns into the interrupt sequence. */
function startFetch(c: Cpu6502) {
  c.prog = -1
  c.vp = c.ml = false
  if (c.wait) {
    // After WAI or STP the CPU only reads the next opcode's address, over and over, until an interrupt (WAI) or a reset (STP).
    if (c.wait === 1 && (c.nmiPending || c.irq)) c.wait = 0
    else {
      c.prog = PROG_WAIT
      c.sync = false
      rd(c, c.pc)
      return
    }
  }
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
  c.wait = 0
  c.intr = null
  c.nmiPending = false
  c.sync = false
  begin(c, RESET[0])
}

/** Finish the cycle on the pins (`d` is the byte read, ignored for a write) and set up the next one. */
export function cycle(c: Cpu6502, d: number) {
  c.cycles++
  if (c.prog === PROG_WAIT) return startFetch(c)
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
    const first = programsOf(c)[c.prog]
    if (first.length) begin(c, first[0])
    else startFetch(c) // a one-cycle instruction: the fetch was all of it
    return
  }
  const steps = programsOf(c)[c.prog]
  steps[c.t].e?.(c, d & 255)
  c.t++
  while (c.t < steps.length && steps[c.t].skip?.(c)) c.t++
  if (c.t < steps.length) begin(c, steps[c.t])
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
