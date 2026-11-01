import { describe, expect, it } from 'vitest'
import { romGlyph } from './lcdfont'
import { lcdCode, lcdCursorAt, lcdExec, lcdInit, lcdReadBus, lcdReadDone, lcdText, lcdTick, lcdWriteBus, type BusyTime, type LcdState } from './testdata/oracle/hd44780'

const none: BusyTime = 'none'
const ins = (st: LcdState, byte: number, time: BusyTime = none) => lcdExec(st, 0, byte, time)
const put = (st: LcdState, text: string, time: BusyTime = none) => {
  for (const ch of text) lcdExec(st, 1, ch.charCodeAt(0), time)
}
/** Ben Eater's start-up: function set, display on, entry mode, clear. */
const start = (time: BusyTime = none) => {
  const st = lcdInit()
  ins(st, 0x38, time)
  ins(st, 0x0e, time)
  ins(st, 0x06, time)
  ins(st, 0x01, time)
  return st
}

describe('the character ROM', () => {
  it('has every ASCII character, drawn in 5 dots with the eighth row left for the cursor, the ROM’s yen and arrows, and a box above 0x7F', () => {
    for (let code = 0x20; code < 0x80; code++) {
      const g = romGlyph(code)
      expect(g, String(code)).toHaveLength(7)
      expect(g.every((r) => r >= 0 && r < 32), String(code)).toBe(true)
      if (code > 0x20) expect(g.some((r) => r), String(code)).toBe(true) // every character but the space has a dot
    }
    expect(romGlyph(0x20).every((r) => r === 0)).toBe(true)
    expect(romGlyph(0x41)).toEqual([0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11]) // A
    expect(romGlyph(0x5c)).not.toEqual(romGlyph(0x2f)) // the yen, not a slash
    expect(romGlyph(0xa5)).toEqual([0x1f, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1f])
    const distinct = new Set(Array.from({ length: 0x5f }, (_, i) => romGlyph(0x20 + i).join()))
    expect(distinct.size).toBe(0x5f) // no two characters look the same
  })
})

describe('the instructions', () => {
  it('starts with the display off, 8 bits, one line, and nothing on it', () => {
    const st = lcdInit()
    expect([st.display, st.dl8, st.twoLine, st.up, st.ac]).toEqual([false, true, false, true, 0])
    expect(lcdText(st)).toEqual([' '.repeat(16), ' '.repeat(16)])
  })

  it('sets the modes: function set, display on with cursor and blink, entry mode', () => {
    const st = start()
    expect([st.twoLine, st.display, st.cursor, st.blink, st.up, st.entryShift]).toEqual([true, true, true, false, true, false])
    ins(st, 0x0f)
    expect(st.blink).toBe(true)
    ins(st, 0x04)
    expect([st.up, st.entryShift]).toEqual([false, false])
    ins(st, 0x07)
    expect([st.up, st.entryShift]).toEqual([true, true])
  })

  it('writes characters at the address counter and moves it; DDRAM address 40 is the second line', () => {
    const st = start()
    put(st, 'Hello')
    expect(st.ac).toBe(5)
    ins(st, 0xc0)
    put(st, 'World')
    expect(lcdText(st)).toEqual(['Hello           ', 'World           '])
    expect(lcdCursorAt(st)).toEqual({ row: 1, col: 5 })
  })

  it('clear blanks the display and goes home; home keeps what is written', () => {
    const st = start()
    put(st, 'Hi')
    ins(st, 0x02)
    expect([st.ac, lcdText(st)[0]]).toEqual([0, 'Hi              '])
    ins(st, 0x01)
    expect(lcdText(st)[0]).toBe(' '.repeat(16))
    expect(st.ac).toBe(0)
  })

  it('counts down with entry mode decrement', () => {
    const st = start()
    ins(st, 0x04)
    ins(st, 0x8f)
    put(st, 'ab')
    expect([st.ddram[15], st.ddram[14], st.ac]).toEqual([0x61, 0x62, 13])
  })

  it('shifts the display (instructions and the entry mode) and the cursor', () => {
    const st = start()
    put(st, 'ABCDEFGHIJKLMNOPQRST') // 20 characters: the window shows the first 16
    expect(lcdText(st)[0]).toBe('ABCDEFGHIJKLMNOP')
    ins(st, 0x18) // display left
    expect(lcdText(st)[0]).toBe('BCDEFGHIJKLMNOPQ')
    ins(st, 0x1c) // display right
    ins(st, 0x1c)
    expect(lcdText(st)[0]).toBe(' ABCDEFGHIJKLMNO') // one place right of where it began: the last place of the 40 (blank) comes round on the left
    ins(st, 0x01)
    ins(st, 0x07) // entry shift
    put(st, 'AB')
    expect(st.shift).toBe(2)
    ins(st, 0x01)
    ins(st, 0x14) // cursor right
    expect(st.ac).toBe(1)
    ins(st, 0x10)
    expect(st.ac).toBe(0)
  })

  it('reads the character at the address counter, and the address counter moves after a read', () => {
    const st = start()
    put(st, 'XY')
    ins(st, 0x80)
    const a = lcdReadBus(st, 1)
    expect(a).toEqual({ value: 0x58, mask: 0xff })
    lcdReadDone(st, 1)
    expect(st.ac).toBe(1)
    expect(lcdReadBus(st, 1).value).toBe(0x59)
    lcdReadDone(st, 1)
    // The address counter itself, without a move.
    expect(lcdReadBus(st, 0).value).toBe(2)
    lcdReadDone(st, 0)
    expect(st.ac).toBe(2)
  })

  it('has eight custom characters in the CGRAM, written after a CGRAM address', () => {
    const st = start()
    ins(st, 0x40)
    for (const row of [0x04, 0x0e, 0x1f, 0x0e, 0x04, 0x00, 0x00, 0x00]) lcdExec(st, 1, row, none)
    expect(st.cgram.slice(0, 8)).toEqual([4, 14, 31, 14, 4, 0, 0, 0])
    expect(st.cg).toBe(true)
    ins(st, 0x80)
    lcdExec(st, 1, 0, none) // character 0: the custom one
    expect(st.cg).toBe(false)
    expect(lcdCode(st, 0, 0)).toBe(0)
    expect(lcdCursorAt(st)).toEqual({ row: 0, col: 1 })
  })
})

