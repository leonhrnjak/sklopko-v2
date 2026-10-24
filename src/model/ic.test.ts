import { describe, expect, it } from 'vitest'
import { Simulator } from '../engine/simulator'
import type { V } from '../engine/types'
import { CircuitBuilder } from './builder'
import { busModel, flatten } from './buses'
import { type Circuit } from './circuit'
import { analyzeCircuit, dependsOnState } from './analyze'
import { ruleProblems } from './challengecheck'
import { produce } from 'immer'
import { IC, deleteDefinition, deriveInterface, documentOf, enterDefinition, enterIC, expandICs, findCycle, icParams, icProblems, inlineInstance, isUsed, leaveIC, levelsOf, newICId, operableInside, placementOf, placingIC, renameDefinition, subCircuit, usageOf, wouldLoop } from './ic'
import { deserialize, migrate, serialize } from './serialize'
import { analyzeTiming } from './timing'

const run = (c: Circuit) => {
  const sim = new Simulator()
  sim.load(flatten(c))
  sim.settle()
  return sim
}
const set = (sim: Simulator, c: Circuit, id: string, on: boolean) => {
  sim.setParams(id, { ...c.comps[id].params, on })
  sim.settle()
}

/** Half adder from gates: inputs A and B, outputs S and C. */
function halfAdder(): Circuit {
  const b = new CircuitBuilder()
  const a = b.add('switch', 0, 0, { label: 'A' })
  const bb = b.add('switch', 0, 60, { label: 'B' })
  const x = b.add('xor', 100, 0)
  const n = b.add('and', 100, 60)
  const s = b.add('led', 200, 0, { label: 'S' })
  const c = b.add('led', 200, 60, { label: 'C' })
  b.wire(`${a}.Q`, `${x}.A`)
  b.wire(`${bb}.Q`, `${x}.B`)
  b.wire(`${a}.Q`, `${n}.A`)
  b.wire(`${bb}.Q`, `${n}.B`)
  b.wire(`${x}.Y`, `${s}.A`)
  b.wire(`${n}.Y`, `${c}.A`)
  return b.build()
}

/** Full adder from two half-adder ICs and an OR: inputs A, B, Ci, outputs S, Co. Its own definitions are in `ics`. */
function fullAdder(): Circuit {
  const b = new CircuitBuilder()
  b.defineIC('Half adder', halfAdder())
  const a = b.add('switch', 0, 0, { label: 'A' })
  const bb = b.add('switch', 0, 60, { label: 'B' })
  const ci = b.add('switch', 0, 120, { label: 'Ci' })
  const h1 = b.ic('half-adder', 100, 0)
  const h2 = b.ic('half-adder', 260, 20)
  const or = b.add('or', 420, 60)
  const s = b.add('led', 420, 0, { label: 'S' })
  const co = b.add('led', 520, 60, { label: 'Co' })
  b.wire(`${a}.Q`, `${h1}.A`)
  b.wire(`${bb}.Q`, `${h1}.B`)
  b.wire(`${h1}.S`, `${h2}.A`)
  b.wire(`${ci}.Q`, `${h2}.B`)
  b.wire(`${h2}.S`, `${s}.A`)
  b.wire(`${h1}.C`, `${or}.A`)
  b.wire(`${h2}.C`, `${or}.B`)
  b.wire(`${or}.Y`, `${co}.A`)
  return b.build()
}

describe('the interface of an IC', () => {
  it('is the labelled switches and LEDs, from top to bottom, and bus parts keep their width', () => {
    const b = new CircuitBuilder()
    b.add('switch', 0, 100, { label: 'Second' })
    b.add('switch', 0, 0, { label: 'First' })
    b.add('busin', 0, 200, { label: 'Data', params: { bits: 8 } })
    b.add('led', 100, 0, { label: 'Out' })
    b.add('busdisp', 100, 100, { params: { bits: 4 } })
    b.add('button', 0, 300, { label: 'Not a pin' })
    const i = deriveInterface(b.build())
    expect(i.inputs.map((p) => [p.name, p.bits])).toEqual([['First', 1], ['Second', 1], ['Data', 8]])
    expect(i.outputs.map((p) => [p.name, p.bits])).toEqual([['Out', 1], ['out2', 4]])
  })

  it('makes names that are safe and unique, and unlabelled pins in1, in2…', () => {
    const b = new CircuitBuilder()
    b.add('switch', 0, 0, { label: 'a b.c' })
    b.add('switch', 0, 20, { label: 'a b.c' })
    b.add('switch', 0, 40)
    b.add('led', 100, 0)
    expect(deriveInterface(b.build()).inputs.map((p) => p.name)).toEqual(['a_b_c', 'a_b_c_2', 'in3'])
  })

  it('says what is wrong with a circuit that cannot be an IC', () => {
    expect(icProblems(halfAdder())).toEqual([])
    expect(icProblems(new CircuitBuilder().build())).toHaveLength(2)
    const b = new CircuitBuilder()
    b.add('led', 0, 0)
    expect(icProblems(b.build())).toEqual([expect.stringContaining('no inputs')])
  })
})

