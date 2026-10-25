import { describe, expect, it } from 'vitest'
import io from '../../scripts/basic/io.s?raw'
import source from '../../scripts/basic/m6502.asm?raw'
import { buildBasic } from '../../scripts/basic/target'
import { BasicMachine } from './basic-harness'
import { BASIC_ENTRIES, BASIC_ERRORS } from './basic-reference'

const build = buildBasic(source, io)

/** Words in a table of the image: each ends in a byte with bit 7 set, and the table ends with a 0. */
function table(bytes: ArrayLike<number>, firstWord: string): string[] {
  const first = [...firstWord].map((c, i, a) => (i === a.length - 1 ? c.charCodeAt(0) | 0x80 : c.charCodeAt(0)))
  let at = -1
  for (let i = 0; i < bytes.length && at < 0; i++) if (first.every((v, k) => bytes[i + k] === v)) at = i
  const words: string[] = []
  let word = ''
  for (let i = at; at >= 0 && bytes[i] !== 0; i++) {
    word += String.fromCharCode(bytes[i] & 0x7f)
    if (bytes[i] & 0x80) {
      words.push(word)
      word = ''
    }
  }
  return words
}

describe('the BASIC reference', () => {
  it('lists every word of the keyword table in the image, and nothing else', () => {
    const inImage = table(build.rom, 'END')
    expect(inImage).toHaveLength(68)
    expect(BASIC_ENTRIES.map((e) => e.word).sort()).toEqual([...inImage].sort())
  })

  it('lists every error code of the image, in its order', () => {
    // The table is a run of two-letter codes (the second letter has bit 7 set) in front of ' ERROR'.
    const rom = Array.from(build.rom)
    const at = rom.findIndex((v, i) => v === 0x4e && rom[i + 1] === 0xc6 && rom[i + 2] === 0x53 && rom[i + 3] === 0xce)
    const codes: string[] = []
    for (let i = at; (rom[i + 1] & 0x80) !== 0 && codes.length < 40; i += 2) codes.push(String.fromCharCode(rom[i]) + String.fromCharCode(rom[i + 1] & 0x7f))
    expect(codes).toEqual(BASIC_ERRORS.map(([c]) => c))
  })

  it('shows what it says it shows: every example runs on the bare core', { timeout: 120_000 }, () => {
    const withExample = BASIC_ENTRIES.filter((e) => e.try)
    expect(withExample.length).toBeGreaterThan(30)
    const m = new BasicMachine(build.rom, build.symbols.INWAIT)
    m.settle()
    for (const e of withExample) expect(m.answer(e.try!), `${e.word}: ${e.try}`).toBe(e.shows)
  })

  it('has a one-line syntax and a sentence for every word', () => {
    for (const e of BASIC_ENTRIES) {
      expect(e.syntax.length, e.word).toBeGreaterThan(0)
      expect(e.text.endsWith('.'), e.word).toBe(true)
    }
  })
})
