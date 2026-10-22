import { describe, expect, it } from 'vitest'
import { CircuitBuilder } from './builder'
import { MAX_ANALYZE_INPUTS, analyzeCircuit, circuitPorts, dependsOnState } from './analyze'

/** Two labelled switches into a gate into an LED. */
const gateCircuit = (gate: string) => {
  const b = new CircuitBuilder()
  const a = b.add('switch', 0, 0, { label: 'A' })
  const bb = b.add('switch', 0, 100, { label: 'B' })
  const g = b.add(gate, 150, 40)
  const led = b.add('led', 300, 50, { label: 'Y' })
  b.wire(`${a}.Q`, `${g}.A`)
  b.wire(`${bb}.Q`, `${g}.B`)
  b.wire(`${g}.Y`, `${led}.A`)
  return { c: b.build(), a, bb, g, led }
}

describe('circuit ports', () => {
  it('lists switches and LEDs top to bottom, then left to right, by label', () => {
    const b = new CircuitBuilder()
    const s2 = b.add('switch', 0, 100, { label: 'B' })
    const s1 = b.add('switch', 0, 0, { label: 'A' })
    const s3 = b.add('switch', 50, 0, { label: 'C' })
    const l1 = b.add('led', 300, 0, { label: 'Y' })
    const p = circuitPorts(b.c)
    expect(p.inputs).toEqual([{ id: s1, name: 'A' }, { id: s3, name: 'C' }, { id: s2, name: 'B' }])
    expect(p.outputs).toEqual([{ id: l1, name: 'Y' }])
  })

  it('makes labels safe for expressions, names the unlabelled, and keeps every name unique', () => {
    const b = new CircuitBuilder()
    b.add('switch', 0, 0, { label: 'Bit 0' })
    b.add('switch', 0, 40, { label: 'Bit 0' })
    b.add('switch', 0, 80)
    b.add('switch', 0, 120, { label: '3rd' })
    b.add('led', 100, 0, { label: 'A+B!' })
    b.add('led', 100, 40, { label: 'Bit 0' }) // clashes with a switch name
    b.add('led', 100, 80)
    const p = circuitPorts(b.c)
    expect(p.inputs.map((x) => x.name)).toEqual(['Bit_0', 'Bit_0_2', 'Switch3', '_3rd'])
    expect(p.outputs.map((x) => x.name)).toEqual(['A_B', 'Bit_0_3', 'LED3'])
  })
})

