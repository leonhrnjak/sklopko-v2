import { numbered } from '../bus'
import { box, names, type PinSpec } from '../layouts'
import { X, writeNum, type ComponentDef, type Params, type ParamDef, type PinGroup, type V } from '../types'

/**
 * The n-bit family: parts whose data pins are buses (2 to 16 bits). They are always in bus mode; internally they are
 * plain scalar pins `D0..`, `Q0..`, like the 4-bit parts, so the simulator needs nothing new.
 */

const bitsParam: ParamDef = { key: 'bits', label: 'Bits', kind: 'number', min: 2, max: 16, default: 8, structural: true }
const widthOf = (p: Params) => Number(p.bits)
const maskOf = (p: Params) => 2 ** widthOf(p) - 1

const CLK: PinSpec = { name: 'CLK', clock: true }

/** Hex digits of a `bits`-wide number. */
const digits = (p: Params) => Math.ceil(widthOf(p) / 4)
export const hexOf = (n: number, p: Params) => n.toString(16).toUpperCase().padStart(digits(p), '0')

const HEX = '[0-9a-fA-F]{1,4}'
/** The number in a hex text param, cut to the width. */
export const hexValue = (p: Params) => (parseInt(String(p.value), 16) || 0) & maskOf(p)

const valueParam = (label: string): ParamDef => ({
  key: 'value',
  label,
  kind: 'text',
  default: '0',
  pattern: HEX,
  maxLength: 4,
  multiline: false,
  hint: 'Hexadecimal digits (0–9, A–F), up to four.',
})

const bus = (name: string, dir: PinGroup['dir'], n: number) => numbered(name, dir, name, n)
const twoBuses = (p: Params) => [bus('A', 'in', widthOf(p)), bus('B', 'in', widthOf(p))]

/** The two-input gates on 0, 1 and X, as the n-input `and`, `or` and `xor` of gates.ts have them (without making an array). */
const and2 = (a: V, b: V): V => (a === 0 || b === 0 ? 0 : a === X || b === X ? X : 1)
const or2 = (a: V, b: V): V => (a === 1 || b === 1 ? 1 : a === X || b === X ? X : 0)
const xor2 = (a: V, b: V): V => (a === X || b === X ? X : ((a ^ b) as V))
const flip = (v: V): V => (v > 1 ? X : ((1 - v) as V))

const GATES: Record<string, { label: string; fn: (a: V, b: V) => V }> = {
  and: { label: 'AND', fn: and2 },
  or: { label: 'OR', fn: or2 },
  xor: { label: 'XOR', fn: xor2 },
  nand: { label: 'NAND', fn: (a, b) => flip(and2(a, b)) },
  nor: { label: 'NOR', fn: (a, b) => flip(or2(a, b)) },
  xnor: { label: 'XNOR', fn: (a, b) => flip(xor2(a, b)) },
  not: { label: 'NOT', fn: (a) => flip(a) },
}

const log2 = (n: number) => Math.round(Math.log2(n))

