import { describe, expect, it } from 'vitest'
import { Simulator } from '../engine/simulator'
import { boundsRect } from './circuit'
import { EXAMPLES, SMILEY } from './examples'

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
    const { c, sim, byLabel, ofType } = load('intersection')
    // Each light's lamps listed red, yellow, green. Around the crossing every light is the same light turned 90°:
    // N reads left to right, E top to bottom, S right to left, W bottom to top.
    const cx = 1060
    const cy = 300
    // Crosswalk poles: title lamp (red, don't walk), then Walk (green) 50px below, then the Push button.
    const pole = (name: string) => {
      const stop = c.comps[byLabel(`${name} crossing`)]
      const walk = Object.values(c.comps).find((k) => k.type === 'led' && k.x === stop.x && k.y === stop.y + 50)!
      // The pole's button is the one closest below its lamps.
      const push = Object.values(c.comps)
        .filter((k) => k.type === 'button' && k.y > stop.y)
        .sort((a, b) => Math.hypot(a.x - stop.x, a.y - stop.y) - Math.hypot(b.x - stop.x, b.y - stop.y))[0]
      return { stop: stop.id, walk: walk.id, push: push.id }
    }
    const westX = pole('West')
    const northX = pole('North')
    const walkLeds = [westX.walk, westX.stop, northX.walk, northX.stop]
    const leds = ofType('led').filter((k) => !walkLeds.includes(k.id))
    const centre = (k: (typeof leds)[number]) => {
      const r = boundsRect(k)
      return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
    }
    const pick = (keep: (p: { x: number; y: number }) => boolean, order: (p: { x: number; y: number }) => number) =>
      leds.filter((k) => keep(centre(k))).sort((a, b) => order(centre(a)) - order(centre(b)))
    const north = pick((p) => p.y < cy - 60, (p) => p.x)
    const east = pick((p) => p.x > cx + 60, (p) => p.y)
    const south = pick((p) => p.y > cy + 60, (p) => -p.x)
    const west = pick((p) => p.x < cx - 60, (p) => -p.y)
    const colors = (light: typeof leds) => light.map((k) => k.params.color).join(',')
    for (const light of [north, east, south, west]) expect(colors(light)).toBe('red,yellow,green')

    const read = (light: typeof leds) => light.map((k) => sim.pinValue(k.id, 'A')).join('')
    // NS lamps + EW lamps + west walk/stop + north walk/stop; opposite lights must always agree.
    const lamps = () => {
      expect(read(south)).toBe(read(north))
      expect(read(east)).toBe(read(west))
      return read(north) + read(west) + walkLeds.map((id) => sim.pinValue(id, 'A')).join('')
    }
    const press = (id: string) => {
      sim.setState(id, { pressed: true })
      sim.settle()
      sim.setState(id, { pressed: false })
      sim.settle()
    }
    const step = () => sim.advance(1000) // 1 Hz clock: one count per second
    sim.advance(500) // first rising edge -> count 1
    const seen: string[] = []
    for (let n = 1; n < 17; n++) {
      seen.push(lamps().slice(0, 6))
      step()
    }
    //                NS: r y g  EW: r y g
    const allRed = '100100'
    const nsReady = '110100' // red + yellow
    const nsGreen = '001100'
    const nsYellow = '010100'
    const ewReady = '100110'
    const ewGreen = '100001'
    const ewYellow = '100010'
    expect(seen).toEqual([
      nsReady, // 1
      ...Array(4).fill(nsGreen), // 2-5
      nsYellow, // 6
      nsYellow, // 7
      allRed, // 8: clearance
      ewReady, // 9
      ...Array(4).fill(ewGreen), // 10-13
      ewYellow, // 14
      ewYellow, // 15
      allRed, // 0: clearance
    ])

    // West crossing: press during E–W green; WALK waits for the next N–S green and ends at N–S yellow.
    // The loop above ended on count 1.
    const west2 = () => lamps().slice(6, 8)
    const north2 = () => lamps().slice(8, 10)
    for (let i = 0; i < 9; i++) step() // count 10 (E–W green)
    expect(west2()).toBe('01')
    press(westX.push)
    expect(west2()).toBe('01')
    for (let i = 0; i < 6; i++) step() // count 0: all red, still waiting
    expect(west2()).toBe('01')
    step() // count 1: N–S red + yellow, still waiting (and the request survives it)
    expect(west2()).toBe('01')
    step() // count 2: N–S green, WALK
    expect(west2()).toBe('10')
    expect(north2()).toBe('01') // the other crossing is unaffected
    for (let i = 0; i < 4; i++) step() // count 6: yellow, request cleared
    expect(west2()).toBe('01')

    // North crossing: press during N–S yellow; WALK during the E–W green (counts 10-13), not before.
    press(northX.push)
    step() // count 7
    step() // count 8: all red
    step() // count 9: E–W red + yellow
    expect(north2()).toBe('01')
    step() // count 10: E–W green
    expect(north2()).toBe('10')
    expect(west2()).toBe('01')
    for (let i = 0; i < 4; i++) step() // count 14: E–W yellow, request cleared
    expect(north2()).toBe('01')
    for (let i = 0; i < 12; i++) step() // count 10 again, no new press
    expect(north2()).toBe('01')
    expect(west2()).toBe('01')
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

