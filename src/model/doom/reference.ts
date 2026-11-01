import { angleTables, COLUMN_BYTES, firstEdge, FLOOR, MAP, Q_FAR, Q_NEAR, RECIP, SCREEN_H, screenWidth, SHADE, SKY } from './tables'

/** Where the player is: a cell (0 to 15) and a fraction (0 to 255) on each axis, and an angle (0 to 255). */
export interface Pose {
  xCell: number
  xFrac: number
  yCell: number
  yFrac: number
  angle: number
}

/** What one ray found: the wall's height in steps of 4 pixels, its colour pair, and how many DDA steps it took. */
export interface Hit {
  q: number
  pair: number
  steps: number
}

/** Cast the ray of column `c` (of `columns`). The program does exactly these integer operations. */
export function castColumn(p: Pose, c: number, columns: number, map: number[] = MAP): Hit {
  const t = angleTables(columns)
  return cast(p, c, t, map)
}

function cast(p: Pose, c: number, t: ReturnType<typeof angleTables>, map: number[]): Hit {
  const dirX = (((t.r0x[p.angle] & 255) << 8) + c * t.stepX[p.angle]) & 0xffff
  const dirY = (((t.r0y[p.angle] & 255) << 8) + c * t.stepY[p.angle]) & 0xffff
  const axis = (dir: number, frac: number, cellStep: number) => {
    const h = (dir >> 8) & 255
    const neg = h >= 128
    const i = neg ? (256 - h) & 255 : h
    const fx = neg ? frac : 255 - frac
    const delta = RECIP[i]
    return { step: neg ? -cellStep : cellStep, delta, side: firstEdge(fx, i) }
  }
  const ax = axis(dirX, p.xFrac, 1)
  const ay = axis(dirY, p.yFrac, 16)
  let idx = p.yCell * 16 + p.xCell
  let sx = ax.side
  let sy = ay.side
  for (let steps = 1; steps < 1000; steps++) {
    let dist: number
    let side: number
    if (sx < sy) {
      sx = (sx + ax.delta) & 0xffff
      idx = (idx + ax.step) & 255
      dist = (sx - ax.delta) & 0xffff
      side = 0
    } else {
      sy = (sy + ay.delta) & 0xffff
      idx = (idx + ay.step) & 255
      dist = (sy - ay.delta) & 0xffff
      side = 1
    }
    if (map[idx]) {
      const q = dist >> 8 < 4 ? Q_NEAR[(dist >> 2) & 255] : Q_FAR[(dist >> 4) & 255]
      return { q, pair: SHADE[(map[idx] & 64) | (side << 5) | q], steps }
    }
  }
  throw new Error('the ray never hit a wall')
}

/** The picture, 160×100 colours row by row, from `columns` rays (80 rays: each is two pixels wide). */
export function render(p: Pose, columns: number, map: number[] = MAP): Uint8Array {
  const t = angleTables(columns)
  const sw = screenWidth(columns)
  const out = new Uint8Array(sw * SCREEN_H)
  const scale = sw / columns
  for (let c = 0; c < columns; c++) {
    const { q, pair } = cast(p, c, t, map)
    const top = 50 - 2 * q
    const bottom = 50 + 2 * q
    for (let k = 0; k < scale; k++)
      for (let y = 0; y < SCREEN_H; y++) out[y * sw + c * scale + k] = y < top ? SKY : y < bottom ? pair & 15 : FLOOR
  }
  return out
}

/** The framebuffer bytes of a picture `sw` wide: column by column, two pixels a byte. */
export function packColumns(pixels: Uint8Array, sw: number): Uint8Array {
  const fb = new Uint8Array(sw * COLUMN_BYTES)
  for (let x = 0; x < sw; x++)
    for (let y = 0; y < SCREEN_H; y += 2) fb[x * COLUMN_BYTES + (y >> 1)] = (pixels[y * sw + x] << 4) | pixels[(y + 1) * sw + x]
  return fb
}

export function unpackColumns(fb: Uint8Array, sw: number): Uint8Array {
  const out = new Uint8Array(sw * SCREEN_H)
  for (let x = 0; x < sw; x++)
    for (let y = 0; y < SCREEN_H; y += 2) {
      const b = fb[x * COLUMN_BYTES + (y >> 1)]
      out[y * sw + x] = b >> 4
      out[(y + 1) * sw + x] = b & 15
    }
  return out
}
