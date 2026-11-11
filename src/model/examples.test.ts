import { describe, expect, it } from 'vitest'
import { Simulator } from '../engine/simulator'
import { boundsRect, isAnnotation, isFrame } from './circuit'
import { flatten } from './buses'
import { buildRows } from '../app/waveform'
import { SKASM, assemble, disassemble } from '../engine/isa'
import { FIBONACCI_SOURCE, programWords } from './computer2'
import { counterDisplay } from './example-counter'
import { EXAMPLES, SMILEY } from './examples'
import { EXAMPLE_GROUPS, EXAMPLE_LIST, WELCOME_ID, exampleFromPath } from './examples-index'
import { BLURBS, searchExamples } from './examples-blurbs'

/** Routing the big examples takes close to a second, so build each one once for all tests. */
const built = new Map<string, ReturnType<(typeof EXAMPLES)[number]['build']>>()
function example(id: string) {
  let c = built.get(id)
  if (!c) built.set(id, (c = EXAMPLES.find((e) => e.id === id)!.build()))
  return c
}

describe('all examples', () => {
  it('have no parts on top of each other', () => {
    for (const e of EXAMPLES) {
      // Notes and frames are meant to sit over other parts.
      const rects = Object.values(example(e.id).comps).filter((k) => !isAnnotation(k)).map((k) => ({ k, r: boundsRect(k) }))
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++) {
          const [a, b] = [rects[i].r, rects[j].r]
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
          expect(overlap, `${e.id}: ${rects[i].k.label ?? rects[i].k.type} / ${rects[j].k.label ?? rects[j].k.type}`).toBe(false)
        }
    }
  }, 60000)
})

describe('notes and frames in the examples', () => {
  it('frames in an example do not overlap each other, and every frame holds something', () => {
    for (const e of EXAMPLES) {
      const comps = Object.values(example(e.id).comps)
      const frames = comps.filter(isFrame)
      for (let i = 0; i < frames.length; i++) {
        const a = boundsRect(frames[i])
        expect(
          comps.some((k) => k !== frames[i] && !isAnnotation(k) && boundsRect(k).x >= a.x && boundsRect(k).y >= a.y && boundsRect(k).x + boundsRect(k).w <= a.x + a.w && boundsRect(k).y + boundsRect(k).h <= a.y + a.h),
          `${e.id}: ${frames[i].params.title} is empty`,
        ).toBe(true)
        for (let j = i + 1; j < frames.length; j++) {
          const b = boundsRect(frames[j])
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
          // (A frame may hold another whole: a frame round a group of frames.)
          const holds = (o: typeof a, p: typeof a) => p.x >= o.x && p.y >= o.y && p.x + p.w <= o.x + o.w && p.y + p.h <= o.y + o.h
          expect(overlap && !holds(a, b) && !holds(b, a), `${e.id}: "${frames[i].params.title}" overlaps "${frames[j].params.title}"`).toBe(false)
        }
      }
    }
  }, 60000)

  // Every example explains itself: what it shows and one thing to try. Add an id here only with a reason.
  const WITHOUT_NOTE: string[] = []

  it('every example has a note, except those listed here', () => {
    for (const e of EXAMPLES) {
      const hasNote = Object.values(example(e.id).comps).some((k) => k.type === 'note')
      expect(hasNote || WITHOUT_NOTE.includes(e.id), `${e.id} has no note`).toBe(true)
    }
    for (const id of WITHOUT_NOTE) expect(Object.values(example(id).comps).some((k) => k.type === 'note'), `${id} now has a note: remove it from the list`).toBe(false)
  }, 120000)
})

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

