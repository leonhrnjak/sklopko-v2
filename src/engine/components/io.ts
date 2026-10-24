import { numbered } from '../bus'
import { box, names } from '../layouts'
import { toNum, writeNum, X, type ComponentDef, type ParamDef, type Params, type V } from '../types'

/** Names of net labels: short, no spaces. An empty name is allowed and connects to nothing. */
const labelName: ParamDef = {
  key: 'name',
  label: 'Name',
  kind: 'text',
  default: '',
  pattern: '[A-Za-z0-9_]{0,12}',
  maxLength: 12,
  multiline: false,
  focus: true,
  hint: 'Letters, digits and underscores, up to 12 characters.',
  structural: true, // the flag's width, and so a Receive label's pin, depends on the name
}

/** More than one bit makes a label carry a bus (see `isBusLabel`). */
const labelBits: ParamDef = { key: 'bits', label: 'Bits', kind: 'number', min: 1, max: 16, default: 1, structural: true }

/** Width of a label flag: wide enough for its name (or the "name" placeholder shown while it is empty), on the 10px grid. */
const flagWidth = (p: Params) => {
  const bits = Number(p.bits ?? 1)
  const chars = Math.max(String(p.name).length, 4) + (bits > 1 ? String(bits).length + 2 : 0)
  return Math.ceil((chars * 8 + 22) / 10) * 10
}

export const io: ComponentDef[] = [
  {
    type: 'switch',
    name: 'Switch',
    category: 'io',
    description: 'Toggle switch: outputs 0 or 1. Click it to flip it, or give it a key and press that key.',
    params: [
      { key: 'on', label: 'On', kind: 'bool', default: false },
      {
        key: 'key',
        label: 'Key',
        kind: 'text',
        default: '',
        pattern: '[1-9A-Za-z]?',
        maxLength: 1,
        multiline: false,
        hint: 'One digit from 1 to 9, or a letter. Press it on the keyboard to flip the switch.',
      },
    ],
    interactive: 'toggle',
    pins: {
      Q: '1 while the switch is on, 0 while it is off. Click the switch (or press its key) to flip it.',
    },
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
    pins: {
      Q: '1 only while the button is held down, 0 otherwise.',
    },
    layout: () => ({ w: 20, h: 20, pins: [{ name: 'Q', dir: 'out', side: 'r', x: 30, y: 10 }] }),
    evaluate(inst) {
      inst.outs[0] = inst.state.pressed ? 1 : 0
    },
  },
  {
    type: 'clock',
    name: 'Clock',
    category: 'io',
    description: 'Square wave source from 0.25 to 4096 Hz. It flips every half period in real time while the simulation runs; Clock step flips it by hand.',
    params: [
      {
        key: 'hz',
        label: 'Frequency (Hz)',
        kind: 'select',
        default: 1,
        options: [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096].map((v) => ({ value: v, label: `${v} Hz` })),
      },
    ],
    init: () => ({ phase: 0 as V, elapsed: 0 }),
    clockHalfPeriod: (p) => 500 / Number(p.hz),
    pins: {
      Q: 'The square wave: flips between 0 and 1 every half period, and starts at 0.',
    },
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
    pins: {
      Q: 'Always the same level, 0 or 1, as chosen.',
    },
    layout: () => ({ w: 20, h: 20, pins: [{ name: 'Q', dir: 'out', side: 'r', x: 30, y: 10 }] }),
    evaluate(inst) {
      inst.outs[0] = Number(inst.params.value) ? 1 : 0
    },
  },
  {
    type: 'netsend',
    name: 'Send label',
    category: 'io',
    description:
      'Publishes its input under a name. Every Receive label with the same name carries this signal, with no wire ' +
      'in between and no delay. If several Send labels share a name, the first one that is driven wins.',
    params: [labelName, labelBits],
    pins: {
      A: 'The signal to publish under this label\'s name. With more than one bit it is a bus.',
    },
    layout: (p) => ({ w: flagWidth(p), h: 20, pins: [{ name: 'A', dir: 'in', side: 'l', x: -10, y: 10, ...(Number(p.bits) > 1 ? { bus: Number(p.bits) } : {}) }] }),
    evaluate() {},
  },
  {
    type: 'netrecv',
    name: 'Receive label',
    category: 'io',
    description:
      'Carries the signal that the Send label with the same name publishes. Unknown (grey) when no driven Send ' +
      'label has that name.',
    params: [labelName, labelBits],
    pins: {
      Y: 'The signal published by the Send label with the same name; unknown (X) if none is driven. With more than one bit it is a bus.',
    },
    layout: (p) => {
      const w = flagWidth(p)
      return { w, h: 20, pins: [{ name: 'Y', dir: 'out', side: 'r', x: w + 10, y: 10, ...(Number(p.bits) > 1 ? { bus: Number(p.bits) } : {}) }] }
    },
    evaluate(inst) {
      // Only reached when nothing publishes this name; a matched label shares the sender's net instead.
      inst.outs[0] = X
    },
  },
  {
    type: 'hexin',
    name: '4-bit input',
    category: 'io',
    description: 'Outputs a 4-bit number (A = least significant bit). Click to count up, Alt/Option-click to count down.',
    params: [{ key: 'value', label: 'Value', kind: 'number', min: 0, max: 15, default: 0 }],
    interactive: 'cycle',
    pins: {
      A: 'Bit 0 of the number (the least significant bit).',
      B: 'Bit 1 of the number.',
      C: 'Bit 2 of the number.',
      D: 'Bit 3 of the number (the most significant bit).',
      Q: 'All four bits as one bus (bus ports on), bit 0 first.',
    },
    layout: () => box({ w: 40, right: ['A', 'B', 'C', 'D'] }),
    evaluate(inst) {
      writeNum(inst.outs, 0, 4, Number(inst.params.value) & 15)
    },
  },
  {
    type: 'led',
    name: 'LED',
    category: 'io',
    description: 'Lights up while its input is 1. Dark for 0 and for unknown (X).',
    params: [
      {
        key: 'color',
        label: 'Color',
        kind: 'select',
        default: 'green',
        options: ['green', 'red', 'yellow', 'blue', 'white'].map((c) => ({ value: c, label: c })),
      },
    ],
    pins: {
      A: 'The LED lights while this is 1; it stays dark for 0 and for an unknown (X) input.',
    },
    layout: () => ({ w: 20, h: 20, pins: [{ name: 'A', dir: 'in', side: 'l', x: -10, y: 10 }] }),
    evaluate() {},
  },
]