describe('an IC in a circuit', () => {
  it('behaves like the circuit it was made from, over every input', () => {
    const b = new CircuitBuilder()
    const id = b.defineIC('Half adder', halfAdder())
    const a = b.add('switch', 0, 0)
    const bb = b.add('switch', 0, 60)
    const ic = b.ic(id, 100, 0)
    const s = b.add('led', 260, 0)
    const c = b.add('led', 260, 60)
    b.wire(`${a}.Q`, `${ic}.A`)
    b.wire(`${bb}.Q`, `${ic}.B`)
    b.wire(`${ic}.S`, `${s}.A`)
    b.wire(`${ic}.C`, `${c}.A`)
    const circuit = b.build()
    const sim = run(circuit)
    for (const [x, y] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      set(sim, circuit, a, !!x)
      set(sim, circuit, bb, !!y)
      expect([sim.pinValue(s, 'A'), sim.pinValue(c, 'A')], `${x}+${y}`).toEqual([x ^ y, x & y])
    }
  })

  it('a full adder of IC half adders matches the built-in full adder, and the same IC is placed twice', () => {
    const c = fullAdder()
    const ref = new CircuitBuilder()
    const ra = ref.add('switch', 0, 0)
    const rb = ref.add('switch', 0, 60)
    const rc = ref.add('switch', 0, 120)
    const fa = ref.add('fulladd', 100, 0)
    const rs = ref.add('led', 260, 0)
    const rco = ref.add('led', 260, 60)
    ref.wire(`${ra}.Q`, `${fa}.A`)
    ref.wire(`${rb}.Q`, `${fa}.B`)
    ref.wire(`${rc}.Q`, `${fa}.Ci`)
    ref.wire(`${fa}.S`, `${rs}.A`)
    ref.wire(`${fa}.Co`, `${rco}.A`)
    const reference = ref.build()
    const sim = run(c)
    const want = run(reference)
    const sw = (circ: Circuit) => Object.values(circ.comps).filter((k) => k.type === 'switch').map((k) => k.id)
    const leds = (circ: Circuit) => Object.values(circ.comps).filter((k) => k.type === 'led').map((k) => k.id)
    for (let row = 0; row < 8; row++) {
      sw(c).forEach((id, i) => set(sim, c, id, !!((row >> i) & 1)))
      sw(reference).forEach((id, i) => set(want, reference, id, !!((row >> i) & 1)))
      expect(leds(c).map((id) => sim.pinValue(id, 'A')), `row ${row}`).toEqual(leds(reference).map((id) => want.pinValue(id, 'A')))
    }
  })

  it('nests three deep, and the parts inside have ids that say where they are', () => {
    const b = new CircuitBuilder()
    b.defineIC('Half adder', halfAdder())
    const inner = new CircuitBuilder()
    inner.c.ics = b.c.ics
    const x = inner.add('switch', 0, 0, { label: 'A' })
    const y = inner.add('switch', 0, 60, { label: 'B' })
    const h = inner.ic('half-adder', 100, 0)
    const o = inner.add('led', 260, 0, { label: 'S' })
    inner.wire(`${x}.Q`, `${h}.A`)
    inner.wire(`${y}.Q`, `${h}.B`)
    inner.wire(`${h}.S`, `${o}.A`)
    b.defineIC('Wrapper', inner.build())
    const outer = new CircuitBuilder()
    outer.c.ics = b.c.ics
    const w = outer.ic('wrapper', 100, 0)
    const ia = outer.add('switch', 0, 0)
    const ib = outer.add('switch', 0, 60)
    const out = outer.add('led', 260, 0)
    outer.wire(`${ia}.Q`, `${w}.A`)
    outer.wire(`${ib}.Q`, `${w}.B`)
    outer.wire(`${w}.S`, `${out}.A`)
    const circuit = outer.build()
    const expanded = expandICs(circuit).circuit
    expect(Object.keys(expanded.comps).some((id) => id.startsWith(`${w}/`) && id.split('/').length === 3), 'a part two levels down').toBe(true)
    const sim = run(circuit)
    set(sim, circuit, ia, true)
    expect(sim.pinValue(out, 'A')).toBe(1)
    set(sim, circuit, ib, true)
    expect(sim.pinValue(out, 'A')).toBe(0)
  })

  it('reads X on an input nothing drives, and on an output that nothing inside drives', () => {
    const b = new CircuitBuilder()
    const id = b.defineIC('Half adder', halfAdder())
    const ic = b.ic(id, 100, 0)
    const s = b.add('led', 260, 0)
    b.wire(`${ic}.S`, `${s}.A`)
    expect(run(b.build()).pinValue(s, 'A')).toBe(2)
  })

  it('passes a bus through a bus pin', () => {
    const inner = new CircuitBuilder()
    const din = inner.add('busin', 0, 0, { label: 'In', params: { bits: 8 } })
    const reg = inner.add('busreg', 100, 0, { params: { bits: 8 } })
    const clk = inner.add('switch', 0, 100, { label: 'Clk' })
    const dout = inner.add('busdisp', 260, 0, { label: 'Out', params: { bits: 8 } })
    inner.wire(`${din}.Q`, `${reg}.D`)
    inner.wire(`${clk}.Q`, `${reg}.CLK`)
    inner.wire(`${reg}.Q`, `${dout}.A`)
    const b = new CircuitBuilder()
    const id = b.defineIC('Latch8', inner.build())
    const d = b.add('busin', 0, 0, { params: { bits: 8, value: '5A' } })
    const k = b.add('switch', 0, 100)
    const ic = b.ic(id, 100, 0)
    const out = b.add('busdisp', 260, 0, { params: { bits: 8 } })
    b.wire(`${d}.Q`, `${ic}.In`)
    b.wire(`${k}.Q`, `${ic}.Clk`)
    b.wire(`${ic}.Out`, `${out}.A`)
    const circuit = b.build()
    const sim = run(circuit)
    const read = () => Array.from({ length: 8 }, (_, i) => sim.pinValue(out, `A${i}`))
    expect(read().every((v) => v === 2 || v === 0)).toBe(true)
    set(sim, circuit, k, true)
    expect(read()).toEqual([0, 1, 0, 1, 1, 0, 1, 0]) // 0x5A, least significant bit first
    // The wires keep their ids, and a wire into the IC still carries its bus.
    const m = busModel(circuit)
    const into = Object.values(circuit.wires).find((w) => w.to.comp === ic && w.to.pin === 'In')!
    expect(m.bits.get(into.id)).toHaveLength(8)
    expect(m.bits.get(into.id)!.every((s) => s && s.comp === d)).toBe(true)
  })
})

