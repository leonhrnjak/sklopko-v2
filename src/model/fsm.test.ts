import { describe, expect, it } from 'vitest'
import { Simulator } from '../engine/simulator'
import { print, variables } from '../logic/expr'
import { simComps } from './circuit'
import { ENCODING_NAMES, codeText, encodeStates, fsmFrom, fsmLogic, generateFsm, nextBits, outputsOf, stateBits, stepFsm, validateEncoding, validateFsm, type EncodingKind, type Fsm } from './fsm'
import { FSM_EXAMPLES, SEQUENCE_DETECTOR, TRAFFIC_LIGHT, UP_DOWN_COUNTER, VENDING_MACHINE } from './fsm-examples'

const messages = (fsm: Fsm, level?: string) => validateFsm(fsm).filter((i) => !level || i.level === level).map((i) => i.message)
const KINDS: EncodingKind[] = ['binary', 'gray', 'onehot', 'custom']

describe('state machines: checking', () => {
  it('the four examples have no errors', () => {
    for (const f of FSM_EXAMPLES) expect(messages(f, 'error'), f.name).toEqual([])
  })

  it('says which transitions of a state can fire together, and for which inputs', () => {
    const f = fsmFrom({ name: 'M', type: 'moore', inputs: ['A', 'B'], states: ['S', 'X', 'Y'], transitions: [['S', 'X', 'A'], ['S', 'Y', 'A | B'], ['X', 'S'], ['Y', 'S']] })
    expect(messages(f, 'error')).toEqual(['Two transitions of state “S” can both fire (to “X” and to “Y”) when A=1, B=0. The first one listed is taken.'])
  })

  it('says where no guard holds: the machine stays', () => {
    const f = fsmFrom({ name: 'M', type: 'moore', inputs: ['A'], states: ['S', 'X'], transitions: [['S', 'X', 'A'], ['X', 'S']] })
    expect(messages(f, 'info')).toEqual(['State “S” stays where it is when A=0: no transition fires.'])
    expect(messages(f, 'error')).toEqual([])
  })

  it('says a state without transitions stays for good', () => {
    const f = fsmFrom({ name: 'M', type: 'moore', states: ['S', 'End'], transitions: [['S', 'End']] })
    expect(messages(f, 'info')).toEqual(['State “End” has no transitions: once the machine is there it stays.'])
  })

  it('finds a guard that does not parse, and one that uses something that is not an input', () => {
    const f = fsmFrom({ name: 'M', type: 'moore', inputs: ['A'], states: ['S', 'X'], transitions: [['S', 'X', 'A &'], ['X', 'S', 'A & Z']] })
    const errors = messages(f, 'error')
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('The guard of “S” → “X” does not make sense')
    expect(errors[1]).toBe('The guard of “X” → “S” uses “Z”, which is not an input.')
  })

  it('finds states that cannot be reached', () => {
    const f = fsmFrom({ name: 'M', type: 'moore', states: ['S', 'X', 'Lost'], transitions: [['S', 'X'], ['X', 'S'], ['Lost', 'S']] })
    expect(messages(f, 'warning')).toEqual(['State “Lost” cannot be reached from the reset state.'])
  })

  it('checks names: reserved, repeated, keywords, clashes between inputs and outputs', () => {
    const f = fsmFrom({ name: 'M', type: 'moore', inputs: ['Q0', 'A', 'A', 'AND', '1x'], outputs: ['A', 'D1', 'Reset', 'Ok'], states: ['S'], transitions: [] })
    const errors = messages(f, 'error').join('\n')
    expect(errors).toContain('“Q0” is a name the generated circuit uses itself')
    expect(errors).toContain('There are two inputs called “A”.')
    expect(errors).toContain('“AND” is not a usable input name')
    expect(errors).toContain('“1x” is not a usable input name')
    expect(errors).toContain('“D1” is a name the generated circuit uses itself')
    expect(errors).toContain('“Reset” is a name the generated circuit uses itself')
    expect(errors).toContain('“A” is both an input and an output.')
  })

  it('checks states and transitions: none, no reset state, unknown states, repeated names, unknown outputs', () => {
    expect(messages({ ...TRAFFIC_LIGHT, states: [], transitions: [] }, 'error')).toContain('The machine has no states.')
    expect(messages({ ...TRAFFIC_LIGHT, reset: 'Nowhere' }, 'error')).toContain('The reset state is not one of the states.')
    const f = fsmFrom({ name: 'M', type: 'mealy', outputs: ['Z'], states: [{ name: 'S', outputs: ['Q'] }, 'S2'], transitions: [['S', 'Nope'], ['S2', 'S', '', ['W']]] })
    const errors = messages(f, 'error').join('\n')
    expect(errors).toContain('A transition joins a state that does not exist (S → Nope).')
    expect(errors).toContain('lists the output “W”, which is not one of the outputs.')
    expect(errors).toContain('State “S” lists the output “Q”')
    expect(messages(fsmFrom({ name: 'M', type: 'moore', states: ['S', { name: 'S' }], transitions: [] }), 'error').join()).toContain('Two states have the id “S”.')
  })

  it('warns about outputs that the type of machine ignores', () => {
    const moore = fsmFrom({ name: 'M', type: 'moore', outputs: ['Z'], states: ['S'], transitions: [['S', 'S', '', ['Z']]] })
    expect(messages(moore, 'warning')[0]).toContain('In a Moore machine the outputs belong to states')
    const mealy = fsmFrom({ name: 'M', type: 'mealy', outputs: ['Z'], states: [{ name: 'S', outputs: ['Z'] }], transitions: [['S', 'S']] })
    expect(messages(mealy, 'warning')[0]).toContain('In a Mealy machine the outputs belong to transitions')
  })

  it('limits the inputs and the states', () => {
    const many = fsmFrom({ name: 'M', type: 'moore', inputs: Array.from({ length: 9 }, (_, i) => `I${i}`), states: ['S'], transitions: [] })
    expect(messages(many, 'error')).toContain('There are 9 inputs; at most 8 are supported.')
    const states = fsmFrom({ name: 'M', type: 'moore', states: Array.from({ length: 33 }, (_, i) => `S${i}`), transitions: [] })
    expect(messages(states, 'error')).toContain('There are 33 states; at most 32 are supported.')
  })
})

