import { cycle, newCpu, reset, setIrq, setNmi, type Cpu6502 } from '../cpu6502'
import { box, names } from '../layouts'
import { X, Z, toNum, writeNum, type ComponentDef, type V } from '../types'

/** What the 6502 part keeps between clocks. The CPU is plain numbers, so a copy of it is cheap (it is copied at every edge). */
export interface CpuState {
  cpu: Cpu6502
  /** PHI2 as it was last time (for finding its falling edge). */
  pc: V
  /** The CPU is running (the reset sequence has begun). Until then the pins are unknown. */
  started: boolean
  /** RES was low at the last falling edge: the CPU waits for it to go high. */
  held: boolean
  /** A read cycle is waiting for data on DI that is still unknown (X): the CPU does not move on. */
  waiting: boolean
  /** Waiting for RDY: a read cycle is held while RDY is low. */
  stalled: boolean
}

const hasPowerOn = (p: { powerOn?: unknown }) => p.powerOn !== false

/**
 * Pins, in the order `evaluate` reads and writes them (a box lists its left pins, then its right ones). Inputs: PHI2, RESB, IRQB,
 * NMIB, RDY, DI0–DI7. Outputs: A0–A15, D0–D7, RWB, SYNC. A pin that is low-active has a bubble and its name ends in B.
 */
const IN = { PHI2: 0, RESB: 1, IRQB: 2, NMIB: 3, RDY: 4, DI: 5 } as const
const OUT = { A: 0, D: 16, RWB: 24, SYNC: 25 } as const

export function cpuInit(powerOn: boolean): CpuState {
  const cpu = newCpu()
  if (powerOn) reset(cpu)
  return { cpu, pc: X, started: powerOn, held: false, waiting: false, stalled: false }
}

export const cpus: ComponentDef[] = [
  {
    type: 'cpu6502',
    name: 'MOS 6502',
    category: 'cpu',
    description:
      'The MOS 6502, the 8-bit processor of the Apple II, the Commodore 64 and the NES (documented instructions). In every clock ' +
      'cycle it puts an address on A and R/W on the pins and reads or writes one byte; it moves on at the falling edge of Φ2. ' +
      'Select it to see its registers and the instruction it is running.',
    params: [
      {
        key: 'powerOn',
        label: 'Resets itself at power-up',
        kind: 'bool',
        default: true,
        structural: false,
      },
      {
        key: 'tristate',
        label: 'Tri-state data bus',
        kind: 'bool',
        default: false,
        structural: false,
      },
    ],
    title: () => '6502',
    live: true,
    init: (p): CpuState => cpuInit(hasPowerOn(p)),
    layout: () =>
      box({
        left: [
          { name: 'PHI2', label: 'Φ2', clock: true },
          { name: 'RESB', label: 'RES', invert: true, def: 1 },
          { name: 'IRQB', label: 'IRQ', invert: true, def: 1 },
          { name: 'NMIB', label: 'NMI', invert: true, def: 1 },
          { name: 'RDY', def: 1 },
          ...names('DI', 8),
        ],
        right: [...names('A', 16), ...names('D', 8), { name: 'RWB', label: 'R/W' }, 'SYNC'],
      }),
    evaluate(inst) {
      const { ins, outs } = inst
      const st = inst.state as CpuState
      const c = st.cpu
      const phi2 = ins[IN.PHI2]
      // A bus is only as good as the data on it: an unknown level on a control pin is "not asserted".
      setIrq(c, ins[IN.IRQB] === 0)
      setNmi(c, ins[IN.NMIB] === 0)
      const falling = st.pc === 1 && phi2 === 0
      if (phi2 <= 1) st.pc = phi2
      if (falling) {
        if (ins[IN.RESB] === 0) {
          // Held in reset: the bus is idle (reading), nothing is written.
          st.held = true
          st.started = true
          st.waiting = st.stalled = false
          c.prog = -1
          c.read = true
          c.sync = false
        } else if (st.held) {
          // RES went high: this clock is the first of the 7 cycles of the reset sequence.
          st.held = false
          st.started = true
          reset(c)
          cycle(c, 0)
        } else if (st.started) {
          st.stalled = c.read && ins[IN.RDY] === 0
          const data = c.read ? toNum(ins, IN.DI, 8) : 0
          st.waiting = c.read && data < 0
          if (!st.stalled && !st.waiting) cycle(c, data)
        }
      }
      if (!st.started) {
        outs.fill(X)
        return
      }
      writeNum(outs, OUT.A, 16, c.addr)
      for (let i = 0; i < 8; i++) outs[OUT.D + i] = inst.params.tristate && c.read ? Z : (((c.out >> i) & 1) as V)
      outs[OUT.RWB] = c.read ? 1 : 0
      outs[OUT.SYNC] = c.sync ? 1 : 0
    },
  },
]