describe('inside an instance', () => {
  /** An IC that remembers its input when Clk rises: a D flip-flop with a net label in the way, a probe and a display. */
  function memoryIC() {
    const c = new CircuitBuilder()
    const d = c.add('switch', 0, 0, { label: 'D' })
    const k = c.add('switch', 0, 60, { label: 'Clk' })
    const send = c.add('netsend', 80, 0, { params: { name: 'bit', bits: 1 } })
    const recv = c.add('netrecv', 80, 60, { params: { name: 'bit', bits: 1 } })
    const ff = c.add('dff', 160, 0)
    const q = c.add('led', 300, 0, { label: 'Q' })
    const probe = c.add('probe', 300, 60)
    const seg = c.add('seg7', 300, 120)
    c.wire(`${d}.Q`, `${send}.A`)
    c.wire(`${recv}.Y`, `${ff}.D`)
    c.wire(`${k}.Q`, `${ff}.CLK`)
    c.wire(`${ff}.Q`, `${q}.A`)
    c.wire(`${ff}.Q`, `${probe}.A`)
    c.wire(`${ff}.Q`, `${seg}.a`)
    return c.build()
  }

  it('keeps the state of each instance apart, and scopes net labels to the instance, not the circuit', () => {
    const b = new CircuitBuilder()
    const id = b.defineIC('Bit', memoryIC())
    const d1 = b.add('switch', 0, 0)
    const k1 = b.add('switch', 0, 40)
    const d2 = b.add('switch', 0, 100)
    const k2 = b.add('switch', 0, 140)
    const one = b.ic(id, 100, 0)
    const two = b.ic(id, 100, 100)
    const o1 = b.add('led', 260, 0)
    const o2 = b.add('led', 260, 100)
    // A label of the same name outside must not meet the ones inside.
    const outside = b.add('netrecv', 260, 200, { params: { name: 'bit', bits: 1 } })
    const o3 = b.add('led', 340, 200)
    b.wire(`${d1}.Q`, `${one}.D`)
    b.wire(`${k1}.Q`, `${one}.Clk`)
    b.wire(`${d2}.Q`, `${two}.D`)
    b.wire(`${k2}.Q`, `${two}.Clk`)
    b.wire(`${one}.Q`, `${o1}.A`)
    b.wire(`${two}.Q`, `${o2}.A`)
    b.wire(`${outside}.Y`, `${o3}.A`)
    const circuit = b.build()
    const sim = run(circuit)
    set(sim, circuit, d1, true)
    set(sim, circuit, k1, true) // the first one takes 1
    set(sim, circuit, k2, true) // the second takes 0
    expect([sim.pinValue(o1, 'A'), sim.pinValue(o2, 'A')]).toEqual([1, 0])
    set(sim, circuit, d2, true)
    set(sim, circuit, d1, false)
    expect([sim.pinValue(o1, 'A'), sim.pinValue(o2, 'A')]).toEqual([1, 0]) // no clock edge: both hold
    expect(sim.pinValue(o3, 'A')).toBe(2) // the label outside reads nothing
    // Probes and displays inside are not in the simulation, so there is one row of probes for no instance.
    expect(flatten(circuit).comps.some((k) => k.type === 'probe' || k.type === 'seg7')).toBe(false)
  })

  it('goes back a clock step through an instance', () => {
    const b = new CircuitBuilder()
    const id = b.defineIC('Bit', memoryIC())
    const d = b.add('switch', 0, 0, { params: { on: true } })
    const clk = b.add('clock', 0, 40, { params: { hz: 2 } })
    const ic = b.ic(id, 100, 0)
    const q = b.add('led', 260, 0)
    b.wire(`${d}.Q`, `${ic}.D`)
    b.wire(`${clk}.Q`, `${ic}.Clk`)
    b.wire(`${ic}.Q`, `${q}.A`)
    const sim = run(b.build())
    expect(sim.pinValue(q, 'A')).not.toBe(1)
    sim.advance(300) // the clock rises at 250 ms
    sim.settle()
    expect(sim.pinValue(q, 'A')).toBe(1)
    expect(sim.stepBack()).toBe(true) // to the edge itself: the flip-flop has taken D
    expect(sim.pinValue(q, 'A')).toBe(1)
    expect(sim.stepBack()).toBe(true) // to before it: the state inside the instance went back too
    expect(sim.pinValue(q, 'A')).not.toBe(1)
  })
})

