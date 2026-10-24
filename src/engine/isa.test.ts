import { describe, expect, it } from 'vitest'
import { ISAS, PORTS, SKASM, SKASM_ALIASES, SKASM_OPS, assemble, currentIsaId, disassemble, getIsa, parseNumber, toHexBytes, toHexWords, wordFields } from './isa'
import { ISA_CHOICES } from './isalist'

const asm = (source: string, capacity = 16) => assemble(SKASM, source, capacity)
const hex = (source: string, capacity = 16) => toHexWords(asm(source, capacity).words, SKASM.bits)

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
    expect(hex('SHOW = 15\nTEN = 0xA\nSTA SHOW\nLDA TEN', 2)).toBe('002F 001A')
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
    expect([0xc800, 0x13, 0x2f, 0x37, 0x41, 0x52, 0x69, 0x70].map((w) => disassemble(SKASM, w))).toEqual([
      'LDI 200', 'LDA 3', 'STA 15', 'JMP 7', 'ADD 1', 'SUB 2', 'JNC 9', 'HALT',
    ])
  })

  it('round-trips: assembling the disassembly gives the same word, for every possible instruction', () => {
    for (const [mnemonic, op] of Object.entries(SKASM.ops)) {
      const args = op.arg === 'none' ? [0] : op.arg === 'imm' || op.arg === 'target' ? Array.from({ length: 256 }, (_, i) => i) : Array.from({ length: 16 }, (_, i) => i)
      for (const arg of args) {
        const word = SKASM.encode(op, arg)
        const text = disassemble(SKASM, word)
        if (op.arg !== 'port') expect(text).toBe(op.arg === 'none' ? mnemonic : `${mnemonic} ${arg}`)
        expect(asm(text, 256).words[0], text).toBe(word)
        expect(SKASM.decode(word), text).toEqual({ mnemonic, arg })
      }
    }
  })

  it('.word can be assembled, so any word round-trips through the disassembly', () => {
    for (const w of [0x0000, 0x1234, 0x0080, 0x0072, 0xffff, 0x8000, 0x0001]) {
      const r = asm(disassemble(SKASM, w), 1)
      expect(r.errors).toEqual([])
      expect(r.words[0], w.toString(16)).toBe(w)
    }
  })

  it('shows a word that is not exactly an instruction as data', () => {
    expect(disassemble(SKASM, 0x0000)).toBe('LDI 0')
    expect(disassemble(SKASM, 0x1234)).toBe('.word 0x1234') // opcode 3 (JMP) but with stray bits in 12–15
    expect(disassemble(SKASM, 0x0072)).toBe('.word 0x0072') // HALT with an address
    expect(disassemble(SKASM, 0xf0f0)).toBe('.word 0xF0F0') // an extension opcode (15) with a sub-opcode nobody uses
    expect(disassemble(SKASM, 0x0eed)).toBe('.word 0x0EED') // EXT-I sub-opcode 13 is free
  })
})

describe('instruction set registry', () => {
  it('finds skasm by id, and understands the ids of the sets it replaced', () => {
    expect(getIsa('skasm')).toBe(SKASM)
    expect(getIsa('sk8')).toBe(SKASM)
    expect(getIsa('sk82')).toBe(SKASM)
    expect(currentIsaId('sk8')).toBe('skasm')
    expect(currentIsaId('none')).toBe('none')
    expect(getIsa('nope')).toBeUndefined()
  })
  it('hex words are zero-padded to the word width', () => {
    expect(toHexWords([1, 0xabc, 0xffff], 16)).toBe('0001 0ABC FFFF')
    expect(toHexWords([1, 0xab], 8)).toBe('01 AB')
  })
})

