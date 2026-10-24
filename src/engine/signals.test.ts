import { describe, expect, it } from 'vitest'
import { assembleSignals, describeWord, parseRows, parseSignals, signalParts, signalValue, signalsToText, splitPlan, valueName, withSignal } from './signals'

const LAYOUT = `LOAD
SRC 2 = CONST ALU RAM if LOAD   ; where it loads from
WRITE
_ 2
COUNT 3
`

describe('parseSignals', () => {
  it('reads one signal per line, lowest bit first, with comments and skipped bits', () => {
    const { layout, errors } = parseSignals(LAYOUT)
    expect(errors).toEqual([])
    expect(layout.signals.map((s) => [s.name, s.from, s.width])).toEqual([
      ['LOAD', 0, 1],
      ['SRC', 1, 2],
      ['WRITE', 3, 1],
      ['COUNT', 6, 3],
    ])
    expect(layout.signals[1].values).toEqual(['CONST', 'ALU', 'RAM'])
    expect(layout.signals[1].when).toBe('LOAD')
    expect(layout.bits).toBe(9)
  })

  it('collects every error with its line, and leaves the bad lines out', () => {
    const { layout, errors } = parseSignals('A\n1B\nA\nX 0\nY 2 = P Q R S T\nZ 2 = P P\nW 1 = A B if NOPE\nT 2\nV 2 = K if T\nU = x = y')
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6, 7, 9, 10])
    expect(errors[0].message).toMatch(/not a valid name/)
    expect(errors[1].message).toMatch(/already defined/)
    expect(errors[2].message).toMatch(/not a width/)
    expect(errors[3].message).toMatch(/hold 4 values/)
    expect(errors[4].message).toMatch(/listed twice/)
    expect(errors[5].message).toMatch(/no signal NOPE/)
    expect(errors[6].message).toMatch(/one bit/)
    expect(errors[7].message).toMatch(/more than one/)
    expect(layout.signals.map((s) => s.name)).toEqual(['A', 'W', 'T', 'V'])
  })

  it('accepts an empty text and // comments', () => {
    expect(parseSignals('').layout).toEqual({ signals: [], bits: 0 })
    expect(parseSignals('// nothing\n\nGO // now').layout.signals.map((s) => s.name)).toEqual(['GO'])
  })
})

describe('parseRows', () => {
  it('reads an address and a name per line, in hex with or without 0x', () => {
    const { rows, errors } = parseRows('00 LDI\n1E ORI ; or\n0x1f NOP\n\n')
    expect(errors).toEqual([])
    expect(rows.names).toEqual({ 0: 'LDI', 30: 'ORI', 31: 'NOP' })
    expect(rows.addresses.ORI).toBe(30)
  })

  it('reports bad lines, double addresses and double names', () => {
    const { rows, errors } = parseRows('GG X\n01 A\n01 B\n02 A\n03\n04 5x')
    expect(errors.map((e) => e.line)).toEqual([1, 3, 4, 5, 6])
    expect(errors[0].message).toMatch(/hexadecimal/)
    expect(errors[1].message).toMatch(/named twice/)
    expect(errors[2].message).toMatch(/already the name/)
    expect(rows.names).toEqual({ 1: 'A' })
  })
})

describe('words', () => {
  const { layout } = parseSignals(LAYOUT)
  const [load, src, write, count] = layout.signals

  it('reads and sets a signal without touching the others', () => {
    const word = 0b101_00_1_10_1 // COUNT=5, bits 4–5 unused, WRITE, SRC=2, LOAD
    expect(signalValue(load, word)).toBe(1)
    expect(signalValue(src, word)).toBe(2)
    expect(signalValue(write, word)).toBe(1)
    expect(signalValue(count, word)).toBe(5)
    expect(withSignal(src, word, 1)).toBe(0b101_00_1_01_1)
    expect(withSignal(load, word, 0)).toBe(0b101_00_1_10_0)
    expect(withSignal(count, 0, 9)).toBe(0b001_00_0_00_0) // only the low 3 bits of a value fit
  })

  it('names the values of a field and falls back to the number', () => {
    expect(valueName(src, 1)).toBe('ALU')
    expect(valueName(src, 3)).toBe('3')
  })

  it('describes what a word switches on, lowest bit first', () => {
    expect(describeWord(layout, 0b00_00_1_01_1)).toBe('LOAD, SRC=ALU, WRITE')
    expect(describeWord(layout, 0b010_00_0_00_0)).toBe('COUNT=2')
    expect(describeWord(layout, 0)).toBe('')
  })

  it('shows a field with `if` while its signal is on, even at 0', () => {
    expect(describeWord(layout, 0b1)).toBe('LOAD, SRC=CONST')
    // ...and a field without its signal only when it is not 0 (a sign of a row that was edited by hand).
    expect(describeWord(layout, 0b100)).toBe('SRC=RAM')
  })

  it('shows set bits that no signal covers', () => {
    expect(signalParts(layout, 0b11_0000).map((p) => p.text)).toEqual(['bit 4', 'bit 5'])
    expect(describeWord(layout, 1 << 9)).toBe('bit 9')
  })
})

