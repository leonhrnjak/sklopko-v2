import { describe, expect, it } from 'vitest'
import { Simulator } from '../engine/simulator'
import { simComps } from './circuit'
import { EXAMPLES } from './examples'
import { flatten } from './buses'
import { LIT, SEGMENTS } from './seg7-examples'
import { runTests } from './testbench'

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

describe('priority encoder example', () => {
  it('reports the highest request and lights the matching decoder output; none lights nothing', () => {
    const r = rig('encoder')
    const [bar] = r.ofType('bar')
    const lit = () => Array.from({ length: 8 }, (_, i) => r.sim.pinValue(bar, `I${i}`))
    expect(lit()).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(r.lit('Any request (V)')).toBe(0)
    r.set('Request 2', true)
    r.set('Request 5', true)
    expect(lit()).toEqual([0, 0, 0, 0, 0, 1, 0, 0])
    expect(r.lit('Any request (V)')).toBe(1)
    r.set('Request 5', false)
    expect(lit()).toEqual([0, 0, 1, 0, 0, 0, 0, 0])
  })
})

describe('bus arbitration example', () => {
  it('grants the lowest request only, and with Override on two devices make the bus unknown', () => {
    const r = rig('arbiter')
    const flat = flatten(r.c)
    const sim = new Simulator()
    sim.load(flat)
    sim.settle()
    const bus = () => {
      const bits = [0, 1, 2, 3].map((i) => sim.pinValue(r.part('Bus'), `Y${i}`))
      return bits.some((v) => v > 1) ? null : bits.reduce((n: number, v, i) => n | (v << i), 0)
    }
    const set = (label: string, on: boolean) => {
      sim.setParams(r.part(label), { ...r.c.comps[r.part(label)].params, on })
      sim.settle()
    }
    expect(bus()).toBeNull() // nobody drives it: floating
    set('Request 3', true)
    expect(bus()).toBe(0xc)
    set('Request 2', true)
    expect(bus()).toBe(0x6) // 2 beats 3
    set('Request 1', true)
    expect(bus()).toBe(0x3) // 1 beats both
    set('Override arbiter', true)
    expect(bus()).toBeNull() // everybody drives: contention
    set('Request 2', false)
    set('Request 3', false)
    expect(bus()).toBe(0x3)
  })
})

describe('ALU flags example', () => {
  const run = (a: number, bv: number, op: number) => {
    const r = rig('alu-flags')
    const setPart = (label: string, params: object) => {
      r.sim.setParams(r.part(label), { ...r.c.comps[r.part(label)].params, ...params })
      r.sim.settle()
    }
    setPart('A', { value: a })
    setPart('B', { value: bv })
    ;[2, 1, 0].forEach((k) => setPart(`S${k}`, { on: ((op >> k) & 1) === 1 }))
    const [alu] = r.ofType('alu')
    const f = [0, 1, 2, 3].reduce((n, i) => n | (r.sim.pinValue(alu, `F${i}`) << i), 0)
    return { f, z: r.lit('Zero (Z)'), c: r.lit('Carry (C)'), n: r.lit('Negative (N)') }
  }
  it('sets Zero, Carry and Negative', () => {
    expect(run(15, 1, 0)).toEqual({ f: 0, z: 1, c: 1, n: 0 })
    expect(run(5, 5, 1)).toMatchObject({ f: 0, z: 1 })
    expect(run(7, 1, 0)).toEqual({ f: 8, z: 0, c: 0, n: 1 })
  })
})

describe('PWM example', () => {
  it('the lamp is on for Duty ticks out of every 16', () => {
    for (const duty of [0, 1, 4, 9, 15]) {
      const r = rig('pwm')
      r.sim.setParams(r.part('Duty'), { ...r.c.comps[r.part('Duty')].params, value: duty })
      r.sim.settle()
      let on = 0
      for (let i = 0; i < 16; i++) {
        r.cycle()
        on += r.lit('Lamp')
      }
      expect(on, `duty ${duty}`).toBe(duty)
    }
  })
})

