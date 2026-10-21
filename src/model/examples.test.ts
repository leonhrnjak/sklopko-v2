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

function load(id: string) {
  const c = EXAMPLES.find((e) => e.id === id)!.build()
  const sim = new Simulator()
  sim.load({ comps: Object.values(c.comps), wires: Object.values(c.wires) })
  sim.settle()
  const byLabel = (label: string) => Object.values(c.comps).find((k) => k.label === label)!.id
  const ofType = (type: string) => Object.values(c.comps).filter((k) => k.type === type)
  return { c, sim, byLabel, ofType }
}

describe('traffic lights example', () => {
  it('cycles N–S green/yellow then E–W green/yellow, and serves a pedestrian request', () => {
    const { sim, byLabel, ofType } = load('traffic')
    // LEDs sorted top to bottom: N–S red, yellow, green, E–W red, yellow, green, WALK, DON'T WALK.
    const leds = ofType('led').sort((a, b) => a.y - b.y).map((k) => k.id)
    const lamps = () => leds.map((id) => sim.pinValue(id, 'A')).join('')
    const step = () => sim.advance(500) // 2 Hz clock: one count per 500 ms
    sim.advance(250) // first rising edge -> count 1
    const seen: string[] = []
    for (let n = 1; n < 17; n++) {
      seen.push(lamps().slice(0, 6))
      step()
    }
    //                NS: r y g  EW: r y g
    const nsGreen = '001100'
    const nsYellow = '010100'
    const ewGreen = '100001'
    const ewYellow = '100010'
    expect(seen).toEqual([
      ...Array(5).fill(nsGreen), // counts 1-5
      nsYellow,
      nsYellow,
      ...Array(6).fill(ewGreen),
      ewYellow,
      ewYellow,
      nsGreen, // count 0 again
    ])

    // Press during E–W green: WALK waits for the next N–S green, then turns off at yellow.
    for (let i = 0; i < 9; i++) step() // count 9 (E–W green)
    expect(lamps().slice(6)).toBe('01')
    sim.setState(byLabel('Pedestrian button'), { pressed: true })
    sim.settle()
    sim.setState(byLabel('Pedestrian button'), { pressed: false })
    sim.settle()
    expect(lamps().slice(6)).toBe('01')
    for (let i = 0; i < 7; i++) step() // count 0: N–S green
    expect(lamps().slice(6)).toBe('10')
    for (let i = 0; i < 6; i++) step() // count 6: yellow, request cleared
    expect(lamps().slice(6)).toBe('01')
    for (let i = 0; i < 10; i++) step() // next N–S green without a new press
    expect(lamps().slice(6)).toBe('01')
  })
})

describe('electronic dice example', () => {
  it('shows the right pips for every face', () => {
    const { sim, ofType } = load('dice')
    const cnt = ofType('counter')[0].id
    const die = ofType('dicedisp')[0].id
    const pips = () => sim.inputValues(die).join('')
    //            TL TR ML C MR BL BR
    const faces = ['0001000', '1000001', '1001001', '1100011', '1101011', '1110111']
    faces.forEach((face, n) => {
      sim.setState(cnt, { n })
      sim.settle()
      expect(pips(), `face ${n + 1}`).toBe(face)
    })
  })

  it('only spins while the roll button is held', () => {
    const { sim, ofType, byLabel } = load('dice')
    const cnt = ofType('counter')[0].id
    const value = () => ['A', 'B', 'C'].reduce((n, p, i) => n | (sim.pinValue(cnt, p) << i), 0)
    sim.advance(2000)
    expect(value()).toBe(0)
    sim.setState(byLabel('Hold to roll'), { pressed: true })
    sim.settle()
    const seen = new Set<number>()
    for (let i = 0; i < 40; i++) {
      sim.advance(16)
      seen.add(value())
    }
    expect(seen.size).toBe(6)
    sim.setState(byLabel('Hold to roll'), { pressed: false })
    sim.settle()
    const stopped = value()
    sim.advance(2000)
    expect(value()).toBe(stopped)
  })
})
