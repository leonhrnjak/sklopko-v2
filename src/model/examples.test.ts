import { describe, expect, it } from 'vitest'
import { Simulator } from '../engine/simulator'
import { boundsRect } from './circuit'
import { CONTROL, EXAMPLES, FIBONACCI, SMILEY } from './examples'

/** Routing the big examples takes close to a second, so build each one once for all tests. */
const built = new Map<string, ReturnType<(typeof EXAMPLES)[number]['build']>>()
function example(id: string) {
  let c = built.get(id)
  if (!c) built.set(id, (c = EXAMPLES.find((e) => e.id === id)!.build()))
  return c
}

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

describe('4-bit computer example', () => {
  const setup = () => {
    const c = example('computer')
    const sim = new Simulator()
    sim.load({ comps: Object.values(c.comps), wires: Object.values(c.wires) })
    sim.settle()
    const byLabel = (label: string) => Object.values(c.comps).find((k) => k.label === label)!.id
    const reg = (id: string, pins = ['QA', 'QB', 'QC', 'QD']) => pins.reduce((n, p, i) => n | (sim.pinValue(id, p) << i), 0)
    const [pc, acc, flags, outPort] = [byLabel('PC'), byLabel('ACC'), byLabel('Flags'), byLabel('Output port')]
    const ram = byLabel('Data RAM')
    /** One full clock cycle: rising edge, then falling edge. */
    const cycle = () => {
      sim.stepClock()
      sim.stepClock()
    }
    return { sim, c, cycle, pc: () => reg(pc, ['Q0', 'Q1', 'Q2', 'Q3']), acc: () => reg(acc), out: () => reg(outPort), carry: () => sim.pinValue(flags, 'QA'), halted: () => sim.pinValue(byLabel('Halted'), 'A'), ram: () => sim.state(ram).mem as number[], byLabel }
  }

  it('encodes the Fibonacci program as ROM words', () => {
    expect(FIBONACCI).toBe('00 20 2F 01 21 11 2F 40 22 11 20 12 21 65 70')
    expect(CONTROL.split(' ')).toHaveLength(8)
    expect(CONTROL).toBe('01 05 08 20 13 13 40 80')
  })

  it('runs Fibonacci, writing each sum to RAM, and halts on the carry', () => {
    const { cycle, pc, acc, out, carry, halted, ram } = setup()
    const sums: number[] = []
    const shown: number[] = [] // what the Output display reads after each STA 15
    let cycles = 0
    while (!halted() && cycles++ < 200) {
      const at = pc()
      cycle()
      if (at === 7) sums.push(acc()) // the ADD instruction has just run
      if (at === 2 || at === 6) shown.push(out())
    }
    expect(halted()).toBe(1)
    expect(sums).toEqual([1, 2, 3, 5, 8, 13, 5]) // 21 does not fit in 4 bits: 21 mod 16 = 5, with carry
    expect(shown).toEqual([0, 1, 1, 2, 3, 5, 8, 13]) // 0 1 1 2 3 5 8 D on the display, never an intermediate value
    expect(carry()).toBe(1)
    expect(pc()).toBe(14)
    expect(ram().slice(0, 3)).toEqual([13, 5, 5])
    expect(cycles).toBe(5 + 7 * 9) // set-up, then seven loops of nine instructions, then it sits on HALT
    // Halted: more clock cycles change nothing.
    for (let i = 0; i < 5; i++) cycle()
    expect(pc()).toBe(14)
    expect(out()).toBe(13)
    expect(ram().slice(0, 3)).toEqual([13, 5, 5])
  })

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

  it('every instruction does what its opcode says (tiny programs)', () => {
    // Build a machine with a custom program by editing the ROM contents.
    const run = (words: string, cycles: number) => {
      const c = example('computer')
      const comps = Object.values(c.comps).map((k) => (k.label === 'Program' ? { ...k, params: { ...k.params, data: words } } : k))
      const sim = new Simulator()
      sim.load({ comps, wires: Object.values(c.wires) })
      sim.settle()
      for (let i = 0; i < cycles * 2; i++) sim.stepClock()
      const id = (label: string) => Object.values(c.comps).find((k) => k.label === label)!.id
      const reg = (label: string, pins = ['QA', 'QB', 'QC', 'QD']) => pins.reduce((n, p, i) => n | (sim.pinValue(id(label), p) << i), 0)
      return { out: reg('Output port'), acc: reg('ACC'), pc: reg('PC', ['Q0', 'Q1', 'Q2', 'Q3']), carry: sim.pinValue(id('Flags'), 'QA'), zero: sim.pinValue(id('Flags'), 'QB'), ram: sim.state(id('Data RAM')).mem as number[] }
    }
    expect(run('09', 1).acc).toBe(9) // LDI 9
    expect(run('09 25 00 15', 4)).toMatchObject({ acc: 9 }) // LDI 9, STA [5], LDI 0, LDA [5]
    expect(run('09 25 00 15', 4).ram[5]).toBe(9)
    expect(run('0A 20 03 40', 4)).toMatchObject({ acc: 13, carry: 0, zero: 0 }) // 3 + RAM[0] (10)
    expect(run('0F 20 01 40', 4)).toMatchObject({ acc: 0, carry: 1, zero: 1 }) // 1 + 15 overflows to 0
    expect(run('05 20 03 50', 4)).toMatchObject({ acc: 14, carry: 1 }) // 3 - 5 = -2 -> 14, with borrow
    expect(run('35', 1).pc).toBe(5) // JMP 5
    expect(run('01 20 40 66', 4).pc).toBe(6) // 1 + 1: no carry, so JNC 6 jumps
    expect(run('0F 20 40 66', 4).pc).toBe(4) // 15 + 15 carries, so JNC falls through
    expect(run('70', 5).pc).toBe(0) // HALT stays where it is
    expect(run('0A 2F', 2).out).toBe(10) // LDI 10, STA 15: address 15 is the output port
    expect(run('0A 2E', 2).out).toBe(0) // any other address leaves it alone
    expect(run('0A 2F 03 1F', 4)).toMatchObject({ out: 10, acc: 10 }) // LDA 15 reads the RAM, not the port
  })
})