describe('through the rest of the model', () => {
  it('analyze reads a truth table through an IC', () => {
    const c = fullAdder()
    const ports = Object.values(c.comps)
    const ids = (type: string) => ports.filter((k) => k.type === type).map((k) => k.id)
    const { table } = analyzeCircuit(c, ids('switch'), ids('led'))
    expect(table.values).toHaveLength(2)
    const row = (n: number) => table.values.map((col) => col[n])
    // The first input is the most significant bit: rows count A B Ci as a binary number.
    expect([row(0), row(3), row(5), row(7)]).toEqual([[0, 0], [0, 1], [0, 1], [1, 1]].map(([s, co]) => [s, co]))
    // 011 → sum 0, carry 1; 101 → 0, 1; 111 → 1, 1
  })
})

describe('challenge rules and state, through an IC', () => {
  it('rules count the parts an IC is made of, not the IC', () => {
    const c = fullAdder() // two half adders (an XOR and an AND each) and an OR
    expect(ruleProblems(c, { maxParts: 5 })).toEqual([])
    expect(ruleProblems(c, { maxParts: 4 })).toEqual([expect.stringContaining('has 5')])
    expect(ruleProblems(c, { only: ['and', 'or', 'xor'] })).toEqual([])
    expect(ruleProblems(c, { only: ['and', 'or'] })).toEqual([expect.stringContaining('XOR')])
  })

  it('an output depends on state when a flip-flop inside an IC drives it, and not when only gates do', () => {
    const b = new CircuitBuilder()
    const inner = new CircuitBuilder()
    const d = inner.add('switch', 0, 0, { label: 'D' })
    const k = inner.add('switch', 0, 60, { label: 'Clk' })
    const ff = inner.add('dff', 100, 0)
    const q = inner.add('led', 260, 0, { label: 'Q' })
    inner.wire(`${d}.Q`, `${ff}.D`)
    inner.wire(`${k}.Q`, `${ff}.CLK`)
    inner.wire(`${ff}.Q`, `${q}.A`)
    const memory = b.defineIC('Bit', inner.build())
    const gates = b.defineIC('Half adder', halfAdder())
    const m = b.ic(memory, 100, 0)
    const h = b.ic(gates, 100, 200)
    const o1 = b.add('led', 300, 0)
    const o2 = b.add('led', 300, 200)
    b.wire(`${m}.Q`, `${o1}.A`)
    b.wire(`${h}.S`, `${o2}.A`)
    const c = b.build()
    expect(dependsOnState(c, o1)).toBe(true)
    expect(dependsOnState(c, o2)).toBe(false)
  })
})