describe('state machines: run directly', () => {
  const x = (v: number) => ({ X: v === 1 })
  it('the 1011 detector says Z on the clock edge where the pattern is completed, overlaps included', () => {
    const bits = [1, 0, 1, 1, 0, 1, 1, 0]
    let state = SEQUENCE_DETECTOR.reset
    const z: number[] = []
    for (const v of bits) {
      z.push(outputsOf(SEQUENCE_DETECTOR, state, x(v)).includes('Z') ? 1 : 0)
      state = stepFsm(SEQUENCE_DETECTOR, state, x(v))
    }
    expect(z).toEqual([0, 0, 0, 1, 0, 0, 1, 0]) // 1011 ends at the 4th bit, and 011 + the earlier 1 make a second at the 7th
  })

  it('the traffic light goes Red, Green, Yellow and round, showing one lamp (Moore)', () => {
    const seen: string[] = []
    let state = TRAFFIC_LIGHT.reset
    for (let i = 0; i < 6; i++) {
      seen.push(outputsOf(TRAFFIC_LIGHT, state, {}).join())
      state = stepFsm(TRAFFIC_LIGHT, state, {})
    }
    expect(seen).toEqual(['Red', 'Green', 'Yellow', 'Red', 'Green', 'Yellow'])
  })

  it('the vending machine takes 15 cents and gives the drink one state later', () => {
    let state = VENDING_MACHINE.reset
    const run = (n: boolean, d: boolean) => (state = stepFsm(VENDING_MACHINE, state, { N: n, D: d }))
    expect(run(true, false)).toBe('Cents5')
    expect(run(false, true)).toBe('Cents15')
    expect(outputsOf(VENDING_MACHINE, state, {})).toEqual(['Dispense'])
    expect(run(false, false)).toBe('Cents0')
    expect(run(true, true)).toBe('Cents0') // both at once: no transition fires
  })

  it('the first transition whose guard holds is taken, and none means stay', () => {
    const f = fsmFrom({ name: 'M', type: 'moore', inputs: ['A', 'B'], states: ['S', 'X', 'Y'], transitions: [['S', 'X', 'A'], ['S', 'Y', 'B']] })
    expect(stepFsm(f, 'S', { A: true, B: true })).toBe('X')
    expect(stepFsm(f, 'S', { A: false, B: true })).toBe('Y')
    expect(stepFsm(f, 'S', { A: false, B: false })).toBe('S')
  })
})

