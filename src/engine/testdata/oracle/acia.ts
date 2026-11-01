/**
 * The register model of a 6551-style serial chip with a terminal at the other end of the wire: a screen and a keyboard. No pins, no
 * simulator, no DOM: the `acia6551` part (later) and the test harness for BASIC both drive these functions.
 *
 * Registers, picked by RS1 RS0:  0 data (read: the received character, write: send one to the screen), 1 status (write: programmed
 * reset), 2 command, 3 control. Status: bit 3 a character has arrived, bit 4 ready to send (always: a character takes no time),
 * bit 6 the level on the DSR pin, bit 7 interrupt.
 *
 * Not modelled: baud rate and its timing, parity, framing and overrun errors, the handshake lines, the transmit interrupt, echo mode.
 */

export const SCREEN_COLS = 40
export const SCREEN_ROWS = 24
/** Lines kept for scrolling back. */
export const SCREEN_LINES = 200
/** Typed or pasted characters that can wait to be read. */
export const KEYBOARD_MAX = 8000

export interface AciaState {
  command: number
  control: number
  /** The receive register, and whether it holds a character nobody has read (status bit 3). */
  rx: number
  full: boolean
  /** Status bit 7: a character arrived while the receive interrupt was on, and the status has not been read since. */
  interrupt: boolean
  /** Characters waiting to be delivered, and the position of the next one. */
  keys: string
  next: number
  /** The text on the screen, one string per line; the last is the cursor's. Changed in place; `rev` counts the changes. */
  lines: string[]
  /** The cursor's column. */
  col: number
  /** The cursor's line goes on from the one above because the terminal wrapped it (not because of a line feed): Backspace can go back up. */
  wrapped: boolean
  /** How many times BEL was sent (a view flashes when it changes). */
  bells: number
  /** Counts changes of the screen. */
  rev: number
}

export function aciaInit(): AciaState {
  return { command: 0, control: 0, rx: 0, full: false, interrupt: false, keys: '', next: 0, lines: [''], col: 0, wrapped: false, bells: 0, rev: 0 }
}

/** The receiver is on: command bit 0 (DTR). Until a program sets it, typed characters wait. */
export const receiverOn = (st: AciaState) => (st.command & 1) === 1
/** The receive interrupt is on: command bit 1 clear. */
export const interruptOn = (st: AciaState) => (st.command & 2) === 0

/** The level of the interrupt line (IRQ is low while this is true). */
export const aciaIrq = (st: AciaState) => st.interrupt

/** What RESB low does to the chip: the registers are cleared. (The part can also wipe the terminal: `aciaWipe`.) */
export function aciaReset(st: AciaState) {
  st.command = 0
  st.control = 0
  st.rx = 0
  st.full = false
  st.interrupt = false
}

/** The terminal's own reset: a blank screen, the cursor at the top, and nothing waiting on the keyboard. A no-op (no change counted) when it is so already. */
export function aciaWipe(st: AciaState) {
  st.keys = ''
  st.next = 0
  if (st.lines.length > 1 || st.lines[0] !== '' || st.col !== 0) aciaPut(st, 12)
}

/** Deliver the next waiting character if the receiver is on and the last one was read. Called at every clock. */
export function aciaClock(st: AciaState) {
  if (st.full || !receiverOn(st) || st.next >= st.keys.length) return
  st.rx = st.keys.charCodeAt(st.next++)
  st.full = true
  if (interruptOn(st)) st.interrupt = true
  if (st.next > 1024) {
    st.keys = st.keys.slice(st.next)
    st.next = 0
  }
}

export function aciaStatus(st: AciaState, dsr: boolean): number {
  return (st.full ? 8 : 0) | 16 | (dsr ? 64 : 0) | (st.interrupt ? 128 : 0)
}

/** A read of register `rs` (0–3), with its side effects: the data register clears *full*, the status register clears *interrupt*. */
export function aciaRead(st: AciaState, rs: number, dsr: boolean): number {
  switch (rs & 3) {
    case 0: {
      const v = st.rx
      st.full = false
      return v
    }
    case 1: {
      const v = aciaStatus(st, dsr)
      st.interrupt = false
      return v
    }
    case 2:
      return st.command
    default:
      return st.control
  }
}