describe('button debouncer example', () => {
  it('the naive counter counts the bounce, the debounced one counts each press once', () => {
    const r = rig('debounce')
    const [naive, clean] = ['Naive counter', 'Counter'].map((l) => r.part(l))
    const count = (id: string) => ['A', 'B', 'C', 'D'].reduce((n, p, i) => n | (r.sim.pinValue(id, p) << i), 0)
    const wait = (ms: number) => {
      for (let t = 0; t < ms; t += 5) r.sim.frame(5)
    }
    wait(500)
    expect([count(naive), count(clean)]).toEqual([0, 0])
    r.set('Press', true)
    wait(1000)
    expect(count(clean)).toBe(1)
    expect(count(naive)).toBeGreaterThan(1)
    r.set('Press', false)
    wait(1000)
    const afterRelease = count(naive)
    expect(afterRelease).toBeGreaterThan(count(clean))
    expect(count(clean)).toBe(1) // releasing is not a press
    r.set('Press', true)
    wait(1000)
    expect(count(clean)).toBe(2)
  })
})

describe('stopwatch example', () => {
  const setup = () => {
    const r = rig('stopwatch')
    const read = (labels: string[]) =>
      labels.map((l) => ['A', 'B', 'C', 'D'].reduce((n, p, i) => n | (r.sim.pinValue(r.part(l), p) << i), 0)).join('')
    return {
      r,
      time: () => read(['Minutes', 'Tens of seconds', 'Seconds']),
      lap: () => read(['Lap Minutes', 'Lap Tens of seconds', 'Lap Seconds']),
      click: (label: string) => {
        r.press(label, true)
        r.press(label, false)
      },
    }
  }
  it('runs only between Start/Stop presses, resets, and Lap holds a split time', () => {
    const { r, time, lap, click } = setup()
    for (let i = 0; i < 5; i++) r.cycle()
    expect(time()).toBe('000') // not started
    click('Start/Stop')
    for (let i = 0; i < 25; i++) r.cycle()
    expect(time()).toBe('025')
    r.press('Lap', true)
    r.cycle()
    r.press('Lap', false)
    expect(lap()).toBe('025')
    for (let i = 0; i < 4; i++) r.cycle()
    expect(time()).toBe('030')
    expect(lap()).toBe('025') // held
    click('Start/Stop')
    for (let i = 0; i < 5; i++) r.cycle()
    expect(time()).toBe('030') // stopped
    click('Start/Stop')
    for (let j = 0; j < 60; j++) r.cycle()
    expect(time()).toBe('130') // a minute later
    click('Reset')
    expect(time()).toBe('000')
  })
})

describe('UART example', () => {
  const STEP = 4 // ms per frame; one baud period is 62.5 ms
  const setup = () => {
    const r = rig('uart')
    const wait = (ms: number) => {
      for (let t = 0; t < ms; t += STEP) r.sim.frame(STEP)
    }
    const setNum = (label: string, value: number) => {
      r.sim.setParams(r.part(label), { ...r.c.comps[r.part(label)].params, value })
      r.sim.settle()
    }
    const read = (label: string) => ['A', 'B', 'C', 'D'].reduce((n, p, i) => n | (r.sim.pinValue(r.part(label), p) << i), 0)
    const lineNow = () => r.sim.pinValue(r.part('Line'), 'Y')
    /** Send a byte; returns the line as seen once per frame step, and what the receiver holds afterwards. */
    const send = (byte: number) => {
      setNum('Data low', byte & 15)
      setNum('Data high', byte >> 4)
      const line: number[] = []
      r.set('Send', true)
      for (let t = 0; t < 1000; t += STEP) {
        r.sim.frame(STEP)
        if (t === 40) r.set('Send', false)
        line.push(lineNow())
      }
      return { line, got: read('Received high') * 16 + read('Received low') }
    }
    return { r, wait, send, lineNow, read }
  }

  it('puts start bit, 8 data bits (least significant first) and stop bit on the line', () => {
    for (const byte of [0xa5, 0x00, 0xff, 0x81, 0x3c]) {
      const { wait, send, lineNow } = setup()
      wait(300)
      expect(lineNow()).toBe(1) // idle is high
      const { line } = send(byte)
      const start = line.indexOf(0)
      expect(start).toBeGreaterThanOrEqual(0)
      const bit = (k: number) => line[start + Math.round(((k + 0.5) * 62.5) / STEP)]
      const frame = Array.from({ length: 10 }, (_, k) => bit(k))
      const want = [0, ...Array.from({ length: 8 }, (_, k) => (byte >> k) & 1), 1]
      expect(frame, byte.toString(16)).toEqual(want)
    }
  })

  it('the receiver gets the byte back, two bytes in a row, and nothing arrives without Send', () => {
    const { wait, send, read } = setup()
    wait(500)
    expect([read('Received low'), read('Received high')]).toEqual([0, 0])
    for (const byte of [0xa5, 0x3c, 0xff, 0x00, 0x81]) expect(send(byte).got, byte.toString(16)).toBe(byte)
  })
})

