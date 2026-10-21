import { layoutOf, type PinRef } from '../engine/simulator'
import type { Layout, Params, PinDef, Side } from '../engine/types'

export type { PinRef }

export const GRID = 10

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type Rot = 0 | 1 | 2 | 3

export interface Comp {
  id: string
  type: string
  /** World position of the component's local origin (the top-left of the unrotated body). */
  x: number
  y: number
  /** Clockwise quarter turns. */
  rot: Rot
  flip: boolean
  params: Params
  label?: string
}

export interface Wire {
  id: string
  /** Always an output pin. */
  from: PinRef
  /** Always an input pin. */
  to: PinRef
  /** Orthogonal polyline from the output pin tip to the input pin tip. */
  path: Point[]
  /** The user shaped this wire by hand; keep its shape instead of auto-routing it. */
  manual?: boolean
}

export interface Circuit {
  comps: Record<string, Comp>
  wires: Record<string, Wire>
}

export const emptyCircuit = (): Circuit => ({ comps: {}, wires: {} })

export const snap = (v: number) => Math.round(v / GRID) * GRID

export const compLayout = (c: Comp): Layout => layoutOf(c.type, c.params)

/** Map a local component coordinate to world space (flip, then rotate around the origin, then translate). */
export function toWorld(c: Comp, layout: Layout, x: number, y: number): Point {
  if (c.flip) x = layout.w - x
  for (let i = 0; i < c.rot; i++) [x, y] = [-y, x]
  return { x: c.x + x, y: c.y + y }
}

const SIDE_VEC: Record<Side, Point> = { l: { x: -1, y: 0 }, r: { x: 1, y: 0 }, t: { x: 0, y: -1 }, b: { x: 0, y: 1 } }

/** Unit vector pointing out of the body at a pin, in world space. */
export function pinOutward(c: Comp, pin: PinDef): Point {
  let { x, y } = SIDE_VEC[pin.side]
  if (c.flip) x = -x
  for (let i = 0; i < c.rot; i++) [x, y] = [-y, x]
  return { x: x + 0, y: y + 0 }
}

export interface WorldPin {
  comp: Comp
  def: PinDef
  pos: Point
  /** Outward direction. */
  dir: Point
}

export function worldPins(c: Comp): WorldPin[] {
  const l = compLayout(c)
  return l.pins.map((def) => ({ comp: c, def, pos: toWorld(c, l, def.x, def.y), dir: pinOutward(c, def) }))
}

export function findPin(c: Comp, name: string): WorldPin | undefined {
  return worldPins(c).find((p) => p.def.name === name)
}

/** Body rectangle in world space (pins excluded). */
export function bodyRect(c: Comp): Rect {
  const l = compLayout(c)
  const a = toWorld(c, l, 0, 0)
  const b = toWorld(c, l, l.w, l.h)
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}

/** Body plus pin tips: the area a component visually occupies. */
export function boundsRect(c: Comp): Rect {
  let { x, y, w, h } = bodyRect(c)
  let x2 = x + w
  let y2 = y + h
  for (const p of worldPins(c)) {
    x = Math.min(x, p.pos.x)
    y = Math.min(y, p.pos.y)
    x2 = Math.max(x2, p.pos.x)
    y2 = Math.max(y2, p.pos.y)
  }
  return { x, y, w: x2 - x, h: y2 - y }
}

export const rectsIntersect = (a: Rect, b: Rect) =>
  a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h

/** Key of the net a wire belongs to: its driving output pin. */
export const netKey = (p: PinRef) => `${p.comp}:${p.pin}`

let counter = 0
export function newId(prefix: string) {
  counter = (counter + 1) % 1e6
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`
}
