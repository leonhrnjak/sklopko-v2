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
/** A wall cell's byte is 1, a door's is `DOOR` (bit 6 picks the door colours); an empty cell is 0. */
export const WALL = 1
export const DOOR = 64
export const mapFromRows = (rows: string[]): number[] => rows.flatMap((row) => [...row].map((ch) => (ch === '#' ? WALL : ch === 'D' ? DOOR : 0)))
export const MAP: number[] = mapFromRows(MAP_ROWS)

/** The map the game runs: the D0 map with a door (`D`) in the south corridor, two cells east of the start. */
export const GAME_MAP_ROWS = [
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
  '#..D...........#',
  '################',
]
export const GAME_MAP: number[] = mapFromRows(GAME_MAP_ROWS)
/** Where the player starts: cell, fraction, and the angle (0 faces east). */
export const START_POSE = { xCell: 1, xFrac: 128, yCell: 14, yFrac: 128, angle: 0 }

/** The camera plane is 0.66 of the direction: 42 where the direction is 64. */
const DIR = 64
const PLANE = 42

const clampByte = (v: number) => v & 255

/** Square of the sum, a quarter: `a·b = sq(a+b) − sq(a−b)` (quarter-square multiplication). */
export const quarterSquare = (n: number) => Math.floor((n * n) / 4)

/** The reciprocal of a ray's direction (index 0 to 128: the high byte without its sign), as a 16-bit distance step: 1/|d| in 1/256 cells. */
export const RECIP: number[] = Array.from({ length: 129 }, (_, i) => (i === 0 ? 65535 : Math.min(65535, Math.round((256 * DIR) / i))))

/**
 * The first edge's distance by logarithms: from the cell edge a ray hits first, the distance is `64·fx/i` (in 1/256 cells), where `fx` is the
 * 0 to 255 fraction of a cell still to cross and `i` the ray direction's high byte (1 to 128). With a table of logarithms in steps of
 * 1/`LOG_STEPS` of an octave, that is two lookups, one 16-bit add and one lookup in a table of exponentials, with no multiplication
 * (the error is under 1 percent). The program reads 16-bit entries, so the offsets into the exponential table are doubled; `EXP_BASE`
 * is where that table sits in the ROM.
 */
export const LOG_STEPS = 128
export const EXP_BASE = 0xe000
/** Logarithm of the fraction `fx` (1 to 255) in steps, and the logarithm of `128 / i` (i = 1 to 128, plus an octave for the offset). Index 0 is unused. */
export const LOG_FX: number[] = Array.from({ length: 256 }, (_, f) => (f === 0 ? 0 : Math.round(LOG_STEPS * Math.log2(f))))
export const LOG_I: number[] = Array.from({ length: 129 }, (_, i) => (i === 0 ? 0 : Math.round(LOG_STEPS * (7 - Math.log2(i)))))
/** The exponentials: entry `m` is `2^(m/LOG_STEPS - 1)`, up to 2^14. */
export const EXP: number[] = Array.from({ length: 15 * LOG_STEPS + 1 }, (_, m) => Math.min(65535, Math.round(2 ** (m / LOG_STEPS - 1))))
/** The distance to the first edge: what the program computes. 0 when the player is on the edge, the largest value when the ray runs along it. */
export const firstEdge = (fx: number, i: number): number => (fx === 0 ? 0 : i === 0 ? 65535 : EXP[LOG_FX[fx] + LOG_I[i]])

const Q_MAX = 25
const toQ = (dist: number) => Math.max(1, Math.min(Q_MAX, Math.round((Q_MAX * 256) / dist)))
/** Wall height in steps of 4 pixels (1 to 25) for a distance below 1024 (index: distance / 4) … */
export const Q_NEAR: number[] = Array.from({ length: 256 }, (_, i) => toQ(4 * i + 2))
/** … and for a distance of 1024 and more (index: distance / 16). */
export const Q_FAR: number[] = Array.from({ length: 256 }, (_, i) => toQ(16 * i + 8))

/**
 * The pair of pixels (both nibbles) of a wall column of height `q`, seen on the X side (side 0, brighter) or the Y side (side 1): index
 * side·32 + q. A door (index + 64) has its own colours: brown, orange, amber and yellow as it comes near.
 */
export const SHADE: number[] = Array.from({ length: 128 }, (_, i) => {
  const q = i & 31
  if (q < 1 || q > Q_MAX) return 0
  const side = (i >> 5) & 1
  let shade: number
  if (i < 64) {
    const c = 3 + ((q - 1) >> 1)
    shade = side === 0 ? c : Math.max(3, c - 2)
  } else {
    const ramp = [5, 6, 13, 12]
    const step = Math.min(3, Math.floor((q - 1) / 7))
    shade = ramp[side === 0 ? step : Math.max(0, step - 1)]
  }
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
