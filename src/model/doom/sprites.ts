import { Q_FAR, Q_NEAR, SCREEN_H, screenWidth } from './tables'
import type { Pose } from './reference'

/**
 * Sprites: the enemies as scaled pictures, standing in the map and drawn over the walls (docs/plan-doom-like.md, D4). Everything here is
 * integer arithmetic that the 65C02 program repeats step by step (`spritecode.ts`).
 *
 * An enemy stands at a point (x, y) counted in 1/16 cells. Seen from the player it is at a depth `dist` (1/256 cells, along the view
 * direction) and a lateral offset, which gives the screen column of its middle and, with the same height table as the walls (`Q_NEAR`,
 * `Q_FAR`), its size: `q`, as a wall at that distance, in steps of 4 pixels. A sprite is `2.5·q` columns wide and `4·q` pixels tall,
 * drawn only in the columns where it is nearer than the wall (`q` greater than the wall's), in the order far to near.
 */

/** Direction of the view as signed bytes of amplitude 32: cos and sin of the angle. */
const dir = (f: (a: number) => number) => Array.from({ length: 256 }, (_, a) => Math.round(32 * f((2 * Math.PI * a) / 256)))
export const DCOS = dir(Math.cos)
export const DSIN = dir(Math.sin)

/** What a point is seen as: the sprite's `q`, and its first and last columns (clipped to the screen), or null when it is not drawn. */
export interface Seen {
  q: number
  /** First column, which may be negative (the sprite starts off the screen). */
  left: number
  /** Last column (inclusive), which may be past 159. */
  right: number
  width: number
}

/** The sprite's width in columns for a height `q`. */
export const spriteWidth = (q: number) => (q << 1) + (q >> 1)

/** Project the point (x, y) in 1/16 cells, seen from `p`. */
export function project(p: Pose, x: number, y: number): Seen | null {
  const rx = (x * 16 - (p.xCell * 256 + p.xFrac)) >> 2
  const ry = (y * 16 - (p.yCell * 256 + p.yFrac)) >> 2
  if (rx > 511 || rx < -512 || ry > 511 || ry < -512) return null
  const c = DCOS[p.angle]
  const s = DSIN[p.angle]
  // Depth along the view direction, and lateral offset (positive: to the left), in 1/2048 cells.
  const depth = rx * c + ry * s
  const lateral = rx * s - ry * c
  const dist = depth >> 3
  if (dist < 64) return null
  const q = dist >> 8 < 4 ? Q_NEAR[(dist >> 2) & 255] : Q_FAR[(dist >> 4) & 255]
  const t = Math.floor(((Math.abs(lateral) >> 3) << 4) / dist)
  if (t > 255) return null
  const off = (t << 3) - (t >> 2) - (t >> 3)
  if (off > 200) return null
  const centre = lateral > 0 ? 80 - off : 80 + off
  const width = spriteWidth(q)
  const left = centre - (width >> 1)
  const right = left + width - 1
  if (right < 0 || left > 159) return null
  return { q, left, right, width }
}

/** Texture column of the sprite's `n`th column (0 to width − 1), for a sprite of height `q`: 0 to 7. */
export const textureColumn = (q: number, n: number) => Math.min(7, Math.floor(((2 * n + 1) * 4) / spriteWidth(q)))

/** The pixel row where texel row `v` (0 to 16) starts for a sprite of height `q`: even, so that a run is whole bytes. */
export const texelRow = (q: number, v: number) => (50 - 2 * q + ((v * q) >> 2)) & 0xfe

/** One run of a texture column: texel rows `from` to `to` (exclusive) of one colour. */
export interface Run {
  from: number
  to: number
  colour: number
}