describe('calculator example', () => {
  const setup = () => {
    const c = example('calculator')
    const sim = new Simulator()
    sim.load({ comps: Object.values(c.comps), wires: Object.values(c.wires) })
    sim.settle()
    const byLabel = (label: string) => Object.values(c.comps).find((k) => k.label === label)!.id
    const byType = (type: string) => Object.values(c.comps).filter((k) => k.type === type)
    const set = (label: string, value: number) => {
      sim.setParams(byLabel(label), { ...c.comps[byLabel(label)].params, value })
      sim.settle()
    }
    /** Hex displays are fed by the part wired to their inputs; read the number their pins hold. */
    const shown = (label: string) => {
      const id = byLabel(label)
      return ['A', 'B', 'C', 'D'].reduce((n, p, i) => n | (sim.pinValue(id, p) << i), 0)
    }
    /** The unlabelled display that sits to the right of a labelled one (units digit). */
    const right = (label: string) => {
      const l = c.comps[byLabel(label)]
      const id = byType('hexdisp').find((k) => k.x === l.x + 80 && k.y === l.y)!.id
      return ['A', 'B', 'C', 'D'].reduce((n, p, i) => n | (sim.pinValue(id, p) << i), 0)
    }
    const led = (label: string) => sim.pinValue(byLabel(label), 'A')
    return { sim, c, set, shown, right, led, byLabel }
  }

  it('ALU row: every operation, with carry and zero flags', () => {
    const { set, shown, led } = setup()
    const ops: [number, number, number, number, number][] = [
      // a, b, op, result, carry
      [7, 6, 0, 13, 0],
      [9, 9, 0, 2, 1],
      [3, 5, 1, 14, 1],
      [12, 10, 2, 8, 0],
      [12, 10, 3, 14, 0],
      [12, 10, 4, 6, 0],
      [5, 0, 5, 10, 0],
      [15, 0, 6, 0, 1],
      [0, 0, 7, 15, 1],
    ]
    for (const [a, b, op, f, co] of ops) {
      set('A', a)
      set('B', b)
      set('Operation 0–7', op)
      expect(shown('Result'), `${a} op${op} ${b}`).toBe(f)
      expect(led('Carry / borrow'), `carry ${a} op${op} ${b}`).toBe(co)
      expect(led('Zero')).toBe(f === 0 ? 1 : 0)
    }
  })

  it('shows the result in decimal and stores it in the memory register', () => {
    const { sim, set, shown, right, byLabel } = setup()
    set('A', 7)
    set('B', 6) // 13
    expect(shown('Decimal')).toBe(1)
    expect(right('Decimal')).toBe(3)
    expect(shown('M')).toBe(0)
    // Pressing the store button is a rising edge on the register's clock.
    const store = byLabel('Store')
    sim.setState(store, { pressed: true })
    sim.settle()
    sim.setState(store, { pressed: false })
    sim.settle()
    expect(shown('M')).toBe(13)
    set('A', 1)
    expect(shown('M')).toBe(13) // memory keeps its value
  })

  it('multiplier, ROM squares, decimal adder and comparator agree with the arithmetic', () => {
    const { set, shown, right, led } = setup()
    for (let a = 0; a < 16; a++)
      for (const b of [0, 1, 6, 9, 15]) {
        set('A', a)
        set('B', b)
        expect(shown('A × B') * 16 + right('A × B'), `${a}×${b}`).toBe(a * b)
        expect(shown('A² from ROM') * 16 + right('A² from ROM'), `${a}²`).toBe(a * a)
        if (a < 10 && b < 10) {
          expect(shown('A + B (digits 0–9)') * 10 + right('A + B (digits 0–9)'), `${a}+${b}`).toBe(a + b)
        }
        expect(led('A > B')).toBe(a > b ? 1 : 0)
        expect(led('A = B')).toBe(a === b ? 1 : 0)
        expect(led('A < B')).toBe(a < b ? 1 : 0)
      }
  })
})

