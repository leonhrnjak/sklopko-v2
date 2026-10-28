import { boundsRect, type Circuit } from '../model/circuit'

export interface SnapPart {
  id: string
  type: string
  label: string
  x: number
  y: number
  w: number
  h: number
}

export interface SnapSection {
  /** The section's frame. */
  x: number
  y: number
  w: number
  h: number
  parts: SnapPart[]
  /** The notes above the section, left to right and top to bottom. */
  notes: string[]
}

export interface Snapshot {
  /** Everything, for the small map. */
  rect: { x: number; y: number; w: number; h: number }
  sections: (SnapSection | null)[]
  /** All the parts, with the section each one is in (-1: none). */
  parts: (SnapPart & { s: number })[]
  /** The routed wires as an SVG path. */
  wires: string
}

/** How the circuit's frames are titled, one for each section of the guide (the same order as its blocks). */
export const FRAME_TITLES = ['SEQUENCER', 'MICROCODE', 'CONTROL', 'REGISTERS', 'ALU', 'ADDRESS BUS', 'MEMORY']

/** What the guide shows of the circuit on the canvas: the sections' frames, parts and notes, and the wires, or null if it is not the 6502 from parts. */
export function snapshotOf(circuit: Circuit): Snapshot | null {
  const comps = Object.values(circuit.comps)
  const frames = FRAME_TITLES.map((t) => comps.find((c) => c.type === 'frame' && String(c.params.title).startsWith(t)))
  if (frames.some((f) => !f) || !comps.some((c) => c.type === 'frame' && String(c.params.title).startsWith('THE 6502 CPU'))) return null
  const notes = comps.filter((c) => c.type === 'note')
  const intro = notes.reduce((a, b) => (b.y < a.y ? b : a), notes[0])
  const drawn = comps.filter((c) => !['note', 'frame', 'netsend', 'netrecv'].includes(c.type))
  const parts = drawn.map((c) => {
    const b = boundsRect(c)
    return { id: c.id, type: c.type, label: c.label ?? '', x: b.x, y: b.y, w: b.w, h: b.h, s: -1 }
  })
  const sections = frames.map((f, s): SnapSection => {
    const x = f!.x
    const y = f!.y
    const w = Number(f!.params.w)
    const h = Number(f!.params.h)
    const mine = parts.filter((p) => p.x + p.w / 2 >= x && p.x + p.w / 2 <= x + w && p.y + p.h / 2 >= y && p.y + p.h / 2 <= y + h)
    for (const p of mine) p.s = s
    const text = notes
      .filter((n) => n !== intro && n.x >= x - 10 && n.x < x + w)
      .sort((a, b) => a.x - b.x || a.y - b.y)
      .map((n) => String(n.params.text))
    return { x, y, w, h, parts: mine, notes: text }
  })
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const s of sections) {
    x1 = Math.min(x1, s!.x)
    y1 = Math.min(y1, s!.y)
    x2 = Math.max(x2, s!.x + s!.w)
    y2 = Math.max(y2, s!.y + s!.h)
  }
  const wires = Object.values(circuit.wires)
    .map((w) => 'M' + w.path.map((p) => `${p.x} ${p.y}`).join('L'))
    .join('')
  return { rect: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, sections, parts, wires }
}
