import { describe, expect, it } from 'vitest'
import {
  KEYBOARD_MAX,
  SCREEN_COLS,
  SCREEN_LINES,
  aciaBreak,
  aciaClock,
  aciaInit,
  aciaIrq,
  aciaKey,
  aciaPut,
  aciaRead,
  aciaReset,
  aciaType,
  aciaWrite,
  screenText,
} from './acia'

const DATA = 0
const STATUS = 1
const COMMAND = 2
const CONTROL = 3

/** A chip with the receiver switched on (command bit 0), the receive interrupt off (bit 1 set). */
const on = (command = 0x03) => {
  const st = aciaInit()
  aciaWrite(st, COMMAND, command)
  return st
}

describe('the 6551 registers', () => {
  it('has the transmitter always ready and nothing received at the start', () => {
    const st = on()
    expect(aciaRead(st, STATUS, false)).toBe(0x10)
  })

  it('shows the DSR pin in status bit 6', () => {
    const st = on()
    expect(aciaRead(st, STATUS, true)).toBe(0x50)
  })

  it('keeps typed characters waiting until the receiver is switched on', () => {
    const st = aciaInit()
    aciaType(st, 'a')
    aciaClock(st)
    expect(aciaRead(st, STATUS, false) & 8).toBe(0)
    aciaWrite(st, COMMAND, 0x01)
    aciaClock(st)
    expect(aciaRead(st, STATUS, false) & 8).toBe(8)
    expect(aciaRead(st, DATA, false)).toBe(0x41) // capitals are on by default
  })

  it('delivers the next character only after the last one was read', () => {
    const st = on()
    aciaType(st, 'ab')
    aciaClock(st)
    aciaClock(st)
    aciaClock(st)
    expect(aciaRead(st, DATA, false)).toBe(0x41)
    expect(aciaRead(st, STATUS, false) & 8).toBe(0) // reading the data register cleared "received"; the next arrives at the next clock
    aciaClock(st)
    expect(aciaRead(st, STATUS, false) & 8).toBe(8)
    expect(aciaRead(st, DATA, false)).toBe(0x42)
  })

  it('takes lower case as it is when capitals are off', () => {
    const st = on()
    aciaType(st, 'a', false)
    aciaClock(st)
    expect(aciaRead(st, DATA, false)).toBe(0x61)
  })

  it('raises the interrupt only when the receive interrupt is on, and drops it when the status is read', () => {
    const st = on(0x01)
    expect(aciaIrq(st)).toBe(false)
    aciaType(st, 'x')
    aciaClock(st)
    expect(aciaIrq(st)).toBe(true)
    expect(aciaRead(st, STATUS, false) & 0x80).toBe(0x80)
    expect(aciaIrq(st)).toBe(false)
    expect(aciaRead(st, STATUS, false) & 0x80).toBe(0)

    const quiet = on(0x03)
    aciaType(quiet, 'x')
    aciaClock(quiet)
    expect(aciaIrq(quiet)).toBe(false)
  })

  it('reads back the command and control registers', () => {
    const st = aciaInit()
    aciaWrite(st, COMMAND, 0x0b)
    aciaWrite(st, CONTROL, 0x1f)
    expect(aciaRead(st, COMMAND, false)).toBe(0x0b)
    expect(aciaRead(st, CONTROL, false)).toBe(0x1f)
  })

  it('clears command bits 0 to 4 by a write to the status register (programmed reset)', () => {
    const st = aciaInit()
    aciaWrite(st, COMMAND, 0xeb)
    aciaWrite(st, STATUS, 0)
    expect(aciaRead(st, COMMAND, false)).toBe(0xe0)
  })

  it('clears the registers on RES but keeps the screen and the keyboard buffer', () => {
    const st = on(0x01)
    aciaType(st, 'ab')
    aciaClock(st)
    aciaWrite(st, DATA, 0x48)
    aciaReset(st)
    expect(aciaRead(st, COMMAND, false)).toBe(0)
    expect(aciaRead(st, STATUS, false) & 0x88).toBe(0)
    expect(screenText(st)).toBe('H')
    aciaWrite(st, COMMAND, 0x01)
    aciaClock(st)
    expect(aciaRead(st, DATA, false)).toBe(0x42) // 'A' was already in the receive register and is gone; 'B' was still waiting
  })

  it('holds at most KEYBOARD_MAX characters', () => {
    const st = aciaInit()
    expect(aciaType(st, 'x'.repeat(KEYBOARD_MAX + 50))).toBe(KEYBOARD_MAX)
    expect(aciaType(st, 'y')).toBe(0)
    aciaKey(st, 3)
    expect(st.keys.length).toBe(KEYBOARD_MAX)
  })

  it('turns line breaks into CR, tabs into spaces and drops what is not ASCII', () => {
    const st = on()
    aciaType(st, 'a\r\nb\nc\tdé\u0001')
    const got: number[] = []
    for (let i = 0; i < 12; i++) {
      aciaClock(st)
      if (aciaRead(st, STATUS, false) & 8) got.push(aciaRead(st, DATA, false))
    }
    expect(String.fromCharCode(...got)).toBe('A\rB\rC D')
  })
})