describe('state machines: codes', () => {
  const four = UP_DOWN_COUNTER
  const codes = (kind: EncodingKind, f: Fsm = four, custom?: Record<string, number>) => encodeStates(f, kind, custom)

  it('binary numbers the states with the reset state first', () => {
    const f = { ...four, reset: 'Two' }
    expect(codes('binary', f)).toEqual({ kind: 'binary', bits: 2, codes: { Two: 0, Zero: 1, One: 2, Three: 3 } })
  })

  it('Gray code changes one bit from each state to the next', () => {
    const e = codes('gray', fsmFrom({ name: 'M', type: 'moore', states: ['a', 'b', 'c', 'd', 'e'], transitions: [] }))
    expect(Object.values(e.codes)).toEqual([0, 1, 3, 2, 6])
    expect(e.bits).toBe(3)
    const v = Object.values(e.codes)
    for (let i = 1; i < v.length; i++) expect(((v[i] ^ v[i - 1]).toString(2).match(/1/g) ?? []).length).toBe(1)
  })

  it('one-hot has a bit per state, the reset state in bit 0', () => {
    expect(codes('onehot')).toEqual({ kind: 'onehot', bits: 4, codes: { Zero: 1, One: 2, Two: 4, Three: 8 } })
  })

  it('custom takes the codes given and fills in the rest with the lowest free numbers', () => {
    const e = codes('custom', four, { Two: 0, Three: 5 })
    expect(e.codes).toEqual({ Zero: 1, One: 2, Two: 0, Three: 5 })
    expect(e.bits).toBe(3)
    expect(validateEncoding(four, e)).toEqual([])
  })

  it('reports two states with the same code', () => {
    const e = codes('custom', four, { Zero: 2, One: 2 })
    expect(validateEncoding(four, e).map((i) => i.message)).toEqual(['States “Zero” and “One” have the same code.'])
  })

  it('names the bits and writes a code as digits', () => {
    expect(stateBits(3)).toEqual(['Q0', 'Q1', 'Q2'])
    expect(nextBits(2)).toEqual(['D0', 'D1'])
    expect(codeText(5, 4)).toBe('0101')
    expect(ENCODING_NAMES.onehot).toBe('One-hot')
  })

  it('a machine with one state still gets a flip-flop', () => {
    expect(codes('binary', fsmFrom({ name: 'M', type: 'moore', states: ['Only'], transitions: [] }))).toMatchObject({ bits: 1, codes: { Only: 0 } })
  })
})

describe('state machines: the logic', () => {
  /** How big the logic is: the number of literals written. */
  const size = (f: Fsm, dontCares: boolean) => fsmLogic(f, encodeStates(f, 'binary'), { dontCares }).outputs.reduce((n, o) => n + (print(o.expr, 'ascii').match(/[A-Za-z_]\w*/g) ?? []).length, 0)

  it('codes that no state has are don’t cares, which makes the logic smaller', () => {
    const five = fsmFrom({
      name: 'Five',
      type: 'moore',
      outputs: ['Last'],
      states: ['S0', 'S1', 'S2', 'S3', { name: 'S4', outputs: ['Last'] }],
      transitions: [['S0', 'S1'], ['S1', 'S2'], ['S2', 'S3'], ['S3', 'S4'], ['S4', 'S0']],
    })
    expect(size(five, true)).toBeLessThan(size(five, false))
  })

  it('names its inputs (the machine’s, then the state bits) and its outputs (the next state, then the machine’s)', () => {
    const p = fsmLogic(SEQUENCE_DETECTOR, encodeStates(SEQUENCE_DETECTOR, 'binary'))
    expect(p.inputs).toEqual(['X', 'Q0', 'Q1'])
    expect(p.outputs.map((o) => o.name)).toEqual(['D0', 'D1', 'Z'])
  })

  it('a Moore output does not depend on the inputs', () => {
    const p = fsmLogic(VENDING_MACHINE, encodeStates(VENDING_MACHINE, 'binary'))
    expect(variables(p.outputs.find((o) => o.name === 'Dispense')!.expr).sort()).toEqual(['Q0', 'Q1']) // no N, no D
  })

  it('one-hot writes each next bit as "in this state, with this guard" and uses one bit per state', () => {
    const p = fsmLogic(TRAFFIC_LIGHT, encodeStates(TRAFFIC_LIGHT, 'onehot'))
    expect(p.inputs).toEqual(['Q0', 'Q1', 'Q2'])
    expect(print(p.outputs.find((o) => o.name === 'D1')!.expr, 'ascii')).toBe('Q0') // Green follows Red
  })
})