describe('net labels example', () => {
  it('shows the counter far away on the display and the LEDs, with no wire in between', () => {
    const c = example('labels')
    const sim = new Simulator()
    sim.load({ comps: Object.values(c.comps), wires: Object.values(c.wires) })
    sim.settle()
    const byLabel = (label: string) => Object.values(c.comps).find((k) => k.label === label)!.id
    const [counter, disp] = [byLabel('Counter'), byLabel('Hex display')]
    const value = (id: string, pins: string[]) => pins.reduce((n, p, i) => n | (sim.pinValue(id, p) << i), 0)
    const leds = [0, 1, 2, 3].map((i) => byLabel(`Bit ${i}`))
    // No wire joins the counter to anything but its clock's label flags.
    const wiredToCounter = Object.values(c.wires).filter((w) => w.from.comp === counter).map((w) => c.comps[w.to.comp].type)
    expect(new Set(wiredToCounter)).toEqual(new Set(['netsend']))
    for (let n = 1; n <= 20; n++) {
      sim.stepClock()
      sim.stepClock()
      const count = value(counter, ['A', 'B', 'C', 'D'])
      expect(count).toBe(n % 16)
      expect(value(disp, ['A', 'B', 'C', 'D'])).toBe(count)
      expect(leds.map((l) => sim.pinValue(l, 'A'))).toEqual([0, 1, 2, 3].map((i) => (count >> i) & 1))
    }
  })
})

describe('8-bit computer example', () => {
  const nibble = ['QA', 'QB', 'QC', 'QD']
  const setup = () => {
    const c = example('computer')
    const sim = new Simulator()
    sim.load(flatten(c))
    sim.settle()
    const byLabel = (label: string) => Object.values(c.comps).find((k) => k.label === label)!.id
    const reg = (id: string, pins = nibble) => pins.reduce((n, p, i) => n | (sim.pinValue(id, p) << i), 0)
    /** An 8-bit register. */
    const byte = (name: string) => reg(byLabel(name), [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `Q${i}`))
    const flags = byLabel('Flags')
    /** The three decimal digits of the output display, as a number. */
    const decimal = () => ['Hundreds', 'Tens', 'Ones'].reduce((n, label) => n * 10 + reg(byLabel(label), ['S0', 'S1', 'S2', 'S3']), 0)
    const mem = (label: string) => Array.from(sim.state(byLabel(label)).mem as ArrayLike<number>)
    /** One full clock cycle: rising edge, then falling edge. */
    const cycle = () => {
      sim.stepClock()
      sim.stepClock()
    }
    return {
      sim,
      cycle,
      pc: () => byte('PC'),
      acc: () => byte('ACC'),
      out: () => byte('Output'),
      decimal,
      carry: () => sim.pinValue(flags, 'Q0'),
      halted: () => sim.pinValue(byLabel('Halted'), 'A'),
      ram: () => mem('Data RAM'),
    }
  }

  it('the Program ROM holds the assembly source and the words assembled from it', () => {
    const c = example('computer')
    const prog = Object.values(c.comps).find((k) => k.label === 'Program')!
    expect(prog.params).toMatchObject({ abits: 8, dbits: 16, isa: 'skasm', source: FIBONACCI_SOURCE, data: programWords(FIBONACCI_SOURCE) })
    const result = assemble(SKASM, FIBONACCI_SOURCE, 256)
    expect(result.errors).toEqual([])
    expect(result.symbols).toEqual({ loop: 5 })
    // The comments in the source name each instruction; the listing reads back the same program.
    expect(result.words.slice(0, 15).map((w) => disassemble(SKASM, w))).toEqual([
      'LDI 0', 'STA 0', 'OUT NUMBER', 'LDI 1', 'STA 1', 'LDA 1', 'OUT NUMBER', 'ADD 0', 'STA 2', 'LDA 1', 'STA 0', 'LDA 2', 'STA 1', 'JNC 5', 'HALT',
    ])
  })

  it('has only the decimal display attached', () => {
    const types = new Set(Object.values(example('computer').comps).map((k) => k.type))
    for (const absent of ['console', 'framebuffer', 'speaker', 'keypad']) expect(types.has(absent), absent).toBe(false)
    expect(types.has('bcdadd')).toBe(true)
  })

  it('runs Fibonacci up to 233, the last number that fits in 8 bits, and halts on the carry', () => {
    const { cycle, pc, acc, out, decimal, carry, halted, ram } = setup()
    const sums: number[] = []
    const shown: number[] = [] // what the Output register holds after each OUT NUMBER
    const digits: number[] = [] // what the three decimal digits read at the same moments
    let cycles = 0
    while (!halted() && cycles++ < 400) {
      const at = pc()
      cycle()
      if (at === 7) sums.push(acc()) // the ADD instruction has just run
      if (at === 2 || at === 6) {
        shown.push(out())
        digits.push(decimal())
      }
    }
    expect(halted()).toBe(1)
    expect(shown).toEqual([0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233]) // never an intermediate value
    expect(digits).toEqual(shown) // the decimal display agrees with the binary value
    expect(sums).toEqual([1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 121]) // 377 does not fit: 377 mod 256 = 121
    expect(carry()).toBe(1)
    expect(pc()).toBe(14)
    expect(ram().slice(0, 3)).toEqual([233, 121, 121])
    expect(cycles).toBe(5 + 13 * 9) // set-up, then thirteen loops of nine instructions, then it sits on HALT
    // Halted: more clock cycles change nothing.
    for (let i = 0; i < 5; i++) cycle()
    expect(pc()).toBe(14)
    expect(out()).toBe(233)
    expect(decimal()).toBe(233)
    expect(ram().slice(0, 3)).toEqual([233, 121, 121])
  }, 30000)

  it('shows the program counter and the accumulator as numbers in the waveform panel', () => {
    const rows = buildRows(example('computer').comps)
    // Each is one probe: PC and ACC are bus probes that record the number.
    expect(rows.map((r) => [r.name, !!r.bus, r.width])).toEqual([
      ['CLK', false, 1],
      ['PC', true, 8],
      ['ACC', true, 8],
      ['Carry', false, 1],
    ])
    for (const r of rows) expect(r.probes).toHaveLength(1)
  })

  it('a breakpoint pauses it when the program reaches HALT, with the last number on show', () => {
    const { sim, pc, halted, out } = setup()
    let hit: string | null = null
    for (let i = 0; i < 40 && !hit; i++) {
      sim.advance(8000)
      hit = sim.takeBreak()
    }
    const c = example('computer')
    expect(c.comps[hit!].label).toBe('Pause at HALT')
    expect(halted()).toBe(1)
    expect(pc()).toBe(14)
    expect(out()).toBe(233)
    // Running on (as pressing Run does) is allowed: it stays halted and does not stop again.
    sim.advance(2000)
    expect(sim.takeBreak()).toBeNull()
    expect(pc()).toBe(14)
  }, 30000)

  it('the toolbar reset power-cycles it: the program starts again from the top', () => {
    const { sim, cycle, pc, ram } = setup()
    for (let i = 0; i < 9; i++) cycle()
    expect(pc()).toBe(9)
    sim.reset()
    sim.settle()
    expect(pc()).toBe(0)
    expect(ram().slice(0, 3)).toEqual([0, 0, 0])
    cycle()
    expect(pc()).toBe(1)
  })
})

