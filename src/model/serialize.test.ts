import { describe, expect, it } from 'vitest'
import { loadIntoSim, sim } from '../app/sim'
import { EXAMPLES } from './examples'
import { deserialize, fromShareHash, serialize, toShareHash } from './serialize'

describe('serialization', () => {
  for (const ex of EXAMPLES) {
    it(`round-trips the "${ex.name}" example unchanged`, () => {
      const c = ex.build()
      const back = deserialize(JSON.parse(JSON.stringify(serialize(c))))
      expect(back).toEqual(JSON.parse(JSON.stringify(c)))
    })
  }

  it('round-trips through a share link', () => {
    const c = EXAMPLES[0].build()
    expect(fromShareHash('#' + toShareHash(c))).toEqual(deserialize(serialize(c)))
  })

  it('drops unknown parts and dangling wires, re-routes broken paths', () => {
    const c = deserialize({
      app: 'sklopko',
      version: 1,
      comps: [
        { id: 'a', type: 'switch', x: 0, y: 0 },
        { id: 'b', type: 'led', x: 100, y: 100 },
        { id: 'z', type: 'flux-capacitor', x: 0, y: 0 },
      ],
      wires: [
        { id: 'w1', from: 'a.Q', to: 'b.A', path: [[0, 0], [5, 5]] },
        { id: 'w2', from: 'z.Q', to: 'b.A' },
        { id: 'w3', from: 'b.A', to: 'a.Q' },
      ],
    })
    expect(Object.keys(c.comps)).toEqual(['a', 'b'])
    expect(Object.keys(c.wires)).toEqual(['w1'])
    expect(c.wires.w1.path[0]).toEqual({ x: 40, y: 10 })
    expect(c.wires.w1.path.at(-1)).toEqual({ x: 90, y: 110 })
  })

  it('drops saved parameter values that do not fit the part', () => {
    const c = deserialize({
      app: 'sklopko',
      version: 1,
      comps: [
        { id: 'r', type: 'rom', x: 0, y: 0, params: { abits: 99, dbits: 8, data: 'xyz' } },
        { id: 'g', type: 'and', x: 100, y: 0, params: { inputs: 500 } },
        { id: 'r2', type: 'rom', x: 200, y: 0, params: { data: 'FF 0A' } },
        { id: 'r3', type: 'rom', x: 300, y: 0, params: { data: 'A'.repeat(500) } },
      ],
      wires: [],
    })
    expect(c.comps.r.params).toMatchObject({ abits: 4, dbits: 8, data: '0 1 2 3 4 5 6 7 8 9 A B C D E F' })
    expect(c.comps.g.params.inputs).toBe(2)
    expect(c.comps.r2.params.data).toBe('FF 0A')
    expect(c.comps.r3.params.data).toBe('0 1 2 3 4 5 6 7 8 9 A B C D E F')
  })

  it('rejects files that are not circuits', () => {
    expect(() => deserialize({ hello: 'world' })).toThrow()
  })
})

describe('examples simulate', () => {
  it('the welcome counter counts even though its reset input starts unknown', () => {
    loadIntoSim(EXAMPLES[0].build())
    sim.reset()
    sim.settle()
    const read = () => ['A', 'B', 'C', 'D'].reduce((n, p, i) => n | (sim.pinValue(findComp('counter'), p) << i), 0)
    expect(read()).toBe(0)
    sim.frame(250) // 2 Hz clock: first rising edge after 250 ms
    expect(read()).toBe(1)
  })
})

function findComp(type: string) {
  const c = EXAMPLES[0].build()
  return Object.values(c.comps).find((k) => k.type === type)!.id
}
