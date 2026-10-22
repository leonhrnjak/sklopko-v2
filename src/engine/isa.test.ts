import { describe, expect, it } from 'vitest'
import { SK8, SK82, assemble, disassemble, getIsa, parseNumber, toHexWords } from './isa'

const asm = (source: string, capacity = 16) => assemble(SK8, source, capacity)
const hex = (source: string, capacity = 16) => toHexWords(asm(source, capacity).words, SK8.bits)

describe('numbers', () => {
  it('reads decimal, hex, binary and negative numbers', () => {
    expect(parseNumber('42')).toBe(42)
    expect(parseNumber('0x2A')).toBe(42)
    expect(parseNumber('0X2a')).toBe(42)
    expect(parseNumber('$2A')).toBe(42)
    expect(parseNumber('0b101010')).toBe(42)
    expect(parseNumber('-5')).toBe(-5)
    expect(parseNumber('-0x10')).toBe(-16)
  })
  it('rejects anything else', () => {
    for (const t of ['', 'abc', '1.5', '0x', '$', '0b2', '12ab', '--1', 'loop']) expect(parseNumber(t), t).toBeNull()
  })
})

describe('assembler: the instruction set', () => {
  it('encodes every instruction in its fields: immediate | opcode | address', () => {
    const r = asm('LDI 200\nLDA 3\nSTA 15\nJMP 7\nADD 1\nSUB 2\nJNC 9\nHALT')
    expect(r.errors).toEqual([])
    expect(r.words.slice(0, 8)).toEqual([0xc800, 0x0013, 0x002f, 0x0037, 0x0041, 0x0052, 0x0069, 0x0070])
  })

  it('pads the ROM with zeros', () => {
    const r = asm('HALT', 4)
    expect(r.words).toEqual([0x70, 0, 0, 0])
    expect(r.words).toHaveLength(4)
  })

  it('does not care about case, spacing or blank lines', () => {
    expect(hex('  ldi   5 \n\n\tSta\t1')).toBe(hex('LDI 5\nSTA 1'))
  })

  it('writes operands as decimal, hex, binary, constants or labels', () => {
    expect(hex('LDI 0xFF\nLDI $ff\nLDI 0b11111111\nLDI 255', 4)).toBe('FF00 FF00 FF00 FF00')
    expect(hex('OUT = 15\nTEN = 0xA\nSTA OUT\nLDA TEN', 2)).toBe('002F 001A')
  })

  it('takes a negative immediate as two\'s complement', () => {
    expect(hex('LDI -1\nLDI -128', 2)).toBe('FF00 8000')
  })
})

describe('assembler: .word', () => {
  const errors = (source: string) => asm(source).errors.map((e) => `${e.line}: ${e.message}`)
  it('puts a raw word in the ROM, at its own address', () => {
    const r = asm('LDI 1\n.word 0xBEEF\nTOP = 0x1234\n.WORD TOP\nHALT')
    expect(r.errors).toEqual([])
    expect(r.words.slice(0, 4)).toEqual([0x0100, 0xbeef, 0x1234, 0x70])
  })
  it('can be a label target, like any instruction', () => {
    expect(asm('JMP data\ndata: .word 7', 2).words).toEqual([0x30 + 1, 7])
  })
  it('reports a missing or too large value', () => {
    expect(errors('.word')).toEqual(['1: .word needs a value.'])
    expect(errors('.word 0x10000')).toEqual(["1: .word: the value 65536 doesn't fit in 16 bits."])
    expect(errors('.word -1')).toEqual(["1: .word: the value -1 doesn't fit in 16 bits."])
    expect(errors('.word nowhere')).toEqual(['1: Unknown name “nowhere”.'])
  })
})

describe('assembler: comments, constants and labels', () => {
  it('ignores ; and // comments', () => {
    const r = asm('; whole line\nLDI 1 ; after\n// also a comment\nHALT // done')
    expect(r.errors).toEqual([])
    expect(r.words.slice(0, 2)).toEqual([0x0100, 0x70])
  })

  it('resolves labels backwards and forwards, with or without an instruction on the label line', () => {
    const r = asm(['start: LDI 1', 'JMP end', 'mid:', 'ADD 0', 'JMP start', 'end:', 'HALT'].join('\n'))
    expect(r.errors).toEqual([])
    expect(r.symbols).toEqual({ start: 0, mid: 2, end: 4 })
    expect(r.words.slice(0, 5)).toEqual([0x0100, 0x34, 0x40, 0x30, 0x70])
  })

  it('a constant may be defined from another constant', () => {
    const r = asm('A = 7\nB = A\nSTA B', 2)
    expect(r.errors).toEqual([])
    expect(r.words[0]).toBe(0x27)
  })

  it('reports which source line each instruction came from', () => {
    const r = asm('; hi\n\nLDI 1\nloop:\nADD 0\n\nJNC loop')
    expect(r.lineOf).toEqual([3, 5, 7])
  })
})

