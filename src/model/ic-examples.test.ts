import { describe, expect, it } from 'vitest'
import { Simulator } from '../engine/simulator'
import { flatten } from './buses'
import { EXAMPLES } from './examples'
import { IC, deriveInterface, expandICs, findCycle, levelsOf } from './ic'
import { computerBlocks, icAdder } from './ic-examples'
import { serialize, deserialize } from './serialize'

const example = (id: string) => EXAMPLES.find((e) => e.id === id)!.build()

describe('the IC adder example', () => {
  const circuit = icAdder()
  const byLabel = (label: string) => Object.values(circuit.comps).find((k) => k.label === label)!.id

  it('has the ICs nested three deep, with no loop, and one instance on the canvas', () => {
    expect(Object.keys(circuit.ics!)).toEqual(['half-adder', 'full-adder', '4-bit-adder'])
    expect(findCycle(circuit.ics!)).toBeNull()
    expect(Object.values(circuit.comps).filter((k) => k.type === IC)).toHaveLength(1)
    // 4 full adders of 2 half adders each: eight half adders (an XOR and an AND), four ORs.
    const types: Record<string, number> = {}
    for (const k of Object.values(expandICs(circuit).circuit.comps)) types[k.type] = (types[k.type] ?? 0) + 1
    expect(types).toMatchObject({ xor: 8, and: 8, or: 4 })
    expect(deriveInterface(circuit.ics!['4-bit-adder'].circuit).inputs).toHaveLength(9)
  })

  it('adds: every sum of two 4-bit numbers with and without a carry in', () => {
    const sim = new Simulator()
    sim.load(flatten(circuit))
    sim.settle()
    const set = (label: string, on: boolean) => {
      const id = byLabel(label)
      sim.setParams(id, { ...circuit.comps[id].params, on })
    }
    for (let a = 0; a < 16; a++)
      for (let b = 0; b < 16; b++)
        for (const ci of [0, 1]) {
          for (let i = 0; i < 4; i++) {
            set(`A${i}`, !!((a >> i) & 1))
            set(`B${i}`, !!((b >> i) & 1))
          }
          set('Ci', !!ci)
          sim.settle()
          let sum = 0
          for (let i = 0; i < 4; i++) sum |= (sim.pinValue(byLabel(`S${i}`), 'A') as number) << i
          sum |= (sim.pinValue(byLabel('Co'), 'A') as number) << 4
          expect(sum, `${a} + ${b} + ${ci}`).toBe(a + b + ci)
        }
  })

  it('is a document: saving and loading it keeps the ICs, and no part of it is above the top level', () => {
    const back = deserialize(JSON.parse(JSON.stringify(serialize(circuit))))
    expect(back).toEqual(JSON.parse(JSON.stringify(circuit)))
    expect(levelsOf(back)).toEqual([])
  })
})

describe('the computer as blocks', () => {
  const blocks = computerBlocks()
  const full = example('computer')

  it('has seven blocks and what stayed outside, and no net label left joining them', () => {
    const insts = Object.values(blocks.comps).filter((k) => k.type === IC)
    expect(insts.map((k) => k.params.name).sort()).toEqual(['ALU', 'Accumulator', 'Control', 'Data memory', 'Fetch', 'Instruction fields', 'Program ROM'])
    expect(Object.values(blocks.comps).filter((k) => k.type === 'netsend' || k.type === 'netrecv')).toHaveLength(0)
    expect(findCycle(blocks.ics!)).toBeNull()
    // Every wire is routed and joins parts that exist.
    for (const w of Object.values(blocks.wires)) {
      expect(blocks.comps[w.from.comp], w.id).toBeDefined()
      expect(blocks.comps[w.to.comp], w.id).toBeDefined()
      expect(w.path.length, w.id).toBeGreaterThan(1)
    }
  })

  it('computes what the full computer computes: the same output and flags at every moment', { timeout: 120000 }, () => {
    const a = new Simulator()
    const b = new Simulator()
    a.load(flatten(full))
    b.load(flatten(blocks))
    a.settle()
    b.settle()
    const leds = Object.values(full.comps).filter((k) => k.type === 'led').map((k) => k.id)
    const regs = Object.values(full.comps).filter((k) => k.type === 'busreg' && k.label === 'Output').map((k) => k.id)
    const disp = Object.values(full.comps).filter((k) => k.type === 'hexdisp').map((k) => k.id)
    expect(leds.length).toBe(3)
    expect(regs).toHaveLength(1)
    expect(disp).toHaveLength(3)
    const snapshot = (sim: Simulator) => ({
      leds: leds.map((id) => sim.pinValue(id, 'A')),
      out: Array.from({ length: 8 }, (_, i) => sim.pinValue(regs[0], `Q${i}`)),
      disp: disp.map((id) => Array.from({ length: 4 }, (_, i) => sim.pinValue(id, `IN${i}`))),
    })
    let moved = 0
    let last = ''
    // The clock runs at 4 Hz: 16 simulated seconds is 64 clock periods, enough for the program to reach its output and halt.
    for (let i = 0; i < 160; i++) {
      a.advance(100)
      a.settle()
      b.advance(100)
      b.settle()
      const x = snapshot(a)
      expect(snapshot(b), `after ${(i + 1) * 100} ms`).toEqual(x)
      const s = JSON.stringify(x.out)
      if (s !== last) moved++
      last = s
    }
    expect(moved).toBeGreaterThan(2) // the output register changed: the comparison was of something happening
  })
})
