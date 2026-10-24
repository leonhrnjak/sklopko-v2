import { splitOffsets, splitWidths } from '../bus'
import { box, type PinSpec } from '../layouts'
import type { ComponentDef, ParamDef, Params } from '../types'

const bitsParam: ParamDef = { key: 'bits', label: 'Bits', kind: 'number', min: 2, max: 16, default: 8, structural: true }
const splitParam: ParamDef = {
  key: 'split',
  label: 'Pieces',
  kind: 'text',
  default: '4,4',
  pattern: '[0-9]{1,2}(,[0-9]{1,2}){0,15}',
  maxLength: 47,
  multiline: false,
  hint: 'Widths of the pieces, lowest bits first, adding up to the number of bits: 4,4 or 1,1,6.',
  structural: true,
}

/** `[3:0]` for a piece of several bits starting at `from`, `[5]` for a single bit. */
const range = (from: number, width: number) => (width === 1 ? `[${from}]` : `[${from + width - 1}:${from}]`)

/** One pin per piece: a bus pin for a piece of several bits, an ordinary pin for a single bit. */
function pieces(p: Params, prefix: string, dir: 'in' | 'out'): PinSpec[] {
  const offsets = splitOffsets(p)
  return splitWidths(p).map((w, i) => ({ name: `${prefix}${i}`, label: range(offsets[i], w), dir, ...(w > 1 ? { bus: w } : {}) }))
}

const whole = (p: Params, name: string, dir: 'in' | 'out'): PinSpec => ({
  name,
  label: range(0, Number(p.bits)),
  dir,
  bus: Number(p.bits),
})

export const buses: ComponentDef[] = [
  {
    type: 'splitter',
    name: 'Splitter',
    category: 'buses',
    description:
      'Takes a bus apart: the bits of A come out as pieces Y0, Y1... (lowest bits first). A piece of one bit is an ordinary wire. ' +
      'Pure wiring: it adds no delay.',
    pins: {
      A: 'The whole bus to take apart (Bits wide, bit 0 is the lowest).',
      'Y#': 'One piece of A, lowest bits first; its range is shown on the pin, e.g. [3:0]. A piece of one bit is an ordinary wire.',
    },
    params: [bitsParam, splitParam],
    wiring: true,
    title: () => 'SPLIT',
    layout: (p) => box({ left: [whole(p, 'A', 'in')], right: pieces(p, 'Y', 'out') }),
    evaluate() {},
  },
  {
    type: 'merger',
    name: 'Merger',
    category: 'buses',
    description:
      'Puts wires and smaller buses together into one bus: the pieces A0, A1... (lowest bits first) make up Y. ' +
      'Pure wiring: it adds no delay.',
    pins: {
      'A#': 'One piece of the bus, lowest bits first; its range in Y is shown on the pin, e.g. [3:0]. A piece of one bit is an ordinary wire.',
      Y: 'The whole bus (Bits wide) made of all the pieces: A0 gives the lowest bits.',
    },
    params: [bitsParam, splitParam],
    wiring: true,
    title: () => 'MERGE',
    layout: (p) => box({ left: pieces(p, 'A', 'in'), right: [whole(p, 'Y', 'out')] }),
    evaluate() {},
  },
]