describe('timing through an IC', () => {
  it('a path runs through an instance: the slowest path is as long as in the same circuit built flat', () => {
    // Switch → XOR → XOR → LED, with the middle XOR inside an IC, against all three in the open.
    const inner = new CircuitBuilder()
    const a = inner.add('switch', 0, 0, { label: 'A' })
    const x = inner.add('xor', 100, 0)
    const o = inner.add('led', 200, 0, { label: 'Y' })
    inner.wire(`${a}.Q`, `${x}.A`)
    inner.wire(`${a}.Q`, `${x}.B`)
    inner.wire(`${x}.Y`, `${o}.A`)
    const b = new CircuitBuilder()
    const id = b.defineIC('Gate', inner.build())
    const s = b.add('switch', 0, 0)
    const g1 = b.add('xor', 100, 0)
    const ic = b.ic(id, 240, 0)
    const g2 = b.add('xor', 400, 0)
    const out = b.add('led', 540, 0)
    b.wire(`${s}.Q`, `${g1}.A`)
    b.wire(`${s}.Q`, `${g1}.B`)
    b.wire(`${g1}.Y`, `${ic}.A`)
    b.wire(`${ic}.Y`, `${g2}.A`)
    b.wire(`${ic}.Y`, `${g2}.B`)
    b.wire(`${g2}.Y`, `${out}.A`)
    const timing = analyzeTiming(b.build())
    expect(timing.critical?.delay).toBe(3)
    expect(timing.critical?.steps.some((st) => st.comp.startsWith(`${ic}/xor`))).toBe(true)
    expect(timing.critical?.steps.at(-1)?.comp).toBe(out)
  })
})

describe('saving ICs', () => {
  it('round-trips a circuit with nested ICs, and writes version 2', () => {
    const c = fullAdder()
    const saved = serialize(c)
    expect(saved.version).toBe(2)
    expect(saved.ics).toHaveLength(1)
    const back = deserialize(JSON.parse(JSON.stringify(saved)))
    expect(back).toEqual(JSON.parse(JSON.stringify(c)))
    // A circuit without ICs saves no `ics` at all, and loads without one.
    const plain = serialize(halfAdder())
    expect(plain.ics).toBeUndefined()
    expect(deserialize(plain).ics).toBeUndefined()
  })

  it('opens a version 1 file as it was, with no ICs', () => {
    const v1 = { app: 'sklopko', version: 1, comps: [{ id: 'a', type: 'switch', x: 0, y: 0 }], wires: [] }
    expect(migrate(v1)).toMatchObject({ version: 2, ics: [] })
    const c = deserialize(v1)
    expect(Object.keys(c.comps)).toEqual(['a'])
    expect(c.ics).toBeUndefined()
  })

  it('refuses a file in which an IC contains itself, directly or through another', () => {
    const half = serialize(halfAdder())
    const self = { ...serialize(fullAdder()), ics: [{ id: 'loop', name: 'Loop', ...half, comps: [...half.comps, { id: 'in', type: 'ic', x: 0, y: 0, params: { ic: 'loop' } }] }] }
    expect(() => deserialize(self)).toThrow('contains itself')
    const a = { id: 'a', name: 'A', ...half, comps: [...half.comps, { id: 'x', type: 'ic', x: 0, y: 0, params: { ic: 'b' } }] }
    const b = { id: 'b', name: 'B', ...half, comps: [...half.comps, { id: 'y', type: 'ic', x: 0, y: 0, params: { ic: 'a' } }] }
    expect(() => deserialize({ ...half, ics: [a, b] })).toThrow('contains itself')
  })

  it('drops an instance whose IC is not in the file, with its wires, and refreshes the pins of the others', () => {
    const c = fullAdder()
    const saved = JSON.parse(JSON.stringify(serialize(c)))
    saved.comps.push({ id: 'ghost', type: 'ic', x: 0, y: 0, params: { ic: 'missing', name: 'Gone', ins: 'A:1', outs: 'S:1' } })
    saved.wires.push({ id: 'wg', from: 'ghost.S', to: Object.values(c.comps).find((k) => k.type === 'led')!.id + '.A' })
    // An instance saved with stale pins takes the ones its definition has now.
    const inst = saved.comps.find((k: { type: string }) => k.type === IC)
    inst.params.ins = 'Old:1'
    const back = deserialize(saved)
    expect(back.comps.ghost).toBeUndefined()
    expect(back.wires.wg).toBeUndefined()
    expect(back.comps[inst.id].params).toEqual(icParams(back.ics!['half-adder']))
  })
})

