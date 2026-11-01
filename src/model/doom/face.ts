/**
 * The face in the HUD (docs/plan-doom-like.md, D4c): a 16 × 12 picture at the bottom of the screen, between the health bar and the gun, that shows how
 * the player is: four faces by health, and a wince for a few ticks after a hit. Like the HUD it is written into the video memory right after each
 * column's wall, so the program keeps the art as bytes (two pixels each, the upper in the high nibble) in the fixed ROM, a column at a time.
 */

export const FACE_X = 55
export const FACE_W = 16
export const FACE_ROWS = 12
/** The first row of the face, and its bytes a column. */
export const FACE_Y = 100 - FACE_ROWS
export const FACE_BYTES = FACE_ROWS / 2
/** Ticks the wince lasts after a hit. */
export const HURT_TICKS = 20
export const FACE_FRAMES = 5
/** The frame that is the wince. */
export const FACE_OUCH = 4

const KEY: Record<string, number> = { '.': 9, s: 12, k: 0, w: 15, r: 6, h: 5, o: 13 }

const TOP = ['..hhhhhhhhhhhh..', '.hhhhhhhhhhhhhh.']
const BOTTOM = ['..ssssssssssss..', '...ssssssssss...', '....ssssssss....']

/** Rows 2 to 8 of each face: a stern, scowling man (heavy brows, narrowed eyes, a flat mouth), scratched, bloodier, nearly gone, and wincing. */
const MIDDLE: string[][] = [
  ['.hssssssssssssh.', '.sskksssssskkss.', '.skkkwsssswkkks.', '.sssssoooosssss.', '.ssosssssssssos.', '.ssssokkkkossss.', '.ssssssssssssss.'],
  ['.hsssrssssssshs.', '.sskksssssskkss.', '.skkkwsssswkkks.', '.sssssoooosssss.', '.ssosrsssssssos.', '.ssssokkkkossss.', '.ssssssssssssss.'],
  ['.hsrrssssssrssh.', '.sskksssssskkss.', '.skkkwsssswkkks.', '.sssssoooosssss.', '.srosssssssrsos.', '.ssssokkkkossss.', '.ssssrrrssssrss.'],
  ['.hrrrssrsssrrrh.', '.sskkrssssrkkss.', '.skkkwsssswkkks.', '.sssssoooosssss.', '.srossrsssrrsos.', '.ssssokkkkossss.', '.ssrrrssrrrrsss.'],
  ['.hssssssssssssh.', '.wkkkksssskkkkw.', '.wkwwksssskwwkw.', '.sssssoooosssss.', '.ssssskkkkkssss.', '.sssskkkkkkksss.', '.ssssskkkkkssss.'],
]

/** The art of each face: 12 rows of 16 characters. */
export const FACE_ART: string[][] = MIDDLE.map((m) => [...TOP, ...m, ...BOTTOM])

/** The colours of face `f`, row by row (16 per row). */
export const faceColours = (f: number): number[][] => FACE_ART[f].map((row) => Array.from(row, (ch) => KEY[ch]))

/** The face for a health and the ticks since a hit: the wince while those last, else by health. */
export function faceFrame(health: number, hurt: number): number {
  if (hurt) return FACE_OUCH
  return health >= 70 ? 0 : health >= 40 ? 1 : health >= 20 ? 2 : 3
}

/** The video bytes of face `f` a column at a time: FACE_BYTES for each of the 16 columns. */
export function faceBytes(f: number): number[] {
  const c = faceColours(f)
  const out: number[] = []
  for (let u = 0; u < FACE_W; u++) for (let k = 0; k < FACE_BYTES; k++) out.push((c[2 * k][u] << 4) | c[2 * k + 1][u])
  return out
}

/** Paint the face into a picture (160 wide, row by row). */
export function drawFace(pixels: Uint8Array, w: number, f: number): void {
  const c = faceColours(f)
  for (let r = 0; r < FACE_ROWS; r++) for (let u = 0; u < FACE_W; u++) pixels[(FACE_Y + r) * w + FACE_X + u] = c[r][u]
}
