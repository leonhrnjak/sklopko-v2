import { lcdInit, type LcdState } from '../hd44780'
import { box, names, type PinSpec } from '../layouts'
import { X, type ComponentDef, type V } from '../types'

/** What the LCD part keeps between evaluations: the controller (`hd44780.ts`), and the pins as they were last time. */
export interface LcdPartState extends LcdState {
  /** The clock and E as they were last time (for finding their edges). */
  cp: V
  ep: V
  /** What is being driven on the data pins now (a read cycle: E is high and R/W is 1), with the mask of the pins that are, or -1. */
  drive: number
  mask: number
}

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
  },
]
