import { describe, expect, it } from 'vitest'
import { Simulator } from '../../engine/simulator'
import { flatten } from '../buses'
import type { Circuit } from '../circuit'
import { displayValue, goalHolds, goalProblems, labelled, tick } from './goals'
import { STEPS } from './steps'
import type { ExploreStep, Goal } from './types'

const explores = STEPS.filter((s): s is ExploreStep => s.kind === 'explore')

/** What a learner does to reach each explore step's goals: operate the parts with these labels, in order. */
const SCRIPTS: Record<string, { label: string; to: number }[]> = {
  bits: [
    { label: 'S', to: 1 },
    { label: 'S', to: 0 },
  ],
  'show-nine': [
    { label: 'N', to: 9 },
    { label: 'N', to: 15 },
  ],
  'meet-nand': [
    { label: 'A', to: 1 },
    { label: 'B', to: 1 },
  ],
}

/** A simulator holding the circuit, with a way to operate its switches and 4-bit inputs by label. */
function play(c: Circuit) {
  const sim = new Simulator()
  sim.load(flatten(c))
  sim.settle()
  return {
    sim,
    operate(label: string, to: number) {
      const k = labelled(c, label)!
      sim.setParams(k.id, k.type === 'switch' ? { ...k.params, on: to === 1 } : { ...k.params, value: to })
      sim.settle()
    },
  }
}

describe('explore steps', () => {
  it('have at least one goal, a task, and goals on parts that exist', () => {
    expect(explores.length).toBeGreaterThanOrEqual(3)
    for (const s of explores) {
      expect(s.goals.length, s.id).toBeGreaterThan(0)
      expect(s.task, s.id).toBeTruthy()
      expect(goalProblems(s.goals, s.open.build()), s.id).toEqual([])
    }
  })

  it('offer parts that the circuit they open is made of', () => {
    for (const s of explores) for (const k of Object.values(s.open.build().comps)) expect(s.palette ?? [k.type], `${s.id}: ${k.type}`).toContain(k.type)
  })

  for (const s of explores) {
    it(`${s.id}: no goal holds before the learner does anything, and a short script reaches every goal`, () => {
      const c = s.open.build()
      const { sim, operate } = play(c)
      let ticked = s.goals.map(() => false)
      const look = () => (ticked = tick(s.goals, ticked, !!s.ordered, (g) => goalHolds(g, c, sim)))
      look()
      expect(ticked.every(Boolean), 'done before playing').toBe(false)
      expect(ticked[0], 'the first goal is not there from the start').toBe(false)
      for (const a of SCRIPTS[s.id]) {
        operate(a.label, a.to)
        look()
      }
      expect(ticked).toEqual(s.goals.map(() => true))
    })
  }
})

describe('goals', () => {
  const c = explores.find((s) => s.id === 'show-nine')!.open.build()

  it('read a display as a number, and nothing while a bit is unknown', () => {
    const { sim, operate } = play(c)
    operate('N', 9)
    expect(displayValue(c, 'Number', sim)).toBe(9)
    expect(goalHolds({ display: 'Number', is: 9, text: '' }, c, sim)).toBe(true)
    expect(goalHolds({ display: 'Number', is: 8, text: '' }, c, sim)).toBe(false)
    expect(displayValue(c, 'No such display', sim)).toBeNull()
    expect(displayValue({ ...c, wires: {} }, 'Number', sim)).toBe(9) // the reader decides, not the wires
  })

  it('stay ticked once reached, and an ordered goal waits for the one before it', () => {
    const goals: Goal[] = [
      { led: 'Y', is: 1, text: 'on' },
      { led: 'Y', is: 0, text: 'off again' },
    ]
    // The LED is dark at the start: unordered, the second goal holds at once; ordered, it waits.
    const dark = () => false
    const holds = (g: Goal) => ('led' in g ? g.is === 0 : false)
    expect(tick(goals, [false, false], false, holds)).toEqual([false, true])
    expect(tick(goals, [false, false], true, holds)).toEqual([false, false])
    expect(tick(goals, [true, false], true, holds)).toEqual([true, true])
    expect(tick(goals, [true, true], true, dark)).toEqual([true, true])
  })

  it('see an oscillating circuit', () => {
    const { sim } = play(c)
    expect(goalHolds({ oscillating: true, text: '' }, c, sim)).toBe(false)
  })

  it('report a goal on a part that is not there, or not an LED', () => {
    expect(goalProblems([{ led: 'Nope', is: 1, text: 'x' }], c)).toHaveLength(1)
    expect(goalProblems([{ led: 'Number', is: 1, text: 'x' }], c)).toHaveLength(1)
  })
})