describe('loops', () => {
  const ic = (circuit: Circuit) => ({ id: '', name: '', circuit })
  it('finds an IC that contains itself, and refuses to place one inside what would contain it', () => {
    const a = new CircuitBuilder()
    a.defineIC('B', halfAdder(), 'b')
    const inA = new CircuitBuilder()
    inA.c.ics = a.c.ics
    inA.add('switch', 0, 0)
    inA.add('led', 100, 0)
    inA.ic('b', 0, 100)
    a.defineIC('A', inA.build(), 'a')
    const ics = a.c.ics!
    expect(findCycle(ics)).toBeNull()
    expect(wouldLoop(ics, 'b', 'a')).toBe(true) // A contains B: B cannot contain A
    expect(wouldLoop(ics, 'a', 'b')).toBe(false)
    expect(wouldLoop(ics, 'a', 'a')).toBe(true)
    ics.b.circuit.comps.back = { id: 'back', type: 'ic', x: 0, y: 0, rot: 0, flip: false, params: { ic: 'a' } }
    expect(findCycle(ics)).toEqual(expect.arrayContaining(['a', 'b']))
    void ic
  })

  it('an instance of an IC in a loop is left out of the simulation instead of recursing', () => {
    const b = new CircuitBuilder()
    b.defineIC('Loop', halfAdder(), 'loop')
    b.c.ics!.loop.circuit.comps.me = { id: 'me', type: 'ic', x: 0, y: 0, rot: 0, flip: false, params: { ic: 'loop' } }
    b.ic('loop', 0, 0)
    const expanded = expandICs(b.build()).circuit
    expect(Object.keys(expanded.comps).filter((id) => id.includes('/me'))).toEqual([])
  })
})

describe('sanity', () => {
  it('an instance of a part type that is registered has a layout from its params alone', () => {
    const b = new CircuitBuilder()
    const id = b.defineIC('Half adder', halfAdder())
    const ic = b.ic(id, 0, 0)
    const c = b.build()
    expect(c.comps[ic].params).toMatchObject({ ic: id, name: 'Half adder', ins: 'A:1,B:1', outs: 'S:1,C:1' })
    expect(busModel(c).circuit).not.toBe(c) // expanded
    const plain = halfAdder()
    expect(busModel(plain).circuit).toBe(plain) // nothing to expand: the same circuit
    const values: V[] = [0, 1]
    expect(values).toHaveLength(2)
  })
})

describe('making, placing and unpacking', () => {
  it('a sub-circuit holds the parts with these ids and the wires between them, copied', () => {
    const c = halfAdder()
    const ids = Object.keys(c.comps).slice(0, 3)
    const sub = subCircuit(c, ids)
    expect(Object.keys(sub.comps)).toEqual(ids)
    expect(Object.values(sub.wires).every((w) => ids.includes(w.from.comp) && ids.includes(w.to.comp))).toBe(true)
    expect(sub.comps[ids[0]]).toEqual(c.comps[ids[0]])
    expect(sub.comps[ids[0]]).not.toBe(c.comps[ids[0]])
    expect(Object.keys(subCircuit(c).comps)).toEqual(Object.keys(c.comps))
  })

  it('names a definition by a slug, with a number when it is taken', () => {
    expect(newICId(undefined, 'Half adder!')).toBe('half-adder')
    expect(newICId({ 'half-adder': { id: 'half-adder', name: '', circuit: halfAdder() } }, 'Half adder')).toBe('half-adder-2')
    expect(newICId(undefined, '???')).toBe('ic')
  })

  it('places an IC from its palette entry, and knows nothing of one that is not there', () => {
    const b = new CircuitBuilder()
    const id = b.defineIC('Half adder', halfAdder())
    expect(placementOf(b.c, placingIC(id))).toEqual({ type: 'ic', params: icParams(b.c.ics![id]), name: 'Half adder' })
    expect(placementOf(b.c, 'and')?.type).toBe('and')
    expect(placementOf(b.c, 'ic:nope')).toBeNull()
    expect(placementOf(b.c, 'nope')).toBeNull()
  })

  it('lists the parts inside that nobody could operate', () => {
    const b = new CircuitBuilder()
    b.add('switch', 0, 0)
    b.add('button', 0, 50, { label: 'Go' })
    b.add('keypad', 0, 100)
    b.add('and', 100, 0)
    expect(operableInside(b.build())).toEqual(['Go', 'Keypad'])
  })

  /** Switches A and B into a half-adder IC, S and C out to LEDs. */
  function withInstance() {
    const b = new CircuitBuilder()
    const id = b.defineIC('Half adder', halfAdder())
    const a = b.add('switch', 0, 0)
    const bb = b.add('switch', 0, 60)
    const ic = b.ic(id, 100, 0)
    const s = b.add('led', 260, 0)
    const c = b.add('led', 260, 60)
    b.wire(`${a}.Q`, `${ic}.A`)
    b.wire(`${bb}.Q`, `${ic}.B`)
    b.wire(`${ic}.S`, `${s}.A`)
    b.wire(`${ic}.C`, `${c}.A`)
    return { circuit: b.build(), a, bb, ic, s, c }
  }

  it('unpacking an instance leaves a circuit that behaves the same, with the IC gone and its parts in the open', () => {
    const { circuit, a, bb, ic, s, c } = withInstance()
    let n = 0
    const open = structuredClone(circuit)
    const ids = inlineInstance(open, ic, (p) => `${p}${++n}`)!
    expect(open.comps[ic]).toBeUndefined()
    expect(Object.values(open.comps).some((k) => k.type === IC)).toBe(false)
    expect(Object.values(open.comps).map((k) => k.type).sort()).toEqual(['and', 'led', 'led', 'switch', 'switch', 'xor'])
    expect(ids.length).toBe(2 + 6) // the XOR and the AND, and six wires: four in, two out
    // Every wire has a route.
    expect(Object.values(open.wires).every((w) => w.path.length >= 2)).toBe(true)
    const before = run(circuit)
    const after = run(open)
    for (const [x, y] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
      for (const [sim, circ] of [[before, circuit], [after, open]] as const) {
        set(sim, circ, a, !!x)
        set(sim, circ, bb, !!y)
      }
      expect([after.pinValue(s, 'A'), after.pinValue(c, 'A')]).toEqual([before.pinValue(s, 'A'), before.pinValue(c, 'A')])
    }
  })

  it('unpacking renames a net label inside that would meet one outside, and keeps a pair together', () => {
    const inner = new CircuitBuilder()
    const d = inner.add('switch', 0, 0, { label: 'D' })
    const send = inner.add('netsend', 80, 0, { params: { name: 'x', bits: 1 } })
    const recv = inner.add('netrecv', 80, 60, { params: { name: 'x', bits: 1 } })
    const q = inner.add('led', 200, 60, { label: 'Q' })
    inner.wire(`${d}.Q`, `${send}.A`)
    inner.wire(`${recv}.Y`, `${q}.A`)
    const b = new CircuitBuilder()
    const id = b.defineIC('Pipe', inner.build())
    b.add('netrecv', 0, 300, { params: { name: 'x', bits: 1 } })
    const ic = b.ic(id, 100, 0)
    const circuit = b.build()
    inlineInstance(circuit, ic, (p) => `${p}${Math.random()}`)
    const names = Object.values(circuit.comps).filter((k) => k.type === 'netsend' || k.type === 'netrecv').map((k) => `${k.type}:${k.params.name}`).sort()
    expect(names).toEqual(['netrecv:x', 'netrecv:x_2', 'netsend:x_2'])
  })

  it('unpacking returns null for something that is not an instance', () => {
    const c = halfAdder()
    expect(inlineInstance(c, Object.keys(c.comps)[0], (p) => p)).toBeNull()
  })
})