describe('half and full adder example', () => {
  it('the gate versions and the parts give the same sum and carry for every input, and add', () => {
    const r = rig('adders')
    const switches = Object.values(r.c.comps).filter((k) => k.type === 'switch')
    const sw = (side: (x: number) => boolean, label: string) => switches.find((k) => side(k.x) && k.label === label)!.id
    const flip = (id: string, on: boolean) => {
      r.sim.setParams(id, { ...r.c.comps[id].params, on })
      r.sim.settle()
    }
    const out = (...labels: string[]) => labels.map((l) => r.lit(l))
    const half = (x: number) => x < 300
    for (let v = 0; v < 4; v++) {
      flip(sw(half, 'A'), !!(v & 1))
      flip(sw(half, 'B'), !!(v & 2))
      const total = (v & 1) + (v >> 1)
      expect(out('Sum', 'Carry'), `half ${v}`).toEqual([total & 1, total >> 1])
      expect(out('Part sum', 'Part carry'), `half part ${v}`).toEqual([total & 1, total >> 1])
    }
    const full = (x: number) => x > 300
    for (let v = 0; v < 8; v++) {
      flip(sw(full, 'A'), !!(v & 1))
      flip(sw(full, 'B'), !!(v & 2))
      flip(sw(full, 'Carry in'), !!(v & 4))
      const total = (v & 1) + ((v >> 1) & 1) + (v >> 2)
      expect(out('Full sum', 'Carry out'), `full ${v}`).toEqual([total & 1, total >> 1])
      expect(out('Part full sum', 'Part carry out'), `full part ${v}`).toEqual([total & 1, total >> 1])
    }
  })
})

describe('seven-segment decoder example', () => {
  it('shows each digit 0 to 9 the same three ways, and the decoder and the part stay blank for 10 to 15', () => {
    const r = rig('seg7-table')
    const input = r.ofType('hexin')[0]
    const [fromTable, fromDecoder, part] = ['From the table', 'From the decoder', 'The part'].map((l) => r.part(l))
    const lit = (id: string) => [...SEGMENTS].map((s) => r.sim.pinValue(id, s))
    for (let digit = 0; digit < 16; digit++) {
      r.sim.setParams(input, { ...r.c.comps[input].params, value: digit })
      r.sim.settle()
      const want = [...SEGMENTS].map((s) => (LIT[s].includes(digit) ? 1 : 0))
      if (digit < 10) {
        expect(lit(fromTable), `table, digit ${digit}`).toEqual(want)
        expect(lit(fromDecoder), `decoder, digit ${digit}`).toEqual(want)
        expect(lit(part), `part, digit ${digit}`).toEqual(want)
      } else {
        expect(lit(fromDecoder), `decoder, code ${digit}`).toEqual(want)
        expect(lit(part), `part, code ${digit}`).toEqual(want)
      }
    }
  })
})

