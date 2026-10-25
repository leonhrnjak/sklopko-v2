import { describe, expect, it } from 'vitest'
import { loadIntoSim, sim } from '../app/sim'
import { EXAMPLES } from './examples'
import { deserialize, fromShareHash, migrate, serialize, toShareHash } from './serialize'

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

  describe('the history setting', () => {
    const circuit = () => EXAMPLES[0].build()

    it('is not written when the history is on, so no file changes', () => {
      const saved = serialize(circuit())
      expect('history' in saved).toBe(false)
      expect(deserialize(JSON.parse(JSON.stringify(saved))).history).toBeUndefined()
    })

    it('is written as false when it is off, and read back, in a file and in a share link', () => {
      const c = { ...circuit(), history: false as const }
      const saved = JSON.parse(JSON.stringify(serialize(c)))
      expect(saved.history).toBe(false)
      expect(deserialize(saved).history).toBe(false)
      expect(fromShareHash('#' + toShareHash(c))?.history).toBe(false)
    })

    it('is on for a file from before it came in, and for anything but false', () => {
      const old = JSON.parse(JSON.stringify(serialize(circuit())))
      old.version = 3
      expect(migrate(old)).toMatchObject({ version: 4 })
      expect(deserialize(old).history).toBeUndefined()
      for (const odd of [true, 0, 'false', null]) expect(deserialize({ ...old, history: odd }).history).toBeUndefined()
    })
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
        { id: 'r3', type: 'rom', x: 300, y: 0, params: { data: 'A'.repeat(14001) } },
      ],
      wires: [],
    })
    expect(c.comps.r.params).toMatchObject({ abits: 4, dbits: 8, data: '0 1 2 3 4 5 6 7 8 9 A B C D E F' })
    expect(c.comps.g.params.inputs).toBe(2)
    expect(c.comps.r2.params.data).toBe('FF 0A')
    expect(c.comps.r3.params.data).toBe('0 1 2 3 4 5 6 7 8 9 A B C D E F')
  })

  it('keeps net label names and drops names that are not allowed', () => {
    const c = deserialize({
      app: 'sklopko',
      version: 1,
      comps: [
        { id: 'a', type: 'netsend', x: 0, y: 0, params: { name: 'CLK_2' } },
        { id: 'b', type: 'netrecv', x: 100, y: 0, params: { name: 'has space' } },
        { id: 'c', type: 'netrecv', x: 200, y: 0, params: { name: 'WAY_TOO_LONG_A_NAME' } },
      ],
      wires: [],
    })
    expect(c.comps.a.params.name).toBe('CLK_2')
    expect(c.comps.b.params.name).toBe('')
    expect(c.comps.c.params.name).toBe('')
  })

  it('keeps a ROM program with its instruction set, and a wide RAM; drops unknown or oversized values', () => {
    const c = deserialize({
      app: 'sklopko',
      version: 1,
      comps: [
        { id: 'a', type: 'rom', x: 0, y: 0, params: { abits: 4, dbits: 16, isa: 'sk8', source: 'LDI 1\nHALT', data: '0100 0070' } },
        { id: 'b', type: 'rom', x: 100, y: 0, params: { isa: 'nope', source: 'x'.repeat(9001), dbits: 12 } },
        { id: 'c', type: 'ram', x: 200, y: 0, params: { dbits: 8 } },
        { id: 'd', type: 'ram', x: 300, y: 0, params: { dbits: 5 } },
      ],
      wires: [],
    })
    expect(c.comps.a.params).toMatchObject({ dbits: 16, isa: 'skasm', source: 'LDI 1\nHALT', data: '0100 0070' })
    expect(c.comps.b.params).toMatchObject({ isa: 'none', source: '', dbits: 4 })
    expect(c.comps.c.params.dbits).toBe(8)
    expect(c.comps.d.params.dbits).toBe(4)
  })

  it('a ROM saved with the instruction set of an early computer (sk8, sk82) is a SKASM program now, words untouched', () => {
    for (const old of ['sk8', 'sk82', 'skasm']) {
      const c = deserialize({
        app: 'sklopko',
        version: 1,
        comps: [{ id: 'a', type: 'rom', x: 0, y: 0, params: { abits: 4, dbits: 16, isa: old, source: 'LDI 1\nJZ 3', data: '0100 0083' } }],
        wires: [],
      })
      expect(c.comps.a.params, old).toMatchObject({ isa: 'skasm', source: 'LDI 1\nJZ 3', data: '0100 0083' })
    }
  })

  it('circuits saved before programs and wide memories still load: no instruction set, 4-bit RAM', () => {
    const c = deserialize({
      app: 'sklopko',
      version: 1,
      comps: [
        { id: 'r', type: 'rom', x: 0, y: 0, params: { abits: 4, dbits: 8, data: '00 20 2F' } },
        { id: 'm', type: 'ram', x: 100, y: 0, params: {} },
      ],
      wires: [],
    })
    expect(c.comps.r.params).toMatchObject({ abits: 4, dbits: 8, data: '00 20 2F', isa: 'none', source: '' })
    expect(c.comps.m.params.dbits).toBe(4)
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