export const nbit: ComponentDef[] = [
  {
    type: 'busconst',
    name: 'Bus constant',
    category: 'buses',
    description: 'A fixed number on a bus, written in hexadecimal.',
    params: [bitsParam, valueParam('Value (hex)')],
    title: (p) => `${hexOf(hexValue(p), p)}`,
    layout: (p) => box({ w: 60, right: names('Q', widthOf(p)) }),
    groups: (p) => [bus('Q', 'out', widthOf(p))],
    evaluate(inst) {
      writeNum(inst.outs, 0, widthOf(inst.params), hexValue(inst.params))
    },
  },
  {
    type: 'busin',
    name: 'Bus input',
    category: 'buses',
    description:
      'A number you set by hand, on a bus. Click it to count up, Alt/Option-click to count down; or type the value (in ' +
      'hexadecimal) in the inspector.',
    params: [bitsParam, valueParam('Value (hex)')],
    interactive: 'cycle',
    title: (p) => `${hexOf(hexValue(p), p)}\n${hexValue(p)}`,
    layout: (p) => box({ w: 60, right: names('Q', widthOf(p)) }),
    groups: (p) => [bus('Q', 'out', widthOf(p))],
    cycle: (p, back) => ({ ...p, value: ((hexValue(p) + (back ? maskOf(p) : 1)) & maskOf(p)).toString(16).toUpperCase() }),
    evaluate(inst) {
      writeNum(inst.outs, 0, widthOf(inst.params), hexValue(inst.params))
    },
  },
  {
    type: 'busdisp',
    name: 'Bus display',
    category: 'buses',
    description: 'Shows the number on a bus, in hexadecimal, decimal or binary. A question mark means some bit is unknown.',
    params: [
      bitsParam,
      {
        key: 'format',
        label: 'Shown as',
        kind: 'select',
        default: 'hex',
        structural: true,
        options: [
          { value: 'hex', label: 'Hexadecimal' },
          { value: 'dec', label: 'Decimal' },
          { value: 'bin', label: 'Binary' },
        ],
      },
    ],
    live: true,
    // The readout is drawn by the symbol, from the bus's value.
    layout: (p) => box({ w: p.format === 'bin' ? Math.ceil((widthOf(p) * 9 + 30) / 20) * 20 : 80, left: names('A', widthOf(p)) }),
    groups: (p) => [bus('A', 'in', widthOf(p))],
    evaluate() {},
  },
  {
    type: 'busreg',
    name: 'Register',
    category: 'buses',
    description: 'Loads the bus D on the rising clock edge while LD=1, and holds it on Q. CLR clears it to 0.',
    params: [bitsParam],
    title: () => 'REG',
    init: () => ({ n: 0, pc: X as V }),
    layout: (p) =>
      box({
        left: [...names('D', widthOf(p)), { name: 'LD', def: 1 }, CLK],
        bottom: [{ name: 'CLR', def: 0 }],
        right: names('Q', widthOf(p)),
      }),
    groups: (p) => [bus('D', 'in', widthOf(p)), bus('Q', 'out', widthOf(p))],
  },
  {
    type: 'busctr',
    name: 'Counter (bus)',
    category: 'buses',
    description:
      'Binary counter with parallel load. On a rising CLK: LD=1 loads D, otherwise it counts up while EN=1, and wraps ' +
      'around after the largest number. R resets it to 0 at once. CO is high at the largest number while EN=1.',
    params: [bitsParam],
    title: () => 'CNTR\nLOAD',
    init: () => ({ n: 0, pc: X as V }),
    layout: (p) =>
      box({
        left: [...names('D', widthOf(p)), { name: 'LD', def: 0 }, { name: 'EN', def: 1 }, CLK],
        bottom: [{ name: 'R', def: 0 }],
        right: [...names('Q', widthOf(p)), 'CO'],
      }),
    groups: (p) => [bus('D', 'in', widthOf(p)), bus('Q', 'out', widthOf(p))],
  },
  {
    type: 'busadd',
    name: 'Adder (bus)',
    category: 'buses',
    description: 'Adds the numbers A and B plus carry-in Ci: S is the sum, Co the carry out.',
    params: [bitsParam],
    title: () => 'Σ',
    layout: (p) => box({ left: [...names('A', widthOf(p)), ...names('B', widthOf(p)), { name: 'Ci', def: 0 }], right: [...names('S', widthOf(p)), 'Co'] }),
    groups: (p) => [...twoBuses(p), bus('S', 'out', widthOf(p))],
  },
  {
    type: 'bussub',
    name: 'Subtractor (bus)',
    category: 'buses',
    description: 'Computes A − B − Bi: D is the difference. Bo=1 means the result went below zero.',
    params: [bitsParam],
    title: () => '−',
    layout: (p) => box({ left: [...names('A', widthOf(p)), ...names('B', widthOf(p)), { name: 'Bi', def: 0 }], right: [...names('D', widthOf(p)), 'Bo'] }),
    groups: (p) => [...twoBuses(p), bus('D', 'out', widthOf(p))],
  },
  {
    type: 'busaddsub',
    name: 'Adder/subtractor (bus)',
    category: 'buses',
    description:
      'M=0: S = A + B. M=1: S = A − B (two’s complement). Co is the carry out, V signals signed overflow.',
    params: [bitsParam],
    title: () => '±',
    layout: (p) => box({ left: [...names('A', widthOf(p)), ...names('B', widthOf(p)), { name: 'M', def: 0 }], right: [...names('S', widthOf(p)), 'Co', 'V'] }),
    groups: (p) => [...twoBuses(p), bus('S', 'out', widthOf(p))],
  },
  {
    type: 'buscmp',
    name: 'Comparator (bus)',
    category: 'buses',
    description: 'Compares the numbers A and B (as unsigned numbers).',
    params: [bitsParam],
    title: () => 'COMP',
    layout: (p) =>
      box({
        left: [...names('A', widthOf(p)), ...names('B', widthOf(p))],
        right: [{ name: 'GT', label: 'A>B' }, { name: 'EQ', label: 'A=B' }, { name: 'LT', label: 'A<B' }],
      }),
    groups: twoBuses,
  },
  {
    type: 'busgate',
    name: 'Bitwise gate',
    category: 'buses',
    description:
      'A logic gate on every bit of a bus: bit i of Y is the gate applied to bit i of A and bit i of B (NOT has only A). ' +
      'It is as slow as the single gate.',
    params: [
      bitsParam,
      {
        key: 'op',
        label: 'Gate',
        kind: 'select',
        default: 'and',
        structural: true,
        options: Object.entries(GATES).map(([value, g]) => ({ value, label: g.label })),
      },
    ],
    title: (p) => (GATES[String(p.op)] ?? GATES.and).label,
    layout: (p) => box({ left: p.op === 'not' ? names('A', widthOf(p)) : [...names('A', widthOf(p)), ...names('B', widthOf(p))], right: names('Y', widthOf(p)) }),
    groups: (p) => [...(p.op === 'not' ? [bus('A', 'in', widthOf(p))] : twoBuses(p)), bus('Y', 'out', widthOf(p))],
  },
  {
    type: 'busmux',
    name: 'Multiplexer (bus)',
    category: 'buses',
    description: 'Passes the bus I0..In picked by the select S to Y. With two inputs, S is a single wire.',
    params: [
      bitsParam,
      {
        key: 'n',
        label: 'Inputs',
        kind: 'select',
        default: 4,
        structural: true,
        options: [2, 4, 8].map((v) => ({ value: v, label: String(v) })),
      },
    ],
    title: (p) => `MUX\n${p.n}:1`,
    layout: (p) => {
      const w = widthOf(p)
      const inputs = Array.from({ length: Number(p.n) }, (_, i) => names(`I${i}_`, w)).flat()
      return box({ w: 100, left: inputs, bottom: names('S', log2(Number(p.n))), right: names('Y', w), minRows: Number(p.n) + 1 })
    },
    groups: (p) => [
      ...Array.from({ length: Number(p.n) }, (_, i) => numbered(`I${i}`, 'in', `I${i}_`, widthOf(p))),
      ...(Number(p.n) > 2 ? [numbered('S', 'in', 'S', log2(Number(p.n)))] : []),
      bus('Y', 'out', widthOf(p)),
    ],
  },
]
