import { describe, expect, it } from 'vitest'
import { getDef } from './registry'
import { Simulator, type SimCircuit } from './simulator'
import { paramDefaults } from './types'

const clock = (hz: number): SimCircuit => ({
  comps: [{ id: 'clk', type: 'clock', params: { ...paramDefaults(getDef('clock')), hz } }],
  wires: [],
})

describe('the clock rate', () => {
  it('is the rate of the fastest clock, and null without one', () => {
    const s = new Simulator()
    s.load({ comps: [], wires: [] })
    expect(s.fastestClockHz()).toBeNull()
    s.load({
      comps: [
        { id: 'a', type: 'clock', params: { ...paramDefaults(getDef('clock')), hz: 4 } },
        { id: 'b', type: 'clock', params: { ...paramDefaults(getDef('clock')), hz: 250 } },
      ],
      wires: [],
    })
    expect(s.fastestClockHz()).toBe(250)
  })

  it('counts the clock time it was asked for, and skips none when it has the time', () => {
    const s = new Simulator()
    s.load(clock(10))
    s.settle()
    s.advance(1000, performance.now() + 10_000)
    expect(s.clockTime).toEqual({ offered: 1000, skipped: 0 })
  })

  it('counts the clock time it skipped when it runs out of time', () => {
    const s = new Simulator()
    s.load(clock(1000))
    s.settle()
    s.advance(1000, performance.now() - 1) // no time left at all
    expect(s.lagging).toBe(true)
    const { offered, skipped } = s.clockTime
    expect(offered).toBe(1000)
    expect(skipped).toBeGreaterThan(900)
    expect(skipped).toBeLessThan(1000)
  })

  it('counts nothing without a clock', () => {
    const s = new Simulator()
    s.load({ comps: [], wires: [] })
    s.advance(1000)
    expect(s.clockTime).toEqual({ offered: 0, skipped: 0 })
  })
})
