import { describe, expect, it } from 'vitest'
import { getDef } from './registry'
import { Simulator, type SimCircuit } from './simulator'
import { X, paramDefaults, type Params, type V } from './types'

/** Tiny builder: wire('a.Q', 'b.A') connects output Q of a to input A of b. */
function build(comps: Record<string, string | [string, Params]>, wires: [string, string][]): SimCircuit {
  return {
    comps: Object.entries(comps).map(([id, t]) => {
      const [type, params] = typeof t === 'string' ? [t, {}] : t
      return { id, type, params: { ...paramDefaults(getDef(type)), ...params } }
    }),
    wires: wires.map(([f, t]) => {
      const [fc, fp] = f.split('.')
      const [tc, tp] = t.split('.')
      return { from: { comp: fc, pin: fp }, to: { comp: tc, pin: tp } }
    }),
  }
}

function sim(c: SimCircuit) {
  const s = new Simulator()
  s.load(c)
  s.settle()
  return s
}

const set = (s: Simulator, id: string, on: boolean) => {
  s.setParams(id, { on })
  s.settle()
}

const send = (name: string): [string, Params] => ['netsend', { name }]
const recv = (name: string): [string, Params] => ['netrecv', { name }]

describe('net labels', () => {
  it('a send/receive pair carries the signal like a wire, and shows it on both labels', () => {
    const s = sim(build({ sw: 'switch', tx: send('S'), rx: recv('S'), led: 'led' }, [['sw.Q', 'tx.A'], ['rx.Y', 'led.A']]))
    expect(s.pinValue('led', 'A')).toBe(0)
    expect(s.pinValue('rx', 'Y')).toBe(0)
    expect(s.pinValue('tx', 'A')).toBe(0)
    set(s, 'sw', true)
    expect(s.pinValue('led', 'A')).toBe(1)
    expect(s.pinValue('rx', 'Y')).toBe(1)
    expect(s.pinValue('tx', 'A')).toBe(1)
    expect(s.signature('rx')).toBe('1')
  })

  it('adds no delay: a clock sent through a label does not race the data it clocks', () => {
    // Shift register: f1 is clocked directly, f2 and f3 through a label. With even one gate delay in the label,
    // f2 would see f1's new value and the data would run through two stages on the first pulse.
    const s = sim(
      build({ d: 'switch', c: 'switch', tx: send('CK'), rx: recv('CK'), f1: 'dff', f2: 'dff', f3: 'dff' }, [
        ['d.Q', 'f1.D'],
        ['f1.Q', 'f2.D'],
        ['f2.Q', 'f3.D'],
        ['c.Q', 'f1.CLK'],
        ['c.Q', 'tx.A'],
        ['rx.Y', 'f2.CLK'],
        ['rx.Y', 'f3.CLK'],
      ]),
    )
    const pulse = () => {
      set(s, 'c', true)
      set(s, 'c', false)
    }
    const q = () => ['f1', 'f2', 'f3'].map((f) => s.pinValue(f, 'Q'))
    set(s, 'd', true)
    pulse()
    expect(q()).toEqual([1, 0, 0])
    set(s, 'd', false)
    pulse()
    expect(q()).toEqual([0, 1, 0])
    pulse()
    expect(q()).toEqual([0, 0, 1])
  })

  it('counts the same as a direct wire, tick for tick', () => {
    const direct = sim(build({ clk: ['clock', { hz: 4 }], n: ['counter', { mod: 16 }] }, [['clk.Q', 'n.CLK']]))
    const labelled = sim(
      build({ clk: ['clock', { hz: 4 }], tx: send('CLK'), rx: recv('CLK'), n: ['counter', { mod: 16 }] }, [
        ['clk.Q', 'tx.A'],
        ['rx.Y', 'n.CLK'],
      ]),
    )
    const read = (s: Simulator) => ['A', 'B', 'C', 'D'].map((p) => s.pinValue('n', p))
    for (let i = 0; i < 40; i++) {
      direct.stepClock()
      labelled.stepClock()
      expect(read(labelled)).toEqual(read(direct))
      expect(labelled.ticks).toBe(direct.ticks)
    }
  })

  it('one send feeds any number of receives, wherever they come in the circuit', () => {
    const s = sim(
      build({ r1: recv('F'), r2: recv('F'), sw: 'switch', tx: send('F'), r3: recv('F'), l1: 'led', l2: 'led', l3: 'led' }, [
        ['sw.Q', 'tx.A'],
        ['r1.Y', 'l1.A'],
        ['r2.Y', 'l2.A'],
        ['r3.Y', 'l3.A'],
      ]),
    )
    set(s, 'sw', true)
    expect(['l1', 'l2', 'l3'].map((l) => s.pinValue(l, 'A'))).toEqual([1, 1, 1])
  })

  it('names are exact: other names, empty names and a send nobody drives all read X', () => {
    const s = sim(
      build(
        { sw: 'switch', tx: send('A'), other: recv('B'), lower: recv('a'), blank: recv(''), undriven: send('U'), orphan: recv('U'), l: 'led', m: 'led', n: 'led', o: 'led' },
        [
          ['sw.Q', 'tx.A'],
          ['other.Y', 'l.A'],
          ['lower.Y', 'm.A'],
          ['blank.Y', 'n.A'],
          ['orphan.Y', 'o.A'],
        ],
      ),
    )
    for (const l of ['l', 'm', 'n', 'o']) expect(s.pinValue(l, 'A')).toBe(X)
    expect(s.pinValue('other', 'Y')).toBe(X)
  })

  it('an unnamed send does not publish', () => {
    const s = sim(build({ sw: 'switch', tx: send(''), rx: recv(''), led: 'led' }, [['sw.Q', 'tx.A'], ['rx.Y', 'led.A']]))
    expect(s.pinValue('led', 'A')).toBe(X)
  })

  it('with several sends of one name, the first driven one wins', () => {
    const c = build({ a: 'switch', b: 'switch', t1: send('N'), t2: send('N'), rx: recv('N'), led: 'led' }, [
      ['a.Q', 't1.A'],
      ['b.Q', 't2.A'],
      ['rx.Y', 'led.A'],
    ])
    const s = sim(c)
    set(s, 'a', true)
    set(s, 'b', false)
    expect(s.pinValue('led', 'A')).toBe(1)
    set(s, 'a', false)
    set(s, 'b', true)
    expect(s.pinValue('led', 'A')).toBe(0)
    // Without a driver on the first send, the next one publishes.
    const s2 = sim({ ...c, wires: c.wires.filter((w) => w.to.comp !== 't1') })
    set(s2, 'b', true)
    expect(s2.pinValue('led', 'A')).toBe(1)
  })

  it('a receive can feed a send of another name: the chain is followed to the real driver', () => {
    const s = sim(
      build({ sw: 'switch', t1: send('ONE'), r1: recv('ONE'), t2: send('TWO'), r2: recv('TWO'), led: 'led' }, [
        ['sw.Q', 't1.A'],
        ['r1.Y', 't2.A'],
        ['r2.Y', 'led.A'],
      ]),
    )
    set(s, 'sw', true)
    expect(s.pinValue('led', 'A')).toBe(1)
    set(s, 'sw', false)
    expect(s.pinValue('led', 'A')).toBe(0)
  })

  it('a loop of labels resolves to unknown instead of hanging', () => {
    const s = sim(build({ t: send('LOOP'), r: recv('LOOP'), led: 'led' }, [['r.Y', 't.A'], ['r.Y', 'led.A']]))
    expect(s.pinValue('led', 'A')).toBe(X)
  })

  it('reloading keeps the circuit and its state, and reset starts it over', () => {
    const c = build({ clk: ['clock', { hz: 4 }], tx: send('CLK'), rx: recv('CLK'), n: ['counter', { mod: 16 }] }, [
      ['clk.Q', 'tx.A'],
      ['rx.Y', 'n.CLK'],
    ])
    const s = sim(c)
    const count = () => ['A', 'B', 'C', 'D'].reduce((n, p, i) => n | ((s.pinValue('n', p) as V) << i), 0)
    for (let i = 0; i < 8; i++) s.stepClock()
    const before = count()
    expect(before).toBeGreaterThan(0)
    s.load(c)
    s.settle()
    expect(count()).toBe(before)
    s.stepClock()
    s.stepClock()
    expect(count()).toBe(before + 1)
    s.reset()
    s.settle()
    expect(s.pinValue('rx', 'Y')).toBe(s.pinValue('clk', 'Q'))
  })

  it('layouts: the flag is as wide as its name, on the grid, with the pin on the outside', () => {
    const l = (type: string, name: string) => getDef(type).layout({ name })
    expect(l('netsend', '').w).toBe(l('netsend', 'abcd').w) // room for the placeholder
    expect(l('netsend', 'ACC_HI_ENABLE').w % 10).toBe(0)
    expect(l('netsend', 'ACC_HI_ENABLE').w).toBeGreaterThan(l('netsend', 'ABCD').w)
    expect(l('netsend', 'A').pins[0]).toMatchObject({ name: 'A', dir: 'in', x: -10 })
    const r = l('netrecv', 'CLK')
    expect(r.pins[0]).toMatchObject({ name: 'Y', dir: 'out', x: r.w + 10 })
  })
})