describe('dot matrix example', () => {
  const setup = () => {
    const c = EXAMPLES.find((e) => e.id === 'matrix')!.build()
    const sim = new Simulator()
    sim.load({ comps: Object.values(c.comps), wires: Object.values(c.wires) })
    sim.settle()
    const id = (type: string) => Object.values(c.comps).find((k) => k.type === type)!.id
    /** Run like the app does: in animation-frame sized steps (an advance handles at most 64 clock edges). */
    const run = (ms: number) => {
      for (let left = ms; left > 0; left -= 16) sim.frame(Math.min(16, left))
    }
    return { sim, matrix: id('matrix'), run }
  }

  it('shows one image row at a time: the lit row and its columns follow the counter', () => {
    const { sim, matrix } = setup()
    const rows = new Set<number>()
    for (let step = 0; step < 24; step++) {
      sim.stepClock() // one clock edge (rising or falling)
      const r = Array.from({ length: 8 }, (_, i) => sim.pinValue(matrix, `R${i}`))
      const lit = r.flatMap((v, i) => (v === 1 ? [i] : []))
      expect(lit.length).toBe(1)
      rows.add(lit[0])
      const cols = Array.from({ length: 8 }, (_, i) => sim.pinValue(matrix, `C${i}`))
      expect(cols.reduce<number>((n, v, i) => n | (v << i), 0)).toBe(parseInt(SMILEY[lit[0]], 16))
    }
    expect(rows.size).toBe(8)
  })

  it('draws the whole smiley after a few scans thanks to persistence', () => {
    const { sim, matrix, run } = setup()
    run(400)
    const lit = sim.state(matrix).lit as Float64Array
    // Every pixel that is part of the image was lit within the last scan (8 rows × 7.8 ms), the others never.
    SMILEY.forEach((word, r) => {
      for (let c = 0; c < 8; c++) {
        const on = (parseInt(word, 16) >> c) & 1
        const age = sim.time - lit[r * 8 + c]
        if (on) expect(age, `pixel ${r},${c}`).toBeLessThan(70)
        else expect(lit[r * 8 + c], `pixel ${r},${c}`).toBe(-Infinity)
      }
    })
  })

  it('forgets what was lit when the simulation is reset', () => {
    const { sim, matrix, run } = setup()
    run(400)
    sim.reset()
    expect(sim.time).toBe(0)
    expect((sim.state(matrix).lit as Float64Array).every((t) => t === -Infinity)).toBe(true)
  })
})