describe('the original instructions never change their encoding', () => {
  it('the eight of the first computer and the six added for the second', () => {
    const r = asm('LDI 200\nLDA 3\nSTA 15\nJMP 7\nADD 1\nSUB 2\nJNC 9\nHALT\nJZ 3\nADDI 5\nCMPI 0x80\nSHL\nSHR\nSUBI 1')
    expect(r.errors).toEqual([])
    expect(r.words.slice(0, 14)).toEqual([0xc800, 0x0013, 0x002f, 0x0037, 0x0041, 0x0052, 0x0069, 0x0070, 0x0083, 0x0590, 0x80a0, 0x00b0, 0x00c0, 0x01d0])
  })

  it('stores the upper bits of a jump target in bits 8-11, so programs can be 256 instructions long', () => {
    const r = asm('JMP 31\nJZ 16\nJNC 15\nJMP 127\nJZ 64\nJMP 255', 256)
    expect(r.errors).toEqual([])
    expect(r.words.slice(0, 6)).toEqual([0x013f, 0x0180, 0x006f, 0x073f, 0x0480, 0x0f3f])
    expect(asm('JMP 256', 256).errors[0].message).toBe('JMP: the jump target 256 is out of range, it must be from 0 to 255.')
    expect(asm('LDA 16').errors[0].message).toBe('LDA: the address 16 is out of range, it must be from 0 to 15.')
    expect(asm('JMP').errors[0].message).toBe('JMP needs a jump target.')
  })

  it('takes labels past address 15 as jump targets', () => {
    const lines = [...Array.from({ length: 100 }, () => 'SHL'), 'far: HALT', 'JMP far']
    const r = asm(lines.join('\n'), 256)
    expect(r.errors).toEqual([])
    expect(r.symbols.far).toBe(100)
    expect(disassemble(SKASM, r.words[101])).toBe('JMP 100')
  })

  it('an unused opcode field is not an instruction (the old unused opcodes 14 and 15 are the extension groups now)', () => {
    expect(SKASM.decode(0x00ed)).toBeNull()
    expect(SKASM.decode(0xf0f0)).toBeNull()
  })
})

describe('the instruction table', () => {
  const entries = Object.entries(SKASM_OPS)

  it('gives every instruction its own opcode (and sub-opcode), and decodes it back', () => {
    const seen = new Map<string, string>()
    for (const [name, op] of entries) {
      const key = `${op.code}:${op.sub ?? '-'}`
      expect(seen.get(key), `${name} and ${seen.get(key)} share ${key}`).toBeUndefined()
      seen.set(key, name)
      expect(SKASM.decode(SKASM.encode(op, 0))?.mnemonic).toBe(name)
    }
  })

  it('uses opcodes 0–13 for the main instructions, 14 for immediates and 15 for addresses, ports and targets', () => {
    for (const [name, op] of entries) {
      if (op.sub === undefined) expect(op.code, name).toBeLessThanOrEqual(13)
      else if (op.code === 14) expect(['imm', 'none'], name).toContain(op.arg)
      else {
        expect(op.code, name).toBe(15)
        expect(['addr', 'port', 'target', 'none'], name).toContain(op.arg)
      }
    }
  })

  it('every instruction has a summary and a category for the reference page', () => {
    for (const [name, op] of entries) {
      expect(op.summary.length, name).toBeGreaterThan(5)
      expect(op.category, name).toBeTruthy()
    }
  })
})

describe('the new instructions', () => {
  it('encode in the extension groups', () => {
    const r = asm('ANDI 0x0F\nORI 0x80\nXORI 255\nOUT 0\nIN 5\nJNZ 19\nJC 7\nCMP 2\nAND 1\nOR 1\nXOR 1\nADC 1\nSBC 1\nNOP', 256)
    expect(r.errors).toEqual([])
    expect(r.words.slice(0, 14)).toEqual([0x0fe0, 0x80e1, 0xffe2, 0x00f0, 0x10f5, 0x21f3, 0x30f7, 0x40f2, 0x50f1, 0x60f1, 0x70f1, 0x80f1, 0x90f1, 0xa0f0])
  })

  it('take the same kinds of operand as the older ones', () => {
    const errors = (s: string) => asm(s, 256).errors.map((e) => e.message)
    expect(errors('JNZ')).toEqual(['JNZ needs a jump target.'])
    expect(errors('JNZ 256')).toEqual(['JNZ: the jump target 256 is out of range, it must be from 0 to 255.'])
    expect(errors('AND 16')).toEqual(['AND: the address 16 is out of range, it must be from 0 to 15.'])
    expect(errors('ANDI 256')).toEqual(["ANDI: the value 256 doesn't fit, it must be from -128 to 255."])
    expect(errors('NOP 1')).toEqual(['NOP takes no operand.'])
    expect(errors('OUT')).toEqual(['OUT needs a port.'])
    expect(errors('OUT 16')).toEqual(['OUT: the port 16 is out of range, it must be from 0 to 15.'])
    expect(errors('IN -1')).toEqual(['IN: the port -1 is out of range, it must be from 0 to 15.'])
  })

  it('jump to labels like the others', () => {
    const r = asm('top: DEC\nJNZ top\nJC top\nHALT')
    expect(r.errors).toEqual([])
    expect(r.words.slice(0, 4)).toEqual([0x01d0, 0x20f0, 0x30f0, 0x70])
  })
})

