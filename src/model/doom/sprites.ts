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

/** The frames of each enemy: standing, two walking, two attacking (the strike and the recovery), two of falling and the corpse. */
export const FRAME_STAND = 0
export const FRAME_WALK_A = 1
export const FRAME_WALK_B = 2
export const FRAME_STRIKE = 3
export const FRAME_RECOVER = 4
export const FRAME_DIE_A = 5
export const FRAME_DIE_B = 6
export const FRAME_CORPSE = 7
export const FRAMES = 8

/** A picture with some rows replaced (`patch` maps a row number to its eight characters). */
const patched = (base: string[], patch: Record<number, string>) => base.map((row, i) => patch[i] ?? row)
/** A picture moved down, the rows at the top clear and the rows at the bottom gone. */
const lowered = (base: string[], n: number) => [...Array<string>(n).fill('........'), ...base.slice(0, base.length - n)]
/** A picture of the bottom rows only (a figure on the ground): the rows from `first` are `rows`, the rest clear. */
const onGround = (first: number, rows: string[]) => [...Array<string>(first).fill('........'), ...rows]

/** The frames of a standing figure `base`: the legs are rows 12 to 15, the arms the rows 2 to 9. */
function figure(base: string[], p: { walkA: string[]; walkB: string[]; strike: Record<number, string>; recover: Record<number, string>; dieB: string[]; corpse: string[] }): string[][] {
  const legsA = Object.fromEntries(p.walkA.map((r, i) => [12 + i, r]))
  return [
    base,
    patched(base, legsA),
    patched(base, Object.fromEntries(p.walkB.map((r, i) => [12 + i, r]))),
    patched(base, { ...legsA, ...p.strike }),
    patched(base, p.recover),
    lowered(base, 2),
    onGround(16 - p.dieB.length, p.dieB),
    onGround(16 - p.corpse.length, p.corpse),
  ]
}

const ART: string[][][] = [
  // Patrol: a guard with a brown helmet and a red coat.
  figure(
    ['..hhhh..', '.hhhhhh.', '.ssssss.', '.ssssss.', '..ssss..', '.rrrrrr.', 'rrrrrrrr', 'rrrrrrrr', 'rrrrrrrr', 'rrrrrrrr', '.rrrrrr.', '..gggg..', '..gg.gg.', '..gg.gg.', '..gg.gg.', '.kkk.kkk'],
    {
      walkA: ['.gg..gg.', 'gg....gg', 'gg....gg', 'kk....kk'],
      walkB: ['..gggg..', '..gggg..', '..g..g..', '.kk..kk.'],
      // Arms thrown up.
      strike: { 2: 'r.ssss.r', 3: 'r.ssss.r', 4: 'r.ssss.r', 5: 'rrrrrrrr', 6: 'rrrrrrrr', 7: '.rrrrrr.', 8: '.rrrrrr.', 9: '.rrrrrr.' },
      recover: { 4: 'r.ssss.r', 5: 'rrrrrrrr' },
      dieB: ['.hh.....', 'hssrrrgg', 'hssrrrgg', '.hrrrrgk', '..rrrr.k'],
      corpse: ['.hssrrgg', 'hssrrrgk'],
    },
  ),
  // Chaser: a horned creature, purple with magenta head and white eyes.
  figure(
    ['.m....m.', '.mm..mm.', '..mmmm..', '.mmmmmm.', '.mwmmwm.', '.mmmmmm.', '..mmmm..', '.pppppp.', 'pppppppp', 'pppppppp', 'p.pppp.p', '..pppp..', '..p..p..', '..p..p..', '.pp..pp.', '.mm..mm.'],
    {
      walkA: ['.pp..pp.', 'pp....pp', 'pp....pp', 'mm....mm'],
      walkB: ['..pppp..', '..pppp..', '..p..p..', '.mm..mm.'],
      // Arms up, mouth open.
      strike: { 5: '.mmkkmm.', 6: 'p.mmmm.p', 7: 'pppppppp', 8: 'pppppppp', 9: 'p.pppp.p' },
      recover: { 5: '.mmkkmm.' },
      dieB: ['.mm.....', 'mmpppppp', 'mwpppppp', '.mpppp.p', '..pppp.p'],
      corpse: ['.mmpppp.', 'mmwpppp.'],
    },
  ),
]

/** The frame an enemy is drawn as: hit points, the cooldown (the attack's age, or the fall's), and its place (the legs move with it). */
export function enemyFrame(hp: number, cd: number, x: number, y: number): number {
  if (!hp) return cd >= 14 ? FRAME_DIE_A : cd >= 7 ? FRAME_DIE_B : FRAME_CORPSE
  if (cd >= 40) return FRAME_STRIKE
  if (cd >= 34) return FRAME_RECOVER
  return [FRAME_STAND, FRAME_WALK_A, FRAME_STAND, FRAME_WALK_B][(x + y) & 3]
}
/** `enemyFrame` as the table the program reads, by (x + y) & 3. */
export const WALK_FRAMES = [FRAME_STAND, FRAME_WALK_A, FRAME_STAND, FRAME_WALK_B]

/** Runs in a record, and the record's size in the bank: a count and up to five runs of three bytes. */
export const MAX_RUNS = 5
export const RECORD = 16

/** The runs of column `u` of frame `frame` of sprite `kind` (0 or 1). */
export function columnRuns(kind: number, u: number, frame = 0): Run[] {
  const runs: Run[] = []
  let v = 0
  while (v < 16) {
    const ch = ART[kind][frame][v][u]
    if (ch === '.') {
      v++
      continue
    }
    let to = v + 1
    while (to < 16 && ART[kind][frame][to][u] === ch) to++
    runs.push({ from: v, to, colour: KEY[ch] })
    v = to
  }
  return runs
}

/** Where the art and the texture-column table sit in bank 1. */
export const ART_BASE = 0xa000
export const UTAB_BASE = 0xa800
export const Q_LEVELS = 26

/** Bank 1: the runs of each texture column (a 16-byte record: count, then from, to and the colour as a pair of pixels), then for every `q` the texture column of each of up to 64 sprite columns. */
export function artBankSource(): string {
  const lines = ['  .org $8000', '  .byte 0', `  .org $${ART_BASE.toString(16)}`]
  for (let frame = 0; frame < FRAMES; frame++)
    for (let kind = 0; kind < 2; kind++)
      for (let u = 0; u < 8; u++) {
        const runs = columnRuns(kind, u, frame)
        if (runs.length > MAX_RUNS) throw new Error(`sprite ${kind} frame ${frame} column ${u} has ${runs.length} runs`)
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
  frame: number
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
    const { kind, frame, seen } = sprites[i]
    const q = seen.q
    for (let n = 0; n < seen.width; n++) {
      const x = seen.left + n
      if (x < 0) continue
      if (x > 159) break
      if (q <= zq[x]) continue
      for (const r of columnRuns(kind - 1, textureColumn(q, n), frame)) {
        const y0 = texelRow(q, r.from)
        const y1 = texelRow(q, r.to)
        for (let y = y0; y < y1 && y < SCREEN_H; y++) pixels[y * w + x] = r.colour
      }
    }
  }
}
