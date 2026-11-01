/**
 * The register model of an HD44780-style character LCD (16 × 2): the instruction set, the display memory (DDRAM), the eight custom
 * characters (CGRAM), the address counter, the busy flag, and the 4-bit interface. No pins and no simulator, so that the `hd44780` part and
 * the tests drive it the same way: `lcdWriteBus` at the falling edge of E for a write, `lcdReadBus` at its rising edge for a read and
 * `lcdReadDone` at its falling edge, `lcdTick` once per clock cycle for the busy flag.
 *
 * Instructions (RS = 0): 01 clear · 02 home · 04+ entry mode (I/D, S) · 08+ display (D, C, B) · 10+ shift (S/C, R/L) · 20+ function set (DL, N, F) ·
 * 40+ CGRAM address · 80+ DDRAM address. Data (RS = 1) goes to the DDRAM or, after a CGRAM address, the CGRAM.
 *
 * Not modelled: the 5 × 10 font, katakana in the character ROM, and the busy time of a data transfer being different for a read.
 */

export const LCD_COLS = 16
export const LCD_ROWS = 2

export interface LcdState {
  /** The display memory: 0x00–0x27 and 0x40–0x67 are the two lines (in a one-line display 0x00–0x4F); 128 places. */
  ddram: number[]
  cgram: number[]
  /** The address counter (7 bits), and whether it addresses the CGRAM (after a CGRAM address) or the DDRAM. */
  ac: number
  cg: boolean
  /** Entry mode: the address counter counts up (I/D = 1), and the display shifts as characters are written (S). */
  up: boolean
  entryShift: boolean
  display: boolean
  cursor: boolean
  blink: boolean
  /** How far the display window has been shifted left. */
  shift: number
  /** The interface is 8 bits (DL), and two lines (N). */
  dl8: boolean
  twoLine: boolean
  /** Cycles left before the chip takes another instruction, and what it ignored while busy. */
  busy: number
  dropped: number
  /** The first half of a byte sent in 4-bit mode (-1 for none), and the byte being read in 4-bit mode and which half is next. */
  nibble: number
  readByte: number
  readHalf: number
  /** What was written last, for the inspector: a short description. */
  last: string
  /** Counts the changes of what the display shows, so that a symbol is drawn again. */
  rev: number
}

export function lcdInit(): LcdState {
  return {
    ddram: new Array(128).fill(0x20),
    cgram: new Array(64).fill(0),
    ac: 0, cg: false,
    up: true, entryShift: false,
    display: false, cursor: false, blink: false,
    shift: 0,
    dl8: true, twoLine: false,
    busy: 0, dropped: 0,
    nibble: -1, readByte: 0, readHalf: 0,
    last: 'power on: display off',
    rev: 0,
  }
}

/** The code at column `col` of line `row` (0 or 1) of the display window. */
export function lcdCode(st: LcdState, row: number, col: number): number {
  if (!st.twoLine) return row === 0 ? st.ddram[(st.shift + col) % 80] : 0x20
  const base = row === 0 ? 0 : 0x40
  return st.ddram[base + ((st.shift + col) % 40)]
}

/** The place of the cursor in the window as {row, col}, or null when it is outside it (or the address counter is in the CGRAM). */
export function lcdCursorAt(st: LcdState): { row: number; col: number } | null {
  if (st.cg) return null
  let row = 0
  let a = st.ac
  let span = 80
  if (st.twoLine) {
    span = 40
    if (a >= 0x40) {
      row = 1
      a -= 0x40
    }
    if (a >= 40) return null
  } else if (a >= 80) return null
  const col = (((a - st.shift) % span) + span) % span
  return col < LCD_COLS ? { row, col } : null
}

/** What the display shows as text, two lines (a custom character is `?`; a code above 0x7F is `?` too, and 0x5C a yen sign `¥`). */
export function lcdText(st: LcdState): string[] {
  return [0, 1].map((row) => {
    let s = ''
    for (let c = 0; c < LCD_COLS; c++) {
      const code = lcdCode(st, row, c)
      s += code < 0x10 ? '?' : code === 0x5c ? '¥' : code === 0x7e ? '→' : code === 0x7f ? '←' : code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : '?'
    }
    return s
  })
}