describe('analysing a circuit', () => {
  it('sweeps the switches through every combination, first switch as the most significant bit', () => {
    for (const [gate, want] of [['and', [0, 0, 0, 1]], ['or', [0, 1, 1, 1]], ['xor', [0, 1, 1, 0]], ['nand', [1, 1, 1, 0]], ['nor', [1, 0, 0, 0]]] as const) {
      const { c, a, bb, led } = gateCircuit(gate)
      const r = analyzeCircuit(c, [a, bb], [led])
      expect(r.table.inputs, gate).toEqual(['A', 'B'])
      expect(r.table.outputs).toEqual(['Y'])
      expect(r.table.values[0], gate).toEqual(want)
      expect(r.warnings).toEqual([])
    }
  })

  it('swapping the order of the inputs swaps the bit order of the rows', () => {
    const b = new CircuitBuilder()
    const a = b.add('switch', 0, 0, { label: 'A' })
    const bb = b.add('switch', 0, 100, { label: 'B' })
    const n = b.add('not', 100, 100)
    const g = b.add('and', 200, 40)
    const led = b.add('led', 350, 50, { label: 'Y' })
    b.wire(`${bb}.Q`, `${n}.A`)
    b.wire(`${a}.Q`, `${g}.A`)
    b.wire(`${n}.Y`, `${g}.B`) // Y = A·¬B
    b.wire(`${g}.Y`, `${led}.A`)
    const c = b.build()
    expect(analyzeCircuit(c, [a, bb], [led]).table.values[0]).toEqual([0, 0, 1, 0]) // rows AB: 10 is the third
    expect(analyzeCircuit(c, [bb, a], [led]).table.values[0]).toEqual([0, 1, 0, 0]) // rows BA: 01 is the second
  })

  it('reads several outputs at once, and leaves unchosen switches where they are', () => {
    const b = new CircuitBuilder()
    const a = b.add('switch', 0, 0, { label: 'A' })
    const bb = b.add('switch', 0, 100, { label: 'B' })
    const held = b.add('switch', 0, 200, { label: 'H', params: { on: true } })
    const x = b.add('xor', 150, 40)
    const n = b.add('and', 150, 160)
    const sum = b.add('led', 300, 50, { label: 'S' })
    const carry = b.add('led', 300, 170, { label: 'C' })
    b.wire(`${a}.Q`, `${x}.A`)
    b.wire(`${bb}.Q`, `${x}.B`)
    b.wire(`${a}.Q`, `${n}.A`)
    b.wire(`${held}.Q`, `${n}.B`) // C = A·H, with H held at 1
    b.wire(`${x}.Y`, `${sum}.A`)
    b.wire(`${n}.Y`, `${carry}.A`)
    const c = b.build()
    const r = analyzeCircuit(c, [a, bb], [sum, carry])
    expect(r.table.values).toEqual([[0, 1, 1, 0], [0, 0, 1, 1]])
    expect(c.comps[held].params.on).toBe(true) // the circuit itself is not changed
    expect(c.comps[a].params.on).toBe(false)
  })

  it('follows net labels', () => {
    const b = new CircuitBuilder()
    const a = b.add('switch', 0, 0, { label: 'A' })
    const tx = b.add('netsend', 100, 0, { params: { name: 'W' } })
    const rx = b.add('netrecv', 300, 0, { params: { name: 'W' } })
    const n = b.add('not', 400, 0)
    const led = b.add('led', 500, 0, { label: 'Y' })
    b.wire(`${a}.Q`, `${tx}.A`)
    b.wire(`${rx}.Y`, `${n}.A`)
    b.wire(`${n}.Y`, `${led}.A`)
    expect(analyzeCircuit(b.build(), [a], [led]).table.values[0]).toEqual([1, 0])
  })

  it('marks unknown values, and says so', () => {
    const b = new CircuitBuilder()
    const a = b.add('switch', 0, 0, { label: 'A' })
    const g = b.add('and', 150, 0)
    const led = b.add('led', 300, 10, { label: 'Y' })
    b.wire(`${a}.Q`, `${g}.A`) // B is not connected
    b.wire(`${g}.Y`, `${led}.A`)
    const r = analyzeCircuit(b.build(), [a], [led])
    expect(r.table.values[0]).toEqual([0, 2]) // 0·? = 0, 1·? = unknown
    expect(r.warnings.join(' ')).toContain('unknown')
  })

  it('warns when an output depends on memory or a clock', () => {
    const b = new CircuitBuilder()
    const d = b.add('switch', 0, 0, { label: 'D' })
    const clk = b.add('clock', 0, 100)
    const ff = b.add('dff', 150, 0)
    const led = b.add('led', 300, 10, { label: 'Q' })
    b.wire(`${d}.Q`, `${ff}.D`)
    b.wire(`${clk}.Q`, `${ff}.CLK`)
    b.wire(`${ff}.Q`, `${led}.A`)
    const c = b.build()
    expect(dependsOnState(c, led)).toBe(true)
    expect(analyzeCircuit(c, [d], [led]).warnings[0]).toContain('flip-flops, memory or a clock')
    expect(dependsOnState(gateCircuit('and').c, Object.keys(gateCircuit('and').c.comps).at(-1)!)).toBe(false)
  })

  it('warns when a circuit never settles', () => {
    const b = new CircuitBuilder()
    const a = b.add('switch', 0, 0, { label: 'A', params: { on: true } })
    const n = b.add('not', 100, 0)
    const led = b.add('led', 250, 0, { label: 'Y' })
    b.wire(`${n}.Y`, `${n}.A`) // a NOT feeding itself oscillates
    b.wire(`${n}.Y`, `${led}.A`)
    void a
    const r = analyzeCircuit(b.build(), [], [led])
    expect(r.warnings.join(' ')).toMatch(/never settled|unknown/)
  })

  it('refuses more inputs than it can sweep', () => {
    const b = new CircuitBuilder()
    const ids = Array.from({ length: MAX_ANALYZE_INPUTS + 1 }, (_, i) => b.add('switch', 0, i * 40))
    expect(() => analyzeCircuit(b.c, ids, [])).toThrow(RangeError)
  })

  it('works with no inputs: one row', () => {
    const b = new CircuitBuilder()
    const k = b.add('const', 0, 0, { params: { value: 1 } })
    const led = b.add('led', 100, 0, { label: 'Y' })
    b.wire(`${k}.Q`, `${led}.A`)
    expect(analyzeCircuit(b.build(), [], [led]).table).toEqual({ inputs: [], outputs: ['Y'], values: [[1]] })
  })
})
