import { describe, expect, it } from 'vitest'
import { assemble6502, listing6502, sourceFromBytes } from './asm6502'
import { newCpu, cycle, reset } from './cpu6502'
import { disassemble6502 } from './disasm6502'
import { MODE_BYTES, OPCODES_6502, type Mode6502 } from './opcodes6502'

const hex = (bytes: number[]) => bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
/** The bytes a program assembles to (without the zeros the ROM is padded with). */
const asm = (source: string, capacity = 64) => {
  const r = assemble6502(source, capacity)
  expect(r.errors).toEqual([])
  const last = r.items.reduce((n, it) => Math.max(n, it.addr - r.base + Math.max(it.bytes.length, it.gap ?? 0)), 0)
  return hex(r.bytes.slice(0, last))
}
const errors = (source: string, capacity = 64) => assemble6502(source, capacity).errors.map((e) => `${e.line}: ${e.message}`)

/** An operand that has this mode, for a given value. */
const operand: Record<Mode6502, (v: number) => string> = {
  imp: () => '',
  acc: () => 'A',
  imm: (v) => `#$${v.toString(16)}`,
  zp: (v) => `$${v.toString(16)}`,
  zpx: (v) => `$${v.toString(16)},X`,
  zpy: (v) => `$${v.toString(16)},Y`,
  abs: (v) => `$${v.toString(16)}`,
  abx: (v) => `$${v.toString(16)},X`,
  aby: (v) => `$${v.toString(16)},Y`,
  ind: (v) => `($${v.toString(16)})`,
  izx: (v) => `($${v.toString(16)},X)`,
  izy: (v) => `($${v.toString(16)}),Y`,
  rel: (v) => `$${v.toString(16)}`,
}