describe('splitPlan', () => {
  it('gives each signal an output and the uncovered bits outputs of their own', () => {
    const plan = splitPlan(parseSignals(LAYOUT).layout, 12)
    expect(plan.widths).toEqual([1, 2, 1, 2, 3, 3])
    expect(plan.output).toEqual({ LOAD: 0, SRC: 1, WRITE: 2, COUNT: 4 })
  })
})

describe('the text form', () => {
  const { layout } = parseSignals(LAYOUT)
  const { rows } = parseRows('00 GET\n01 PUT\n05 NOP')
  const asm = (text: string) => assembleSignals(layout, rows, text, 8, 9)

  it('assembles rows by name or address; rows left out are 0', () => {
    const r = asm('GET: LOAD SRC=ALU   ; comment\nPUT: WRITE, COUNT=5\n0x03: LOAD\n$6: bit8')
    expect(r.errors).toEqual([])
    expect(r.words).toEqual([0b11, 0b101_00_1_00_0, 0, 1, 0, 0, 0b100_000_000, 0])
  })

  it('writes a field as a name or a number, and a one-bit signal as itself or =0 / =1; names are not case sensitive', () => {
    expect(asm('GET: src=2 load=1').words[0]).toBe(0b101)
    expect(asm('GET: LOAD=0 SRC=ram').words[0]).toBe(0b100)
    expect(asm('GET: COUNT=0b101').words[0]).toBe(0b101_000_000)
  })

  it('reports every error with its line', () => {
    const r = asm('GET LOAD\nNOPE: LOAD\n0x40: LOAD\nGET: LOAD\nGET: LOAD\n0x04: BOGUS LOAD LOAD\n0x05: SRC\n0x06: SRC=9\n0x07: SRC=XYZ COUNT=3=4 bit12')
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 3, 5, 6, 6, 7, 8, 9, 9, 9])
    const say = r.errors.map((e) => e.message)
    expect(say[0]).toMatch(/Expected a row/)
    expect(say[1]).toMatch(/Unknown row “NOPE”/)
    expect(say[2]).toMatch(/only 8 words/)
    expect(say[3]).toMatch(/listed twice/)
    expect(say[4]).toMatch(/Unknown signal “BOGUS”/)
    expect(say[5]).toMatch(/LOAD is written twice/)
    expect(say[6]).toMatch(/SRC is a field and needs a value/)
    expect(say[7]).toMatch(/does not fit in 2 bits/)
    expect(say[8]).toMatch(/not a value of SRC \(CONST, ALU, RAM\)/)
    expect(say[9]).toMatch(/more than one “=”/)
    expect(say[10]).toMatch(/only 9 data bits/)
  })

  it('writes the words back as text: named rows and rows that are not 0, with the address for the rest', () => {
    const words = [0b101, 0b1000, 0, 0, 0, 0b010_000_000, 0b11_0000, 0b100_000_000]
    expect(signalsToText(layout, rows, words)).toBe(['GET:  LOAD SRC=RAM', 'PUT:  WRITE', 'NOP:  COUNT=2', '0x06: bit4 bit5', '0x07: COUNT=4'].join('\n'))
    expect(signalsToText(layout, rows, [0, 0, 0, 0, 0, 0, 0, 0])).toBe(['GET:', 'PUT:', 'NOP:'].join('\n'))
  })

  it('round trips every word of every row, including bits that no signal names', () => {
    for (let w = 0; w < 512; w++) {
      const words = [w, 0, 0, 0, 0, 0, 0, 0]
      const back = asm(signalsToText(layout, rows, words))
      expect(back.errors, `word ${w}`).toEqual([])
      expect(back.words, `word ${w}`).toEqual(words)
    }
  })
})