/** How much history a probe keeps, in simulated ms. */
export const TRACE_KEEP_MS = 60_000

/** A probe's recorded signal: value `v[i]` holds from time `t[i]` (ms) until the next transition. */
export interface Trace {
  t: number[]
  v: V[]
}

/** What a probe of several bits records: the number it reads (-1 while some bit is unknown) instead of a logic value. */
export interface NumberTrace {
  t: number[]
  v: number[]
}

/** Bits a probe watches (1 for an ordinary probe, and for one saved before there was a choice). */
export const probeBits = (p: Params) => Number(p.bits) || 1

export const probe: ComponentDef = {
  type: 'probe',
  name: 'Probe',
  category: 'io',
  description:
    'Records the signal at its input and draws it in the waveform panel. Give it a label: that is the name of ' +
    'its trace. Place several to compare signals over time. Probes with the same group name are drawn as one trace ' +
    'that shows the number they form (select several probes to group them). Give it more bits to record a whole bus ' +
    'as one trace.',
  params: [
    {
      key: 'group',
      label: 'Group (optional)',
      kind: 'text',
      default: '',
      pattern: '[A-Za-z0-9_]{0,12}',
      maxLength: 12,
      multiline: false,
      hint: 'Letters, digits and underscores, up to 12 characters.',
    },
    { key: 'bit', label: 'Bit in the group (0 = least significant)', kind: 'number', min: 0, max: 15, default: 0 },
    {
      key: 'bits',
      label: 'Bits (a bus)',
      kind: 'number',
      min: 1,
      max: 16,
      default: 1,
      structural: true,
    },
  ],
  init: (): Trace => ({ t: [], v: [] }),
  pins: {
    'A#|A': 'The signal to record in the waveform panel. With more than one bit the pins form one number (A0 is the least significant bit).',
  },
  layout: (p) => {
    const n = probeBits(p)
    return n === 1 ? { w: 30, h: 20, pins: [{ name: 'A', dir: 'in', side: 'l', x: -10, y: 10 }] } : box({ w: 60, left: names('A', n) })
  },
  groups: (p) => (probeBits(p) > 1 ? [numbered('A', 'in', 'A', probeBits(p))] : []),
  sample(inst, time) {
    const st = inst.state as { t: number[]; v: number[] }
    // A probe of several bits records the number, so a bus is one row in the waveform panel.
    const v = inst.ins.length > 1 ? toNum(inst.ins, 0, inst.ins.length) : inst.ins[0]
    if (st.v.length && st.v[st.v.length - 1] === v) return
    st.t.push(time)
    st.v.push(v)
    // Forget old history in batches, but keep the value that was in effect at the start of the window.
    const cutoff = time - TRACE_KEEP_MS
    if (st.t.length > 2 && st.t[1] < cutoff - 5000) {
      let k = 1
      while (k + 1 < st.t.length && st.t[k + 1] < cutoff) k++
      st.t.splice(0, k)
      st.v.splice(0, k)
    }
  },
  rewind(inst, time) {
    const st = inst.state as Trace
    while (st.t.length && st.t[st.t.length - 1] > time) {
      st.t.pop()
      st.v.pop()
    }
  },
  evaluate() {},
}

