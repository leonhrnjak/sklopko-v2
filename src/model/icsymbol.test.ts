import { describe, expect, it } from 'vitest'
import { viewLayoutOf } from '../engine/viewlayout'
import { CircuitBuilder } from './builder'
import type { Circuit, ICDef } from './circuit'
import { icParams } from './ic'
import { detectSymbol } from './icsymbol'
import { deserialize, serialize } from './serialize'

/** Switches A, B… into one gate of `type`, into the LED Y. */
function gate(type: string, n = 2): Circuit {
  const b = new CircuitBuilder()
  const g = b.add(type, 150, 0, { params: type === 'not' || type === 'buf' ? {} : { inputs: n } })
  const y = b.add('led', 300, 0, { label: 'Y' })
  for (let i = 0; i < (type === 'not' || type === 'buf' ? 1 : n); i++) {
    const s = b.add('switch', 0, i * 60, { label: String.fromCharCode(65 + i) })
    b.wire(`${s}.Q`, `${g}.${String.fromCharCode(65 + i)}`)
  }
  b.wire(`${g}.Y`, `${y}.A`)
  return b.build()
}

const def = (circuit: Circuit, symbol?: ICDef['symbol']): ICDef => ({ id: 'chip', name: 'Chip', circuit, ...(symbol ? { symbol } : {}) })
const layoutOf = (d: ICDef) => viewLayoutOf('ic', icParams(d))

describe('detectSymbol', () => {
  it('knows each gate from its truth table, whatever it is made of', () => {
    for (const type of ['and', 'or', 'nand', 'nor', 'xor', 'xnor'] as const) expect(detectSymbol(gate(type)), type).toBe(type)
    expect(detectSymbol(gate('and', 4))).toBe('and')
    expect(detectSymbol(gate('xor', 3))).toBe('xor') // three inputs: an odd number of ones
    expect(detectSymbol(gate('not'))).toBe('not')
    expect(detectSymbol(gate('buf'))).toBe('buf')

    // An AND made of a NAND and a NOT is an AND: it is the table that counts.
    const b = new CircuitBuilder()
    const a = b.add('switch', 0, 0, { label: 'A' })
    const c = b.add('switch', 0, 60, { label: 'B' })
    const n = b.add('nand', 120, 0)
    const inv = b.add('not', 240, 0)
    const y = b.add('led', 340, 0, { label: 'Y' })
    b.wire(`${a}.Q`, `${n}.A`)
    b.wire(`${c}.Q`, `${n}.B`)
    b.wire(`${n}.Y`, `${inv}.A`)
    b.wire(`${inv}.Y`, `${y}.A`)
    expect(detectSymbol(b.build())).toBe('and')
  })

  it('finds none for anything else: other functions, several outputs, memory, too many inputs, a part left unconnected', () => {
    const b = new CircuitBuilder()
    const s = [0, 1, 2].map((i) => b.add('switch', 0, i * 60, { label: `S${i}` }))
    const maj = b.add('or', 200, 0, { params: { inputs: 3 } })
    const ands = [[0, 1], [0, 2], [1, 2]].map(([p, q], i) => {
      const g = b.add('and', 100, i * 60)
      b.wire(`${s[p]}.Q`, `${g}.A`)
      b.wire(`${s[q]}.Q`, `${g}.B`)
      return g
    })
    ands.forEach((g, i) => b.wire(`${g}.Y`, `${maj}.${'ABC'[i]}`))
    const y = b.add('led', 300, 0, { label: 'Y' })
    b.wire(`${maj}.Y`, `${y}.A`)
    expect(detectSymbol(b.build())).toBeUndefined() // majority

    expect(detectSymbol(gate('and', 5))).toBeUndefined() // wider than a chip is checked for
    const half = new CircuitBuilder()
    const a = half.add('switch', 0, 0, { label: 'A' })
    const x = half.add('led', 100, 0, { label: 'X' })
    const z = half.add('led', 100, 60, { label: 'Z' })
    half.wire(`${a}.Q`, `${x}.A`)
    half.wire(`${a}.Q`, `${z}.A`)
    expect(detectSymbol(half.build())).toBeUndefined() // two outputs

    const open = gate('and')
    const wires = { ...open.wires }
    delete wires[Object.keys(wires)[0]]
    expect(detectSymbol({ ...open, wires })).toBeUndefined() // an input not connected reads unknown
    expect(detectSymbol(new CircuitBuilder().c)).toBeUndefined()
  })
})

