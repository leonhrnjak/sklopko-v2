import type { Layout, PinDef, Side, V } from './types'

export type PinSpec =
  | string
  | { name: string; label?: string; dir?: 'in' | 'out'; clock?: boolean; invert?: boolean; def?: V; bus?: number }

interface BoxOpts {
  w?: number
  left?: PinSpec[]
  right?: PinSpec[]
  top?: PinSpec[]
  bottom?: PinSpec[]
  /** Minimum number of 20px pin rows. */
  minRows?: number
}

const PITCH = 20

function spec(s: PinSpec) {
  return typeof s === 'string' ? { name: s } : s
}

/**
 * Rectangular body with pins on its sides, 20px apart, 10px pin stubs.
 * Pin order (and therefore `ins`/`outs` order) is left, top, bottom, right.
 * A side with fewer pins than the other is centred.
 */
export function box(o: BoxOpts): Layout {
  const left = o.left ?? []
  const right = o.right ?? []
  const top = o.top ?? []
  const bottom = o.bottom ?? []
  const rows = Math.max(left.length, right.length, o.minRows ?? 2)
  const h = PITCH * (rows + 1)
  const cols = Math.max(top.length, bottom.length)
  // Leave room for the widest label on each side plus ~44px for the title in between.
  const labelWidth = (list: PinSpec[]) =>
    Math.max(0, ...list.map((s) => {
      const p = spec(s)
      return (p.label ?? p.name).replace('~', '').length * 6 + (p.clock ? 8 : 0)
    }))
  const fit = Math.ceil((labelWidth(left) + labelWidth(right) + 60) / PITCH) * PITCH
  const w = Math.max(o.w ?? Math.max(80, fit), PITCH * (cols + 1))
  const pins: PinDef[] = []

  const vertical = (list: PinSpec[], side: Side, x: number, defDir: 'in' | 'out') => {
    const start = 10 * (rows - list.length + 2)
    list.forEach((s, i) => {
      const p = spec(s)
      pins.push({ dir: defDir, label: p.name, ...p, side, x, y: start + PITCH * i })
    })
  }
  const horizontal = (list: PinSpec[], side: Side, y: number) => {
    const start = Math.round((w - PITCH * (list.length - 1)) / 2 / 10) * 10
    list.forEach((s, i) => {
      const p = spec(s)
      pins.push({ dir: 'in', label: p.name, ...p, side, x: start + PITCH * i, y })
    })
  }

  vertical(left, 'l', -10, 'in')
  horizontal(top, 't', -10)
  horizontal(bottom, 'b', h + 10)
  vertical(right, 'r', w + 10, 'out')
  return { w, h, pins }
}

export type GateShape = 'and' | 'or' | 'xor' | 'buf'

/** Distinctive-shape gate with `n` inputs. Inputs are 20px apart, output centred. */
export function gateLayout(n: number, shape: GateShape, inverted: boolean): Layout {
  if (shape === 'buf') {
    const w = 30
    return {
      w,
      h: 20,
      pins: [
        { name: 'A', dir: 'in', side: 'l', x: -10, y: 10 },
        { name: 'Y', dir: 'out', side: 'r', x: w + (inverted ? 20 : 10), y: 10, invert: inverted },
      ],
    }
  }
  const h = PITCH * n
  const w = 20 + h / 2 + (shape === 'xor' ? 10 : 0)
  const pins: PinDef[] = []
  for (let i = 0; i < n; i++) {
    pins.push({ name: String.fromCharCode(65 + i), dir: 'in', side: 'l', x: -10, y: 10 + PITCH * i })
  }
  pins.push({ name: 'Y', dir: 'out', side: 'r', x: w + (inverted ? 20 : 10), y: h / 2, invert: inverted })
  return { w, h, pins }
}

/** Pin names helper: prefix + index, e.g. names('I', 4) -> I0..I3. */
export const names = (prefix: string, n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => `${prefix}${i + from}`)
