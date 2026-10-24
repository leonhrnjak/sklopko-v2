import { describe, expect, it } from 'vitest'
import { CircuitBuilder } from './builder'
import { checkChallenge } from './challengecheck'
import { CHALLENGES } from './challenges'
import { testNames, parseTests, runTests } from './testbench'
import { deserialize, migrate, serialize } from './serialize'

/** A D flip-flop with a clock switch: D, CLK in; Q out. */
function dff() {
  const b = new CircuitBuilder()
  const d = b.add('switch', 0, 0, { label: 'D' })
  const clk = b.add('switch', 0, 80, { label: 'CLK' })
  const ff = b.add('dff', 140, 0)
  const q = b.add('led', 300, 0, { label: 'Q' })
  b.wire(`${d}.Q`, `${ff}.D`)
  b.wire(`${clk}.Q`, `${ff}.CLK`)
  b.wire(`${ff}.Q`, `${q}.A`)
  return b.build()
}

/** An AND gate: A, B in; Y out. */
function andGate() {
  const b = new CircuitBuilder()
  const a = b.add('switch', 0, 0, { label: 'A' })
  const bb = b.add('switch', 0, 60, { label: 'B' })
  const g = b.add('and', 100, 20)
  const y = b.add('led', 260, 20, { label: 'Y' })
  b.wire(`${a}.Q`, `${g}.A`)
  b.wire(`${bb}.Q`, `${g}.B`)
  b.wire(`${g}.Y`, `${y}.A`)
  return b.build()
}

describe('reading a testbench', () => {
  it('a line is set, pulse and expect parts in order; comments and empty lines are skipped', () => {
    const { steps, errors } = parseTests(`
# a comment
A=1 B=0; expect Y=0   // trailing comment

pulse CLK
D=1, X=0; pulse CLK; expect Q=1`)
    expect(errors).toEqual([])
    expect(steps.map((s) => s.line)).toEqual([3, 5, 6])
    expect(steps[0].actions).toEqual([
      { kind: 'set', values: { A: 1, B: 0 } },
      { kind: 'expect', values: { Y: 0 } },
    ])
    expect(steps[1].actions).toEqual([{ kind: 'pulse', name: 'CLK' }])
    expect(steps[2].actions.map((a) => a.kind)).toEqual(['set', 'pulse', 'expect'])
  })

  it('says which line is wrong, and why', () => {
    const { steps, errors } = parseTests('A=1\nA=2\npulse\nexpect\nA=1 B')
    expect(steps).toHaveLength(1)
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 5])
    expect(errors[0].message).toContain('“A=2” is not NAME=0 or NAME=1')
    expect(errors[1].message).toBe('pulse needs the name of a switch: pulse CLK.')
    expect(errors[2].message).toBe('expect needs what to expect: expect Q=1.')
  })
})