describe('aliases', () => {
  it('INC, DEC, CLR and NOT assemble to the instruction they stand for', () => {
    expect(hex('INC\nDEC\nCLR\nNOT', 4)).toBe(hex('ADDI 1\nSUBI 1\nLDI 0\nXORI 255', 4))
    expect(hex('inc', 1)).toBe('0190')
    expect(asm('NOT').lineOf).toEqual([1])
  })
  it('take no operand, and cannot be used as names', () => {
    expect(asm('INC 3').errors.map((e) => e.message)).toEqual(['INC takes no operand.'])
    for (const name of Object.keys(SKASM_ALIASES)) expect(asm(`${name} = 1`).errors[0].message).toContain('instruction name')
    expect(asm('nop: HALT').errors[0].message).toContain('instruction name')
  })
  it('are shown as the real instruction when disassembled', () => {
    expect(disassemble(SKASM, asm('INC').words[0])).toBe('ADDI 1')
  })
})

describe('ports', () => {
  it('have names that stand for their number, in any operand', () => {
    expect(hex('OUT NUMBER\nOUT CHAR\nOUT PIXEL_ON\nOUT PIXEL_OFF\nOUT SPEAKER\nIN KEY\nOUT KEY_ACK', 8)).toBe(
      hex('OUT 0\nOUT 1\nOUT 2\nOUT 3\nOUT 4\nIN 5\nOUT 5', 8),
    )
    expect(asm('LDI KEY\nX = CHAR\nLDA X').errors).toEqual([])
  })
  it('have names that cannot be defined again, as a label or a constant', () => {
    for (const p of PORTS) {
      expect(asm(`${p.name} = 3`).errors.map((e) => e.message)).toEqual([`“${p.name}” is the name of a port and can't be used as a constant.`])
      expect(asm(`${p.name}: HALT`).errors.map((e) => e.message)).toEqual([`“${p.name}” is the name of a port and can't be used as a label.`])
    }
  })
  it('are not listed among the program\'s own symbols', () => {
    expect(asm('X = 1\nOUT CHAR').symbols).toEqual({ X: 1 })
  })
  it('are named when disassembled, by direction', () => {
    expect(disassemble(SKASM, 0x10f5)).toBe('IN KEY')
    expect(disassemble(SKASM, 0x00f5)).toBe('OUT KEY_ACK')
    expect(disassemble(SKASM, 0x00f1)).toBe('OUT CHAR')
    expect(disassemble(SKASM, 0x00f9)).toBe('OUT 9') // no device has it yet
  })
  it('are listed once each with a direction and a summary, and fit in 4 bits', () => {
    expect(new Set(PORTS.map((p) => `${p.number}${p.dir}`)).size).toBe(PORTS.length)
    for (const p of PORTS) {
      expect(p.number).toBeLessThanOrEqual(15)
      expect(p.summary.length).toBeGreaterThan(5)
    }
  })
})

describe('names that happen to be inherited object properties', () => {
  it('are unknown names, not numbers', () => {
    expect(asm('JMP constructor').errors.map((e) => e.message)).toEqual(['Unknown name “constructor”.'])
    expect(asm('toString: HALT').errors).toEqual([])
  })
})