describe('the 6502 assembler', () => {
  it('assembles every documented opcode, in every mode, to the byte the table says', () => {
    for (const o of OPCODES_6502) {
      // $34 or $1234, as the mode's size needs; a branch is written with its target address.
      const value = o.mode === 'rel' ? 0x20 : MODE_BYTES[o.mode] === 3 ? 0x1234 : 0x34
      const line = `${o.mnemonic} ${operand[o.mode](value)}`
      const r = assemble6502(`${line}`, 8)
      expect(r.errors, line).toEqual([])
      expect(r.bytes[0], line).toBe(o.opcode)
      expect(r.items[0].bytes.length, line).toBe(o.bytes)
    }
  })

  it('reads what the disassembler writes, for every opcode', () => {
    for (const o of OPCODES_6502) {
      const bytes = [o.opcode, o.mode === 'rel' ? 0x10 : 0x34, 0x12].slice(0, o.bytes)
      const text = disassemble6502(bytes, 0x100).text
      const r = assemble6502(`.org $100\n${text}`, 16)
      expect(r.errors, text).toEqual([])
      expect(r.bytes.slice(0, o.bytes), text).toEqual(bytes)
    }
  })

  it('chooses zero page for a known small address and absolute otherwise', () => {
    expect(asm('LDA $10')).toBe('A5 10')
    expect(asm('LDA $0010')).toBe('A5 10')
    expect(asm('LDA $1234')).toBe('AD 34 12')
    expect(asm('LDA $10,X')).toBe('B5 10')
    expect(asm('LDA $1234,X')).toBe('BD 34 12')
    expect(asm('LDA $1234,Y')).toBe('B9 34 12')
    expect(asm('LDX $10,Y')).toBe('B6 10')
    expect(asm('STX $10,Y')).toBe('96 10')
    expect(asm('JMP $10')).toBe('4C 10 00') // JMP has no zero-page form
    expect(asm('LDA ($20),Y')).toBe('B1 20')
    expect(asm('LDA ($20,X)')).toBe('A1 20')
    expect(asm('JMP ($FFFC)')).toBe('6C FC FF')
  })

  it('takes an address defined further down as absolute, and one defined before as it is', () => {
    expect(asm('LDA later\nlater: NOP')).toBe('AD 03 00 EA')
    expect(asm('zp = $10\nLDA zp')).toBe('A5 10')
    expect(asm('LDA zp\nzp = $10')).toBe('AD 10 00') // not known yet when the line is sized, so it is absolute
  })

  it('writes the accumulator forms, with or without the A', () => {
    expect(asm('ASL A')).toBe('0A')
    expect(asm('asl')).toBe('0A')
    expect(asm('ROR a')).toBe('6A')
    expect(asm('ASL $10')).toBe('06 10')
    expect(asm('INX\nDEY\nNOP')).toBe('E8 88 EA')
  })

  it('writes constants as numbers, characters and the low or high byte of an address', () => {
    expect(asm('LDA #10')).toBe('A9 0A')
    expect(asm('LDA #$0A')).toBe('A9 0A')
    expect(asm('LDA #0x0A')).toBe('A9 0A')
    expect(asm('LDA #0b1010')).toBe('A9 0A')
    expect(asm("LDA #'A'")).toBe('A9 41')
    expect(asm('LDA #-1')).toBe('A9 FF')
    expect(asm('.org $F000\nstart: LDA #<start\nLDX #>start', 16)).toBe('A9 00 A2 F0')
    expect(asm('.org $F000\nstart: LDA #<start+$34', 16)).toBe('A9 34')
    expect(asm("LDA #';'  ; a semicolon in a character is not a comment")).toBe('A9 3B')
  })

  it('keeps labels and offsets: label+1, label-1 and * (this address)', () => {
    expect(asm('.org $10\nLDA data+1\ndata: .byte 7, 8')).toBe('AD 14 00 07 08')
    expect(asm('.org $20\n.word *\n.word *-$20')).toBe('20 00 02 00')
  })

  it('places data: .byte (numbers, characters, strings), .word (little endian) and .res', () => {
    expect(asm('.byte 1, $FF, -1, \'x\'')).toBe('01 FF FF 78')
    expect(asm('.byte "Hi", 0')).toBe('48 69 00')
    expect(asm('.byte "a,b;c"')).toBe('61 2C 62 3B 63')
    expect(asm('.word $1234, 2')).toBe('34 12 02 00')
    expect(asm('.byte 1\n.res 3\n.byte 2')).toBe('01 00 00 00 02')
    expect(asm('.byte "tab\\there\\n"')).toBe('74 61 62 09 68 65 72 65 0A')
  })

  it('moves with .org and *=, and the first one is the address of the ROM image', () => {
    const r = assemble6502('.org $F000\nNOP\n*= $F010\nRTS\n.org $FFFC\n.word $F000', 0x1000)
    expect(r.errors).toEqual([])
    expect(r.base).toBe(0xf000)
    expect(r.bytes[0]).toBe(0xea)
    expect(r.bytes[0x10]).toBe(0x60)
    expect(r.bytes.slice(0xffc, 0xffe)).toEqual([0x00, 0xf0])
    expect(r.symbols).toEqual({})
  })

  it('gives labels their address in the CPU space, and resolves branches both ways', () => {
    const r = assemble6502(['.org $F000', 'loop: DEX', 'BNE loop', 'BEQ done', 'NOP', 'done: RTS'].join('\n'), 32)
    expect(r.errors).toEqual([])
    expect(r.symbols).toEqual({ loop: 0xf000, done: 0xf006 })
    expect(hex(r.bytes.slice(0, 6))).toBe('CA D0 FD F0 01 EA')
  })

  it('assembles the blink program of the board to the hand-assembled bytes', () => {
    const src = ['.org $F000', 'start: LDA #$01', 'show: STA $4000', 'ASL A', 'BNE show', 'JMP start'].join('\n')
    expect(asm(src, 16)).toBe('A9 01 8D 00 40 0A D0 FA 4C 00 F0')
  })

  describe('says what is wrong', () => {
    it('a branch too far', () => {
      const far = `.org 0\nBNE away\n.res 200\naway: NOP`
      expect(errors(far, 512)[0]).toMatch(/^2: BNE: the branch is out of range/)
      expect(errors(`.org 0\naway: .res 200\nBNE away`, 512)[0]).toMatch(/^3: BNE: the branch is out of range.*back/)
    })
    it('a mode the instruction does not have', () => {
      expect(errors('STA #1')[0]).toMatch(/^1: STA can't be written with a constant/)
      expect(errors('STA #1')[0]).toContain('STA address')
      expect(errors('LDX $10,X')[0]).toMatch(/LDX can't be written with ,X/)
      expect(errors('JMP ($10),Y')[0]).toMatch(/JMP can't be written as \(address\),Y/)
      expect(errors('INX $10')[0]).toMatch(/INX can't be written with an address/)
      expect(errors('LDA')[0]).toMatch(/LDA needs an operand/)
      expect(errors('BIT #1')[0]).toMatch(/BIT can't be written with a constant/)
      expect(errors('LDA A')[0]).toMatch(/LDA can't be written on A/)
    })
    it('a value that is too big', () => {
      expect(errors('LDA #256')[0]).toMatch(/too big for a constant, it must be from -128 to 255/)
      expect(errors('LDA ($1234),Y')[0]).toMatch(/too big for a zero-page address/)
      expect(errors('STX $1234,Y')[0]).toMatch(/too big for a zero-page address/)
      expect(errors('JMP $10000')[0]).toMatch(/too big for an address/)
      expect(errors('.byte 256')[0]).toMatch(/\.byte: the value 256 doesn't fit/)
      expect(errors('.word 65536')[0]).toMatch(/\.word: the value 65536 doesn't fit/)
    })
    it('unknown names, instructions and directives', () => {
      expect(errors('LDA nowhere\nLDX #far')).toEqual(['1: Unknown name “nowhere”.', '2: Unknown name “far”.'])
      expect(errors('LDQ #1')[0]).toBe('1: Unknown instruction “LDQ”.')
      expect(errors('.foo 1')[0]).toMatch(/Unknown directive “\.foo”/)
      expect(errors('LDA #$')[0]).toMatch(/not a number or a name/)
      expect(errors('LDA #1 2')[0]).toMatch(/not a number or a name/)
    })
    it('bad names and duplicates', () => {
      expect(errors('b: NOP\nb: NOP')[0]).toBe('2: “b” is already defined.')
      expect(errors('LDA: NOP')[0]).toMatch(/is an instruction name/)
      expect(errors('X = 1')[0]).toMatch(/name of a register/)
      expect(errors('9x: NOP')[0]).toMatch(/not a valid name/)
    })
    it('a program that does not fit, or lands on itself', () => {
      expect(errors('.res 70', 64)[0]).toMatch(/^1: This goes outside the ROM, which holds 64 bytes, \$0000 to \$003F/)
      expect(errors('.org $F000\nNOP\n.org $EFFF\nNOP', 16)[0]).toMatch(/outside the ROM/)
      expect(errors('.org 0\nNOP\n.org 0\nNOP')[0]).toBe('4: This overlaps the bytes at $0000 that line 2 placed.')
      expect(errors('.org $FFFF\nLDA $10')[0]).toMatch(/runs past \$FFFF/)
    })
    it('reports every error of a pass, in line order', () => {
      expect(errors('LDA #300\nNOP\nLDA nowhere\nLDX #-200').map((e) => e.slice(0, 2))).toEqual(['1:', '3:', '4:'])
      // A line that cannot be sized stops the second pass: the addresses after it would be wrong.
      expect(errors('LDA #300\nSTA #1\nLDQ').map((e) => e.slice(0, 2))).toEqual(['2:', '3:'])
    })
  })

  it('writes a program for the chip that the core then runs', () => {
    const src = `
      .org $F000
      reset: LDX #0
      again: TXA
             STA $0200,X
             INX
             CPX #4
             BNE again
             LDA #$AA
             STA $0300
      done:  JMP done
      .org $FFFC
      .word reset`
    const r = assemble6502(src, 0x1000)
    expect(r.errors).toEqual([])
    const ram = new Uint8Array(0x400)
    const c = newCpu()
    reset(c)
    for (let n = 0; n < 200; n++) {
      if (!c.read && c.addr < 0x400) ram[c.addr] = c.out
      cycle(c, c.read ? (c.addr >= 0xf000 ? r.bytes[c.addr - 0xf000] : ram[c.addr] ?? 0) : 0)
    }
    expect(Array.from(ram.slice(0x200, 0x204))).toEqual([0, 1, 2, 3])
    expect(ram[0x300]).toBe(0xaa)
  })
})

describe('listings of 6502 bytes', () => {
  it('lists what the assembler placed, with the source line of each row', () => {
    const r = assemble6502('.org $F000\nstart: LDA #1\n.byte 1,2,3,4,5\n.res 2\nJMP start', 32)
    const rows = listing6502(r.bytes, r.base, r.items)
    expect(rows.map((x) => [x.addr.toString(16), x.text, x.line])).toEqual([
      ['f000', 'LDA #$01', 2],
      ['f002', '.byte $01, $02, $03, $04', 3],
      ['f006', '.byte $05', 3],
      ['f007', '.res 2', 4],
      ['f009', 'JMP $F000', 5],
    ])
  })

  it('reads bytes it was not told about as instructions, leaving out runs of zeros and showing an unknown opcode as data', () => {
    const bytes = [0xa9, 1, 0x8d, 0, 0x40, 0, 0, 0, 0, 0, 0xff, 0xea]
    const rows = listing6502(bytes, 0x8000)
    expect(rows.map((x) => [x.addr.toString(16), x.text])).toEqual([
      ['8000', 'LDA #$01'],
      ['8002', 'STA $4000'],
      ['800a', '.byte $FF'],
      ['800b', 'NOP'],
    ])
  })

  it('turns bytes into source that assembles to the same bytes', () => {
    const bytes = new Array<number>(64).fill(0)
    ;[0xa9, 1, 0x8d, 0, 0x40, 0xd0, 0xfb, 0xff].forEach((b, i) => (bytes[i] = b))
    ;[0xa2, 3, 0x60].forEach((b, i) => (bytes[40 + i] = b))
    const src = sourceFromBytes(bytes)
    const r = assemble6502(src, 64)
    expect(r.errors).toEqual([])
    expect(r.bytes).toEqual(bytes)
  })
})
