import { describe, expect, it } from 'vitest'
import { Simulator } from '../engine/simulator'
import { parseProgram, print, resolveProgram, variables, type Expr, type Program } from '../logic/expr'
import { rowBits, tableOfProgram, type Cell, type TruthTable } from '../logic/table'
import { randomExpr, rng } from '../logic/testing'
import { validPath } from '../routing/path'
import { wireEndpoints } from '../routing/router'
import { boundsRect, type Circuit } from './circuit'
import { CircuitBuilder } from './builder'
import { synthesize, synthesizeInto, synthesizeTable } from './synth'

const programOf = (text: string): Program => {
  const r = resolveProgram(parseProgram(text).statements)
  expect(r.errors).toEqual([])
  return r.program!
}

/** Simulate a generated circuit over every input row; returns the table the LEDs give (labels are the names). */
function simulate(c: Circuit, inputs: string[], outputs: string[]): TruthTable {
  const sim = new Simulator()
  sim.load({
    comps: Object.values(c.comps).map(({ id, type, params }) => ({ id, type, params })),
    wires: Object.values(c.wires).map(({ from, to }) => ({ from, to })),
  })
  const byLabel = (label: string, type: string) => Object.values(c.comps).find((k) => k.type === type && k.label === label)!
  const values: Cell[][] = outputs.map(() => [])
  for (let row = 0; row < 2 ** inputs.length; row++) {
    const bits = rowBits(row, inputs.length)
    inputs.forEach((name, i) => {
      const sw = byLabel(name, 'switch')
      sim.setParams(sw.id, { ...sw.params, on: bits[i] === 1 })
    })
    sim.settle()
    outputs.forEach((name, o) => values[o].push(sim.pinValue(byLabel(name, 'led').id, 'A') as Cell))
  }
  return { inputs, outputs, values }
}

const count = (c: Circuit, type: string) => Object.values(c.comps).filter((k) => k.type === type).length

