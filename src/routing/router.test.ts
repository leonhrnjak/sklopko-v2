import { describe, expect, it } from 'vitest'
import { CircuitBuilder } from '../model/builder'
import { GRID, bodyRect, findPin, netKey, type Circuit, type Point } from '../model/circuit'
import { adjustEnds, applySegmentDrag, beginSegmentDrag, isOrthogonal, junctions, normalize, validPath } from './path'
import { routeWires, wireEndpoints } from './router'

/** Unit edges of a path as "x,y,h|v" keys. */
function edges(path: Point[]): string[] {
  const out: string[] = []
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    if (a.y === b.y) for (let x = Math.min(a.x, b.x); x < Math.max(a.x, b.x); x += GRID) out.push(`${x},${a.y},h`)
    else for (let y = Math.min(a.y, b.y); y < Math.max(a.y, b.y); y += GRID) out.push(`${a.x},${y},v`)
  }
  return out
}

function pointsOn(path: Point[]): Point[] {
  const out: Point[] = [path[0]]
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    const dx = Math.sign(b.x - a.x)
    const dy = Math.sign(b.y - a.y)
    for (let p = { ...a }; p.x !== b.x || p.y !== b.y; ) {
      p = { x: p.x + dx * GRID, y: p.y + dy * GRID }
      out.push(p)
    }
  }
  return out
}

/** Check the invariants every routed circuit must satisfy. */
function checkInvariants(c: Circuit) {
  const owner = new Map<string, string>()
  for (const w of Object.values(c.wires)) {
    const e = wireEndpoints(c, w)!
    expect(isOrthogonal(w.path), `${w.id} orthogonal`).toBe(true)
    expect(validPath(w.path, e.from, e.fromDir, e.to, e.toDir), `${w.id} valid ends`).toBe(true)
    // Never through a component body.
    for (const p of pointsOn(w.path)) {
      for (const comp of Object.values(c.comps)) {
        const r = bodyRect(comp)
        const inside = p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h
        expect(inside, `${w.id} passes through ${comp.id} at ${p.x},${p.y}`).toBe(false)
      }
    }
    // No collinear overlap with a different net.
    for (const e of edges(w.path)) {
      const net = netKey(w.from)
      const o = owner.get(e)
      if (o) expect(o, `${w.id} overlaps another net at ${e}`).toBe(net)
      owner.set(e, net)
    }
  }
}

describe('router', () => {
  it('routes a simple AND circuit cleanly', () => {
    const b = new CircuitBuilder()
    const a = b.add('switch', 0, 0)
    const bb = b.add('switch', 0, 80)
    const g = b.add('and', 120, 30)
    const l = b.add('led', 240, 40)
    b.wire(`${a}.Q`, `${g}.A`)
    b.wire(`${bb}.Q`, `${g}.B`)
    b.wire(`${g}.Y`, `${l}.A`)
    const c = b.build()
    checkInvariants(c)
    // Gate output and LED input are aligned -> a straight wire.
    const w = Object.values(c.wires).find((x) => x.to.comp === l)!
    expect(w.path.length).toBe(2)
  })

  it('goes around a component in the way', () => {
    const b = new CircuitBuilder()
    const s = b.add('switch', 0, 100)
    b.add('counter', 100, 40) // sits right between the switch and the LED
    const l = b.add('led', 300, 100)
    b.wire(`${s}.Q`, `${l}.A`)
    const c = b.build()
    checkInvariants(c)
    expect(Object.values(c.wires)[0].path.length).toBeGreaterThan(2)
  })

  it('fan-out wires share a trunk and get a junction dot', () => {
    const b = new CircuitBuilder()
    const s = b.add('switch', 0, 100)
    const l1 = b.add('led', 200, 40)
    const l2 = b.add('led', 200, 100)
    const l3 = b.add('led', 200, 160)
    for (const l of [l1, l2, l3]) b.wire(`${s}.Q`, `${l}.A`)
    const c = b.build()
    checkInvariants(c)
    expect(junctions(Object.values(c.wires)).length).toBeGreaterThan(0)
  })

  it('handles feedback wires that must loop backwards', () => {
    const b = new CircuitBuilder()
    const s = b.add('switch', 0, 0)
    const r = b.add('switch', 0, 120)
    const g1 = b.add('nor', 100, 0)
    const g2 = b.add('nor', 100, 100)
    b.wire(`${s}.Q`, `${g1}.A`)
    b.wire(`${g2}.Y`, `${g1}.B`)
    b.wire(`${g1}.Y`, `${g2}.A`)
    b.wire(`${r}.Q`, `${g2}.B`)
    checkInvariants(b.build())
  })

  it('keeps invariants on random layouts', () => {
    let seed = 7
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    for (let trial = 0; trial < 15; trial++) {
      const b = new CircuitBuilder()
      const ids: string[] = []
      for (let i = 0; i < 6; i++) {
        const type = ['and', 'or', 'xor', 'nand', 'dff'][rnd(5)]
        ids.push(b.add(type, (i % 3) * 160, Math.floor(i / 3) * 140 + rnd(4) * 10, { rot: rnd(4) === 0 ? 2 : 0 }))
      }
      const src = b.add('switch', -120, 60)
      for (let i = 0; i < 6; i++) {
        const target = ids[(i + 1 + rnd(5)) % 6]
        const input = b.c.comps[target].type === 'dff' ? 'D' : 'A'
        const from = rnd(3) === 0 ? `${src}.Q` : `${ids[i]}.${b.c.comps[ids[i]].type === 'dff' ? 'Q' : 'Y'}`
        if (Object.values(b.c.wires).some((w) => w.to.comp === target && w.to.pin === input)) continue
        b.wire(from, `${target}.${input}`)
      }
      checkInvariants(b.build())
    }
  })
})

