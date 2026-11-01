import { box, names, type PinSpec } from '../layouts'
import { X, type ComponentDef, type V } from '../types'
import { viaInit, type ViaState } from '../via6522'

/** What the VIA part keeps between evaluations: the chip's registers (`via6522.ts`), PHI2 as it was, and what the data pins show. */
export interface ViaPartState extends ViaState {
  /** PHI2 as it was last time (for finding its rising edge). */
  pc: V
  /** What the data pins D show: the register read at the last rising edge, 0 when the chip was not selected. */
  out: number
}

export const viaPartInit = (): ViaPartState => ({ ...viaInit(), pc: X, out: 0 })

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
  },
]
