/**
 * The gun in the HUD (docs/plan-doom-like.md, D4c): a 16 × 16 weapon at the bottom middle of the view (columns 72 to 87, rows 80 to 95) with a fire
 * animation: a flash in the first ticks after a shot, then the recoil, then at rest. The art is transparent where the walls show through, so each
 * column is kept as the bytes from its first solid row down to the bottom (a byte is two pixels, so the first row is even and every row below the first is solid).
 */

export const GUN_X = 72
export const GUN_W = 16
export const GUN_ROWS = 16
export const GUN_Y = 96 - GUN_ROWS
export const GUN_FRAMES = 3
/** The frames: at rest, the flash just after a shot, the recoil after that. */
export const GUN_REST = 0
export const GUN_FLASH = 1
export const GUN_RECOIL = 2
/** `FIRECD` counts down from `FIRE_DELAY` (18) after a shot: the flash while it is at least this, the recoil while it is at least `RECOIL_FROM`. */
export const FLASH_FROM = 16
export const RECOIL_FROM = 10
/** One column's record in the ROM: the number of bytes, the first byte's row pair, and up to eight bytes. */
export const GUN_RECORD = 10

const KEY: Record<string, number> = { k: 0, a: 10, d: 9, h: 13, y: 12, o: 6, f: 15 }

const REST = [
  '................',
  '................',
  '................',
  '......kkkk......',
  '......kaak......',
  '......kaak......',
  '......kaak......',
  '......kaak......',
  '.....kaaaak.....',
  '.....kaddak.....',
  '....kkaddakk....',
  '...kyyyaayyyk...',
  '..kyyyyaayyyyk..',
  '..kyyyykkyyyyk..',
  '.kyyyyyddyyyyyk.',
  'kyyyyyyddyyyyyyk',
]
/** The top rows of the flash: over the barrel and a glow beside it. */
const FLASH_TOP = [
  '.......yy.......',
  '......yyyy......',
  '.....oyffyo.....',
  '....ooyffyoo....',
  '....oyyffyyo....',
  '.....oyyyyo.....',
]

/** Every solid pixel from the first one down, to the bottom: holes are filled with `fill`, and an odd first row starts a row higher. */
function solid(rows: string[], fill: string): string[] {
  const out = rows.map((r) => r.split(''))
  for (let u = 0; u < GUN_W; u++) {
    let first = out.findIndex((r) => r[u] !== '.')
    if (first < 0) continue
    if (first & 1) {
      out[first - 1][u] = out[first][u]
      first--
    }
    for (let r = first; r < GUN_ROWS; r++) if (out[r][u] === '.') out[r][u] = fill
  }
  return out.map((r) => r.join(''))
}

/** The art of the three frames. */
export const GUN_ART: string[][] = [
  solid(REST, 'k'),
  solid([...FLASH_TOP, ...REST.slice(FLASH_TOP.length)], 'o'),
  solid(['................', '................', ...REST.slice(0, GUN_ROWS - 2)], 'k'),
]

/** The gun frame for the ticks left of the gun's delay. */
export const gunFrame = (firecd: number) => (firecd >= FLASH_FROM ? GUN_FLASH : firecd >= RECOIL_FROM ? GUN_RECOIL : GUN_REST)

/** One column of a frame: the first byte (a row pair, 0 to 7) and the bytes, or none when the column is clear. */
export function gunColumn(f: number, u: number): { start: number; bytes: number[] } {
  const art = GUN_ART[f]
  const first = art.findIndex((r) => r[u] !== '.')
  if (first < 0) return { start: 0, bytes: [] }
  const bytes: number[] = []
  for (let r = first; r < GUN_ROWS; r += 2) bytes.push((KEY[art[r][u]] << 4) | KEY[art[r + 1][u]])
  return { start: first >> 1, bytes }
}

/** The records of a frame, 16 columns of `GUN_RECORD` bytes. */
export function gunBytes(f: number): number[] {
  const out: number[] = []
  for (let u = 0; u < GUN_W; u++) {
    const { start, bytes } = gunColumn(f, u)
    const rec = [bytes.length, start, ...bytes]
    while (rec.length < GUN_RECORD) rec.push(0)
    out.push(...rec)
  }
  return out
}

/** Paint the gun into a picture (160 wide, row by row). */
export function drawGun(pixels: Uint8Array, w: number, f: number): void {
  const art = GUN_ART[f]
  for (let r = 0; r < GUN_ROWS; r++) for (let u = 0; u < GUN_W; u++) if (art[r][u] !== '.') pixels[(GUN_Y + r) * w + GUN_X + u] = KEY[art[r][u]]
}