describe('assembler: errors', () => {
  const errors = (source: string, capacity = 16) => asm(source, capacity).errors.map((e) => `${e.line}: ${e.message}`)

  it('reports an unknown instruction, with its line', () => {
    expect(errors('LDI 1\nFOO 2')).toEqual(['2: Unknown instruction “FOO”.'])
  })

  it('reports a missing, an unwanted and a surplus operand', () => {
    expect(errors('LDI')).toEqual(['1: LDI needs a value.'])
    expect(errors('STA')).toEqual(['1: STA needs an address.'])
    expect(errors('HALT 3')).toEqual(['1: HALT takes no operand.'])
    expect(errors('STA 1 2')).toEqual(['1: STA takes at most one operand, but there are 2.'])
  })

  it('reports out-of-range operands', () => {
    expect(errors('STA 16')).toEqual(['1: STA: the address 16 is out of range, it must be from 0 to 15.'])
    expect(errors('STA -1')).toEqual(['1: STA: the address -1 is out of range, it must be from 0 to 15.'])
    expect(errors('LDI 256')).toEqual(["1: LDI: the value 256 doesn't fit, it must be from -128 to 255."])
    expect(errors('LDI -129')).toEqual(["1: LDI: the value -129 doesn't fit, it must be from -128 to 255."])
  })

  it('reports unknown names and things that are not numbers', () => {
    expect(errors('JMP nowhere')).toEqual(['1: Unknown name “nowhere”.'])
    expect(errors('JMP 1x')).toEqual(['1: “1x” is not a number or a name.'])
    expect(errors('X = oops')).toEqual(['1: “oops” is not a number or a defined name.'])
  })

  it('reports duplicate and invalid names, and names that are instructions', () => {
    expect(errors('a: HALT\na: HALT')).toEqual(['2: “a” is already defined.'])
    expect(errors('A = 1\nA = 2')).toEqual(['2: “A” is already defined.'])
    expect(errors('1a: HALT')).toEqual(['1: “1a” is not a valid name (letters, digits and underscores, not starting with a digit).'])
    expect(errors('halt: HALT')).toEqual(['1: “halt” is an instruction name and can\'t be used as a label.'])
    expect(errors('LDI = 3')).toEqual(["1: “LDI” is an instruction name and can't be used as a constant."])
  })

  it('reports a program that is too long, once, at the first instruction that does not fit', () => {
    expect(errors('HALT\nHALT\nHALT', 2)).toEqual(['3: The program has more than 2 instructions, the size of the ROM.'])
    expect(errors('HALT\nHALT\nHALT\nHALT', 2)).toEqual(['3: The program has more than 2 instructions, the size of the ROM.'])
  })

  it('reports every error, in line order, and still assembles what is right', () => {
    const r = asm('FOO\nLDI 1\nSTA 99\nHALT')
    expect(r.errors.map((e) => e.line)).toEqual([1, 3])
    expect(r.words[0]).toBe(0x0100) // FOO is dropped, so LDI 1 is the first instruction
    expect(r.words[2]).toBe(0x70) // and HALT is still the third, after STA 99 (left as 0)
  })

  it('has no errors for an empty program', () => {
    expect(asm('').errors).toEqual([])
    expect(asm('; nothing here').words.every((w) => w === 0)).toBe(true)
  })
})

