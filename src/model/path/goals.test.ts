import { describe, expect, it } from 'vitest'
import { Simulator } from '../../engine/simulator'
import { flatten } from '../buses'
import type { Circuit } from '../circuit'
import { displayValue, goalHolds, goalProblems, labelled, tick } from './goals'
import { EXAMPLES } from '../examples'
import { STEPS } from './steps'
import type { ExploreStep, Goal } from './types'

const explores = STEPS.filter((s): s is ExploreStep => s.kind === 'explore')

/** The circuit an explore step opens with: built on the spot, or an example (made once: routing the wires of a board takes seconds). */
const made = new Map<string, Circuit>()
const openOf = (s: ExploreStep): Circuit => {
  if ('build' in s.open) return s.open.build()
  const id = s.open.example
  if (!made.has(id)) made.set(id, EXAMPLES.find((e) => e.id === id)!.build())
  return structuredClone(made.get(id)!)
}

/** What a learner does to reach each explore step's goals: operate the parts with these labels, in order. */
const SCRIPTS: Record<string, ({ label: string; to: number } | { cycles: number; every?: number } | { type: string })[]> = {
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
  'mux4-tour': [
    { label: 'S1', to: 1 },
    { label: 'D2', to: 1 },
  ],
  'ripple-tour': [{ label: 'B', to: 1 }],
  'rom-ram-tour': [
    { label: 'Address', to: 3 },
    { label: 'Data', to: 9 },
    { label: 'WE', to: 1 },
    { label: 'CLK', to: 1 },
    { label: 'Address', to: 5 },
  ],
  'one-bus': [{ cycles: 20 }],
  'asm-irq': [{ cycles: 1100 }],
  'basic-boot': [{ cycles: 25_000, every: 250 }],
  'basic-print': [
    { cycles: 25_000, every: 250 },
    { type: 'PRINT 2+3\r' },
    { cycles: 30_000, every: 250 },
    { type: '10 PRINT "HELLO"\r' },
    { cycles: 40_000, every: 250 },
    { type: 'RUN\r' },
    { cycles: 20_000, every: 250 },
  ],
  'basic-loop': [
    { cycles: 25_000, every: 250 },
    { type: 'FOR I=1 TO 10: PRINT I: NEXT\r' },
    { cycles: 150_000, every: 250 },
  ],
  feedback: [
    { label: 'Enable', to: 1 },
    { label: 'Enable', to: 0 },
  ],
  'alu-tour': [
    { label: 'S1', to: 1 },
    { label: 'S1', to: 0 },
    { label: 'B', to: 10 },
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
  it('have at least one goal, a task, and goals on parts that exist', { timeout: 120_000 }, () => {
    expect(explores.length).toBeGreaterThanOrEqual(3)
    for (const s of explores) {
      expect(s.goals.length, s.id).toBeGreaterThan(0)
      expect(s.task, s.id).toBeTruthy()
      expect(goalProblems(s.goals, openOf(s)), s.id).toEqual([])
    }
  })

  it('offer parts that the circuit they open is made of', { timeout: 120_000 }, () => {
    for (const s of explores) for (const k of Object.values(openOf(s).comps)) expect(s.palette ?? [k.type], `${s.id}: ${k.type}`).toContain(k.type)
  })

  for (const s of explores) {
    it(`${s.id}: no goal holds before the learner does anything, and a short script reaches every goal`, () => {
      const c = openOf(s)
      const { sim, operate } = play(c)
      let ticked = s.goals.map(() => false)
      const look = () => (ticked = tick(s.goals, ticked, !!s.ordered, (g) => goalHolds(g, c, sim)))
      look()
      expect(ticked.every(Boolean), 'done before playing').toBe(false)
      expect(ticked[0], 'the first goal is not there from the start').toBe(false)
      for (const a of SCRIPTS[s.id]) {
        if ('cycles' in a) {
          // Clock steps, looking after each: a goal about the pins is seen for a moment only.
          for (let i = 0; i < a.cycles * 2; i++) {
            sim.stepClock()
            if (i % (a.every ?? 1) === 0) look()
          }
        } else if ('type' in a) {
          // Keys typed on a terminal (the only one on the board).
          sim.terminal(Object.values(c.comps).find((k) => k.type === 'acia6551')!.id, { op: 'type', text: a.type, capitals: true })
        } else {
          operate(a.label, a.to)
          look()
        }
      }
      expect(ticked).toEqual(s.goals.map(() => true))
    }, 120_000) // a board runs hundreds of thousands of cycles here (BASIC starting up)
  }
})

describe('goals', () => {
  const c = openOf(explores.find((s) => s.id === 'show-nine')!)

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

describe('goals on switches', () => {
  const step = explores.find((s) => s.id === 'mux4-tour')!
  const c = openOf(step)

  it('hold when every named switch is as asked, whatever the others do', () => {
    const { sim, operate } = play(c)
    const goal: Goal = { switches: { S1: 1, S0: 0 }, text: '' }
    expect(goalHolds(goal, c, sim)).toBe(false)
    operate('S1', 1)
    expect(goalHolds(goal, c, sim)).toBe(true)
    operate('D0', 1)
    expect(goalHolds(goal, c, sim)).toBe(true)
    operate('S0', 1)
    expect(goalHolds(goal, c, sim)).toBe(false)
  })

  it('are reported when a switch is not there, or is not a switch', () => {
    expect(goalProblems([{ switches: { S1: 1, Nope: 0 }, text: 'x' }], c)).toHaveLength(1)
    expect(goalProblems([{ switches: { Y: 1 }, text: 'x' }], c)).toHaveLength(1)
  })
})