describe('the break key', () => {
  it('jumps the queue and throws away what was waiting behind it', () => {
    const st = on()
    aciaType(st, 'abc')
    aciaClock(st) // 'A' is in the receive register, not yet read
    aciaBreak(st)
    expect(aciaRead(st, DATA, false)).toBe(0x41) // (the one that had arrived is still read first)
    aciaClock(st)
    expect(aciaRead(st, DATA, false)).toBe(3) // the break is next, not after 'B' and 'C'
    aciaClock(st)
    expect(aciaRead(st, STATUS, false) & 8).toBe(0) // nothing else was left
  })

  it('works when a long paste is waiting', () => {
    const st = on()
    aciaType(st, 'x'.repeat(KEYBOARD_MAX))
    aciaBreak(st)
    aciaClock(st)
    expect(aciaRead(st, DATA, false)).toBe(3)
    expect(st.keys.length - st.next).toBe(0)
  })
})

describe('the screen', () => {
  const print = (st: ReturnType<typeof aciaInit>, text: string) => {
    for (const ch of text) aciaPut(st, ch.charCodeAt(0))
  }

  it('prints text, goes to the start of the line on CR and to the next line on LF', () => {
    const st = aciaInit()
    print(st, 'HELLO\r\nWORLD')
    expect(screenText(st)).toBe('HELLO\nWORLD')
  })

  it('overwrites from the start of the line after a CR alone', () => {
    const st = aciaInit()
    print(st, 'HELLO\rJ')
    expect(screenText(st)).toBe('JELLO')
  })

  it('moves back and blanks on BS, and stops at the left edge', () => {
    const st = aciaInit()
    print(st, 'ABC\b\bX')
    expect(screenText(st)).toBe('AX')
    print(st, '\b\b\b\b')
    aciaPut(st, 8)
    expect(st.col).toBe(0)
  })

  it('goes back over a wrapped line with Backspace, so that the screen follows what BASIC deletes', () => {
    const st = aciaInit()
    print(st, '1234567890'.repeat(4) + 'A') // the 41st character wraps
    expect(st.lines).toEqual(['1234567890'.repeat(4), 'A'])
    print(st, '\b\b') // the first erases the A, the second goes back onto the line above and erases its last character
    expect(st.lines).toEqual(['1234567890'.repeat(3) + '123456789'])
    expect(st.col).toBe(SCREEN_COLS - 1)
    print(st, 'Z')
    expect(st.lines).toEqual(['1234567890'.repeat(3) + '123456789Z'])
  })

  it('does not go back over a line break, only over a wrap', () => {
    const st = aciaInit()
    print(st, 'x'.repeat(SCREEN_COLS) + '\r\n') // BASIC ends a full line itself
    print(st, '\b\b')
    expect(st.lines).toEqual(['x'.repeat(SCREEN_COLS), ''])
    const wrapped = aciaInit()
    print(wrapped, 'x'.repeat(SCREEN_COLS) + 'y\r\b') // wrapped, then a carriage return: back at column 0, on its own line
    expect(wrapped.lines).toEqual(['x'.repeat(SCREEN_COLS), 'y'])
  })

  it('clears on FF and counts BEL', () => {
    const st = aciaInit()
    print(st, 'abc\n')
    aciaPut(st, 7)
    aciaPut(st, 12)
    expect(screenText(st)).toBe('')
    expect(st.bells).toBe(1)
  })

  it('ignores other control codes', () => {
    const st = aciaInit()
    const rev = st.rev
    aciaPut(st, 1)
    aciaPut(st, 127)
    expect(st.rev).toBe(rev)
  })

  it('wraps when a character arrives at a full line, not when the line fills', () => {
    const st = aciaInit()
    print(st, 'x'.repeat(SCREEN_COLS))
    print(st, '\r\n')
    expect(st.lines).toEqual(['x'.repeat(SCREEN_COLS), ''])
    const wrapped = aciaInit()
    print(wrapped, 'x'.repeat(SCREEN_COLS) + 'y')
    expect(wrapped.lines).toEqual(['x'.repeat(SCREEN_COLS), 'y'])
  })

  it('keeps the last SCREEN_LINES lines', () => {
    const st = aciaInit()
    for (let i = 0; i < SCREEN_LINES + 30; i++) print(st, `${i}\r\n`)
    expect(st.lines).toHaveLength(SCREEN_LINES)
    expect(st.lines[st.lines.length - 2]).toBe(String(SCREEN_LINES + 29))
  })

  it('changes its lines in place and counts the changes, so a copy taken for a history stays what it was', () => {
    const st = aciaInit()
    print(st, 'ab')
    const lines = st.lines
    const rev = st.rev
    const copy = structuredClone(st) // (what the simulator's history does with a part's state)
    print(st, 'cd\r\nef')
    expect(st.lines).toBe(lines)
    expect(st.rev).toBeGreaterThan(rev)
    expect(copy.lines).toEqual(['ab'])
    expect(screenText(copy)).toBe('ab')
  })

  it('shows a character written to the data register', () => {
    const st = aciaInit()
    aciaWrite(st, DATA, 0xc1) // bit 7 is dropped
    expect(screenText(st)).toBe('A')
  })
})
