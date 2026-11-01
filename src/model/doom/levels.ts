import { mapFromRows } from './tables'

/**
 * The five levels (docs/plan-doom-like.md, D4). All of them are the same floor plan, furnished and turned differently: a long corridor
 * (row 8 of the plan below) from the start at its west end to an exit switch `X` at the east end, between two halls that open onto it.
 * A level is the plan with a few doors (`D`) and walls changed, mirrored and turned by a number of quarter turns. The route from the
 * start to the exit is a straight line (so a held Up and X walks it, and the enemies in the corridor are in front of the gun), and the
 * halls are where the patrols walk.
 */
const PLAN = [
  '################',
  '#..............#',
  '#.####..######.#',
  '#.#..........#.#',
  '#.#..........#.#',
  '#.####..######.#',
  '#..............#',
  '####.######.####',
  '#..............X',
  '####.######.####',
  '#..............#',
  '#.####..######.#',
  '#.#..........#.#',
  '#.####..######.#',
  '#..............#',
  '################',
]

/** The two kinds of enemy: a patrol walks back and forth along the corridor, a chaser comes for the player when he is within ten cells. */
export const PATROL = 1
export const CHASE = 2

/** An enemy in the plan: its kind and the cell of the corridor (row 8) it stands in; a patrol walks along the corridor. */
type Spawn = [kind: number, cellX: number]

interface Spec {
  /** Cells to change in the plan: x, y and the character. */
  edits: [number, number, string][]
  mirror?: boolean
  turns: number
  enemies: Spawn[]
}

const SPECS: Spec[] = [
  { turns: 0, edits: [[6, 8, 'D']], enemies: [[PATROL, 10]] },
  { turns: 1, edits: [[4, 8, 'D'], [10, 8, 'D'], [11, 7, '#']], enemies: [[PATROL, 7], [CHASE, 12]] },
  { turns: 2, edits: [[8, 8, 'D'], [4, 9, '#'], [11, 7, '#']], enemies: [[PATROL, 5], [CHASE, 11], [CHASE, 13]] },
  { turns: 3, edits: [[5, 8, 'D'], [11, 8, 'D']], enemies: [[PATROL, 8], [CHASE, 9], [PATROL, 13]] },
  { turns: 0, mirror: true, edits: [[4, 8, 'D'], [9, 8, 'D'], [12, 8, 'D']], enemies: [[PATROL, 6], [CHASE, 7], [CHASE, 10], [PATROL, 13], [CHASE, 14]] },
]

/** The most enemies a level has, and the bytes of each in the bank (kind, x, y, aux). x and y count 1/16 cells. */
export const MAX_ENEMIES = 5
export interface EnemySpawn {
  kind: number
  x: number
  y: number
  /** Bit 0: walking the other way; bit 1: along y (a patrol). */
  aux: number
}

/** Where a point of the plan ends up: `x` and `y` are in any unit where the plan is `size` wide (16 for cells, 256 for 1/16 cells). */
export function place(spec: { mirror?: boolean; turns: number }, x: number, y: number, size = 16): [number, number] {
  if (spec.mirror) y = size - 1 - y
  for (let t = 0; t < spec.turns; t++) [x, y] = [size - 1 - y, x]
  return [x, y]
}

export interface Level {
  rows: string[]
  map: number[]
  start: { xCell: number; yCell: number; angle: number }
  enemies: EnemySpawn[]
}

export const LEVELS: Level[] = SPECS.map((spec) => {
  const grid = PLAN.map((r) => [...r])
  for (const [x, y, ch] of spec.edits) grid[y][x] = ch
  const out = Array.from({ length: 16 }, () => Array<string>(16).fill('#'))
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const [nx, ny] = place(spec, x, y)
      out[ny][nx] = grid[y][x]
    }
  const rows = out.map((r) => r.join(''))
  const [xCell, yCell] = place(spec, 1, 8)
  const enemies = spec.enemies.map(([kind, cx]) => {
    const [x, y] = place(spec, cx * 16 + 8, 8 * 16 + 8, 256)
    return { kind, x, y, aux: spec.turns & 1 ? 2 : 0 }
  })
  return { rows, map: mapFromRows(rows), start: { xCell, yCell, angle: (spec.turns * 64) & 255 }, enemies }
})

export const LEVEL_COUNT = LEVELS.length
