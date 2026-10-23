import { describe, expect, it } from 'vitest'
import { STATE_RADIUS } from '../../model/fsm-edit'
import { fsmFrom } from '../../model/fsm'
import { arrowBetween, arrowHead, arrowsOf, diagramBounds, edgePoint, entryArrow, loopAt, onRim, stateAt } from './geometry'

const R = STATE_RADIUS
const near = (a: number, b: number, d = 0.2) => expect(Math.abs(a - b)).toBeLessThan(d)

describe('diagram geometry', () => {
  it('edge points lie on the circle, towards the target', () => {
    const p = edgePoint({ x: 100, y: 100 }, { x: 300, y: 100 })
    expect(p).toEqual({ x: 100 + R, y: 100 })
    const q = edgePoint({ x: 0, y: 0 }, { x: 30, y: 40 })
    near(Math.hypot(q.x, q.y), R)
    near(q.x / q.y, 0.75)
  })

  it('a straight arrow runs between the rims and points along the line', () => {
    const a = arrowBetween({ x: 100, y: 100 }, { x: 300, y: 100 }, 0)
    expect(a.d).toBe(`M${100 + R} 100 L${300 - R} 100`)
    expect(a.tip).toEqual({ x: 300 - R, y: 100 })
    near(a.angle, 0, 1e-9)
    expect(a.label.y).toBeLessThan(100) // the label hangs above the line
    near(a.label.x, 200)
    near(arrowBetween({ x: 300, y: 100 }, { x: 100, y: 100 }, 0).angle, Math.PI, 1e-9)
  })

  it('a bent arrow ends on the rim, and bends to the right of the way it goes', () => {
    const to = { x: 300, y: 100 }
    const a = arrowBetween({ x: 100, y: 100 }, to, 30)
    near(Math.hypot(a.tip.x - to.x, a.tip.y - to.y), R, 0.5)
    expect(a.d).toContain('Q')
    expect(a.label.y).toBeGreaterThan(100) // to the right of a rightwards arrow on a screen is down
    const back = arrowBetween(to, { x: 100, y: 100 }, 30)
    expect(back.label.y).toBeLessThan(100) // and the way back bends the other way, so the pair does not overlap
  })

  it('a loop leaves and returns to the same state, above it, and later loops are larger', () => {
    const c = { x: 200, y: 200 }
    const a = loopAt(c)
    near(Math.hypot(a.tip.x - c.x, a.tip.y - c.y), R, 0.5)
    expect(a.tip.y).toBeLessThan(c.y)
    expect(a.label.y).toBeLessThan(c.y - R)
    expect(loopAt(c, 1).label.y).toBeLessThan(a.label.y)
    expect(a.angle).toBeGreaterThan(0) // coming down into the state
    expect(a.angle).toBeLessThan(Math.PI)
  })

  it('the entry arrow comes from the left into the state', () => {
    const a = entryArrow({ x: 200, y: 200 })
    expect(a.tip).toEqual({ x: 200 - R, y: 200 })
    expect(a.angle).toBe(0)
    expect(a.d.startsWith(`M${200 - R - 44} 200`)).toBe(true)
  })

  it('an arrowhead has its tip first and two corners behind it', () => {
    const pts = arrowHead({ x: 50, y: 50 }, 0).split(' ')
    expect(pts[0]).toBe('50,50')
    for (const p of pts.slice(1)) expect(Number(p.split(',')[0])).toBeLessThan(50)
  })

  it('finds the state under a point, the topmost first, and the rim', () => {
    const f = fsmFrom({ name: 'M', type: 'moore', states: ['A', 'B'], transitions: [] })
    f.states[0].x = 100
    f.states[0].y = 100
    f.states[1].x = 120
    f.states[1].y = 100
    expect(stateAt(f, { x: 110, y: 100 })).toBe('B')
    expect(stateAt(f, { x: 70, y: 100 })).toBe('A')
    expect(stateAt(f, { x: 400, y: 400 })).toBeUndefined()
    expect(stateAt(f, { x: 100 - R - 4, y: 100 })).toBeUndefined()
    expect(stateAt(f, { x: 100 - R - 4, y: 100 }, 6)).toBe('A')
    expect(onRim({ x: 100, y: 100 }, { x: 100 + R, y: 100 })).toBe(true)
    expect(onRim({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(false)
    expect(onRim({ x: 100, y: 100 }, { x: 100 + R - 20, y: 100 })).toBe(false)
  })

  it('draws every transition, bending pairs apart and fanning out repeats', () => {
    const f = fsmFrom({
      name: 'M',
      type: 'moore',
      inputs: ['A'],
      states: ['P', 'Q', 'R'],
      transitions: [['P', 'Q', 'A'], ['Q', 'P', '!A'], ['P', 'R', 'A'], ['P', 'R', '!A'], ['R', 'R']],
    })
    f.states.forEach((s, i) => ((s.x = 100 + i * 200), (s.y = 200)))
    const arrows = arrowsOf(f)
    expect([...arrows.keys()]).toEqual(['t0', 't1', 't2', 't3', 't4'])
    expect(arrows.get('t0')!.d).toContain('Q') // paired with t1: bent
    expect(arrows.get('t1')!.d).toContain('Q')
    expect(arrows.get('t0')!.label.y).not.toBeCloseTo(arrows.get('t1')!.label.y, 0)
    expect(arrows.get('t2')!.d).not.toBe(arrows.get('t3')!.d) // two the same way fan out
    expect(arrows.get('t4')!.d).toContain('C') // a loop
    expect(arrowsOf({ ...f, transitions: [{ id: 'x', from: 'P', to: 'Nowhere', guard: '', outputs: [] }] }).size).toBe(0)
  })

  it('the drawing area never shrinks below the default and grows to hold far-away states', () => {
    const f = fsmFrom({ name: 'M', type: 'moore', states: ['A', 'B'], transitions: [] })
    f.states[0].x = 100
    f.states[0].y = 200
    f.states[1].x = 200
    f.states[1].y = 200
    expect(diagramBounds(f)).toEqual({ x: -10, y: 0, w: 910, h: 520 })
    f.states[1].x = 1500
    f.states[1].y = 900
    const b = diagramBounds(f)
    expect(b.x + b.w).toBe(1610)
    expect(b.y + b.h).toBe(990)
  })
})
