import { describe, expect, it } from 'vitest'
import { Simulator } from '../engine/simulator'
import { validPath } from '../routing/path'
import { wireEndpoints } from '../routing/router'
import { CircuitBuilder } from './builder'
import { findPin } from './circuit'
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

describe('net label helpers', () => {
  // A part with pins on all four sides: a ROM has address pins on the left and data pins on the right; a RAM has
  // address pins on top. Flipped, a part has its inputs on the right.
  it('tag and tap put a label next to the pin, facing it, whichever way the pin points', () => {
    const b = new CircuitBuilder()
    const ram = b.add('ram', 200, 200)
    const flipped = b.add('and', 600, 200, { flip: true })
    const spots = [`${ram}.D0`, `${ram}.A1`, `${ram}.Q0`, `${flipped}.A`, `${flipped}.Y`]
    for (const at of spots) {
      const [id, pin] = at.split('.')
      const target = findPin(b.c.comps[id], pin)!
      const isOut = target.def.dir === 'out'
      const label = (isOut ? b.tap(at, 'N') : b.tag(at, 'N'))!
      expect(label, `room beside ${at}`).toBeDefined()
      const mine = findPin(b.c.comps[label], isOut ? 'A' : 'Y')!
      // 20px away along the pin's outward direction, and facing back at it.
      expect(mine.pos, at).toEqual({ x: target.pos.x + target.dir.x * 20, y: target.pos.y + target.dir.y * 20 })
      expect(mine.dir, at).toEqual({ x: -target.dir.x + 0, y: -target.dir.y + 0 })
    }
    const c = b.build()
    for (const w of Object.values(c.wires)) {
      const e = wireEndpoints(c, w)!
      expect(validPath(w.path, e.from, e.fromDir, e.to, e.toDir), w.id).toBe(true)
    }
  })
})

describe('net label helpers with no room', () => {
  it('add nothing when the label would run into another part', () => {
    const b = new CircuitBuilder()
    const a = b.add('and', 0, 0)
    b.add('and', 70, 0) // right where a Send label for the first gate's output would go
    b.add('and', 70, 30)
    b.add('and', 70, -30)
    const before = Object.keys(b.c.comps).length
    expect(b.tap(`${a}.Y`, 'N')).toBeUndefined()
    expect(Object.keys(b.c.comps)).toHaveLength(before)
    expect(Object.keys(b.c.wires)).toHaveLength(0)
  })
})
