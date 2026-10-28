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

/**
 * Width of the body: room for the spine on one side and the widest piece label on the other. The symbol is a comb, not a box
 * with a title, so it needs far less than a part with a label on every pin.
 */
function combWidth(p: Params): number {
  const offsets = splitOffsets(p)
  const label = Math.max(...splitWidths(p).map((w, i) => range(offsets[i], w).length * 6))
  return Math.max(40, Math.ceil((label + 24) / 20) * 20)
}

export const buses: ComponentDef[] = [
  {
    type: 'splitter',
    name: 'Splitter',
    category: 'buses',
    description:
      'Takes a bus apart: the bits of A come out as pieces Y0, Y1... (lowest bits first). A piece of one bit is an ordinary wire. ' +
      'Pure wiring: it adds no delay.',
    params: [bitsParam, splitParam],
    wiring: true,
    title: () => 'SPLIT',
    layout: (p) => box({ left: [whole(p, 'A', 'in')], right: pieces(p, 'Y', 'out'), w: combWidth(p) }),
    evaluate() {},
  },
  {
    type: 'merger',
    name: 'Merger',
    category: 'buses',
    description:
      'Puts wires and smaller buses together into one bus: the pieces A0, A1... (lowest bits first) make up Y. ' +
      'Pure wiring: it adds no delay.',
    params: [bitsParam, splitParam],
    wiring: true,
    title: () => 'MERGE',
    layout: (p) => box({ left: pieces(p, 'A', 'in'), right: [whole(p, 'Y', 'out')], w: combWidth(p) }),
    evaluate() {},
  },
]
