import { describe, expect, it } from 'vitest'
import { Simulator } from '../engine/simulator'
import type { V } from '../engine/types'
import { CircuitBuilder } from './builder'
import { busModel, flatten } from './buses'
import { type Circuit } from './circuit'
import { analyzeCircuit, dependsOnState } from './analyze'
import { ruleProblems } from './challengecheck'
import { produce } from 'immer'
import { IC, collapseSelection, deleteDefinition, deriveInterface, documentOf, enterDefinition, enterIC, expandICs, findCycle, icParams, icProblems, inlineInstance, isUsed, leaveIC, levelsOf, newICId, operableInside, placementOf, placingIC, renameDefinition, subCircuit, usageOf, wouldLoop } from './ic'
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
    expect(saved.version).toBe(3)
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
    expect(migrate(v1)).toMatchObject({ version: 3, ics: [] })
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

describe('collapsing parts into an IC', () => {
  let n = 0
  const makeId = (p: string) => `${p}x${++n}`

  /** Three switches, (A and B) or C through a NOT, and two LEDs: the middle row is what gets collapsed. */
  function mixed() {
    const b = new CircuitBuilder()
    const a = b.add('switch', 0, 0, { label: 'A' })
    const bb = b.add('switch', 0, 60, { label: 'B' })
    const cc = b.add('switch', 0, 120, { label: 'C' })
    const and = b.add('and', 150, 0)
    const or = b.add('or', 300, 40)
    const not = b.add('not', 450, 40)
    const y = b.add('led', 600, 40, { label: 'Y' })
    const z = b.add('led', 600, 120, { label: 'Z' })
    b.wire(`${a}.Q`, `${and}.A`)
    b.wire(`${bb}.Q`, `${and}.B`)
    b.wire(`${and}.Y`, `${or}.A`)
    b.wire(`${cc}.Q`, `${or}.B`)
    b.wire(`${or}.Y`, `${not}.A`)
    b.wire(`${not}.Y`, `${y}.A`)
    b.wire(`${or}.Y`, `${z}.A`) // the OR also feeds a second LED: one output pin, two wires out
    return { circuit: b.build(), a, bb, cc, and, or, not, y, z }
  }

  const rows = (circ: Circuit, inputs: string[], outputs: string[]) => {
    const sim = run(circ)
    const table: V[][] = []
    for (let row = 0; row < 2 ** inputs.length; row++) {
      inputs.forEach((id, i) => set(sim, circ, id, !!((row >> i) & 1)))
      table.push(outputs.map((id) => sim.pinValue(id, 'A')))
    }
    return table
  }

  it('replaces the parts with one instance, wires it as they were, and the circuit behaves the same', () => {
    const { circuit, a, bb, cc, and, or, not, y, z } = mixed()
    const want = rows(circuit, [a, bb, cc], [y, z])
    const after = produce(circuit, (d) => {
      const out = collapseSelection(d, [and, or, not], 'Logic', makeId)!
      expect(out.defId).toBe('logic')
    })
    expect(after.comps[and]).toBeUndefined()
    expect(after.comps[not]).toBeUndefined()
    const inst = Object.values(after.comps).find((k) => k.type === IC)!
    // Inputs: A and B (the AND's inputs) and C; outputs: the NOT and the OR (which has two wires out).
    expect(inst.params.ins).toBe('A:1,B:1,C:1')
    expect(inst.params.outs).toBe('out1:1,out2:1')
    expect(Object.values(after.wires).every((w) => after.comps[w.from.comp] && after.comps[w.to.comp])).toBe(true)
    expect(Object.values(after.wires).every((w) => w.path.length >= 2)).toBe(true)
    expect(Object.values(after.wires)).toHaveLength(3 + 2) // A, B and C in; the NOT's output to Y and the OR's to Z out
    expect(rows(after, [a, bb, cc], [y, z])).toEqual(want)
  })

  it('expanding what was collapsed gives the original wiring back (the same parts, joined the same way)', () => {
    const { circuit, a, bb, cc, and, or, not, y, z } = mixed()
    const collapsed = produce(circuit, (d) => {
      collapseSelection(d, [and, or, not], 'Logic', makeId)
    })
    const inst = Object.values(collapsed.comps).find((k) => k.type === IC)!
    const open = produce(collapsed, (d) => {
      inlineInstance(d, inst.id, makeId)
    })
    expect(Object.values(open.comps).map((k) => k.type).sort()).toEqual(Object.values(circuit.comps).map((k) => k.type).sort())
    const edges = (circ: Circuit) => {
      // Each wire as "type.pin → type.pin" (ids differ), with the labelled switches told apart.
      const name = (id: string) => `${circ.comps[id].type}${circ.comps[id].label ?? ''}`
      return Object.values(circ.wires).map((w) => `${name(w.from.comp)}.${w.from.pin}>${name(w.to.comp)}.${w.to.pin}`).sort()
    }
    expect(edges(open)).toEqual(edges(circuit))
    expect(rows(open, [a, bb, cc], [y, z])).toEqual(rows(circuit, [a, bb, cc], [y, z]))
  })

  it('a bus that crosses the edge becomes a bus pin of the same width', () => {
    const b = new CircuitBuilder()
    const d = b.add('busin', 0, 0, { label: 'Data', params: { bits: 8, value: '3C' } })
    const add = b.add('busadd', 150, 0, { params: { bits: 8 } })
    const k = b.add('busconst', 0, 120, { params: { bits: 8, value: '01' } })
    const out = b.add('busdisp', 350, 0, { params: { bits: 8 } })
    b.wire(`${d}.Q`, `${add}.A`)
    b.wire(`${k}.Q`, `${add}.B`)
    b.wire(`${add}.S`, `${out}.A`)
    const circuit = b.build()
    const after = produce(circuit, (x) => {
      collapseSelection(x, [add], 'Plus', makeId)
    })
    const inst = Object.values(after.comps).find((c) => c.type === IC)!
    expect(inst.params.ins).toBe('Data:8,in1:8')
    expect(inst.params.outs).toBe('out1:8')
    const sim = run(after)
    expect(Array.from({ length: 8 }, (_, i) => sim.pinValue(out, `A${i}`)).join('')).toBe('10111100') // 0x3C + 1 = 0x3D, least significant bit first
  })

  it('net labels that cross the edge become pins named by the label, with a label of the same name outside', () => {
    const b = new CircuitBuilder()
    const s = b.add('switch', 0, 0)
    const send = b.add('netsend', 100, 0, { params: { name: 'go', bits: 1 } })
    b.wire(`${s}.Q`, `${send}.A`)
    const recv = b.add('netrecv', 300, 0, { params: { name: 'go', bits: 1 } })
    const inv = b.add('not', 400, 0)
    const send2 = b.add('netsend', 500, 0, { params: { name: 'back', bits: 1 } })
    b.wire(`${recv}.Y`, `${inv}.A`)
    b.wire(`${inv}.Y`, `${send2}.A`)
    const recv2 = b.add('netrecv', 600, 100, { params: { name: 'back', bits: 1 } })
    const led = b.add('led', 700, 100)
    b.wire(`${recv2}.Y`, `${led}.A`)
    const circuit = b.build()
    const want = rows(circuit, [s], [led])
    expect(want).toEqual([[1], [0]])
    const after = produce(circuit, (x) => {
      collapseSelection(x, [recv, inv, send2], 'Inv', makeId)
    })
    const inst = Object.values(after.comps).find((c) => c.type === IC)!
    expect(inst.params).toMatchObject({ ins: 'go:1', outs: 'back:1' })
    const labels = Object.values(after.comps).filter((c) => c.type === 'netrecv' || c.type === 'netsend').map((c) => `${c.type}:${c.params.name}`).sort()
    expect(labels).toEqual(['netrecv:back', 'netrecv:go', 'netsend:back', 'netsend:go'])
    expect(rows(after, [s], [led])).toEqual(want)
  })

  it('a label that is read inside and outside both stays inside and also leaves as a pin', () => {
    const b = new CircuitBuilder()
    const s = b.add('switch', 0, 0, { label: 'S' })
    const inv = b.add('not', 100, 0)
    const send = b.add('netsend', 200, 0, { params: { name: 'n', bits: 1 } })
    const recvIn = b.add('netrecv', 300, 0, { params: { name: 'n', bits: 1 } })
    const insideLed = b.add('led', 400, 0)
    b.wire(`${s}.Q`, `${inv}.A`)
    b.wire(`${inv}.Y`, `${send}.A`)
    b.wire(`${recvIn}.Y`, `${insideLed}.A`)
    const recvOut = b.add('netrecv', 300, 200, { params: { name: 'n', bits: 1 } })
    const outsideLed = b.add('led', 400, 200)
    b.wire(`${recvOut}.Y`, `${outsideLed}.A`)
    const circuit = b.build()
    const want = rows(circuit, [s], [insideLed, outsideLed])
    expect(want).toEqual([[1, 1], [0, 0]])
    const after = produce(circuit, (x) => {
      collapseSelection(x, [s, inv, send, recvIn, insideLed], 'Pair', makeId)
    })
    const inst = Object.values(after.comps).find((k) => k.type === IC)!
    // The switch and the LED inside are pins too, and so is the label: the outside LED reads that pin through a label of the same name.
    expect(inst.params).toMatchObject({ ins: 'S:1', outs: 'out1:1,n:1' })
    expect(Object.values(after.comps).filter((k) => k.type === 'netsend' && k.params.name === 'n')).toHaveLength(1)
    expect(expandICs(after).circuit.comps[outsideLed]).toBeDefined()
    // Wired to a switch of its own, the instance does what the circuit did.
    const wired = produce(after, (d) => {
      d.comps.s2 = { id: 's2', type: 'switch', x: 0, y: 0, rot: 0, flip: false, params: {}, label: 'S2' }
      d.wires.ws = { id: 'ws', from: { comp: 's2', pin: 'Q' }, to: { comp: inst.id, pin: 'S' }, path: [] }
    })
    expect(rows(wired, ['s2'], [outsideLed])).toEqual([[1], [0]])
  })

  it('returns null for a selection of notes only, or of nothing', () => {
    const b = new CircuitBuilder()
    const note = b.add('note', 0, 0)
    const c = b.build()
    expect(collapseSelection(c, [note], 'x', makeId)).toBeNull()
    expect(collapseSelection(c, [], 'x', makeId)).toBeNull()
  })
})