describe('shared data bus example', () => {
  it('one enabled source drives the bus, two make it unknown, and Load copies the bus into the register', () => {
    const c = EXAMPLES.find((e) => e.id === 'databus')!.build()
    const id = (label: string) => Object.values(c.comps).find((k) => k.label === label)!.id
    const sim = new Simulator()
    sim.load(flatten(c))
    sim.settle()
    const bus = () => {
      const bits = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => sim.pinValue(id('Data bus'), `Y${i}`))
      return bits.some((v) => v > 1) ? null : bits.reduce((n: number, v, i) => n | (v << i), 0)
    }
    const enable = (label: string, on: boolean) => {
      sim.setParams(id(label), { ...c.comps[id(label)].params, on })
      sim.settle()
    }
    const stored = () => [0, 1, 2, 3, 4, 5, 6, 7].reduce((n: number, i) => n | (sim.pinValue(id("Register"), `Q${i}`) << i), 0)
    expect(bus()).toBe(0x5a) // Input A is enabled at the start
    enable('Enable Input B', true)
    expect(bus()).toBeNull() // contention: 5A and 27 disagree
    enable('Enable Input A', false)
    expect(bus()).toBe(0x27)
    enable('Load', true)
    sim.stepClock()
    sim.stepClock()
    expect(stored()).toBe(0x27)
    enable('Load', false)
    enable('Enable Input B', false)
    enable('Enable Register', true)
    expect(bus()).toBe(0x27) // the register drives the bus with what it holds
  })
})

