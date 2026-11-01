import { box, names, type PinSpec } from '../../../layouts'
import { X, Z, toNum, writeNum, type ComponentDef, type V } from '../../../types'
import { ca2IsOutput, cb2IsOutput, viaClock, viaEdges, viaInit, viaIrq, viaPortOut, viaRead, viaReset, viaWrite, type ViaState } from '../via6522'

/** What the VIA part keeps between evaluations: the chip's registers (`via6522.ts`), PHI2 as it was, and what the data pins show. */
export interface ViaPartState extends ViaState {
  /** PHI2 as it was last time (for finding its rising edge). */
  pc: V
  /** What the data pins D show: the register read at the last rising edge, 0 when the chip was not selected. */
  out: number
}

/**
 * Pins, in the order `evaluate` reads and writes them (a box lists its left pins, then its right ones). Inputs: PHI2, RESB, CS1, CS2B,
 * RS0–RS3, RWB, DI0–DI7, PAIN0–PAIN7, PBIN0–PBIN7, CA1, CA2IN, CB1, CB2IN. Outputs: D0–D7, PA0–PA7, PB0–PB7, CA2, CB2, IRQB.
 *
 * A port pin is two pins, as the CPU's data bus is: PAn / PBn is what the chip drives (nothing, Z, where the pin is an input), and
 * PAINn / PBINn is what it reads. Wire the first to the outside, and join the outside to the second, with a bus junction when
 * something else (an LCD that is read) drives the same wires.
 */
const IN = { PHI2: 0, RESB: 1, CS1: 2, CS2B: 3, RS: 4, RWB: 8, DI: 9, PAIN: 17, PBIN: 25, CA1: 33, CA2IN: 34, CB1: 35, CB2IN: 36 } as const
const OUT = { D: 0, PA: 8, PB: 16, CA2: 24, CB2: 25, IRQB: 26 } as const

export const viaPartInit = (): ViaPartState => ({ ...viaInit(), pc: X, out: 0 })

/** A level as 0 or 1, or -1 when it is not one. */
const level = (v: V) => (v === 0 || v === 1 ? v : -1)

/** The eight pins of a port as a number. A bit nothing drives reads 0, unless the chip itself drives it (then it reads what it drives). */
function portIn(ins: V[], first: number, out: number, oe: number): number {
  let n = 0
  for (let i = 0; i < 8; i++) {
    const v = ins[first + i]
    const b = v === 0 || v === 1 ? v : (oe >> i) & 1 ? (out >> i) & 1 : 0
    n |= b << i
  }
  return n
}

const inLabels = (prefix: string, shown: string): PinSpec[] => names(prefix, 8).map((name, i) => ({ name, label: `${shown}${i} in` }))

export const vias: ComponentDef[] = [
  {
    type: 'via6522',
    name: 'VIA (6522)',
    category: 'io',
    description:
      'A 6522 versatile interface adapter, the chip that gives a 6502 its input and output pins: two 8-bit ports (each pin an input or an output, set in the direction registers), ' +
      'two 16-bit timers that count the clock and interrupt the CPU, and four handshake pins. Sixteen registers, picked by RS3–RS0 (0 port B, 1 port A, 2 and 3 their directions, ' +
      '4–9 the timers, 11 and 12 their modes, 13 and 14 the interrupt flags and enables). It answers while CS1 = 1 and CS2 = 0, at the rising edge of Φ2, like the other devices of a 6502 board. ' +
      'Not modelled: the shift register. Each port pin is two pins here, what the chip drives (nothing, Z, while it is an input) and what it reads.',
    layout: () =>
      box({
        w: 300,
        minRows: 37,
        left: [
          { name: 'PHI2', label: 'Φ2', clock: true },
          { name: 'RESB', label: 'RES', invert: true, def: 1 },
          { name: 'CS1', def: 0 },
          { name: 'CS2B', label: 'CS2', invert: true, def: 1 },
          ...names('RS', 4).map((name) => ({ name, def: 0 as V })),
          { name: 'RWB', label: 'R/W', def: 1 },
          ...names('DI', 8),
          ...inLabels('PAIN', 'PA'),
          ...inLabels('PBIN', 'PB'),
          'CA1',
          { name: 'CA2IN', label: 'CA2 in' },
          'CB1',
          { name: 'CB2IN', label: 'CB2 in' },
        ],
        right: [...names('D', 8), ...names('PA', 8), ...names('PB', 8), 'CA2', 'CB2', { name: 'IRQB', label: 'IRQ', invert: true }],
      }),
    title: () => 'VIA 6522',
    init: (): ViaPartState => viaPartInit(),
    evaluate(inst) {
      const { ins, outs } = inst
      const st = inst.state as ViaPartState
      const phi2 = ins[IN.PHI2]
      const rising = st.pc === 0 && phi2 === 1
      if (phi2 <= 1) st.pc = phi2
      const { pa: paOut, paOe, pb: pbOut, pbOe } = viaPortOut(st)
      const pins = { pa: portIn(ins, IN.PAIN, paOut, paOe), pb: portIn(ins, IN.PBIN, pbOut, pbOe) }
      if (ins[IN.RESB] === 0) {
        // Held in reset: the registers are cleared, the ports are inputs, and nothing is selected.
        viaReset(st)
        st.out = 0
      } else {
        // The control pins look at their levels whenever they change, not only at the clock.
        viaEdges(st, level(ins[IN.CA1]), level(ins[IN.CA2IN]), level(ins[IN.CB1]), level(ins[IN.CB2IN]), pins)
        if (rising) {
          // Like the terminal: the chip works while Φ2 is high, its inputs steady since the CPU's last falling edge; what a read returns is kept for the pins.
          st.out = 0
          if (ins[IN.CS1] === 1 && ins[IN.CS2B] === 0) {
            const rs = toNum(ins, IN.RS, 4)
            const rw = ins[IN.RWB]
            if (rs >= 0 && rw === 1) st.out = viaRead(st, rs, pins)
            else if (rs >= 0 && rw === 0) {
              const data = toNum(ins, IN.DI, 8)
              if (data >= 0) viaWrite(st, rs, data)
            }
          }
          viaClock(st, (pins.pb >> 6) & 1)
        }
      }
      writeNum(outs, OUT.D, 8, st.out)
      const out = viaPortOut(st)
      for (let i = 0; i < 8; i++) {
        outs[OUT.PA + i] = (out.paOe >> i) & 1 ? (((out.pa >> i) & 1) as V) : Z
        outs[OUT.PB + i] = (out.pbOe >> i) & 1 ? (((out.pb >> i) & 1) as V) : Z
      }
      outs[OUT.CA2] = ca2IsOutput(st) ? (st.ca2out as V) : Z
      outs[OUT.CB2] = cb2IsOutput(st) ? (st.cb2out as V) : Z
      outs[OUT.IRQB] = viaIrq(st) ? 0 : 1
    },
  },
]
