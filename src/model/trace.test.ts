import { describe, expect, it } from 'vitest'
import { CircuitBuilder } from './builder'
import { CONE_LIMIT, traceCone, traceNet } from './trace'

const wireBetween = (b: CircuitBuilder, from: string, to: string) =>
  Object.values(b.c.wires).find((w) => `${w.from.comp}.${w.from.pin}` === from && `${w.to.comp}.${w.to.pin}` === to)!.id

describe('tracing a signal', () => {
  it('a plain signal is every wire from the same output, and every pin they reach', () => {
    const b = new CircuitBuilder()
    const sw = b.add('switch', 0, 0)
    const [g1, g2, g3] = [b.add('and', 100, 0), b.add('or', 100, 60), b.add('not', 100, 120)]
    const other = b.add('switch', 0, 200)
    b.wire(`${sw}.Q`, `${g1}.A`)
    b.wire(`${sw}.Q`, `${g2}.A`)
    b.wire(`${sw}.Q`, `${g3}.A`)
    b.wire(`${other}.Q`, `${g1}.B`)
    const c = b.build()
    const t = traceNet(c, wireBetween(b, `${sw}.Q`, `${g2}.A`))
    expect(t.source).toEqual({ comp: sw, pin: 'Q' })
    expect(t.wires.size).toBe(3)
    expect([...t.pins].sort()).toEqual([`${g1}:A`, `${g2}:A`, `${g3}:A`, `${sw}:Q`].sort())
    expect(t.wires.has(wireBetween(b, `${other}.Q`, `${g1}.B`))).toBe(false)
  })

  it('follows net labels: the wire in, and every wire out of every receive label of that name', () => {
    const b = new CircuitBuilder()
    const sw = b.add('switch', 0, 0)
    const tx = b.add('netsend', 100, 0, { params: { name: 'GO' } })
    const rx1 = b.add('netrecv', 300, 0, { params: { name: 'GO' } })
    const rx2 = b.add('netrecv', 300, 100, { params: { name: 'GO' } })
    const rxOther = b.add('netrecv', 300, 200, { params: { name: 'NO' } })
    const [l1, l2, l3] = [b.add('led', 500, 0), b.add('led', 500, 100), b.add('led', 500, 200)]
    b.wire(`${sw}.Q`, `${tx}.A`)
    b.wire(`${rx1}.Y`, `${l1}.A`)
    b.wire(`${rx2}.Y`, `${l2}.A`)
    b.wire(`${rxOther}.Y`, `${l3}.A`)
    const c = b.build()
    // Starting from either end of the labelled connection gives the same signal.
    for (const from of [`${rx2}.Y`, `${sw}.Q`]) {
      const wire = Object.values(c.wires).find((w) => `${w.from.comp}.${w.from.pin}` === from)!.id
      const t = traceNet(c, wire)
      expect(t.source, from).toEqual({ comp: sw, pin: 'Q' })
      expect([...t.pins].sort(), from).toEqual([`${l1}:A`, `${l2}:A`, `${rx1}:Y`, `${rx2}:Y`, `${sw}:Q`, `${tx}:A`].sort())
      expect(t.wires.size, from).toBe(3)
    }
  })

  it('a receive label nothing publishes is its own signal', () => {
    const b = new CircuitBuilder()
    const rx = b.add('netrecv', 0, 0, { params: { name: 'LOST' } })
    const led = b.add('led', 200, 0)
    b.wire(`${rx}.Y`, `${led}.A`)
    const c = b.build()
    const t = traceNet(c, Object.keys(c.wires)[0])
    expect(t.source).toEqual({ comp: rx, pin: 'Y' })
    expect(t.wires.size).toBe(1)
  })

  it('an unknown wire traces to nothing', () => {
    const c = new CircuitBuilder().c
    expect(traceNet(c, 'nope')).toEqual({ source: null, wires: new Set(), pins: new Set() })
    expect(traceCone(c, 'nope').size).toBe(0)
  })
})