describe('the busy flag', () => {
  it('is set after an instruction for a time that depends on it, counted in clock cycles, and it is read with the address', () => {
    const st = start('real')
    st.busy = 0
    ins(st, 0x01, 'real')
    expect(lcdReadBus(st, 0).value).toBe(0x80) // busy, address 0
    lcdReadDone(st, 0)
    for (let i = 0; i < 1519; i++) lcdTick(st)
    expect(lcdReadBus(st, 0).value & 0x80).toBe(0x80)
    lcdTick(st)
    expect(lcdReadBus(st, 0).value & 0x80).toBe(0)
    put(st, 'A', 'real')
    expect(st.busy).toBe(37)
    expect(lcdReadBus(st, 0).value).toBe(0x81) // busy, address 1
  })

  it('ignores what is written while it is busy, and says so', () => {
    const st = lcdInit()
    ins(st, 0x38, 'real')
    ins(st, 0x0e, 'real') // too soon
    expect([st.display, st.dropped]).toEqual([false, 1])
    expect(st.last).toMatch(/ignored/)
    for (let i = 0; i < 37; i++) lcdTick(st)
    ins(st, 0x0e, 'real')
    expect(st.display).toBe(true)
  })

  it('is never busy with the busy time set to none', () => {
    const st = lcdInit()
    ins(st, 0x01, 'none')
    expect(st.busy).toBe(0)
  })
})

describe('the 4-bit interface', () => {
  it('is entered with a function set that has DL = 0 sent as one nibble, then takes every byte as two, the high half first', () => {
    const st = lcdInit()
    lcdWriteBus(st, 0, 0x20, none) // 0010: switch to 4 bits
    expect(st.dl8).toBe(false)
    lcdWriteBus(st, 0, 0x20, none) // 0x28: 4-bit, two lines
    lcdWriteBus(st, 0, 0x80, none)
    expect([st.dl8, st.twoLine]).toEqual([false, true])
    for (const [hi, lo] of [[0, 0xc], [0, 6], [0, 1]]) {
      lcdWriteBus(st, 0, hi << 4, none)
      lcdWriteBus(st, 0, lo << 4, none)
    }
    expect([st.display, st.cursor, st.up]).toEqual([true, false, true])
    lcdWriteBus(st, 1, 0x40, none) // 'A' = 0x41
    expect(st.ddram[0]).toBe(0x20) // only half of it so far
    lcdWriteBus(st, 1, 0x10, none)
    expect(st.ddram[0]).toBe(0x41)
  })

  it('reads in halves too: the high nibble first on D7–D4, and a data read moves the address after both', () => {
    const st = start()
    put(st, 'Q')
    ins(st, 0x20) // 4-bit
    ins(st, 0x80)
    expect(st.dl8).toBe(false)
    expect(lcdReadBus(st, 1)).toEqual({ value: 0x50, mask: 0xf0 }) // 'Q' = 0x51
    lcdReadDone(st, 1)
    expect(st.ac).toBe(0)
    expect(lcdReadBus(st, 1)).toEqual({ value: 0x10, mask: 0xf0 })
    lcdReadDone(st, 1)
    expect(st.ac).toBe(1)
  })
})

describe('where the cursor is', () => {
  it('is in the window only when the address counter is on a visible character', () => {
    const st = start()
    ins(st, 0x80 + 20)
    expect(lcdCursorAt(st)).toBeNull() // off the right edge of the 16 columns
    ins(st, 0x80 + 0x27)
    expect(lcdCursorAt(st)).toBeNull()
    ins(st, 0x18) // shifted left by one
    ins(st, 0x80)
    expect(lcdCursorAt(st)).toBeNull() // the first character has gone off the left
    ins(st, 0x1c)
    ins(st, 0x1c) // and now one place to the right of where it began: the last of the 40 places comes round on the left
    ins(st, 0x80 + 0x27)
    expect(lcdCursorAt(st)).toEqual({ row: 0, col: 0 })
  })

  it('in one-line mode the display is the first 16 of 80 places, and the second line is blank', () => {
    const st = lcdInit()
    ins(st, 0x30)
    ins(st, 0x0c)
    put(st, 'one line')
    expect(lcdText(st)).toEqual(['one line        ', ' '.repeat(16)])
  })
})