describe('running a testbench', () => {
  it('a combinational circuit: set the switches, expect the LED', () => {
    const r = runTests(andGate(), 'A=1 B=1; expect Y=1\nA=0; expect Y=0\nB=0; expect Y=0\nA=1 B=1; expect Y=1').run!
    expect(r.passed).toBe(true)
    expect(r.outcomes.map((o) => o.failures.length)).toEqual([0, 0, 0, 0])
  })

  it('a wrong expectation fails, naming the line, the LED and what it showed', () => {
    const r = runTests(andGate(), 'A=1 B=1; expect Y=1\nA=1 B=0; expect Y=1').run!
    expect(r.passed).toBe(false)
    expect(r.outcomes[0].failures).toEqual([])
    expect(r.outcomes[1].failures).toEqual([{ line: 2, output: 'Y', expected: 1, got: 0 }])
  })

  it('a pulse is one rising and one falling edge: the flip-flop takes D at the edge and holds it', () => {
    const r = runTests(dff(), 'expect Q=0\nD=1; expect Q=0\npulse CLK; expect Q=1\nD=0; expect Q=1\npulse CLK; expect Q=0').run!
    expect(r.passed).toBe(true)
    // Without the pulse the flip-flop has not taken D.
    expect(runTests(dff(), 'D=1; expect Q=1').run!.outcomes[0].failures).toEqual([{ line: 1, output: 'Q', expected: 1, got: 0 }])
  })

  it('a switch that was on stays on after its pulse', () => {
    const r = runTests(dff(), 'D=1; CLK=1; expect Q=1\nCLK=0; pulse CLK; D=0; pulse CLK; expect Q=0').run!
    expect(r.passed).toBe(true)
    // CLK was on before the pulse, so after "pulse" it is on again: the next set to 0 and a pulse gives one more edge.
    const stays = runTests(dff(), 'D=1; CLK=1; pulse CLK; D=0; CLK=0; CLK=1; expect Q=0').run!
    expect(stays.passed).toBe(true)
  })

  it('a name that is no switch or no LED is a problem of that step, and the other steps still run', () => {
    const r = runTests(andGate(), 'C=1\nA=1 B=1; expect Y=1\nexpect Z=1\npulse X').run!
    expect(r.outcomes[0].problem).toBe('There is no switch called C.')
    expect(r.outcomes[1].problem).toBeUndefined()
    expect(r.outcomes[2].problem).toBe('There is no LED called Z.')
    expect(r.outcomes[3].problem).toBe('There is no switch called X.')
    expect(r.passed).toBe(false)
  })

  it('names are the labels, or Switch1 / LED1 for parts without one', () => {
    const b = new CircuitBuilder()
    const s = b.add('switch', 0, 0)
    const l = b.add('led', 100, 0)
    b.wire(`${s}.Q`, `${l}.A`)
    const c = b.build()
    expect(testNames(c)).toEqual({ inputs: ['Switch1'], outputs: ['LED1'] })
    expect(runTests(c, 'Switch1=1; expect LED1=1').run!.passed).toBe(true)
  })

  it('a parse error stops the run and is returned', () => {
    const r = runTests(andGate(), 'A=1\nnonsense here')
    expect(r.run).toBeNull()
    expect(r.errors).toHaveLength(1)
  })

  it('works through a custom IC', () => {
    const b = new CircuitBuilder()
    const id = b.defineIC('And', andGate())
    const x = b.add('switch', 0, 0, { label: 'X' })
    const z = b.add('switch', 0, 60, { label: 'Z' })
    const ic = b.ic(id, 100, 0)
    const o = b.add('led', 260, 0, { label: 'OUT' })
    b.wire(`${x}.Q`, `${ic}.A`)
    b.wire(`${z}.Q`, `${ic}.B`)
    b.wire(`${ic}.Y`, `${o}.A`)
    expect(runTests(b.build(), 'X=1 Z=1; expect OUT=1\nZ=0; expect OUT=0').run!.passed).toBe(true)
  })
})

describe('the testbench in a saved circuit', () => {
  it('is saved with it (version 3), comes back, and an older file has none', () => {
    const c = andGate()
    c.tests = 'A=1 B=1; expect Y=1'
    const saved = serialize(c)
    expect(saved.version).toBe(3)
    expect(deserialize(JSON.parse(JSON.stringify(saved))).tests).toBe('A=1 B=1; expect Y=1')
    expect(serialize(andGate()).tests).toBeUndefined()
    expect(deserialize(serialize(andGate())).tests).toBeUndefined()
    expect(migrate({ app: 'sklopko', version: 2, comps: [], wires: [] })).toMatchObject({ version: 3 })
  })

  it('is cut to its limit when a file has more, and ignored when it is not text', () => {
    const base = JSON.parse(JSON.stringify(serialize(andGate())))
    expect(deserialize({ ...base, tests: 'x'.repeat(9000) }).tests).toHaveLength(4000)
    expect(deserialize({ ...base, tests: 42 }).tests).toBeUndefined()
    expect(deserialize({ ...base, tests: '   ' }).tests).toBeUndefined()
  })
})

describe('the challenges that run steps still do', () => {
  it('every sequential challenge accepts its own solution', () => {
    for (const ch of CHALLENGES.filter((x) => x.kind === 'seq')) {
      const r = checkChallenge(ch, ch.solution())
      expect(r.passed, ch.id).toBe(true)
    }
  })
})