/** Remembers what a breakpoint saw last. `prev` is undefined until the first look, which only sets the baseline. */
interface BreakState {
  prev?: number
  met?: boolean
}

export const breakpoint: ComponentDef = {
  type: 'breakpoint',
  name: 'Breakpoint',
  category: 'io',
  description:
    'Pauses the simulation when the signal at its input becomes equal to a value, or when it changes. Give it ' +
    'more bits to watch a whole number (A0 is the least significant). It stops right at the clock edge that did it, ' +
    'and fires only when the condition starts to hold, so you can press Run again and carry on. Unknown (grey) ' +
    'inputs never trigger it.',
  params: [
    {
      key: 'width',
      label: 'Bits to watch',
      kind: 'select',
      default: 1,
      structural: true,
      options: [1, 4, 8, 16].map((v) => ({ value: v, label: v === 1 ? '1 (a single signal)' : `${v} (a number)` })),
    },
    {
      key: 'when',
      label: 'Pause when it',
      kind: 'select',
      default: 'equals',
      options: [
        { value: 'equals', label: 'becomes equal to the value' },
        { value: 'changes', label: 'changes' },
      ],
    },
    { key: 'value', label: 'Value (decimal)', kind: 'number', min: 0, max: 65535, default: 1 },
  ],
  init: (): BreakState => ({}),
  pins: {
    'A#|A': 'The signal to watch. With more than one bit the pins form one number (A0 is the least significant bit); an unknown (X) bit never triggers it.',
  },
  layout: (p) => {
    const n = Number(p.width)
    return n === 1
      ? { w: 50, h: 20, pins: [{ name: 'A', dir: 'in', side: 'l', x: -10, y: 10 }] }
      : box({ w: 60, left: names('A', n) })
  },
  title: (p) => `STOP\n${p.when === 'changes' ? 'changes' : `= ${p.value}`}`,
  rewind(inst) {
    // Stepped back in time: what it saw last is no longer what came before, so look afresh (without firing).
    delete (inst.state as BreakState).prev
  },
  sample(inst) {
    const st = inst.state as BreakState
    const v = toNum(inst.ins, 0, inst.ins.length)
    const equals = inst.params.when !== 'changes'
    const now = equals ? (v >= 0 && v === Number(inst.params.value) ? 1 : 0) : v
    const before = st.prev
    if (equals) {
      st.prev = now
      // Fires when the condition starts to hold. The first look only sets the baseline.
      return before === 0 && now === 1
    }
    if (v < 0) return false // unknown: neither a change nor a new baseline
    st.prev = v
    return before !== undefined && before !== v
  },
  evaluate() {},
}

