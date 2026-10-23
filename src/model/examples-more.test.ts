import { describe, expect, it } from 'vitest'
import { Simulator } from '../engine/simulator'
import { simComps } from './circuit'
import { EXAMPLES } from './examples'

/** Load an example into a simulator, with helpers to find its parts by label and to flip switches and buttons. */
function rig(id: string) {
  const c = EXAMPLES.find((e) => e.id === id)!.build()
  const sim = new Simulator()
  sim.load({ comps: simComps(c), wires: Object.values(c.wires).map(({ from, to }) => ({ from, to })) })
  sim.settle()
  const part = (label: string) => {
    const k = Object.values(c.comps).find((x) => x.label === label)
    if (!k) throw new Error(`no part labelled ${label}`)
    return k.id
  }
  return {
    c,
    sim,
    part,
    ofType: (type: string) => Object.values(c.comps).filter((k) => k.type === type).map((k) => k.id),
    set(label: string, on: boolean) {
      const id = part(label)
      sim.setParams(id, { ...c.comps[id].params, on })
      sim.settle()
    },
    press(label: string, pressed: boolean) {
      sim.setState(part(label), { pressed })
      sim.settle()
    },
    lit: (label: string) => sim.pinValue(part(label), 'A'),
    /** One full clock cycle: the rising edge, then the falling edge. */
    cycle() {
      sim.stepClock()
      sim.stepClock()
    },
  }
}

describe('master-slave flip-flop example', () => {
  it('the master follows D while CLK is high; Q changes only when CLK falls', () => {
    const r = rig('master-slave')
    expect([r.lit('Master'), r.lit('Q (slave)')]).toEqual([0, 0])
    r.set('D', true)
    expect(r.lit('Q (slave)')).toBe(0) // CLK low: the master is shut
    r.set('CLK', true)
    expect([r.lit('Master'), r.lit('Q (slave)')]).toEqual([1, 0]) // master took D, slave still shut
    r.set('D', false)
    expect([r.lit('Master'), r.lit('Q (slave)')]).toEqual([0, 0]) // master follows while open
    r.set('D', true)
    r.set('CLK', false)
    expect([r.lit('Master'), r.lit('Q (slave)')]).toEqual([1, 1]) // the falling edge hands over
    r.set('D', false)
    expect([r.lit('Master'), r.lit('Q (slave)')]).toEqual([1, 1]) // both shut to D now
  })
})

describe('LFSR example', () => {
  it('walks through 15 different patterns and comes back, and Reset starts it from 0000', () => {
    const r = rig('lfsr')
    const [sr] = r.ofType('shiftreg')
    const value = () => ['QA', 'QB', 'QC', 'QD'].reduce((n, p, i) => n | (r.sim.pinValue(sr, p) << i), 0)
    r.press('Reset', true)
    r.press('Reset', false)
    expect(value()).toBe(0)
    const seen = new Set<number>()
    for (let i = 0; i < 15; i++) {
      seen.add(value())
      r.cycle()
    }
    expect(seen.size).toBe(15)
    expect(value()).toBe(0)
  })
})

describe('generated state machine examples', () => {
  it('the vending machine takes 5+10 cents and dispenses', () => {
    const r = rig('fsm-vending')
    const [d] = ['Dispense'].map((l) => r.part(l))
    r.set('Reset', true)
    r.set('Reset', false)
    r.set('N', true)
    r.cycle()
    r.set('N', false)
    r.set('D', true)
    r.cycle()
    expect(r.sim.pinValue(d, 'A')).toBe(1)
  })
})
