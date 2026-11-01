import { describe, expect, it } from 'vitest'
import { aciaBreak, aciaClock, aciaInit, aciaRead, aciaWrite } from '../engine/testdata/oracle/acia'
import { terminalInput, terminalKey, type KeyLike } from './terminal'

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods })

/** What the program would read, one character at a time, with the receiver on. */
function readAll(st: ReturnType<typeof aciaInit>) {
  aciaWrite(st, 2, 0x03)
  const got: number[] = []
  for (let i = 0; i < 40; i++) {
    aciaClock(st)
    if (aciaRead(st, 1, false) & 8) got.push(aciaRead(st, 0, false))
  }
  return got
}

describe('typing on the terminal', () => {
  it('sends Enter as CR, Backspace as BS and Delete as DEL, and takes those keys from the page', () => {
    const st = aciaInit()
    expect(terminalKey(st, key('Enter'))).toBe(true)
    expect(terminalKey(st, key('Backspace'))).toBe(true)
    expect(terminalKey(st, key('Delete'))).toBe(true)
    expect(readAll(st)).toEqual([13, 8, 127])
  })

  it('sends Escape and Control+C as the break, ahead of what was typed and not yet read', () => {
    const st = aciaInit()
    terminalInput(st, 'abc', 'insertText', true)
    expect(terminalKey(st, key('Escape'))).toBe(true)
    expect(readAll(st)).toEqual([3])
    terminalInput(st, 'abc', 'insertText', true)
    expect(terminalKey(st, key('c', { ctrlKey: true }))).toBe(true)
    expect(readAll(st)).toEqual([3])
  })

  it('leaves letters (they arrive as input events), Tab, paste and the other shortcuts to the browser', () => {
    const st = aciaInit()
    for (const k of [key('a'), key('Tab'), key('v', { ctrlKey: true }), key('v', { metaKey: true }), key('c', { metaKey: true }), key('Enter', { altKey: true })]) {
      expect(terminalKey(st, k)).toBe(false)
    }
    expect(readAll(st)).toEqual([])
  })

  it('turns typed text into capitals unless Capitals is off, and a deletion without a key event into Backspace', () => {
    const st = aciaInit()
    terminalInput(st, 'run', 'insertText', true)
    terminalInput(st, 'x', 'deleteContentBackward', true)
    expect(readAll(st)).toEqual([...'RUN'].map((c) => c.charCodeAt(0)).concat(8))
    const low = aciaInit()
    terminalInput(low, 'run', 'insertText', false)
    expect(readAll(low)).toEqual([...'run'].map((c) => c.charCodeAt(0)))
  })

  it('takes a paste with line breaks as Enter, tabs as spaces, and drops what is not ASCII', () => {
    const st = aciaInit()
    terminalInput(st, '10 PRINT "é"\r\n20 END\t', 'insertFromPaste', true)
    expect(String.fromCharCode(...readAll(st))).toBe('10 PRINT ""\r20 END ')
  })

  it('does not break what the break key was not asked to: a break with nothing waiting is just a break', () => {
    const st = aciaInit()
    aciaBreak(st)
    expect(readAll(st)).toEqual([3])
  })
})