describe('subtraction example', () => {
  it('four bits: 3 - 5 is 1110 with the sign set, 3 + 5 overflows; the plain subtractor agrees and borrows', () => {
    const r = rig('subtract')
    const bits = () => ['S3', 'S2', 'S1', 'S0'].map((l) => r.lit(l)).join('')
    expect(bits()).toBe('1110')
    expect(r.lit('Negative (S3)')).toBe(1)
    expect([r.lit('Carry out'), r.lit('Overflow'), r.lit('Borrow (A < B)')]).toEqual([0, 0, 1])
    const [subtractor] = ['Subtractor'].map((l) => r.part(l))
    expect([0, 1, 2, 3].map((i) => r.sim.pinValue(subtractor, `D${i}`)).join('')).toBe('0111') // D0..D3 of 14
    r.set('Subtract', false) // 3 + 5 = 8: does not fit in four signed bits
    expect(bits()).toBe('1000')
    expect([r.lit('Carry out'), r.lit('Overflow')]).toEqual([0, 1])
  })

  it('eight bits on a bus: 5 - 9 is 252 with a borrow, and 5 + 9 is 14', () => {
    const c = EXAMPLES.find((e) => e.id === 'subtract')!.build()
    const sim = new Simulator()
    sim.load(flatten(c)) // the bus wires become one wire for each bit
    sim.settle()
    const ofType = (type: string) => Object.values(c.comps).filter((k) => k.type === type).map((k) => k.id)
    const [sub] = ofType('bussub')
    const [addsub] = ofType('busaddsub')
    const value = (id: string, pin: string) => [0, 1, 2, 3, 4, 5, 6, 7].reduce((n, i) => n | (sim.pinValue(id, `${pin}${i}`) << i), 0)
    expect(value(sub, 'D')).toBe(252)
    expect(sim.pinValue(sub, 'Bo')).toBe(1)
    expect(value(addsub, 'S')).toBe(252)
    const m = Object.values(c.comps).find((k) => k.type === 'switch' && k.label === 'Subtract' && k.x > 1000)!.id
    sim.setParams(m, { ...c.comps[m].params, on: false })
    sim.settle()
    expect(value(addsub, 'S')).toBe(14)
  })

  it('one bit: the half subtractor borrows when B is 1 and A is 0', () => {
    const r = rig('subtract')
    const [hs] = r.ofType('halfsub')
    expect([r.sim.pinValue(hs, 'D'), r.sim.pinValue(hs, 'Bo')]).toEqual([1, 0]) // A = 1, B = 0
    r.set('B', true)
    expect([r.sim.pinValue(hs, 'D'), r.sim.pinValue(hs, 'Bo')]).toEqual([0, 0])
    r.set('A', false)
    expect([r.sim.pinValue(hs, 'D'), r.sim.pinValue(hs, 'Bo')]).toEqual([1, 1])
  })
})

describe('synchronous counter example', () => {
  it('both counters count 0 to 15, but going from 7 to 8 only the ripple counter passes through 6, 4 and 0', () => {
    const r = rig('sync-counter')
    const nets = (prefix: string) => [0, 1, 2, 3].map((i) => r.sim.netOf(r.part(`${prefix} Q${i}`), 'A'))
    const [ripple, sync] = [nets('Ripple'), nets('Sync')]
    const probe = (prefix: string, i: number) => r.part(`${prefix} Q${i}`)
    const read = (prefix: string) => [0, 1, 2, 3].reduce((n, i) => n | ((r.sim.pinValue(probe(prefix, i), 'A') as number) << i), 0)
    const now = (ns: number[]) => read(ns === ripple ? 'Ripple' : 'Sync')
    for (let i = 0; i < 20; i++) {
      expect(now(ripple), `ripple after ${i} clocks`).toBe(i % 16)
      expect(now(sync), `sync after ${i} clocks`).toBe(i % 16)
      r.cycle()
    }
    // Run on to 7, then watch one clock edge tick by tick.
    while (now(ripple) !== 7) r.cycle()
    r.sim.setCapture(true)
    r.sim.stepClock()
    const frames = r.sim.getCapture()!.frames
    /** The numbers the counter shows, tick by tick, without repeats. */
    const path = (ns: number[]) =>
      frames
        .map((f) => ns.reduce((n, net, i) => n | (f[net] << i), 0))
        .filter((v, k, all) => k === 0 || v !== all[k - 1])
    expect(path(ripple)).toEqual([7, 6, 4, 0, 8])
    expect(path(sync)).toEqual([7, 8])
  })
})

