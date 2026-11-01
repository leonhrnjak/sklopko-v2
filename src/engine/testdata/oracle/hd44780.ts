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

/** How long instructions keep the chip busy, in clock cycles of the board: the data sheet's times, taking the clock for 1 MHz. */
export type BusyTime = 'real' | 'short' | 'none'
const LONG: Record<BusyTime, number> = { real: 1520, short: 8, none: 0 }
const SHORT: Record<BusyTime, number> = { real: 37, short: 2, none: 0 }

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

const wrap = (st: LcdState, ac: number) => (st.cg ? ac & 0x3f : ac & 0x7f)

/** Move the address counter one place, up or down. */
function step(st: LcdState) {
  st.ac = wrap(st, st.ac + (st.up ? 1 : -1))
}

/** Run one instruction or data byte. `time` says how long the chip stays busy. */
export function lcdExec(st: LcdState, rs: number, d: number, time: BusyTime) {
  const byte = d & 0xff
  if (st.busy > 0) {
    st.dropped++
    st.last = `ignored ${rs ? 'data' : 'instruction'} ${byte.toString(16).toUpperCase().padStart(2, '0')}: the chip was busy`
    return
  }
  st.rev++
  if (rs) {
    st.last = `data ${byte.toString(16).toUpperCase().padStart(2, '0')}${byte >= 0x20 && byte < 0x7f ? ` (${String.fromCharCode(byte)})` : ''}`
    if (st.cg) st.cgram[st.ac & 0x3f] = byte
    else {
      st.ddram[st.ac & 0x7f] = byte
      if (st.entryShift) st.shift = (st.shift + (st.up ? 1 : -1) + 80) % 80
    }
    step(st)
    st.busy = SHORT[time]
    return
  }
  let long = false
  if (byte & 0x80) {
    st.cg = false
    st.ac = byte & 0x7f
    st.last = `DDRAM address ${st.ac.toString(16).toUpperCase().padStart(2, '0')}`
  } else if (byte & 0x40) {
    st.cg = true
    st.ac = byte & 0x3f
    st.last = `CGRAM address ${st.ac.toString(16).toUpperCase().padStart(2, '0')}`
  } else if (byte & 0x20) {
    const dl8 = (byte & 0x10) !== 0
    if (st.dl8 && !dl8) {
      st.dl8 = false // the 8-bit interface was told to use four bits: only the high nibble counts this time
      st.last = 'function set: 4-bit interface'
    } else {
      st.dl8 = dl8
      st.twoLine = (byte & 0x08) !== 0
      st.last = `function set: ${dl8 ? '8' : '4'}-bit, ${st.twoLine ? '2 lines' : '1 line'}`
    }
  } else if (byte & 0x10) {
    const right = (byte & 0x04) !== 0
    if (byte & 0x08) st.shift = (st.shift + (right ? -1 : 1) + 80) % 80
    else st.ac = wrap(st, st.ac + (right ? 1 : -1))
    st.last = `shift ${byte & 0x08 ? 'display' : 'cursor'} ${right ? 'right' : 'left'}`
  } else if (byte & 0x08) {
    st.display = (byte & 4) !== 0
    st.cursor = (byte & 2) !== 0
    st.blink = (byte & 1) !== 0
    st.last = `display ${st.display ? 'on' : 'off'}, cursor ${st.cursor ? 'on' : 'off'}, blink ${st.blink ? 'on' : 'off'}`
  } else if (byte & 0x04) {
    st.up = (byte & 2) !== 0
    st.entryShift = (byte & 1) !== 0
    st.last = `entry mode: ${st.up ? 'increment' : 'decrement'}${st.entryShift ? ', shift display' : ''}`
  } else if (byte & 0x02) {
    st.cg = false
    st.ac = 0
    st.shift = 0
    st.last = 'return home'
    long = true
  } else if (byte & 0x01) {
    st.ddram.fill(0x20)
    st.cg = false
    st.ac = 0
    st.shift = 0
    st.up = true
    st.last = 'clear display'
    long = true
  } else st.last = 'no operation'
  st.busy = long ? LONG[time] : SHORT[time]
}

/**
 * A write cycle ends (E falls) with `d` on the data pins (the upper nibble D7–D4 is what counts in 4-bit mode). In 4-bit mode the byte comes as two
 * cycles, the high half first.
 */
export function lcdWriteBus(st: LcdState, rs: number, d: number, time: BusyTime) {
  if (st.dl8) return lcdExec(st, rs, d, time)
  if (st.nibble < 0) st.nibble = (d >> 4) & 15
  else {
    const byte = (st.nibble << 4) | ((d >> 4) & 15)
    st.nibble = -1
    lcdExec(st, rs, byte, time)
  }
}

/** The byte a read would give now: the busy flag and the address counter, or the character at the address counter. */
function readValue(st: LcdState, rs: number): number {
  if (!rs) return (st.busy > 0 ? 0x80 : 0) | (st.ac & 0x7f)
  return st.cg ? st.cgram[st.ac & 0x3f] : st.ddram[st.ac & 0x7f]
}

/**
 * A read cycle starts (E rises): the value to put on the data pins, and the mask of the pins that are driven (all eight, or D7–D4 in 4-bit
 * mode).
 */
export function lcdReadBus(st: LcdState, rs: number): { value: number; mask: number } {
  if (st.dl8) return { value: readValue(st, rs), mask: 0xff }
  if (st.readHalf === 0) st.readByte = readValue(st, rs)
  const half = st.readHalf === 0 ? st.readByte >> 4 : st.readByte & 15
  return { value: half << 4, mask: 0xf0 }
}

/** A read cycle ends (E falls): a data read moves the address counter (after the whole byte, in 4-bit mode). */
export function lcdReadDone(st: LcdState, rs: number) {
  if (!st.dl8) {
    st.readHalf ^= 1
    if (st.readHalf === 1) return
  }
  if (rs) {
    step(st)
    st.rev++
  }
}

/** One clock cycle of the board: the chip is busy a cycle less. */
export function lcdTick(st: LcdState) {
  if (st.busy > 0) st.busy--
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