// ---- The circuit, simulated against the machine ----------------------------------------------------

/** A generated circuit, loaded into a simulator. The wires need no routing for that. */
function rig(fsm: Fsm, encoding: EncodingKind, custom?: Record<string, number>) {
  const g = generateFsm(fsm, { encoding, custom, unrouted: true })
  const c = g.circuit
  const sim = new Simulator()
  sim.load({ comps: simComps(c), wires: Object.values(c.wires).map(({ from, to }) => ({ from, to })) })
  sim.settle()
  const toggle = (id: string, on: boolean) => {
    sim.setParams(id, { ...c.comps[id].params, on })
    sim.settle()
  }
  const stateOf = () => {
    const code = g.parts.flops.reduce((n, ff, i) => n | (sim.pinValue(ff, 'Q') << i), 0)
    return fsm.states.find((s) => g.encoding.codes[s.id] === code)?.id
  }
  return {
    g,
    state: stateOf,
    outputs: () => fsm.outputs.filter((o) => sim.pinValue(g.parts.outputs[o], 'A') === 1),
    hold: () => toggle(g.parts.reset, true),
    release: () => toggle(g.parts.reset, false),
    set: (inputs: Record<string, boolean>) => {
      for (const [name, on] of Object.entries(inputs)) toggle(g.parts.inputs[name], on)
    },
    /** One full clock cycle: the edge that moves the machine, then the falling edge. */
    cycle: () => {
      sim.stepClock()
      sim.stepClock()
    },
  }
}

/** Run a sequence of inputs on the circuit and on the machine; they must agree on the outputs before every edge and the state after it. */
function agree(r: ReturnType<typeof rig>, fsm: Fsm, sequence: Record<string, boolean>[]): string | null {
  r.hold()
  if (r.state() !== fsm.reset) return `held in reset, the circuit is in ${r.state()}, not ${fsm.reset}`
  r.release()
  let state = fsm.reset
  for (const [i, inputs] of sequence.entries()) {
    r.set(inputs)
    const wantOut = outputsOf(fsm, state, inputs)
    if (r.outputs().join() !== wantOut.join()) return `step ${i} in ${state} with ${JSON.stringify(inputs)}: outputs ${r.outputs()}, expected ${wantOut}`
    r.cycle()
    state = stepFsm(fsm, state, inputs)
    if (r.state() !== state) return `step ${i}: the circuit is in ${r.state()}, the machine in ${state}`
  }
  return null
}

/** Every input sequence of a length, as lists of input values. */
function sequences(names: string[], length: number): Record<string, boolean>[][] {
  const vectors = Array.from({ length: 2 ** names.length }, (_, v) => Object.fromEntries(names.map((n, i) => [n, ((v >> i) & 1) === 1])))
  let all: Record<string, boolean>[][] = [[]]
  for (let i = 0; i < length; i++) all = all.flatMap((s) => vectors.map((v) => [...s, v]))
  return all
}
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const randomSequence = (names: string[], length: number, rnd: () => number) => Array.from({ length }, () => Object.fromEntries(names.map((n) => [n, rnd() < 0.5])))