/** The art: each row of a sprite is eight characters; `.` is clear and the others are palette colours. */
const KEY: Record<string, number> = { h: 5, s: 12, r: 6, g: 9, k: 0, w: 15, p: 7, m: 8, y: 12, o: 13 }
const ART: string[][] = [
  // Patrol: a guard with a brown helmet and a red coat.
  [
    '..hhhh..',
    '.hhhhhh.',
    '.ssssss.',
    '.ssssss.',
    '..ssss..',
    '.rrrrrr.',
    'rrrrrrrr',
    'rrrrrrrr',
    'rrrrrrrr',
    'rrrrrrrr',
    '.rrrrrr.',
    '..gggg..',
    '..gg.gg.',
    '..gg.gg.',
    '..gg.gg.',
    '.kkk.kkk',
  ],
  // Chaser: a horned creature, purple with magenta head and white eyes.
  [
    '.m....m.',
    '.mm..mm.',
    '..mmmm..',
    '.mmmmmm.',
    '.mwmmwm.',
    '.mmmmmm.',
    '..mmmm..',
    '.pppppp.',
    'pppppppp',
    'pppppppp',
    'p.pppp.p',
    '..pppp..',
    '..p..p..',
    '..p..p..',
    '.pp..pp.',
    '.mm..mm.',
  ],
]
/** Runs in a record, and the record's size in the bank: a count and up to five runs of three bytes. */
export const MAX_RUNS = 5
export const RECORD = 16

/** The runs of column `u` of sprite `kind` (0 or 1). */
export function columnRuns(kind: number, u: number): Run[] {
  const runs: Run[] = []
  let v = 0
  while (v < 16) {
    const ch = ART[kind][v][u]
    if (ch === '.') {
      v++
      continue
    }
    let to = v + 1
    while (to < 16 && ART[kind][to][u] === ch) to++
    runs.push({ from: v, to, colour: KEY[ch] })
    v = to
  }
  return runs
}

/** Where the art and the texture-column table sit in bank 1. */
export const ART_BASE = 0xa000
export const UTAB_BASE = 0xa100
export const Q_LEVELS = 26

/** Bank 1: the runs of each texture column (a 16-byte record: count, then from, to and the colour as a pair of pixels), then for every `q` the texture column of each of up to 64 sprite columns. */
export function artBankSource(): string {
  const lines = ['  .org $8000', '  .byte 0', `  .org $${ART_BASE.toString(16)}`]
  for (let kind = 0; kind < 2; kind++)
    for (let u = 0; u < 8; u++) {
      const runs = columnRuns(kind, u)
      if (runs.length > MAX_RUNS) throw new Error(`sprite ${kind} column ${u} has ${runs.length} runs`)
      const rec = [runs.length, ...runs.flatMap((r) => [r.from, r.to, r.colour | (r.colour << 4)])]
      while (rec.length < RECORD) rec.push(0)
      lines.push(`  .byte ${rec.join(',')}`)
    }
  lines.push(`  .org $${UTAB_BASE.toString(16)}`)
  for (let q = 0; q < Q_LEVELS; q++) {
    const row = Array.from({ length: 64 }, (_, n) => (q === 0 ? 0 : textureColumn(q, n)))
    for (let i = 0; i < 64; i += 16) lines.push(`  .byte ${row.slice(i, i + 16).join(',')}`)
  }
  return lines.join('\n')
}

/** An enemy as the picture needs it: its kind (1 patrol, 2 chaser), and what the projection made of it. */
export interface Drawn {
  kind: number
  seen: Seen
}

/**
 * Draw the sprites over the walls, far to near (ties: lower number first): `pixels` is the picture (160 wide, row by row) and `zq` the
 * `q` of the wall in each column.
 */
export function drawSprites(pixels: Uint8Array, zq: number[], sprites: Drawn[]): void {
  const w = screenWidth(160)
  const order = sprites.map((_, i) => i).sort((i, j) => sprites[i].seen.q - sprites[j].seen.q || i - j)
  for (const i of order) {
    const { kind, seen } = sprites[i]
    const q = seen.q
    for (let n = 0; n < seen.width; n++) {
      const x = seen.left + n
      if (x < 0) continue
      if (x > 159) break
      if (q <= zq[x]) continue
      for (const r of columnRuns(kind - 1, textureColumn(q, n))) {
        const y0 = texelRow(q, r.from)
        const y1 = texelRow(q, r.to)
        for (let y = y0; y < y1 && y < SCREEN_H; y++) pixels[y * w + x] = r.colour
      }
    }
  }
}