describe('parity and Gray code example', () => {
  it('the checker flags one flipped bit, not two, for every data value', () => {
    const r = rig('parity-gray')
    const data = r.ofType('hexin')[0]
    const flip = (label: string, on: boolean) => r.set(label, on)
    for (let v = 0; v < 16; v++) {
      r.sim.setParams(data, { ...r.c.comps[data].params, value: v })
      for (const [f0, f1] of [[false, false], [true, false], [false, true], [true, true]]) {
        flip('Flip bit 0', f0)
        flip('Flip bit 1', f1)
        const ones = Number(f0) + Number(f1)
        expect(r.lit('Error'), `data ${v}, flips ${ones}`).toBe(ones === 1 ? 1 : 0)
      }
    }
  })

  it('the parity bit makes the count of ones even', () => {
    const r = rig('parity-gray')
    const data = r.ofType('hexin')[0]
    for (let v = 0; v < 16; v++) {
      r.sim.setParams(data, { ...r.c.comps[data].params, value: v })
      r.sim.settle()
      const ones = v.toString(2).split('1').length - 1
      expect(r.lit('Parity bit'), `data ${v}`).toBe(ones % 2)
    }
  })

  it('the Gray code changes one bit at each step, round to the start; the binary count sometimes changes four', () => {
    const r = rig('parity-gray')
    const read = (prefix: string) => [0, 1, 2, 3].reduce((n, i) => n | ((r.sim.pinValue(r.part(`${prefix} ${i}`), 'A') as number) << i), 0)
    const bits = (n: number) => n.toString(2).split('1').length - 1
    const changes = { binary: [] as number[], gray: [] as number[] }
    let [pb, pg] = [read('Binary'), read('Gray')]
    for (let i = 0; i < 16; i++) {
      r.cycle()
      const [nb, ng] = [read('Binary'), read('Gray')]
      changes.binary.push(bits(pb ^ nb))
      changes.gray.push(bits(pg ^ ng))
      ;[pb, pg] = [nb, ng]
    }
    expect(changes.gray).toEqual(Array(16).fill(1))
    expect(Math.max(...changes.binary)).toBe(4)
  })
})

describe('testbench example', () => {
  it('has a testbench saved in it, and every step of it passes', () => {
    const c = EXAMPLES.find((e) => e.id === 'testbench')!.build()
    expect(c.tests).toBeTruthy()
    const { run, errors } = runTests(c, c.tests!)
    expect(errors).toEqual([])
    expect(run!.outcomes.filter((o) => o.problem || o.failures.length)).toEqual([])
    expect(run!.passed).toBe(true)
    expect(run!.outcomes.length).toBeGreaterThanOrEqual(10)
  })

  it('a broken circuit fails the steps: with the lookup table emptied, the majority lines fail', () => {
    const c = EXAMPLES.find((e) => e.id === 'testbench')!.build()
    const lut = Object.values(c.comps).find((k) => k.type === 'lut')!
    lut.params = { ...lut.params, data: '0 0 0 0 0 0 0 0' }
    const { run } = runTests(c, c.tests!)
    expect(run!.passed).toBe(false)
    expect(run!.outcomes.some((o) => o.failures.some((f) => f.output === 'Lut'))).toBe(true)
  })

  it('the lookup table is the majority function, row for row, like the gates', () => {
    const r = rig('testbench')
    for (let v = 0; v < 8; v++) {
      r.set('P', !!(v & 1))
      r.set('Q', !!(v & 2))
      r.set('R', !!(v & 4))
      expect(r.lit('Lut'), `inputs ${v}`).toBe(r.lit('Gates'))
    }
  })
})