describe('the examples index', () => {
  it('lists the same examples, in the same order, as the builders', () => {
    expect(EXAMPLES.map(({ build: _build, ...info }) => info)).toEqual(EXAMPLE_LIST)
  })

  it('has a builder for every entry and no duplicate id', () => {
    const ids = EXAMPLE_LIST.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const e of EXAMPLES) expect(typeof e.build).toBe('function')
  })

  it('opens with the counter, which the main chunk can build without the other examples', () => {
    expect(WELCOME_ID).toBe('counter')
    expect(counterDisplay()).toEqual(EXAMPLES[0].build())
  })

  it('keeps each group together, in the order of the menu, and puts the groups the plan names where they belong', () => {
    const order = EXAMPLE_LIST.map((e) => EXAMPLE_GROUPS.indexOf(e.group))
    expect(order).toEqual([...order].sort((x, y) => x - y))
    const ids = (g: string) => EXAMPLE_LIST.filter((e) => e.group === g).map((e) => e.id)
    expect(ids('Start here')).toEqual(['counter', 'gates', 'shift-register'])
    expect(ids('Computers')[0]).toBe('beginner')
    expect(ids('6502')).toEqual(expect.arrayContaining(['6502-echo', '6502-echo-irq']))
    expect(ids('6502').slice(-2)).toEqual(['6502-video', '6502-gameboard'])
    expect(ids('Doom-like')).toEqual(['6502-doomlike'])
  })

  it('names, for a large example, a frame that it has to open at', () => {
    const withFit = EXAMPLE_LIST.filter((e) => e.fit)
    expect(withFit.length).toBeGreaterThan(30)
    for (const e of withFit) {
      const frames = Object.values(example(e.id).comps).filter(isFrame)
      expect(frames.some((f) => String(f.params.title).startsWith(e.fit!)), `${e.id}: no frame starts with "${e.fit}"`).toBe(true)
    }
    // Every computer and 6502 board has one; the small examples open whole.
    for (const e of EXAMPLE_LIST.filter((x) => x.group === 'Computers' || x.group === '6502' || x.group === 'Doom-like')) expect(e.fit, e.id).toBeTruthy()
    expect(EXAMPLE_LIST.find((e) => e.id === 'gates')!.fit).toBeUndefined()
  }, 120000)

  it('finds an example from its short link', () => {
    expect(exampleFromPath('/Intersection/')?.id).toBe('intersection')
    expect(exampleFromPath('/')).toBeUndefined()
    expect(exampleFromPath('/nope')).toBeUndefined()
  })

  it('has a one-line blurb for every example, and examples in every group', () => {
    expect(Object.keys(BLURBS).sort()).toEqual(EXAMPLE_LIST.map((e) => e.id).sort())
    for (const e of EXAMPLE_LIST) {
      expect(BLURBS[e.id], e.id).toMatch(/^[A-Z].*[.!?]$/)
      expect(BLURBS[e.id].length, e.id).toBeLessThanOrEqual(130)
    }
    for (const g of EXAMPLE_GROUPS) expect(EXAMPLE_LIST.some((e) => e.group === g), g).toBe(true)
  })

  it('searches names, blurbs and groups, every word having to match', () => {
    expect(searchExamples('')).toEqual(EXAMPLE_LIST)
    expect(searchExamples('  ')).toEqual(EXAMPLE_LIST)
    expect(searchExamples('UART').map((e) => e.id)).toContain('uart')
    expect(searchExamples('latch').map((e) => e.id)).toEqual(expect.arrayContaining(['sr-latch', 'd-latch']))
    expect(searchExamples('computers gamepad').map((e) => e.id)).toEqual(expect.arrayContaining(['computer-pong', 'computer-snake']))
    expect(searchExamples('latch gamepad')).toEqual([])
    expect(searchExamples('zzzz')).toEqual([])
  })
})
