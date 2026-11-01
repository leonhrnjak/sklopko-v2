
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
const { I, D, U } = FLAG

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
const step = (a: Step['a'], e?: Step['e']): Step => ({ a, e })
/** Put the access of a step on the pins, with its flags. */
const begin = (c: Cpu6502, s: Step) => {
  s.a(c)
  c.vp = !!s.vp
  c.ml = !!s.ml
}
const push = (c: Cpu6502) => 0x100 | c.sp

// ---- The cycles of each instruction --------------------------------------------------------------

const rdPc = (c: Cpu6502) => rd(c, c.pc)
const dummyPc = step(rdPc)

export const PROG_INTERRUPT = 256
export const PROG_RESET = 257
/** Waiting after WAI or STP (not a program: `prog` is this and not -1, so the fetch is not one). */
export const PROG_WAIT = -2

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
