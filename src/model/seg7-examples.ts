import { minimizeExpr } from '../logic/minimize'
import type { Cell } from '../logic/table'
import { CircuitBuilder } from './builder'
import { frameAround, note } from './annotate'
import type { Circuit } from './circuit'
import { synthesizeInto } from './synth'
import { layoutOf } from '../engine/layoutcache'

/** The segments (a to g) lit for each digit 0 to 9, as the display shows them. */
export const SEGMENTS = 'abcdefg'
export const LIT: Record<string, number[]> = {
  a: [0, 2, 3, 5, 6, 7, 8, 9],
  b: [0, 1, 2, 3, 4, 7, 8, 9],
  c: [0, 1, 3, 4, 5, 6, 7, 8, 9],
  d: [0, 2, 3, 5, 6, 8, 9],
  e: [0, 2, 6, 8],
  f: [0, 4, 5, 6, 8, 9],
  g: [2, 3, 4, 5, 6, 8, 9],
}

/** Row `row` of a truth table over the inputs b3 b2 b1 b0 (b3 first, the most significant bit) is the digit `row`; 10 to 15 do not matter. */
const cell = (seg: string, row: number): Cell => (row > 9 ? 2 : LIT[seg].includes(row) ? 1 : 0)

/**
 * A seven-segment decoder made three ways from one 4-bit input: from a truth table (what Tools → Logic → Build circuit makes, with
 * the codes 10 to 15 as "don't care"), from a BCD → decimal decoder with OR gates, and as the ready-made BCD → 7-segment part.
 */
export function seg7Table(): Circuit {
  const b = new CircuitBuilder()
  const input = b.add('hexin', 0, 0, { label: 'Digit (0–9)', params: { value: 5 } })
  const names = ['b3', 'b2', 'b1', 'b0'] // most significant first, as the Logic panel lists a table's inputs
  const pins = ['D', 'C', 'B', 'A'] // the 4-bit input's pins, least significant first
  names.forEach((n, i) => b.tap(`${input}.${pins[i]}`, n))

  // ---- 1. From a truth table ----------------------------------------------------------------------------
  const outputs = [...SEGMENTS].map((name) => {
    const values = Array.from({ length: 16 }, (_, row) => cell(name, row))
    const expr = minimizeExpr(values, names)
    return { name, written: expr, expr }
  })
  const origin = { x: 260, y: 0 }
  const made = synthesizeInto(b, { inputs: names, outputs }, { labelInputs: names, labelOutputs: [...SEGMENTS] }, origin)
  const shown1 = b.add('seg7', origin.x + made.width + 120, origin.y, { label: 'From the table' })
  for (const s of SEGMENTS) b.tag(`${shown1}.${s}`, s)
  // The note stands inside the first frame, to the right of its display, where the example opens.
  const text =
    'Three decoders for one digit. The first is made from a truth table: in Tools → Logic → Build → Truth table, choose 4 inputs, name an output a, click each row to set it (X for 10 to 15, which never occur) and press Build circuit; repeat for b to g. Try codes 10 to 15: the table version shows whatever came out smallest, the OR version and the part stay blank.'
  const guide = note(b, origin.x + made.width + 300, origin.y, text, 34)
  frameAround(b, 'From a truth table (Logic panel)', [...made.parts, shown1, guide])

  // ---- 2. From a BCD → decimal decoder and OR gates ------------------------------------------------------
  const y2 = Math.max(origin.y + made.height, origin.y + 260) + 140
  const dec = b.add('bcddec', 260, y2, { label: 'BCD → decimal' })
  pins.forEach((p) => b.wire(`${input}.${p}`, `${dec}.${p}`))
  const gates: string[] = []
  const shown2 = b.add('seg7', 860, y2, { label: 'From the decoder' })
  let y = y2
  for (const s of SEGMENTS) {
    const lit = LIT[s]
    // A gate has at most 8 inputs: a longer list is OR-ed in two steps.
    const first = lit.slice(0, 8)
    const rest = lit.slice(first.length)
    const inputs = Math.max(2, first.length)
    const or = b.add('or', 540, y, { params: { inputs } })
    gates.push(or)
    first.forEach((d, k) => b.wire(`${dec}.Y${d}`, `${or}.${String.fromCharCode(65 + k)}`))
    if (rest.length) {
      const more = b.add('or', 680, y + 20)
      gates.push(more)
      b.wire(`${or}.Y`, `${more}.A`)
      b.wire(`${dec}.Y${rest[0]}`, `${more}.B`)
      b.wire(`${more}.Y`, `${shown2}.${s}`)
    } else b.wire(`${or}.Y`, `${shown2}.${s}`)
    y += layoutOf('or', { inputs }).h + 30
  }
  frameAround(b, 'From a decoder and OR gates', [dec, ...gates, shown2])

  // ---- 3. The ready-made part ---------------------------------------------------------------------------
  const y3 = y + 100
  const chip = b.add('bcd7', 260, y3, { label: 'BCD → 7-segment part' })
  pins.forEach((p) => b.wire(`${input}.${p}`, `${chip}.${p}`))
  const shown3 = b.add('seg7', 540, y3, { label: 'The part' })
  for (const s of SEGMENTS) b.wire(`${chip}.${s}`, `${shown3}.${s}`)
  frameAround(b, 'The ready-made part', [chip, shown3])

  return b.build()
}
