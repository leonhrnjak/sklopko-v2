import { box } from '../layouts'
import { writeNum, type ComponentDef, type V } from '../types'

export const io: ComponentDef[] = [
  {
    type: 'switch',
    name: 'Switch',
    category: 'io',
    description: 'Toggle switch. Click it to flip between 0 and 1.',
    params: [{ key: 'on', label: 'On', kind: 'bool', default: false }],
    interactive: 'toggle',
    layout: () => ({ w: 30, h: 20, pins: [{ name: 'Q', dir: 'out', side: 'r', x: 40, y: 10 }] }),
    evaluate(inst) {
      inst.outs[0] = inst.params.on ? 1 : 0
    },
  },
  {
    type: 'button',
    name: 'Push button',
    category: 'io',
    description: 'Momentary button: outputs 1 only while held down.',
    interactive: 'momentary',
    init: () => ({ pressed: false }),
    layout: () => ({ w: 20, h: 20, pins: [{ name: 'Q', dir: 'out', side: 'r', x: 30, y: 10 }] }),
    evaluate(inst) {
      inst.outs[0] = inst.state.pressed ? 1 : 0
    },
  },
  {
    type: 'clock',
    name: 'Clock',
    category: 'io',
    description: 'Square wave source. Ticks in real time while the simulation runs.',
    params: [
      {
        key: 'hz',
        label: 'Frequency (Hz)',
        kind: 'select',
        default: 1,
        options: [0.25, 0.5, 1, 2, 4, 8, 16, 32].map((v) => ({ value: v, label: `${v} Hz` })),
      },
    ],
    init: () => ({ phase: 0 as V, elapsed: 0 }),
    clockHalfPeriod: (p) => 500 / Number(p.hz),
    layout: () => ({ w: 40, h: 40, pins: [{ name: 'Q', dir: 'out', side: 'r', x: 50, y: 20 }] }),
    evaluate(inst) {
      inst.outs[0] = inst.state.phase
    },
  },
  {
    type: 'const',
    name: 'Constant',
    category: 'io',
    description: 'Fixed logic level, 0 or 1.',
    params: [
      {
        key: 'value',
        label: 'Value',
        kind: 'select',
        default: 1,
        options: [
          { value: 1, label: '1 (high)' },
          { value: 0, label: '0 (low)' },
        ],
      },
    ],
    layout: () => ({ w: 20, h: 20, pins: [{ name: 'Q', dir: 'out', side: 'r', x: 30, y: 10 }] }),
    evaluate(inst) {
      inst.outs[0] = Number(inst.params.value) ? 1 : 0
    },
  },
  {
    type: 'hexin',
    name: '4-bit input',
    category: 'io',
    description: 'Outputs a 4-bit number (A = least significant bit). Click to count up, Alt/Option-click to count down.',
    params: [{ key: 'value', label: 'Value', kind: 'number', min: 0, max: 15, default: 0 }],
    interactive: 'cycle',
    layout: () => box({ w: 40, right: ['A', 'B', 'C', 'D'] }),
    evaluate(inst) {
      writeNum(inst.outs, 0, 4, Number(inst.params.value) & 15)
    },
  },
  {
    type: 'led',
    name: 'LED',
    category: 'io',
    description: 'Lights up when its input is 1.',
    params: [
      {
        key: 'color',
        label: 'Color',
        kind: 'select',
        default: 'green',
        options: ['green', 'red', 'yellow', 'blue', 'white'].map((c) => ({ value: c, label: c })),
      },
    ],
    layout: () => ({ w: 20, h: 20, pins: [{ name: 'A', dir: 'in', side: 'l', x: -10, y: 10 }] }),
    evaluate() {},
  },
]

/** Segment patterns a..g for hex digits 0-F (bit 0 = a). */
export const SEG_HEX = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71]

export const display: ComponentDef[] = [
  {
    type: 'seg7',
    name: '7-segment display',
    category: 'display',
    description: 'Seven-segment display. Each input a–g (and dp) drives one segment.',
    layout: () => box({ w: 80, left: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'] }),
    evaluate() {},
  },
  {
    type: 'hexdisp',
    name: 'Hex display',
    category: 'display',
    description: 'Shows the 4-bit input (A = least significant bit) as a hex digit 0–F.',
    layout: () => box({ w: 60, left: ['A', 'B', 'C', 'D'] }),
    evaluate() {},
  },
  {
    type: 'dicedisp',
    name: 'Dice display',
    category: 'display',
    description:
      'A die face with seven pips, one input each: top-left, top-right, middle-left, centre, middle-right, ' +
      'bottom-left, bottom-right.',
    layout: () => box({ w: 160, left: ['TL', 'TR', 'ML', 'C', 'MR', 'BL', 'BR'] }),
    evaluate() {},
  },
  {
    type: 'bar',
    name: 'LED bar',
    category: 'display',
    description: 'A row of LEDs, one per input.',
    params: [
      {
        key: 'n',
        label: 'LEDs',
        kind: 'select',
        default: 8,
        structural: true,
        options: [4, 8].map((v) => ({ value: v, label: String(v) })),
      },
    ],
    layout: (p) => box({ w: 40, left: Array.from({ length: Number(p.n) }, (_, i) => `I${i}`) }),
    evaluate() {},
  },
]
