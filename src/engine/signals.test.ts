import { describe, expect, it } from 'vitest'
import { describeWord, parseRows, parseSignals, signalParts, signalValue, splitPlan, valueName, withSignal } from './signals'

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
