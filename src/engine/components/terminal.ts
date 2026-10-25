import { aciaClock, aciaInit, aciaIrq, aciaRead, aciaReset, aciaWipe, aciaWrite, type AciaState } from '../acia'
import { box, names } from '../layouts'
import { X, toNum, writeNum, type ComponentDef, type V } from '../types'

/** What the terminal part keeps between clocks: the chip's registers, the screen and the keyboard buffer (`acia.ts`), and two more. */
export interface TerminalState extends AciaState {
  /** PHI2 as it was last time (for finding its rising edge). */
  pc: V
  /** What the data pins D show: the register the chip was asked for at the last rising edge, 0 when it was not selected. */
  out: number
}

/**
 * Pins, in the order `evaluate` reads and writes them (a box lists its left pins, then its right ones). Inputs: PHI2, RESB, CS0, CS1B,
 * RS0, RS1, RWB, DI0–DI7, DSRB. Outputs: D0–D7, IRQB.
 */
const IN = { PHI2: 0, RESB: 1, CS0: 2, CS1B: 3, RS: 4, RWB: 6, DI: 7, DSRB: 15 } as const
const OUT = { D: 0, IRQB: 8 } as const

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
    evaluate(inst) {
      const { ins, outs } = inst
      const st = inst.state as TerminalState
      const phi2 = ins[IN.PHI2]
      const rising = st.pc === 0 && phi2 === 1
      if (phi2 <= 1) st.pc = phi2
      if (ins[IN.RESB] === 0) {
        // Held in reset: the registers are cleared, and nothing is selected. The terminal is reset with the machine (a screen left over from
        // the program that was running would be confusing), unless the part is set to keep it.
        aciaReset(st)
        if (inst.params.resetClears !== false) aciaWipe(st)
        st.out = 0
      } else if (rising) {
        // The chip works while Φ2 is high: its inputs have been steady since the CPU's last falling edge. What a read returns is
        // kept for the pins, so a read that clears a flag (the status register's interrupt bit) still shows the flag to the CPU.
        st.out = 0
        if (ins[IN.CS0] === 1 && ins[IN.CS1B] === 0) {
          const rs = toNum(ins, IN.RS, 2)
          const rw = ins[IN.RWB]
          if (rs >= 0 && rw === 1) st.out = aciaRead(st, rs, ins[IN.DSRB] === 1)
          else if (rs >= 0 && rw === 0) {
            const data = toNum(ins, IN.DI, 8)
            if (data >= 0) aciaWrite(st, rs, data)
          }
        }
        // The next typed character moves in once the one before was read (a read at this edge clears the flag first, so it moves in now).
        aciaClock(st)
      }
      writeNum(outs, OUT.D, 8, st.out)
      outs[OUT.IRQB] = aciaIrq(st) ? 0 : 1
    },
  },
]
