import { describe, expect, it } from 'vitest'
import { Simulator } from '../engine/simulator'
import { validPath } from '../routing/path'
import { wireEndpoints } from '../routing/router'
import { CircuitBuilder } from './builder'
import { autoConnect, updateWiresAfterMove } from './ops'

describe('auto-connect', () => {
  // AND at (0,0) has its output tip at (50,20); a NOT at (60,10) has its input tip there too.
  const touching = () => {
    const b = new CircuitBuilder()
    const s = b.add('switch', -100, 0)
    const g = b.add('and', 0, 0)
    const n = b.add('not', 60, 10)
    b.wire(`${s}.Q`, `${g}.A`)
    b.wire(`${s}.Q`, `${g}.B`)
    return { c: b.build(), g, n, s }
  }

  it('wires an output tip that touches an input tip', () => {
    const { c, g, n } = touching()
    expect(autoConnect(c, [n])).toBe(true)
    const w = Object.values(c.wires).find((x) => x.to.comp === n)!
    expect(w.from).toEqual({ comp: g, pin: 'Y' })
    expect(w.path).toEqual([{ x: 50, y: 20 }, { x: 50, y: 20 }])
    const e = wireEndpoints(c, w)!
    expect(validPath(w.path, e.from, e.fromDir, e.to, e.toDir)).toBe(true)

    // And it conducts.
    const sim = new Simulator()
    sim.load({ comps: Object.values(c.comps), wires: Object.values(c.wires) })
    sim.setParams(Object.keys(c.comps)[0], { on: true })
    sim.settle()
    expect(sim.pinValue(n, 'Y')).toBe(0)
  })

  it('does not double-connect or override an existing wire', () => {
    const { c, n } = touching()
    autoConnect(c, [n])
    expect(autoConnect(c, [n])).toBe(false)
    expect(Object.values(c.wires).filter((x) => x.to.comp === n)).toHaveLength(1)
  })

  it('becomes a routed wire when the part is moved away', () => {
    const { c, n } = touching()
    autoConnect(c, [n])
    c.comps[n].x += 60
    c.comps[n].y += 80
    updateWiresAfterMove(c, new Set([n]), { x: 60, y: 80 }, true)
    const w = Object.values(c.wires).find((x) => x.to.comp === n)!
    const e = wireEndpoints(c, w)!
    expect(w.path.length).toBeGreaterThan(2)
    expect(validPath(w.path, e.from, e.fromDir, e.to, e.toDir)).toBe(true)
  })

  it('connects one output to every input touching it', () => {
    const b = new CircuitBuilder()
    b.add('switch', 0, 0) // Q tip at (40,10)
    const l = b.add('led', 50, 0) // A tip at (40,10)
    const l2 = b.add('led', 50, 0)
    const c = b.build()
    autoConnect(c, [l, l2])
    expect(Object.values(c.wires)).toHaveLength(2)
    expect(new Set(Object.values(c.wires).map((w) => w.from.pin))).toEqual(new Set(['Q']))
  })

  it('never connects two outputs', () => {
    const b = new CircuitBuilder()
    const a = b.add('switch', 0, 0)
    b.add('switch', 0, 0)
    const c = b.build()
    expect(autoConnect(c, [a])).toBe(false)
  })
})
