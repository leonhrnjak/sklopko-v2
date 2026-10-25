import { lcdInit, lcdReadBus, lcdReadDone, lcdTick, lcdWriteBus, type BusyTime, type LcdState } from '../hd44780'
import { box, names, type PinSpec } from '../layouts'
import { X, Z, type ComponentDef, type V } from '../types'

/** What the LCD part keeps between evaluations: the controller (`hd44780.ts`), and the pins as they were last time. */
export interface LcdPartState extends LcdState {
  /** The clock and E as they were last time (for finding their edges). */
  cp: V
  ep: V
  /** What is being driven on the data pins now (a read cycle: E is high and R/W is 1), with the mask of the pins that are, or -1. */
  drive: number
  mask: number
}

/**
 * Pins, in the order `evaluate` reads and writes them. Inputs: CLK, RS, RW, E, DIN0–DIN7. Outputs: D0–D7, driven (Z, not driven, the rest of the time)
 * while the chip is being read. The data pins are two pins, as the VIA's ports are: wire D to the outside and the outside to DIN, through a bus
 * junction where something else (the VIA's port B) drives the same wires.
 */
const IN = { CLK: 0, RS: 1, RW: 2, E: 3, DIN: 4 } as const

export const lcdPartInit = (): LcdPartState => ({ ...lcdInit(), cp: X, ep: X, drive: -1, mask: 0 })

const dinLabels: PinSpec[] = names('DIN', 8).map((name, i) => ({ name, label: `D${i} in` }))

export const lcds: ComponentDef[] = [
  {
    type: 'hd44780',
    name: 'LCD 16×2 (HD44780)',
    category: 'display',
    description:
      'A character display with an HD44780 controller, 16 characters by 2 lines of 5 × 8 dots, as on Ben Eater’s breadboard. The pins are RS (0 an instruction, 1 a character), R/W, E ' +
      '(a write is taken when E falls; a read is shown while E is high) and eight data pins. Write instructions to switch the display on, set the interface (8 or 4 bits), ' +
      'the entry mode and where the cursor is, then write characters. The chip is busy for a while after each instruction (the flag is bit 7 of a read with RS = 0), and ignores what is ' +
      'written until it is done: the Φ2 pin counts the time, taking the clock for 1 MHz. The display starts off, blank and in the 8-bit interface.',
    params: [
      {
        key: 'busy',
        label: 'Busy time',
        kind: 'select',
        default: 'real',
        options: [
          { value: 'real', label: 'As in the data sheet (37 µs and 1.52 ms at 1 MHz)' },
          { value: 'short', label: 'Short (2 and 8 cycles)' },
          { value: 'none', label: 'Never busy' },
        ],
        structural: false,
      },
    ],
    title: () => 'LCD',
    live: true,
    init: (): LcdPartState => lcdPartInit(),
    revision: (inst) => (inst.state as LcdPartState).rev,
    layout: () =>
      box({
        w: 360,
        minRows: 6,
        left: [{ name: 'CLK', label: 'Φ2', clock: true }, { name: 'RS' }, { name: 'RW', label: 'R/W' }, { name: 'E' }, ...dinLabels],
        right: names('D', 8),
      }),
    evaluate(inst) {
      const { ins, outs } = inst
      const st = inst.state as LcdPartState
      const time = (inst.params.busy as BusyTime) ?? 'real'
      const clk = ins[IN.CLK]
      if (st.cp === 0 && clk === 1) lcdTick(st)
      if (clk <= 1) st.cp = clk
      const e = ins[IN.E]
      const rs = ins[IN.RS]
      const rw = ins[IN.RW]
      const rising = st.ep === 0 && e === 1
      const falling = st.ep === 1 && e === 0
      if (e <= 1) st.ep = e
      if (rising && rw === 1 && rs <= 1) {
        const r = lcdReadBus(st, rs)
        st.drive = r.value
        st.mask = r.mask
      }
      if (falling) {
        if (rw === 0 && rs <= 1) {
          // The upper nibble has to be known; a data pin below it that nothing drives reads 0 (the 4-bit interface leaves them unconnected).
          let d = 0
          let known = true
          for (let i = 0; i < 8; i++) {
            const v = ins[IN.DIN + i]
            if (v === 0 || v === 1) d |= v << i
            else if (i >= 4) known = false
          }
          if (known) lcdWriteBus(st, rs, d, time)
        } else if (rw === 1 && rs <= 1 && st.drive >= 0) lcdReadDone(st, rs)
        st.drive = -1
      }
      // The chip drives the data pins while it is read (E high, R/W = 1) and lets go of them otherwise.
      const driving = e === 1 && rw === 1 && st.drive >= 0
      for (let i = 0; i < 8; i++) outs[i] = driving && (st.mask >> i) & 1 ? (((st.drive >> i) & 1) as V) : Z
    },
  },
]