describe('path editing', () => {
  it('normalize merges collinear points', () => {
    expect(normalize([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }])).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
    ])
  })

  it('dragging a segment keeps the wire orthogonal and attached', () => {
    const b = new CircuitBuilder()
    const s = b.add('switch', 0, 0)
    const l = b.add('led', 200, 100)
    const id = b.wire(`${s}.Q`, `${l}.A`)
    const c = b.build()
    const path = c.wires[id].path
    for (let i = 0; i < path.length - 1; i++) {
      const d = beginSegmentDrag(path, i)
      if (!d) continue
      const moved = normalize(applySegmentDrag(d, d.horizontal ? 200 : 130))
      const e = wireEndpoints(c, c.wires[id])!
      expect(validPath(moved, e.from, e.fromDir, e.to, e.toDir), `segment ${i}`).toBe(true)
    }
  })

  it('a straight wire can be bent by dragging its only segment', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]
    const d = beginSegmentDrag(path, 0)!
    const moved = normalize(applySegmentDrag(d, 50))
    expect(moved).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 50 },
      { x: 90, y: 50 },
      { x: 90, y: 0 },
      { x: 100, y: 0 },
    ])
  })

  it('manual paths follow moved endpoints', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 100 },
      { x: 200, y: 100 },
    ]
    const r = adjustEnds(path, { x: 0, y: 20 }, { x: 1, y: 0 }, { x: 200, y: 100 }, { x: -1, y: 0 })
    expect(r).toEqual([
      { x: 0, y: 20 },
      { x: 50, y: 20 },
      { x: 50, y: 100 },
      { x: 200, y: 100 },
    ])
    // Moving the source past the bend makes the first segment point backwards: rejected.
    expect(adjustEnds(path, { x: 80, y: 0 }, { x: 1, y: 0 }, { x: 200, y: 100 }, { x: -1, y: 0 })).toBeNull()
  })

  it('rerouting a single wire avoids the others', () => {
    const b = new CircuitBuilder()
    const s1 = b.add('switch', 0, 0)
    const s2 = b.add('switch', 0, 40)
    const l1 = b.add('led', 200, 40)
    const l2 = b.add('led', 200, 0)
    b.wire(`${s1}.Q`, `${l1}.A`)
    const w2 = b.wire(`${s2}.Q`, `${l2}.A`)
    const c = b.build()
    c.wires[w2].path = routeWires(c, [w2])[w2]
    checkInvariants(c)
    expect(findPin(c.comps[l2], 'A')).toBeTruthy()
  })
})

describe('segment drag limits', () => {
  it('cannot drag a segment past the pin it leads into', () => {
    // Last segment enters the target moving right (+x); the vertical before it may not pass x=230.
    const path = [
      { x: 70, y: -60 },
      { x: 230, y: -60 },
      { x: 230, y: 40 },
      { x: 240, y: 40 },
    ]
    const d = beginSegmentDrag(path, 1)!
    const moved = normalize(applySegmentDrag(d, 280))
    expect(validPath(moved, path[0], { x: 1, y: 0 }, path[3], { x: -1, y: 0 })).toBe(true)
    expect(moved[1].x).toBe(230)
  })
})