export function aciaWrite(st: AciaState, rs: number, value: number) {
  switch (rs & 3) {
    case 0:
      aciaPut(st, value & 0x7f)
      break
    case 1: // programmed reset
      st.command &= 0xe0
      st.interrupt = false
      break
    case 2:
      st.command = value & 255
      break
    default:
      st.control = value & 255
  }
}

/** The part of `text` that `aciaType` would take (see there), without taking it. */
export function aciaAccepted(st: AciaState, text: string, capitals = true): string {
  let s = text.replace(/\r\n?|\n/g, '\r').replace(/\t/g, ' ').replace(/[^\r\x20-\x7e]/g, '')
  if (capitals) s = s.toUpperCase()
  const room = KEYBOARD_MAX - (st.keys.length - st.next)
  return s.slice(0, Math.max(0, room))
}

/**
 * Type or paste text: it goes into the keyboard buffer. Line breaks become CR, a tab a space, and anything outside ASCII 32–126 is
 * dropped. With `capitals` letters are sent as capitals (Microsoft BASIC knows its words only in capitals). Returns how many
 * characters were taken (the buffer holds `KEYBOARD_MAX`).
 */
export function aciaType(st: AciaState, text: string, capitals = true): number {
  const s = aciaAccepted(st, text, capitals)
  st.keys += s
  return s.length
}

/** A key that is not a character, such as Backspace ($08). It waits its turn behind what was typed before it. */
export function aciaKey(st: AciaState, code: number) {
  if (st.keys.length - st.next < KEYBOARD_MAX) st.keys += String.fromCharCode(code)
}

/**
 * Control+C, the break: it does not wait its turn. What was typed or pasted and not yet read is thrown away (it was meant for the
 * program that is being stopped) and the next character to arrive is the break.
 */
export function aciaBreak(st: AciaState) {
  st.keys = '\x03'
  st.next = 0
}

/**
 * Print one character code on the screen. 32–126 print; CR goes to column 0; LF to the next line; BS moves back one column and
 * blanks it; FF clears the screen; BEL counts. A line wraps when a character arrives at a full line, not when it fills, so a
 * program that prints exactly a line and then CR LF gets no blank line.
 */
export function aciaPut(st: AciaState, code: number) {
  const lines = st.lines
  const last = lines.length - 1
  if (code === 12) {
    lines.length = 0
    lines.push('')
    st.col = 0
    st.wrapped = false
  } else if (code === 13) {
    st.col = 0
    st.wrapped = false
  } else if (code === 10) {
    newLine(lines)
    st.wrapped = false
  } else if (code === 8) {
    if (st.col === 0) {
      // Back over the wrap: onto the last column of the line above, blanking its last character, and the line below is gone.
      if (!st.wrapped || last === 0 || lines[last].trim() !== '' || lines[last - 1].length < SCREEN_COLS) return
      lines.pop()
      lines[last - 1] = lines[last - 1].slice(0, SCREEN_COLS - 1)
      st.col = SCREEN_COLS - 1
      st.wrapped = false
    } else {
      st.col--
      lines[last] = put(lines[last], st.col, ' ')
    }
  } else if (code === 7) st.bells++
  else if (code >= 32 && code <= 126) {
    if (st.col >= SCREEN_COLS) {
      newLine(lines)
      st.col = 0
      st.wrapped = true
    }
    const at = lines.length - 1
    lines[at] = put(lines[at], st.col, String.fromCharCode(code))
    st.col++
  } else return
  st.rev++
}

function put(line: string, col: number, ch: string): string {
  return line.slice(0, col).padEnd(col, ' ') + ch + line.slice(col + 1)
}

/** A new, empty last line; the oldest is forgotten beyond `SCREEN_LINES`. */
function newLine(lines: string[]) {
  lines.push('')
  if (lines.length > SCREEN_LINES) lines.shift()
}

/** The text of the screen as plain lines (trailing spaces cut), for a reader or a test. */
export const screenText = (st: AciaState) => st.lines.map((l) => l.replace(/\s+$/, '')).join('\n')
