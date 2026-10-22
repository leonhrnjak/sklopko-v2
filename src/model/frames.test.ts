import { describe, expect, it } from 'vitest'
import { noteSize, wrapText } from '../engine/components/annotation'
import { circuitRect } from './bounds'
import { CircuitBuilder } from './builder'
import { isAnnotation, isFrame } from './circuit'
import { contentsOf, withFrameContents } from './frames'

describe('frames', () => {
  const scene = () => {
    const b = new CircuitBuilder()
    const frame = b.add('frame', 100, 100, { params: { w: 300, h: 200 } })
    const inside = b.add('and', 150, 150) // body 50×40 plus pin tips: fits
    const label = b.add('led', 300, 220, { label: 'LED' })
    const edge = b.add('and', 380, 150) // sticks out through the right edge
    const outside = b.add('and', 600, 150)
    const nested = b.add('frame', 120, 120, { params: { w: 100, h: 60 } })
    const deep = b.add('not', 130, 140)
    return { b, frame, inside, label, edge, outside, nested, deep }
  }

  it('contains the parts that lie wholly inside, pin tips included', () => {
    const { b, frame, inside, label, edge, outside } = scene()
    const c = contentsOf(b.c, frame)
    expect(c).toContain(inside)
    expect(c).toContain(label)
    expect(c).not.toContain(edge) // its pins stick out
    expect(c).not.toContain(outside)
    expect(c).not.toContain(frame)
  })

  it('a frame inside a frame counts, with what it holds', () => {
    const { b, frame, nested, deep } = scene()
    expect(contentsOf(b.c, frame)).toEqual(expect.arrayContaining([nested, deep]))
    expect(contentsOf(b.c, nested)).toEqual([deep])
  })

  it('dragging a frame moves its contents too; dragging a plain part moves only itself', () => {
    const { b, frame, inside, outside } = scene()
    const moved = withFrameContents(b.c, [frame])
    expect(moved).toContain(frame)
    expect(moved).toContain(inside)
    expect(moved).not.toContain(outside)
    expect(withFrameContents(b.c, [outside])).toEqual([outside])
    expect(new Set(withFrameContents(b.c, [frame, inside])).size).toBe(moved.length) // no duplicates
  })

  it('has nothing for a part that is not a frame, or does not exist', () => {
    const { b, inside } = scene()
    expect(contentsOf(b.c, inside)).toEqual([])
    expect(contentsOf(b.c, 'nope')).toEqual([])
  })

  it('knows which parts are annotations', () => {
    const b = new CircuitBuilder()
    const [n, f, g] = [b.add('note', 0, 0), b.add('frame', 0, 0), b.add('and', 0, 0)]
    expect([n, f, g].map((id) => isAnnotation(b.c.comps[id]))).toEqual([true, true, false])
    expect([n, f, g].map((id) => isFrame(b.c.comps[id]))).toEqual([false, true, false])
  })
})

describe('notes', () => {
  it('wrap at spaces, keep the line breaks you typed, and cut words longer than a line', () => {
    expect(wrapText('the quick brown fox', 10)).toEqual(['the quick', 'brown fox'])
    expect(wrapText('one\ntwo words here', 20)).toEqual(['one', 'two words here'])
    expect(wrapText('a\n\nb', 20)).toEqual(['a', '', 'b'])
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
    expect(wrapText('hi abcdefghij', 4)).toEqual(['hi', 'abcd', 'efgh', 'ij'])
    expect(wrapText('', 10)).toEqual([''])
    expect(wrapText('   ', 10)).toEqual([''])
  })

  it('are as tall as their lines and as wide as their characters, on the grid', () => {
    const short = noteSize({ text: 'hi', cols: 20 })
    const long = noteSize({ text: 'word '.repeat(40), cols: 20 })
    expect(short.w).toBe(long.w)
    expect(long.h).toBeGreaterThan(short.h)
    for (const s of [short, long]) {
      expect(s.w % 10).toBe(0)
      expect(s.h % 10).toBe(0)
    }
    expect(noteSize({ text: '', cols: 20 }).h).toBeGreaterThanOrEqual(40)
    expect(noteSize({ text: 'x', cols: 40 }).w).toBeGreaterThan(noteSize({ text: 'x', cols: 20 }).w)
  })
})

describe('circuit rectangle', () => {
  it('holds every part with its label, and every wire, plus the padding', () => {
    const b = new CircuitBuilder()
    const sw = b.add('switch', 0, 0)
    const led = b.add('led', 400, 300, { label: 'Out' })
    b.wire(`${sw}.Q`, `${led}.A`)
    const c = b.build()
    const r = circuitRect(c, 10)
    expect(r.x).toBeLessThanOrEqual(-10)
    expect(r.y).toBeLessThanOrEqual(-10)
    expect(r.x + r.w).toBeGreaterThanOrEqual(400 + 20 + 10)
    expect(r.y + r.h).toBeGreaterThanOrEqual(300 + 20 + 10)
    // The label above the LED fits inside.
    expect(r.y).toBeLessThanOrEqual(0 - 10)
  })

  it('is small and at the origin for an empty circuit', () => {
    expect(circuitRect(new CircuitBuilder().c, 24)).toEqual({ x: -24, y: -24, w: 48, h: 48 })
  })
})

describe('annotations and wires', () => {
  const link = (withAnnotations: boolean) => {
    const b = new CircuitBuilder()
    const sw = b.add('switch', 0, 100)
    const wall = b.add('and', 200, 40) // a real obstacle the wire must go around: it is in the way
    const led = b.add('led', 500, 100)
    if (withAnnotations) {
      b.add('frame', 100, 20, { params: { w: 300, h: 260 } })
      b.add('note', 250, 200)
    }
    b.wire(`${sw}.Q`, `${led}.A`)
    b.wire(`${wall}.Y`, `${led}.A`)
    return b.build()
  }

  it('frames and notes are not obstacles: the wires are routed exactly as without them', () => {
    const plain = link(false)
    const annotated = link(true)
    const paths = (c: typeof plain) => Object.values(c.wires).map((w) => w.path)
    expect(paths(annotated)).toEqual(paths(plain))
  })

  it('and they do not make the router grid bigger', () => {
    // A frame far away would otherwise grow the routing grid (and the time it takes).
    const b = new CircuitBuilder()
    const a = b.add('switch', 0, 0)
    const z = b.add('led', 200, 0)
    b.add('frame', 0, 0, { params: { w: 4000, h: 4000 } })
    b.wire(`${a}.Q`, `${z}.A`)
    const t = performance.now()
    const c = b.build()
    expect(performance.now() - t).toBeLessThan(500)
    expect(Object.values(c.wires)[0].path.length).toBeLessThanOrEqual(3)
  })
})