describe('an IC with a symbol', () => {
  it('is as big as the gate, with the pins of the IC', () => {
    const and = layoutOf(def(gate('and'), 'and'))
    const gateAnd = viewLayoutOf('and', { inputs: 2 })
    expect([and.w, and.h]).toEqual([gateAnd.w, gateAnd.h]) // 40 × 40
    expect(and.pins.map((p) => [p.name, p.side, p.x, p.y])).toEqual([
      ['A', 'l', -10, 10],
      ['B', 'l', -10, 30],
      ['Y', 'r', 50, 20],
    ])
    const nand = layoutOf(def(gate('nand'), 'nand'))
    expect(nand.pins.find((p) => p.name === 'Y')).toMatchObject({ invert: true, x: 60 })
    const not = layoutOf(def(gate('not'), 'not'))
    expect([not.w, not.h]).toEqual([30, 20])
    expect(not.pins.find((p) => p.name === 'Y')?.invert).toBe(true)
  })

  it('keeps its own pin names', () => {
    const b = new CircuitBuilder()
    const p = b.add('switch', 0, 0, { label: 'P' })
    const q = b.add('switch', 0, 60, { label: 'Q' })
    const g = b.add('and', 120, 0)
    const out = b.add('led', 260, 0, { label: 'Out' })
    b.wire(`${p}.Q`, `${g}.A`)
    b.wire(`${q}.Q`, `${g}.B`)
    b.wire(`${g}.Y`, `${out}.A`)
    expect(layoutOf(def(b.build(), 'and')).pins.map((x) => x.name)).toEqual(['P', 'Q', 'Out'])
  })

  it('is a box again when the pins do not fit the symbol', () => {
    const box = (d: ICDef) => {
      const l = layoutOf(d)
      return [l.w, l.h]
    }
    expect(icParams(def(gate('and'), 'and')).symbol).toBe('and')
    // An AND needs two inputs, a NOT one; one output; single wires.
    expect(icParams(def(gate('not'), 'and')).symbol).toBe('')
    expect(icParams(def(gate('and'), 'not')).symbol).toBe('')
    expect(box(def(gate('and'), 'not'))).toEqual(box(def(gate('and'))))
    expect(icParams(def(gate('and'))).symbol).toBe('')
  })
})

describe('boxes', () => {
  it('are smaller than they were: one input and one output is 60 × 40, two inputs 60 × 60', () => {
    const one = layoutOf(def(gate('buf')))
    expect([one.w, one.h]).toEqual([60, 40])
    expect(one.pins.map((p) => [p.name, p.y])).toEqual([['A', 20], ['Y', 20]])
    const two = layoutOf(def(gate('and')))
    expect([two.w, two.h]).toEqual([60, 60])
  })

  it('still widen for a long name or long pin labels', () => {
    const long = layoutOf({ ...def(gate('and')), name: 'A rather long name' })
    expect(long.w).toBeGreaterThan(100)
  })
})

describe('saving', () => {
  const doc = (symbol?: string): Circuit => {
    const d = def(gate('and'), symbol as ICDef['symbol'])
    const b = new CircuitBuilder()
    b.c.ics = { chip: d }
    b.ic('chip', 0, 0)
    return b.build()
  }

  it('writes the symbol of an IC and reads it back, with the instances drawn as the gate', () => {
    const back = deserialize(JSON.parse(JSON.stringify(serialize(doc('and')))))
    expect(back.ics!.chip.symbol).toBe('and')
    const inst = Object.values(back.comps)[0]
    expect(inst.params.symbol).toBe('and')
    expect(viewLayoutOf('ic', inst.params).h).toBe(40)
  })

  it('writes nothing for an IC without one, and ignores a value it does not know', () => {
    expect(serialize(doc()).ics![0]).not.toHaveProperty('symbol')
    const data = JSON.parse(JSON.stringify(serialize(doc('and'))))
    data.ics[0].symbol = 'teapot'
    expect(deserialize(data).ics!.chip.symbol).toBeUndefined()
    data.ics[0].symbol = 5
    expect(deserialize(data).ics!.chip.symbol).toBeUndefined()
  })
})
