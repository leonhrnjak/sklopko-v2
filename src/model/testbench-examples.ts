import { CircuitBuilder } from './builder'
import { frameAround, note } from './annotate'
import type { Circuit } from './circuit'

/** The testbench saved in the example: Tools → Tests → Run tests. Every line is one step, and every step passes. */
export const TESTBENCH_TESTS = `# A comparator, a majority circuit and a demultiplexer, checked by steps.
# Switches are set by name, a line can also say "expect", and a failing line is marked.

# Comparator: A0 to A3 and B0 to B3, bit 0 is the least significant.
expect EQ=1 GT=0 LT=0                        # 0 and 0 are equal
A0=1 A2=1; B0=1 B2=1; expect EQ=1 GT=0 LT=0  # 5 and 5
A0=1 A2=0 A3=1; expect GT=1 EQ=0 LT=0        # 9 against 5
A0=1 A1=1 A2=0 A3=0; B0=0 B1=0 B2=1 B3=1; expect LT=1 EQ=0 GT=0   # 3 against 12
A0=0 A1=0 A2=0 A3=1; B0=1 B1=1 B2=1 B3=0; expect GT=1   # 8 against 7: the top bit decides

# Majority of P, Q and R: the gates and the lookup table that replaces them agree.
P=1 Q=1 R=0; expect Gates=1 Lut=1
P=1 Q=0; expect Gates=0 Lut=0
R=1; expect Gates=1 Lut=1

# Demultiplexer: D goes to the output the select switches choose.
D=1; expect O0=1 O1=0 O2=0 O3=0
Sel1=1; expect O0=0 O2=1
Sel0=1; expect O2=0 O3=1
D=0; expect O3=0
`

/**
 * A comparator, a majority circuit built from gates beside the lookup table that replaces it, and a demultiplexer, with a testbench
 * saved in the circuit (`Circuit.tests`) that checks all three.
 */
export function testbench(): Circuit {
  const b = new CircuitBuilder()
  const lamp = (x: number, y: number, label: string, color = 'green') => b.add('led', x, y, { label, params: { color } })

  // ---- Comparator ---------------------------------------------------------------------------------------
  const a = [0, 1, 2, 3].map((i) => b.add('switch', 0, i * 60, { label: `A${i}` }))
  const bb = [0, 1, 2, 3].map((i) => b.add('switch', 0, 280 + i * 60, { label: `B${i}` }))
  const cmp = b.add('cmp4', 200, 120, { label: 'Comparator' })
  a.forEach((s, i) => b.wire(`${s}.Q`, `${cmp}.A${i}`))
  bb.forEach((s, i) => b.wire(`${s}.Q`, `${cmp}.B${i}`))
  const leds = [
    ['GT', 'GT', 'green'],
    ['EQ', 'EQ', 'yellow'],
    ['LT', 'LT', 'red'],
  ].map(([pin, label, color], i) => {
    const l = lamp(420, 160 + i * 60, label, color)
    b.wire(`${cmp}.${pin}`, `${l}.A`)
    return l
  })
  const guide = note(
    b,
    520,
    0,
    'This circuit has a testbench saved in it. Open Tools → Tests and press Run tests: each line sets switches by name and checks the lamps, and all of them pass. Break something (move a wire, change the lookup table) and run them again to see which line fails. The tests are saved with the circuit, in the file you download.',
    34,
  )
  frameAround(b, 'Comparator', [...a, ...bb, cmp, ...leds, guide])

  // ---- Majority: three ANDs and an OR, and the lookup table that is the same function -------------------
  const x0 = 1000
  const p = b.add('switch', x0, 20, { label: 'P' })
  const q = b.add('switch', x0, 100, { label: 'Q' })
  const r = b.add('switch', x0, 180, { label: 'R' })
  const ands = [
    [p, q],
    [p, r],
    [q, r],
  ].map(([u, v], i) => {
    const g = b.add('and', x0 + 160, i * 90)
    b.wire(`${u}.Q`, `${g}.A`)
    b.wire(`${v}.Q`, `${g}.B`)
    return g
  })
  const or = b.add('or', x0 + 320, 90, { params: { inputs: 3 } })
  ands.forEach((g, i) => b.wire(`${g}.Y`, `${or}.${'ABC'[i]}`))
  const gates = lamp(x0 + 460, 100, 'Gates')
  b.wire(`${or}.Y`, `${gates}.A`)
  const lut = b.add('lut', x0 + 160, 320, { params: { inputs: 3, outputs: 1, data: '0 0 0 1 0 1 1 1' }, label: 'Lookup table' })
  b.wire(`${p}.Q`, `${lut}.A`)
  b.wire(`${q}.Q`, `${lut}.B`)
  b.wire(`${r}.Q`, `${lut}.C`)
  const lutLamp = lamp(x0 + 460, 330, 'Lut')
  b.wire(`${lut}.Y`, `${lutLamp}.A`)
  frameAround(b, 'Majority: gates, and a lookup table', [p, q, r, ...ands, or, gates, lut, lutLamp])

  // ---- Demultiplexer ------------------------------------------------------------------------------------
  const y0 = 640
  const d = b.add('switch', x0, y0 + 20, { label: 'D' })
  const sel0 = b.add('switch', x0, y0 + 120, { label: 'Sel0' })
  const sel1 = b.add('switch', x0, y0 + 200, { label: 'Sel1' })
  const demux = b.add('demux', x0 + 160, y0, { params: { n: 4 }, label: 'Demultiplexer' })
  b.wire(`${d}.Q`, `${demux}.I`)
  b.wire(`${sel0}.Q`, `${demux}.S0`)
  b.wire(`${sel1}.Q`, `${demux}.S1`)
  const outs = [0, 1, 2, 3].map((i) => {
    const l = lamp(x0 + 360, y0 + i * 50, `O${i}`)
    b.wire(`${demux}.Y${i}`, `${l}.A`)
    return l
  })
  frameAround(b, 'Demultiplexer: D goes where Sel says', [d, sel0, sel1, demux, ...outs])

  b.c.tests = TESTBENCH_TESTS
  return b.build()
}