/** Segment patterns a..g for hex digits 0-F (bit 0 = a). */
export const SEG_HEX = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71]

export const display: ComponentDef[] = [
  {
    type: 'seg7',
    name: '7-segment display',
    category: 'display',
    description: 'Seven-segment display. Each input lights one segment (a–g) or the decimal point (dp) while it is 1. Use a BCD → 7-segment decoder to show digits.',
    pins: {
      a: 'Top segment, lit while 1.',
      b: 'Upper right segment, lit while 1.',
      c: 'Lower right segment, lit while 1.',
      d: 'Bottom segment, lit while 1.',
      e: 'Lower left segment, lit while 1.',
      f: 'Upper left segment, lit while 1.',
      g: 'Middle segment, lit while 1.',
      dp: 'Decimal point, lit while 1.',
    },
    layout: () => box({ w: 80, left: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'] }),
    evaluate() {},
  },
  {
    type: 'hexdisp',
    name: 'Hex display',
    category: 'display',
    description: 'Shows the 4-bit input (A = least significant bit) as a hex digit 0–F.',
    pins: {
      A: 'Bit 0 of the digit (the least significant bit).',
      B: 'Bit 1 of the digit.',
      C: 'Bit 2 of the digit.',
      D: 'Bit 3 of the digit (the most significant bit).',
      IN: 'All four bits as one bus (bus ports on), bit 0 first.',
    },
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
    pins: {
      TL: 'Top-left pip, shown while 1.',
      TR: 'Top-right pip, shown while 1.',
      ML: 'Middle-left pip, shown while 1.',
      C: 'Centre pip, shown while 1.',
      MR: 'Middle-right pip, shown while 1.',
      BL: 'Bottom-left pip, shown while 1.',
      BR: 'Bottom-right pip, shown while 1.',
    },
    layout: () => box({ w: 160, left: ['TL', 'TR', 'ML', 'C', 'MR', 'BL', 'BR'] }),
    evaluate() {},
  },
  {
    type: 'matrix',
    name: 'Dot matrix 8×8',
    category: 'display',
    description:
      'An 8×8 grid of LEDs. Pixel (row, column) lights while its row input R and its column input C are both 1. ' +
      'Pixels glow for a moment after they go dark, so an image drawn one row at a time by a fast scan looks steady.',
    pins: {
      'R#': 'Row n (R0 is the top row). A pixel lights while its row and its column are both 1.',
      'C#': 'Column n (C0 is the left column). A pixel lights while its row and its column are both 1.',
    },
    layout: () => box({ w: 200, left: names('R', 8), top: names('C', 8) }),
    // Simulated time each pixel was last lit (row-major), for the glow.
    init: () => ({ lit: new Float64Array(64).fill(-Infinity) }),
    sample(inst, time) {
      const { ins } = inst
      const lit = inst.state.lit as Float64Array
      for (let r = 0; r < 8; r++) {
        if (ins[r] !== 1) continue
        for (let c = 0; c < 8; c++) if (ins[8 + c] === 1) lit[r * 8 + c] = time
      }
    },
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
    // In bus mode the LEDs sit side by side, so the body is as wide as the row.
    pins: {
      'I#|I': 'LED n of the bar (I0 is the left one), lit while 1. With bus ports on, one bus lights all of them.',
    },
    layout: (p) => box({ w: p.bus ? 20 + 10 * Number(p.n) : 40, left: Array.from({ length: Number(p.n) }, (_, i) => `I${i}`) }),
    evaluate() {},
  },
]