describe('state machines: the generated circuit does what the machine does', () => {
  // Custom codes spread out, with the reset state in the middle: gaps in the code space, and a reset code that is not 0.
  const custom = (f: Fsm): Record<string, number> => Object.fromEntries(f.states.map((s, i) => [s.id, s.id === f.reset ? 5 : i * 2]))

  for (const fsm of FSM_EXAMPLES)
    for (const kind of KINDS)
      it(`${fsm.name}, ${kind} codes`, () => {
        const r = rig(fsm, kind, kind === 'custom' ? custom(fsm) : undefined)
        const length = fsm.inputs.length === 0 ? 8 : fsm.inputs.length === 1 ? 6 : 3
        for (const s of sequences(fsm.inputs, length)) expect(agree(r, fsm, s), JSON.stringify(s)).toBeNull()
        const rnd = random(fsm.inputs.length + kind.length)
        for (let i = 0; i < 12; i++) expect(agree(r, fsm, randomSequence(fsm.inputs, 16, rnd))).toBeNull()
      })

  it('reset puts the machine in its reset state whatever the code, and it runs on once Reset is off', () => {
    const f = { ...TRAFFIC_LIGHT, reset: 'Yellow' }
    for (const kind of KINDS) {
      const r = rig(f, kind)
      r.cycle()
      r.cycle()
      r.hold()
      expect(r.state(), kind).toBe('Yellow')
      r.release()
      r.cycle()
      expect(r.state(), kind).toBe('Red') // Yellow is followed by Red
    }
  })

  it('a state in which no guard holds stays, in every encoding', () => {
    const f = fsmFrom({ name: 'Stay', type: 'mealy', inputs: ['A'], outputs: ['Z'], states: ['S', 'T'], transitions: [['S', 'T', 'A', ['Z']], ['T', 'S', '!A']] })
    for (const kind of KINDS) {
      const r = rig(f, kind)
      for (const s of sequences(['A'], 6)) expect(agree(r, f, s), `${kind} ${JSON.stringify(s)}`).toBeNull()
    }
  })

  it('the first of two guards that can hold together wins', () => {
    const f = fsmFrom({ name: 'First', type: 'moore', inputs: ['A', 'B'], states: ['S', 'X', 'Y'], transitions: [['S', 'X', 'A'], ['S', 'Y', 'B'], ['X', 'S'], ['Y', 'S']] })
    expect(() => generateFsm(f)).toThrow(/can both fire/) // the circuit is only built for a machine that is not ambiguous
    const clear = fsmFrom({ name: 'First', type: 'moore', inputs: ['A', 'B'], states: ['S', 'X', 'Y'], transitions: [['S', 'X', 'A'], ['S', 'Y', '!A & B'], ['X', 'S'], ['Y', 'S']] })
    const r = rig(clear, 'binary')
    for (const s of sequences(['A', 'B'], 3)) expect(agree(r, clear, s)).toBeNull()
  })

  it('works with more inputs than the minimiser can take: the logic is written out', () => {
    const inputs = Array.from({ length: 8 }, (_, i) => `I${i}`)
    const f = fsmFrom({
      name: 'Wide',
      type: 'mealy',
      inputs,
      outputs: ['Hit'],
      states: ['A', 'B', 'C', 'D', 'E'],
      transitions: [['A', 'B', 'I0 & I7'], ['A', 'C', 'I1 & !I0'], ['B', 'D', 'I2 | I3', ['Hit']], ['C', 'E', 'I4 ^ I5'], ['D', 'A'], ['E', 'A', 'I6', ['Hit']], ['E', 'B', '!I6']],
    })
    expect(fsmLogic(f, encodeStates(f, 'binary')).inputs).toHaveLength(8 + 3) // 11 variables: beyond what is minimised
    for (const kind of ['binary', 'onehot'] as const) {
      const r = rig(f, kind)
      const rnd = random(7)
      for (let i = 0; i < 40; i++) expect(agree(r, f, randomSequence(inputs, 12, rnd)), kind).toBeNull()
    }
  })

  it('one-hot and binary give the same behaviour (same outputs for the same inputs)', () => {
    const a = rig(VENDING_MACHINE, 'binary')
    const b = rig(VENDING_MACHINE, 'onehot')
    const rnd = random(3)
    for (let i = 0; i < 10; i++) {
      const seq = randomSequence(['N', 'D'], 14, rnd)
      a.hold()
      b.hold()
      a.release()
      b.release()
      for (const inputs of seq) {
        a.set(inputs)
        b.set(inputs)
        expect(a.outputs()).toEqual(b.outputs())
        a.cycle()
        b.cycle()
      }
    }
  })
})