describe('building a circuit from expressions', () => {
  it('makes a switch for each input, an LED for each output, and the gates in between', () => {
    const c = synthesize(programOf('S = A ⊕ B\nC = A·B'))
    expect([count(c, 'switch'), count(c, 'led'), count(c, 'xor'), count(c, 'and'), count(c, 'not')]).toEqual([2, 2, 1, 1, 0])
    expect(Object.values(c.comps).filter((k) => k.type === 'switch').map((k) => k.label)).toEqual(['A', 'B'])
    expect(Object.values(c.comps).filter((k) => k.type === 'led').map((k) => k.label)).toEqual(['S', 'C'])
  })

  it('behaves as the expressions say', () => {
    for (const text of ['Y = A·B + ¬C', 'S = A ⊕ B ⊕ Cin\nCout = A·B + Cin·(A ⊕ B)', 'Y = ¬(A + B)·C', 'F = (A + B)·(C + D)·¬(A·D)']) {
      const p = programOf(text)
      const want = tableOfProgram(p)
      expect(simulate(synthesize(p), want.inputs, want.outputs), text).toEqual(want)
      expect(simulate(synthesize(p, { simplify: true }), want.inputs, want.outputs), `${text} (simplified)`).toEqual(want)
    }
  })

  it('behaves as the expression says for hundreds of random expressions, built as written and simplified', () => {
    const next = rng(4242)
    for (let trial = 0; trial < 150; trial++) {
      const names = ['A', 'B', 'C', 'D'].slice(0, 2 + Math.floor(next() * 3))
      const e: Expr = randomExpr(next, names, 4)
      const inputs = names.filter((n) => variables(e).includes(n))
      const p: Program = { inputs, outputs: [{ name: 'Y', written: e, expr: e }] }
      const want = tableOfProgram(p)
      for (const simplify of [false, true]) {
        const got = simulate(synthesize(p, { simplify }), inputs, ['Y'])
        expect(got.values, `${print(e)} (simplify ${simplify})`).toEqual(want.values)
      }
    }
  })

  it('builds identical logic once: lines that share a sub-expression, or use each other, share a gate', () => {
    const shared = synthesize(programOf('X = A + B\nY = X·C\nZ = ¬X'))
    expect(count(shared, 'or')).toBe(1)
    expect(count(shared, 'led')).toBe(3)
    const twice = synthesize(programOf('P = A·B\nQ = B·A + C'))
    expect(count(twice, 'and')).toBe(1) // A·B and B·A are the same gate
    const inverter = synthesize(programOf('P = ¬A·B\nQ = ¬A + C'))
    expect(count(inverter, 'not')).toBe(1)
  })

  it('folds constants, repeats and double negations instead of building them', () => {
    expect(count(synthesize(programOf('Y = A·1')), 'and')).toBe(0)
    expect(count(synthesize(programOf('Y = A + A')), 'or')).toBe(0)
    expect(count(synthesize(programOf('Y = ¬¬A')), 'not')).toBe(0)
    expect(count(synthesize(programOf('Y = A ⊕ A ⊕ B')), 'xor')).toBe(0) // = B
    const zero = synthesize(programOf('Y = A·0'))
    expect(count(zero, 'const')).toBe(1)
    expect(simulate(zero, ['A'], ['Y']).values).toEqual([[0, 0]])
    expect(simulate(synthesize(programOf('Y = A ⊕ 1')), ['A'], ['Y']).values).toEqual([[1, 0]])
  })

  it('a constant or a bare input is a legal output', () => {
    expect(simulate(synthesize(programOf('Y = 1')), [], ['Y']).values).toEqual([[1]])
    expect(simulate(synthesize(programOf('Y = A')), ['A'], ['Y']).values).toEqual([[0, 1]])
  })

  it('splits a gate with more than 8 inputs into several', () => {
    const names = Array.from({ length: 10 }, (_, i) => `X${i}`)
    for (const op of ['·', '+', '⊕']) {
      const p = programOf(`Y = ${names.join(` ${op} `)}`)
      const c = synthesize(p)
      const gates = Object.values(c.comps).filter((k) => ['and', 'or', 'xor'].includes(k.type))
      expect(gates.length, op).toBeGreaterThan(1)
      expect(Math.max(...gates.map((k) => Number(k.params.inputs))), op).toBeLessThanOrEqual(8)
      expect(simulate(c, names, ['Y']).values, op).toEqual(tableOfProgram(p).values)
    }
  })

  it('keeps a switch for an input the logic does not use', () => {
    const p = programOf('Y = A + A·B')
    expect(count(synthesize(p, { simplify: true }), 'switch')).toBe(2) // simplifies to A, but B stays on the interface
    expect(simulate(synthesize(p, { simplify: true }), ['A', 'B'], ['Y']).values).toEqual(tableOfProgram(p).values)
  })

  it('lays it out left to right with nothing on top of anything, and every wire routed', () => {
    const c = synthesize(programOf('S = A ⊕ B ⊕ Cin\nCout = A·B + Cin·(A ⊕ B)\nM = A·B + A·Cin + B·Cin'))
    const comps = Object.values(c.comps)
    for (let i = 0; i < comps.length; i++)
      for (let j = i + 1; j < comps.length; j++) {
        const [a, b] = [boundsRect(comps[i]), boundsRect(comps[j])]
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${comps[i].type} / ${comps[j].type}`).toBe(false)
      }
    // Inputs on the left, LEDs on the right.
    const xs = (type: string) => comps.filter((k) => k.type === type).map((k) => k.x)
    expect(Math.max(...xs('switch'))).toBeLessThan(Math.min(...xs('xor'), ...xs('and'), ...xs('or')))
    expect(Math.min(...xs('led'))).toBeGreaterThan(Math.max(...xs('xor'), ...xs('and'), ...xs('or')))
    for (const w of Object.values(c.wires)) {
      const e = wireEndpoints(c, w)!
      expect(validPath(w.path, e.from, e.fromDir, e.to, e.toDir)).toBe(true)
    }
  })
})

describe('building a circuit from a truth table', () => {
  it('builds the smallest sum of products', () => {
    const table: TruthTable = { inputs: ['A', 'B', 'C'], outputs: ['M'], values: [[0, 0, 0, 1, 0, 1, 1, 1]] }
    const c = synthesizeTable(table)
    expect(simulate(c, table.inputs, table.outputs)).toEqual(table)
    expect(count(c, 'and')).toBe(3)
    expect(count(c, 'or')).toBe(1)
  })

  it('treats unknown values as don’t cares: the circuit agrees with every row that is known', () => {
    const next = rng(8)
    for (let trial = 0; trial < 60; trial++) {
      const n = 2 + Math.floor(next() * 3)
      const inputs = ['A', 'B', 'C', 'D'].slice(0, n)
      const values = Array.from({ length: 2 ** n }, () => (Math.floor(next() * 3) as Cell))
      const table: TruthTable = { inputs, outputs: ['Y'], values: [values] }
      const got = simulate(synthesizeTable(table), inputs, ['Y']).values[0]
      values.forEach((v, row) => {
        if (v !== 2) expect(got[row], `${values.join('')} row ${row}`).toBe(v)
      })
    }
  })

  it('handles several outputs, and outputs that are always 0 or always 1', () => {
    const table: TruthTable = { inputs: ['A', 'B'], outputs: ['X', 'Zero', 'One'], values: [[0, 1, 1, 0], [0, 0, 0, 0], [1, 1, 1, 1]] }
    expect(simulate(synthesizeTable(table), table.inputs, table.outputs)).toEqual(table)
  })
})

describe('building into a circuit that is being put together', () => {
  const program = programOf('Y = A·B + ¬C')
  const load = (c: Circuit) => {
    const sim = new Simulator()
    sim.load({ comps: Object.values(c.comps).map(({ id, type, params }) => ({ id, type, params })), wires: Object.values(c.wires).map(({ from, to }) => ({ from, to })) })
    sim.settle()
    return sim
  }

  it('puts the logic at the origin it is given, and says what it added', () => {
    const b = new CircuitBuilder()
    const info = synthesizeInto(b, program, {}, { x: 300, y: 120 })
    expect(info.parts.length).toBe(Object.keys(b.c.comps).length)
    for (const id of info.parts) {
      const r = boundsRect(b.c.comps[id])
      expect(r.x).toBeGreaterThanOrEqual(300)
      expect(r.y).toBeGreaterThanOrEqual(120)
      expect(r.x + r.w).toBeLessThanOrEqual(300 + info.width)
      expect(r.y + r.h).toBeLessThanOrEqual(120 + info.height)
    }
    expect(Object.keys(info.inputs)).toEqual(['A', 'B', 'C'])
    expect(Object.keys(info.outputs)).toEqual(['Y'])
    expect(b.c.comps[info.inputs.A].type).toBe('switch')
    expect(b.c.comps[info.outputs.Y].type).toBe('led')
  })

  it('gives the same circuit as synthesize() when built at the origin', () => {
    const b = new CircuitBuilder()
    synthesizeInto(b, program)
    const whole = synthesize(program)
    expect(Object.values(b.c.comps).map((k) => [k.type, k.x, k.y, k.label])).toEqual(Object.values(whole.comps).map((k) => [k.type, k.x, k.y, k.label]))
  })

  it('an input can come from a Receive label and an output go out through a Send label', () => {
    const b = new CircuitBuilder()
    const info = synthesizeInto(b, program, { labelInputs: ['B'], labelOutputs: ['Y'] })
    expect(b.c.comps[info.inputs.B]).toMatchObject({ type: 'netrecv', params: { name: 'B' } })
    expect(b.c.comps[info.outputs.Y]).toMatchObject({ type: 'netsend', params: { name: 'Y' } })
    expect(Object.values(b.c.comps).some((k) => k.type === 'switch' && k.label === 'B')).toBe(false)
    expect(Object.values(b.c.comps).some((k) => k.type === 'led')).toBe(false)
    expect(b.c.comps[info.inputs.A].type).toBe('switch') // the others are as before
  })

  it('works like the plain version once the labels are connected to something', () => {
    const b = new CircuitBuilder()
    synthesizeInto(b, program, { labelInputs: ['B'], labelOutputs: ['Y'] })
    // Somewhere else: a switch that sends B, and an LED that receives Y.
    const sendB = b.add('switch', 0, 500, { label: 'sendB' })
    const tapB = b.add('netsend', 100, 500, { params: { name: 'B' } })
    b.wire(`${sendB}.Q`, `${tapB}.A`)
    const getY = b.add('netrecv', 100, 600, { params: { name: 'Y' } })
    const led = b.add('led', 200, 600, { label: 'seeY' })
    b.wire(`${getY}.Y`, `${led}.A`)
    const sw = (label: string) => Object.values(b.c.comps).find((k) => k.type === 'switch' && k.label === label)!
    const sim = load(b.c)
    for (let row = 0; row < 8; row++) {
      const [a, bb, c] = [(row >> 2) & 1, (row >> 1) & 1, row & 1]
      for (const [label, v] of [['A', a], ['sendB', bb], ['C', c]] as const) sim.setParams(sw(label).id, { ...sw(label).params, on: v === 1 })
      sim.settle()
      expect(sim.pinValue(led, 'A'), `A=${a} B=${bb} C=${c}`).toBe((a & bb) | (1 - c))
    }
  })

  it('a program with no inputs and no outputs adds nothing', () => {
    const b = new CircuitBuilder()
    const info = synthesizeInto(b, { inputs: [], outputs: [] })
    expect(info).toEqual({ inputs: {}, outputs: {}, parts: [], width: 0, height: 0 })
  })
})
