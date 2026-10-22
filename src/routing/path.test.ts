import { describe, expect, it } from 'vitest'
import type { Point, Wire } from '../model/circuit'
import { crossings, hopArcsD, hopPathD } from './path'

const wire = (id: string, comp: string, path: [number, number][]): Wire => ({
  id,
  from: { comp, pin: 'Q' },
  to: { comp: `${id}-sink`, pin: 'A' },
  path: path.map(([x, y]) => ({ x, y })),
})

describe('crossings', () => {
  it('finds a right-angle crossing of two different signals and hops the horizontal wire', () => {
    const h = wire('h', 'a', [[0, 50], [100, 50]])
    const v = wire('v', 'b', [[50, 0], [50, 100]])
    const c = crossings([h, v])
    expect(c.get('h')).toEqual([{ x: 50, y: 50 }])
    expect(c.has('v')).toBe(false)
  })

  it('does not hop wires of the same signal', () => {
    const h = wire('h', 'a', [[0, 50], [100, 50]])
    const v = wire('v', 'a', [[50, 0], [50, 100]])
    expect(crossings([h, v]).size).toBe(0)
  })

  it('ignores bends and T-junctions where a segment ends on the other', () => {
    const h = wire('h', 'a', [[0, 50], [100, 50]])
    const t = wire('t', 'b', [[50, 0], [50, 50]])
    const corner = wire('c', 'c', [[100, 0], [100, 50], [150, 50]])
    expect(crossings([h, t, corner]).size).toBe(0)
  })

  it('reports a crossing once when the other signal runs on a shared trunk (two overlapping wires)', () => {
    const h = wire('h', 'a', [[0, 50], [100, 50]])
    const v1 = wire('v1', 'b', [[50, 0], [50, 100]])
    const v2 = wire('v2', 'b', [[50, 0], [50, 100]])
    expect(crossings([h, v1, v2]).get('h')).toEqual([{ x: 50, y: 50 }])
  })

  it('collects several crossings on one segment', () => {
    const h = wire('h', 'a', [[0, 50], [100, 50]])
    const v1 = wire('v1', 'b', [[30, 0], [30, 100]])
    const v2 = wire('v2', 'c', [[70, 100], [70, 0]])
    expect(crossings([h, v1, v2]).get('h')?.map((p) => p.x)).toEqual([30, 70])
  })
})

describe('hopPathD', () => {
  const pts = (...p: [number, number][]): Point[] => p.map(([x, y]) => ({ x, y }))

  it('is a plain polyline without hops', () => {
    expect(hopPathD(pts([0, 0], [20, 0], [20, 10]), undefined)).toBe('M0,0 L20,0 L20,10')
  })

  it('leaves a gap at each crossing, whichever way the wire runs', () => {
    expect(hopPathD(pts([0, 50], [100, 50]), [{ x: 50, y: 50 }])).toBe('M0,50 L46,50 M54,50 L100,50')
    expect(hopPathD(pts([100, 50], [0, 50]), [{ x: 50, y: 50 }])).toBe('M100,50 L54,50 M46,50 L0,50')
  })

  it('orders gaps along the direction of travel and leaves vertical segments straight', () => {
    const d = hopPathD(pts([0, 50], [100, 50], [100, 90]), [{ x: 70, y: 50 }, { x: 30, y: 50 }])
    expect(d).toBe('M0,50 L26,50 M34,50 L66,50 M74,50 L100,50 L100,90')
  })

  it('draws the bridges as arcs that bulge upwards', () => {
    expect(hopArcsD([{ x: 50, y: 50 }, { x: 70, y: 50 }])).toBe('M46,50 A4,4 0 0 1 54,50 M66,50 A4,4 0 0 1 74,50')
  })
})