describe('disassembler', () => {
  it('turns words back into instructions', () => {
    expect([0xc800, 0x13, 0x2f, 0x37, 0x41, 0x52, 0x69, 0x70].map((w) => disassemble(SK8, w))).toEqual([
      'LDI 200', 'LDA 3', 'STA 15', 'JMP 7', 'ADD 1', 'SUB 2', 'JNC 9', 'HALT',
    ])
  })

  it('round-trips: assembling the disassembly gives the same word, for every possible instruction', () => {
    for (const [mnemonic, op] of Object.entries(SK8.ops)) {
      const args = op.arg === 'none' ? [0] : op.arg === 'addr' ? Array.from({ length: 16 }, (_, i) => i) : Array.from({ length: 256 }, (_, i) => i)
      for (const arg of args) {
        const word = SK8.encode(op, arg)
        const text = disassemble(SK8, word)
        expect(text).toBe(op.arg === 'none' ? mnemonic : `${mnemonic} ${arg}`)
        expect(asm(text, 1).words[0]).toBe(word)
      }
    }
  })

  it('.word can be assembled, so any word round-trips through the disassembly', () => {
    for (const w of [0x0000, 0x1234, 0x0080, 0x0072, 0xffff, 0x8000, 0x0001]) {
      const r = asm(disassemble(SK8, w), 1)
      expect(r.errors).toEqual([])
      expect(r.words[0], w.toString(16)).toBe(w)
    }
  })

  it('shows a word that is not exactly an instruction as data', () => {
    expect(disassemble(SK8, 0x0000)).toBe('LDI 0')
    expect(disassemble(SK8, 0x1234)).toBe('.word 0x1234') // opcode 3 (JMP) but with an immediate byte set
    expect(disassemble(SK8, 0x0080)).toBe('.word 0x0080') // opcode bits 4–6 = 0 but bit 7 set
    expect(disassemble(SK8, 0x0072)).toBe('.word 0x0072') // HALT with an address
  })
})

describe('instruction set registry', () => {
  it('finds sk8 by id', () => {
    expect(getIsa('sk8')).toBe(SK8)
    expect(getIsa('nope')).toBeUndefined()
  })
  it('hex words are zero-padded to the word width', () => {
    expect(toHexWords([1, 0xabc, 0xffff], 16)).toBe('0001 0ABC FFFF')
    expect(toHexWords([1, 0xab], 8)).toBe('01 AB')
  })
})

describe('the second instruction set (SK82)', () => {
  const asm2 = (source: string, capacity = 256) => assemble(SK82, source, capacity)

  it('is offered as a program type, and keeps the first set\'s opcodes', () => {
    expect(getIsa('sk82')).toBe(SK82)
    for (const [name, op] of Object.entries(SK8.ops)) expect(SK82.ops[name].code, name).toBe(op.code)
    expect(asm2('LDI 200\nLDA 3\nSTA 15\nJMP 7\nADD 1\nSUB 2\nJNC 9\nHALT').words.slice(0, 8)).toEqual(asm('LDI 200\nLDA 3\nSTA 15\nJMP 7\nADD 1\nSUB 2\nJNC 9\nHALT').words.slice(0, 8))
  })

  it('encodes the new instructions with a four-bit opcode', () => {
    const r = asm2('JZ 3\nADDI 5\nCMPI 0x80\nSHL\nSHR\nSUBI 1')
    expect(r.errors).toEqual([])
    expect(r.words.slice(0, 6)).toEqual([0x0083, 0x0590, 0x80a0, 0x00b0, 0x00c0, 0x01d0])
  })

  it('stores the upper bits of a jump target in bits 8-11, so programs can be 256 instructions long', () => {
    const r = asm2('JMP 31\nJZ 16\nJNC 15\nJMP 127\nJZ 64\nJMP 255')
    expect(r.errors).toEqual([])
    expect(r.words.slice(0, 6)).toEqual([0x013f, 0x0180, 0x006f, 0x073f, 0x0480, 0x0f3f])
    expect(asm2('JMP 256').errors[0].message).toBe('JMP: the jump target 256 is out of range, it must be from 0 to 255.')
    expect(asm2('LDA 16').errors[0].message).toBe('LDA: the address 16 is out of range, it must be from 0 to 15.')
    expect(asm2('JMP').errors[0].message).toBe('JMP needs a jump target.')
  })

  it('takes labels past address 15 as jump targets', () => {
    const lines = [...Array.from({ length: 100 }, () => 'SHL'), 'far: HALT', 'JMP far']
    const r = asm2(lines.join('\n'))
    expect(r.errors).toEqual([])
    expect(r.symbols.far).toBe(100)
    expect(disassemble(SK82, r.words[101])).toBe('JMP 100')
  })

  it('disassembles every instruction back to what was written', () => {
    const source = ['LDI 200', 'LDA 3', 'STA 15', 'JMP 100', 'ADD 1', 'SUB 2', 'JNC 9', 'HALT', 'JZ 17', 'ADDI 255', 'CMPI 58', 'SHL', 'SHR', 'SUBI 10']
    const r = asm2(source.join('\n'))
    expect(source.map((_, i) => disassemble(SK82, r.words[i]))).toEqual(source)
    expect(disassemble(SK82, 0x00e0)).toBe('.word 0x00E0') // unused opcode
    expect(disassemble(SK82, 0x1030)).toBe('.word 0x1030') // stray bits that no instruction uses
  })

  it('refuses a name that is an instruction of this set', () => {
    expect(asm2('SHL = 5').errors[0].message).toContain('instruction name')
  })
})