describe('the cone: what feeds a signal', () => {
  /** sw1, sw2 → AND → NOT → D flip-flop; another flip-flop's Q also feeds the AND. */
  const chain = () => {
    const b = new CircuitBuilder()
    const sw1 = b.add('switch', 0, 0)
    const sw2 = b.add('switch', 0, 80)
    const ff0 = b.add('dff', 0, 160)
    const sw3 = b.add('switch', -100, 160) // feeds ff0; behind a flip-flop, so not in the cone
    const and = b.add('and', 150, 40, { params: { inputs: 3 } })
    const not = b.add('not', 300, 50)
    const ff = b.add('dff', 450, 40)
    b.wire(`${sw1}.Q`, `${and}.A`)
    b.wire(`${sw2}.Q`, `${and}.B`)
    b.wire(`${ff0}.Q`, `${and}.C`)
    b.wire(`${sw3}.Q`, `${ff0}.D`)
    b.wire(`${and}.Y`, `${not}.A`)
    b.wire(`${not}.Y`, `${ff}.D`)
    return { b, sw1, sw2, ff0, sw3, and, not, ff }
  }

  it('runs back through combinational parts and stops at a flip-flop', () => {
    const { b, sw1, sw2, ff0, sw3, and, not, ff } = chain()
    const c = b.build()
    const cone = traceCone(c, wireBetween(b, `${not}.Y`, `${ff}.D`))
    expect(cone).toEqual(
      new Set([
        wireBetween(b, `${and}.Y`, `${not}.A`),
        wireBetween(b, `${sw1}.Q`, `${and}.A`),
        wireBetween(b, `${sw2}.Q`, `${and}.B`),
        wireBetween(b, `${ff0}.Q`, `${and}.C`),
      ]),
    )
    expect(cone.has(wireBetween(b, `${sw3}.Q`, `${ff0}.D`))).toBe(false) // behind the flip-flop
    expect(cone.has(wireBetween(b, `${not}.Y`, `${ff}.D`))).toBe(false) // the signal's own wire is not part of its cone
  })

  it('what feeds the output of a flip-flop is the logic at its inputs', () => {
    const { b, sw1, sw2, ff0, and, not, ff } = chain()
    const sink = b.add('led', 600, 40)
    b.wire(`${ff}.Q`, `${sink}.A`)
    const c = b.build()
    const cone = traceCone(c, wireBetween(b, `${ff}.Q`, `${sink}.A`))
    expect(cone).toEqual(
      new Set([
        wireBetween(b, `${not}.Y`, `${ff}.D`), // the flip-flop's D input
        wireBetween(b, `${and}.Y`, `${not}.A`),
        wireBetween(b, `${sw1}.Q`, `${and}.A`),
        wireBetween(b, `${sw2}.Q`, `${and}.B`),
        wireBetween(b, `${ff0}.Q`, `${and}.C`),
      ]),
    )
  })

  it('follows a net label on the way: both the wire out of the receive and the wire into the send', () => {
    const b = new CircuitBuilder()
    const sw = b.add('switch', 0, 0)
    const inv = b.add('not', 100, 0)
    const tx = b.add('netsend', 200, 0, { params: { name: 'W' } })
    const rx = b.add('netrecv', 400, 0, { params: { name: 'W' } })
    const gate = b.add('not', 500, 0)
    const led = b.add('led', 600, 0)
    b.wire(`${sw}.Q`, `${inv}.A`)
    b.wire(`${inv}.Y`, `${tx}.A`)
    b.wire(`${rx}.Y`, `${gate}.A`)
    b.wire(`${gate}.Y`, `${led}.A`)
    const c = b.build()
    const cone = traceCone(c, wireBetween(b, `${gate}.Y`, `${led}.A`))
    expect(cone).toEqual(
      new Set([
        wireBetween(b, `${rx}.Y`, `${gate}.A`),
        wireBetween(b, `${inv}.Y`, `${tx}.A`),
        wireBetween(b, `${sw}.Q`, `${inv}.A`),
      ]),
    )
  })

  it('does not loop on feedback (a latch made of gates) and is capped', () => {
    const b = new CircuitBuilder()
    const g1 = b.add('nor', 0, 0)
    const g2 = b.add('nor', 0, 80)
    const led = b.add('led', 200, 0)
    b.wire(`${g1}.Y`, `${g2}.A`)
    b.wire(`${g2}.Y`, `${g1}.B`)
    b.wire(`${g1}.Y`, `${led}.A`)
    const c = b.build()
    expect(traceCone(c, wireBetween(b, `${g1}.Y`, `${led}.A`)).size).toBeGreaterThan(0)

    // A long chain of inverters is cut off at the limit.
    const long = new CircuitBuilder()
    let prev = long.add('not', 0, 0)
    for (let i = 1; i < CONE_LIMIT + 50; i++) {
      const n = long.add('not', i * 40, 0)
      long.wire(`${prev}.Y`, `${n}.A`)
      prev = n
    }
    const end = long.add('led', 99999, 0)
    long.wire(`${prev}.Y`, `${end}.A`)
    expect(traceCone(long.c, Object.values(long.c.wires).at(-1)!.id).size).toBeLessThanOrEqual(CONE_LIMIT)
  })
})