describe('wordFields: how an instruction word is made up', () => {
  const fieldsOf = (src: string) => wordFields(SKASM, asm(src, 256).words[0])!

  it('LDI: the constant in bits 8-15, the opcode in bits 4-7', () => {
    const f = fieldsOf('LDI 3')
    expect(f.mnemonic).toBe('LDI')
    expect(f.fields).toEqual([
      { name: 'constant', from: 8, to: 15, value: 3 },
      { name: 'opcode', from: 4, to: 7, value: 0 },
    ])
  })

  it('STA and the other address instructions: the address in bits 0-3', () => {
    expect(fieldsOf('STA 9').fields).toEqual([
      { name: 'opcode', from: 4, to: 7, value: 2 },
      { name: 'RAM address', from: 0, to: 3, value: 9 },
    ])
  })

  it('a jump has its target in two halves, bits 8-11 and bits 0-3', () => {
    expect(fieldsOf('JMP 0xA5').fields).toEqual([
      { name: 'jump target, high half', from: 8, to: 11, value: 0xa },
      { name: 'opcode', from: 4, to: 7, value: 3 },
      { name: 'jump target, low half', from: 0, to: 3, value: 5 },
    ])
  })

  it('the extension groups put the sub-opcode in bits 0-3 (immediates) or bits 12-15 (the rest)', () => {
    expect(fieldsOf('ANDI 0x0F').fields).toEqual([
      { name: 'constant', from: 8, to: 15, value: 0x0f },
      { name: 'opcode', from: 4, to: 7, value: 14 },
      { name: 'sub-opcode', from: 0, to: 3, value: 0 },
    ])
    expect(fieldsOf('IN KEY').fields).toEqual([
      { name: 'sub-opcode', from: 12, to: 15, value: 1 },
      { name: 'opcode', from: 4, to: 7, value: 15 },
      { name: 'port', from: 0, to: 3, value: 5 },
    ])
  })

  it('an instruction without an operand is just the opcode', () => {
    expect(fieldsOf('HALT').fields).toEqual([{ name: 'opcode', from: 4, to: 7, value: 7 }])
  })

  it('for every instruction the fields do not overlap, and put together they are the word', () => {
    for (const [name, op] of Object.entries(SKASM.ops)) {
      const args = op.arg === 'none' ? [0] : op.arg === 'imm' || op.arg === 'target' ? [0, 1, 0x5a, 255] : [0, 1, 9, 15]
      for (const arg of args) {
        const word = SKASM.encode(op, arg)
        const f = wordFields(SKASM, word)!
        expect(f.mnemonic).toBe(name)
        let rebuilt = 0
        const used = new Set<number>()
        for (const field of f.fields) {
          for (let b = field.from; b <= field.to; b++) {
            expect(used.has(b), `${name} ${arg}: bit ${b} in two fields`).toBe(false)
            used.add(b)
          }
          rebuilt |= field.value << field.from
        }
        expect(rebuilt, `${name} ${arg}`).toBe(word)
      }
    }
  })

  it('is null for a word that is not exactly an instruction', () => {
    expect(wordFields(SKASM, 0x1234)).toBeNull()
    expect(wordFields(SKASM, 0xf0f0)).toBeNull()
  })
})

describe('.byte and the table', () => {
  const table = (src: string) => asm(src).table
  it('collects the bytes of every .byte line, in order, from numbers, constants and labels', () => {
    const r = asm('K = 7\n.byte 1, 2 3\n.byte K, 0x10, -1, 255\nHALT')
    expect(r.errors).toEqual([])
    expect(r.table).toEqual([1, 2, 3, 7, 16, 255, 255])
    expect(r.words[0]).toBe(0x70) // the table does not use up program words
  })
  it('a label in front of .byte is a table address, in front of an instruction a program address', () => {
    const r = asm('LDI 1\nfirst: .byte 9, 9\nsecond: .byte 9\nthere: HALT')
    expect(r.symbols).toMatchObject({ first: 0, second: 2, there: 1 })
  })
  it('says what is wrong with a .byte line', () => {
    expect(asm('.byte').errors[0]).toMatchObject({ line: 1, message: '.byte needs at least one value.' })
    expect(asm('.byte 300').errors[0].message).toContain("doesn't fit")
    expect(asm('.byte nope').errors[0].message).toBe('Unknown name “nope”.')
    expect(asm(`.byte ${Array.from({ length: 257 }, () => 1).join(',')}`).errors[0].message).toBe('The table has more than 256 bytes.')
  })
  it('has no table without .byte, and 256 bytes fit', () => {
    expect(table('HALT')).toEqual([])
    expect(table(`.byte ${Array.from({ length: 256 }, (_, i) => i).join(',')}`)).toHaveLength(256)
  })
  it('LDT is an instruction without an operand', () => {
    expect(asm('LDT').words[0]).toBe(SKASM.encode(SKASM.ops.LDT, 0))
    expect(disassemble(SKASM, asm('LDT').words[0])).toBe('LDT')
  })
  it('the table as hex text stops at the last byte that is not 0', () => {
    expect(toHexBytes([1, 2, 0, 255, 0, 0])).toBe('01 02 00 FF')
    expect(toHexBytes([0, 0])).toBe('')
  })
})

describe('the list of instruction sets a ROM offers', () => {
  it('matches the assemblers: the same ids and names, in the same order', () => {
    expect(ISA_CHOICES).toEqual(ISAS.map((i) => ({ id: i.id, name: i.name })))
  })
})
