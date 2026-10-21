import { describe, expect, it } from 'vitest'
import { Simulator } from '../engine/simulator'
import { EXAMPLES } from './examples'

describe('digital clock example', () => {
  const setup = () => {
    const c = EXAMPLES.find((e) => e.id === 'clock')!.build()
    const sim = new Simulator()
    sim.load({ comps: Object.values(c.comps), wires: Object.values(c.wires) })
    sim.settle()
    // Counters left to right: hours tens/units, minutes tens/units, seconds tens/units.
    const counters = Object.values(c.comps)
      .filter((k) => k.type === 'counter')
      .sort((a, b) => a.x - b.x)
      .map((k) => k.id)
    const digit = (id: string) => ['A', 'B', 'C', 'D'].reduce((n, p, i) => n | (sim.pinValue(id, p) << i), 0)
    const time = () => {
      const d = counters.map(digit)
      return `${d[0]}${d[1]}:${d[2]}${d[3]}:${d[4]}${d[5]}`
    }
    /** Advance whole seconds of simulated time. */
    const run = (seconds: number) => {
      for (let left = seconds; left > 0; left -= 30) sim.advance(Math.min(30, left) * 1000)
    }
    const button = (label: string) => Object.values(c.comps).find((k) => k.label === label)!.id
    return { sim, time, run, button }
  }

  it('counts seconds, minutes and hours, and wraps at midnight', () => {
    const { time, run } = setup()
    expect(time()).toBe('00:00:00')
    run(59)
    expect(time()).toBe('00:00:59')
    run(1)
    expect(time()).toBe('00:01:00')
    run(3600 - 60)
    expect(time()).toBe('01:00:00')
    run(9 * 3600)
    expect(time()).toBe('10:00:00')
    run(14 * 3600 - 1)
    expect(time()).toBe('23:59:59')
    run(1)
    expect(time()).toBe('00:00:00')
  })

  it('set buttons advance minutes and hours once per second while held', () => {
    const { sim, time, run, button } = setup()
    // Settle after each press, like the app does every frame, so the enable is ready before the next edge.
    const press = (label: string, pressed: boolean) => {
      sim.setState(button(label), { pressed })
      sim.settle()
    }
    press('Set minutes', true)
    run(3)
    press('Set minutes', false)
    press('Set hours', true)
    run(2)
    press('Set hours', false)
    expect(time()).toBe('02:03:05')
  })
})
