import { aciaInit, type AciaState } from '../acia'
import { box, names } from '../layouts'
import { X, type ComponentDef, type V } from '../types'

/** What the terminal part keeps between clocks: the chip's registers, the screen and the keyboard buffer (`acia.ts`), and two more. */
export interface TerminalState extends AciaState {
  /** PHI2 as it was last time (for finding its rising edge). */
  pc: V
  /** What the data pins D show: the register the chip was asked for at the last rising edge, 0 when it was not selected. */
  out: number
}

export const terminalInit = (): TerminalState => ({ ...aciaInit(), pc: X, out: 0 })

export const terminals: ComponentDef[] = [
  {
    type: 'acia6551',
    name: 'Serial terminal (6551)',
    category: 'io',
    description:
      'A 6551-style serial chip with a terminal on the other end of the wire: a screen of 40 columns by 24 rows and a keyboard. ' +
      'Four registers, picked by RS1 RS0: 0 the character (read: the key that arrived, write: print it), 1 status, 2 command, 3 control. ' +
      'It answers while CS0 = 1 and CS1 = 0, at the rising edge of Φ2, like the other devices of a 6502 board. ' +
      'Select it, click it and type. Until a program sets bit 0 of the command register, what you type waits in the keyboard buffer. ' +
      'While RES is low the registers are cleared, and so (unless you switch that off) are the screen and what was typed.',
    params: [
      {
        key: 'capitals',
        label: 'Capitals',
        kind: 'bool',
        default: true,
        structural: false,
      },
      {
        key: 'resetClears',
        label: 'Clear the screen on reset',
        kind: 'bool',
        default: true,
        structural: false,
      },
    ],
    title: () => 'Terminal',
    live: true,
    init: (): TerminalState => terminalInit(),
    revision: (inst) => (inst.state as TerminalState).rev,
    layout: () =>
      box({
        w: 300,
        minRows: 17,
        left: [
          { name: 'PHI2', label: 'Φ2', clock: true },
          { name: 'RESB', label: 'RES', invert: true, def: 1 },
          { name: 'CS0', def: 0 },
          { name: 'CS1B', label: 'CS1', invert: true, def: 1 },
          { name: 'RS0', def: 0 },
          { name: 'RS1', def: 0 },
          { name: 'RWB', label: 'R/W', def: 1 },
          ...names('DI', 8),
          { name: 'DSRB', label: 'DSR', invert: true, def: 0 },
        ],
        right: [...names('D', 8), { name: 'IRQB', label: 'IRQ', invert: true }],
      }),
  },
]
