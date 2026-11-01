/**
 * The numbers of the D0 spike raycaster (docs/plan-doom-like.md): the map, and the tables that both the TypeScript reference
 * (`reference.ts`) and the 65C02 program (`source.ts`) read, so that they cannot differ.
 *
 * Fixed point: a position is a cell number (0 to 15) and a fraction (0 to 255, 1/256 of a cell); an angle is 0 to 255 (a full turn);
 * a ray direction is a signed 16-bit number whose high byte counts 1/64 (so 64 is one cell per step); a distance is in 1/256 cells.
 */

/** Screen: 160×100 pixels of 4 bits, stored column by column (a column is 50 bytes, two pixels a byte, the upper one in the high nibble). */
export const SCREEN_W = 160
/** The picture is 160 wide for 160 or 80 rays (80: each ray two pixels wide), and as wide as the rays for any other count (120 rays: 120×100). */
export const screenWidth = (columns: number) => (columns === 80 ? 160 : columns)
export const SCREEN_H = 100
export const COLUMN_BYTES = SCREEN_H / 2
/** Colours: 0 black, 1 ceiling, 2 floor, 3 to 15 walls. */
export const SKY = 1
export const FLOOR = 2

/** The map, 16×16, a byte per cell, row by row: 0 is empty. */
export const MAP_ROWS = [
  '################',
  '#..............#',
  '#.####....####.#',
  '#.#..........#.#',
  '#.#..##..##..#.#',
  '#....#....#....#',
  '#....#....#....#',
  '#.#............#',
  '#.#............#',
  '#....#....#....#',
  '#....#....#....#',
  '#.#..##..##..#.#',
  '#.#..........#.#',
  '#.####....####.#',
  '#..............#',
  '################',
]
export const MAP: number[] = MAP_ROWS.flatMap((row) => [...row].map((ch) => (ch === '#' ? 1 : 0)))

/** The camera plane is 0.66 of the direction: 42 where the direction is 64. */
const DIR = 64
const PLANE = 42

const clampByte = (v: number) => v & 255

/** Square of the sum, a quarter: `a·b = sq(a+b) − sq(a−b)` (quarter-square multiplication). */
export const quarterSquare = (n: number) => Math.floor((n * n) / 4)

/** The reciprocal of a ray's direction (index 0 to 128: the high byte without its sign), as a 16-bit distance step: 1/|d| in 1/256 cells. */
export const RECIP: number[] = Array.from({ length: 129 }, (_, i) => (i === 0 ? 65535 : Math.min(65535, Math.round((256 * DIR) / i))))

const Q_MAX = 25
const toQ = (dist: number) => Math.max(1, Math.min(Q_MAX, Math.round((Q_MAX * 256) / dist)))
/** Wall height in steps of 4 pixels (1 to 25) for a distance below 1024 (index: distance / 4) … */
export const Q_NEAR: number[] = Array.from({ length: 256 }, (_, i) => toQ(4 * i + 2))
/** … and for a distance of 1024 and more (index: distance / 16). */
export const Q_FAR: number[] = Array.from({ length: 256 }, (_, i) => toQ(16 * i + 8))

/** The pair of pixels (both nibbles) of a wall column of height `q`, seen on the X side (side 0, brighter) or the Y side (side 1): index side·32 + q. */
export const SHADE: number[] = Array.from({ length: 64 }, (_, i) => {
  const q = i & 31
  if (q < 1 || q > Q_MAX) return 0
  const c = 3 + ((q - 1) >> 1)
  const shade = i < 32 ? c : Math.max(3, c - 2)
  return shade | (shade << 4)
})

/** The angle's tables, for `columns` rays across the screen: the start of the first ray (direction minus plane) and the step from ray to ray. */
export interface AngleTables {
  r0x: number[]
  r0y: number[]
  stepX: number[]
  stepY: number[]
}
export function angleTables(columns: number): AngleTables {
  const cos = (a: number) => Math.cos((2 * Math.PI * a) / 256)
  const sin = (a: number) => Math.sin((2 * Math.PI * a) / 256)
  const a256 = Array.from({ length: 256 }, (_, a) => a)
  return {
    r0x: a256.map((a) => Math.round(DIR * cos(a)) + Math.round(PLANE * sin(a))),
    r0y: a256.map((a) => Math.round(DIR * sin(a)) - Math.round(PLANE * cos(a))),
    stepX: a256.map((a) => Math.round((-2 * Math.round(PLANE * sin(a)) * 256) / columns)),
    stepY: a256.map((a) => Math.round((2 * Math.round(PLANE * cos(a)) * 256) / columns)),
  }
}

/** The tables as bytes, for the program. */
export const lo = (v: number) => clampByte(v)
export const hi = (v: number) => clampByte(v >> 8)