describe('state machines: the generated circuit', () => {
  it('has a D flip-flop per state bit, a Clock and a Reset that starts on, and labels that carry the state round', () => {
    for (const [kind, bits] of [['binary', 2], ['gray', 2], ['onehot', 4]] as const) {
      const { circuit, parts, encoding } = generateFsm(UP_DOWN_COUNTER, { encoding: kind, unrouted: true })
      const comps = Object.values(circuit.comps)
      expect(encoding.bits).toBe(bits)
      expect(comps.filter((k) => k.type === 'dff')).toHaveLength(bits)
      expect(circuit.comps[parts.reset]).toMatchObject({ type: 'switch', label: 'Reset', params: { on: true } })
      expect(circuit.comps[parts.clock]).toMatchObject({ type: 'clock', label: 'Clock' })
      const names = (type: string) => comps.filter((k) => k.type === type).map((k) => String(k.params.name)).sort()
      expect(names('netsend')).toEqual([...nextBits(bits), ...stateBits(bits)].sort()) // D0… leave the logic, Q0… leave the flip-flops
      expect(names('netrecv')).toEqual([...nextBits(bits), ...stateBits(bits)].sort()) // and each arrives where it is used
    }
  })

  it('labels its inputs and outputs with their names, and has a frame and a note that give the state codes', () => {
    const { circuit, parts } = generateFsm(SEQUENCE_DETECTOR, { unrouted: true })
    expect(circuit.comps[parts.inputs.X]).toMatchObject({ type: 'switch', label: 'X' })
    expect(circuit.comps[parts.outputs.Z]).toMatchObject({ type: 'led', label: 'Z' })
    const frame = Object.values(circuit.comps).find((k) => k.type === 'frame')!
    expect(frame.params.title).toBe('State machine: Detect 1011')
    const note = Object.values(circuit.comps).find((k) => k.type === 'note')!
    expect(String(note.params.text)).toContain('Start = 00')
    expect(String(note.params.text)).toContain('Mealy machine')
  })

  it('wires the reset to S for a 1 in the reset code and to R for a 0', () => {
    const f = { ...TRAFFIC_LIGHT, reset: 'Yellow' }
    const { circuit, parts, encoding } = generateFsm(f, { unrouted: true })
    for (const [i, ff] of parts.flops.entries()) {
      const w = Object.values(circuit.wires).find((x) => x.from.comp === parts.reset && x.to.comp === ff)!
      expect(w.to.pin).toBe(((encoding.codes.Yellow >> i) & 1) === 1 ? 'S' : 'R')
    }
  })

  it('is routed unless asked not to: every wire has a path', () => {
    const { circuit } = generateFsm(TRAFFIC_LIGHT)
    for (const w of Object.values(circuit.wires)) expect(w.path.length, w.id).toBeGreaterThanOrEqual(2)
  })

  it('refuses a machine with errors, and codes that clash, saying why', () => {
    expect(() => generateFsm({ ...TRAFFIC_LIGHT, reset: 'Nope' })).toThrow('The reset state is not one of the states.')
    expect(() => generateFsm(UP_DOWN_COUNTER, { encoding: 'custom', custom: { Zero: 1, One: 1 } })).toThrow(/same code/)
  })

  it('a machine with no inputs builds no switch except Reset', () => {
    const { circuit } = generateFsm(TRAFFIC_LIGHT, { unrouted: true })
    expect(Object.values(circuit.comps).filter((k) => k.type === 'switch').map((k) => k.label)).toEqual(['Reset'])
  })
})