describe('editing the inside of an IC', () => {
  /** An inverter IC placed in a circuit: switch → IC → LED, with the instance's id. */
  function placed() {
    const inner = new CircuitBuilder()
    const s = inner.add('switch', 0, 0, { label: 'In' })
    const g = inner.add('not', 80, 0)
    const o = inner.add('led', 160, 0, { label: 'Out' })
    inner.wire(`${s}.Q`, `${g}.A`)
    inner.wire(`${g}.Y`, `${o}.A`)
    const b = new CircuitBuilder()
    const id = b.defineIC('Inverter', inner.build())
    const sw = b.add('switch', 0, 0)
    const ic = b.ic(id, 100, 0)
    const led = b.add('led', 260, 0)
    b.wire(`${sw}.Q`, `${ic}.In`)
    b.wire(`${ic}.Out`, `${led}.A`)
    return { circuit: b.build(), id, sw, ic, led, inner: { s, g, o } }
  }

  it('shows the body with the document’s ICs, and remembers the way back', () => {
    const { circuit, id, ic } = placed()
    const inside = enterIC(circuit, ic)!
    expect(inside.comps).toBe(circuit.ics![id].circuit.comps)
    expect(inside.ics).toBe(circuit.ics)
    expect(inside.up).toEqual({ def: id, outer: circuit })
    expect(levelsOf(inside)).toEqual([id])
    expect(levelsOf(circuit)).toEqual([])
    expect(enterIC(circuit, circuit.comps[ic].id + 'x')).toBeNull()
    expect(enterDefinition(circuit, 'nope')).toBeNull()
    expect(enterDefinition(circuit, id)!.up!.def).toBe(id)
  })

  it('what is changed inside is in the IC when you come back, so every instance changes with it', () => {
    const { circuit, sw, led, ic, inner } = placed()
    const before = run(circuit)
    set(before, circuit, sw, true)
    expect(before.pinValue(led, 'A')).toBe(0) // inverted
    // Inside, take the inverter out and wire the switch straight to the LED.
    const inside = produce(enterIC(circuit, ic)!, (d) => {
      delete d.comps[inner.g]
      delete d.wires[Object.keys(d.wires)[0]]
      delete d.wires[Object.keys(d.wires)[0]]
      d.wires.direct = { id: 'direct', from: { comp: inner.s, pin: 'Q' }, to: { comp: inner.o, pin: 'A' }, path: [] }
    })
    const { circuit: back, dropped } = leaveIC(inside)
    expect(dropped).toBe(0)
    expect(back.up).toBeUndefined()
    expect(back.comps[ic]).toBeDefined()
    const after = run(back)
    set(after, back, sw, true)
    expect(after.pinValue(led, 'A')).toBe(1) // now a plain wire
  })

  it('the instances take the new pins, and wires to pins that are gone are dropped and counted', () => {
    const { circuit, ic, inner } = placed()
    expect(circuit.comps[ic].params.outs).toBe('Out:1')
    const inside = produce(enterIC(circuit, ic)!, (d) => {
      d.comps[inner.o].label = 'Renamed' // the output pin gets another name
      d.comps.extra = { id: 'extra', type: 'switch', x: 0, y: 80, rot: 0, flip: false, params: {}, label: 'More' } // and there is a new input
    })
    const { circuit: back, dropped } = leaveIC(inside)
    expect(back.comps[ic].params).toMatchObject({ ins: 'In:1,More:1', outs: 'Renamed:1' })
    expect(dropped).toBe(1) // the wire from Out
    expect(Object.values(back.wires).filter((w) => w.from.comp === ic)).toHaveLength(0)
    expect(Object.values(back.wires).filter((w) => w.to.comp === ic)).toHaveLength(1) // In is still there
  })

  it('works two levels deep, and the document is the same from anywhere', () => {
    const c = fullAdder()
    const half = Object.values(c.comps).find((k) => k.type === IC)!
    const level1 = enterIC(c, half.id)! // the half adder: a body of gates, no ICs
    expect(levelsOf(level1)).toEqual(['half-adder'])
    expect(documentOf(level1)).toEqual(c)
    // Wrap: an IC whose body places the half adder, entered from the top, then its half adder.
    const b = new CircuitBuilder()
    b.defineIC('Half adder', halfAdder())
    const inner = new CircuitBuilder()
    inner.c.ics = b.c.ics
    const x = inner.add('switch', 0, 0, { label: 'A' })
    const y = inner.add('switch', 0, 40, { label: 'B' })
    const h = inner.ic('half-adder', 100, 0)
    const o = inner.add('led', 260, 0, { label: 'S' })
    inner.wire(`${x}.Q`, `${h}.A`)
    inner.wire(`${y}.Q`, `${h}.B`)
    inner.wire(`${h}.S`, `${o}.A`)
    b.defineIC('Wrapper', inner.build())
    const top = new CircuitBuilder()
    top.c.ics = b.c.ics
    const w = top.ic('wrapper', 0, 0)
    const doc = top.build()
    const l1 = enterIC(doc, w)!
    const hid = Object.values(l1.comps).find((k) => k.type === IC)!.id
    const l2 = enterIC(l1, hid)!
    expect(levelsOf(l2)).toEqual(['wrapper', 'half-adder'])
    expect(documentOf(l2)).toEqual(doc)
    expect(documentOf(l1)).toEqual(doc)
    // Saving from inside saves the whole document.
    expect(serialize(l2)).toEqual(serialize(doc))
    const { circuit: up1 } = leaveIC(l2)
    expect(levelsOf(up1)).toEqual(['wrapper'])
    expect(up1.comps).toEqual(l1.comps)
  })

  it('knows where an IC is used, and renames or removes one', () => {
    const c = fullAdder()
    expect(usageOf(c, 'half-adder')).toEqual({ inICs: [], here: 2 })
    expect(isUsed(c, 'half-adder')).toBe(true)
    const renamed = produce(c, (d) => renameDefinition(d, 'half-adder', 'HA'))
    expect(renamed.ics!['half-adder'].name).toBe('HA')
    expect(Object.values(renamed.comps).filter((k) => k.type === IC).map((k) => k.params.name)).toEqual(['HA', 'HA'])
    // Out of the circuit, it is unused and can go.
    const empty = produce(c, (d) => {
      for (const k of Object.values(d.comps)) if (k.type === IC) delete d.comps[k.id]
      d.wires = {}
    })
    expect(isUsed(empty, 'half-adder')).toBe(false)
    expect(produce(empty, (d) => deleteDefinition(d, 'half-adder')).ics).toBeUndefined()
    // An IC another IC uses counts as used.
    const nested = new CircuitBuilder()
    nested.c.ics = fullAdder().ics
    nested.add('switch', 0, 0)
    nested.ic('half-adder', 0, 0)
    nested.add('led', 0, 0)
    nested.defineIC('Uses it', nested.c, 'uses-it')
    expect(usageOf({ comps: {}, wires: {}, ics: nested.c.ics }, 'half-adder').inICs).toEqual(['Uses it'])
  })
})
