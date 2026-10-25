import { describe, expect, it } from 'vitest'
import io from '../../scripts/basic/io.s?raw'
import licence from '../../scripts/basic/LICENSE?raw'
import source from '../../scripts/basic/m6502.asm?raw'
import { linesOf, translate, TranslateError } from '../../scripts/basic/macro10'
import { applyEdits, buildBasic, EDITS } from '../../scripts/basic/target'
import { assemble6502 } from '../engine/asm6502'

/** The translation of a few lines of MACRO-10, as lines of assembly. Like the source it begins with `RADIX 10` (the assembler starts in base 8). */
const tr = (text: string, radix = 'RADIX 10\n') => translate(linesOf(radix + text)).text.trim().split('\n')

describe('the MACRO-10 translator', () => {
  it('reads numbers in the base that is set, and ^O, ^D and characters in any', () => {
    expect(tr('RADIX 8\nLDAI 377\nLDAI ^D255\nLDAI "A"\nRADIX 10\nLDAI 255\nLDAI ^O377')).toEqual(['LDA #255', 'LDA #255', 'LDA #65', 'LDA #255', 'LDA #255'])
  })

  it('reads a number with an 8 or a 9 as decimal even where the base is 8', () => {
    expect(tr('RADIX 8\nLDAI 8*1+230')).toEqual(['LDA #160'])
  })

  it('gives * / & ! precedence over + -, and groups with < >', () => {
    expect(tr('LDAI 2+3*4\nLDAI <2+3>*4\nLDAI 7-6/2\nLDAI 6!1\nLDAI 7&3+1')).toEqual(['LDA #14', 'LDA #20', 'LDA #4', 'LDA #7', 'LDA #4'])
  })

  it('reads names to six characters only, in any case', () => {
    expect(tr('RESTOR: RTS\nJMP restore\nJMP RESTORX')).toEqual(['RESTOR:', 'RTS', 'JMP RESTOR', 'JMP RESTOR'])
  })

  it('understands every form of instruction the source uses', () => {
    expect(
      tr('LDAI 1\nCMPI 2\nLDADY P\nSTADY P\nADCDY P\nJMPD P\nLSR A,\nASL A\nLDA T,X,\nSTA T,Y\nLDX 257,X\nBNE .+5\nRTS\nINX').slice(0, 14),
    ).toEqual(['LDA #1', 'CMP #2', 'LDA (P),Y', 'STA (P),Y', 'ADC (P),Y', 'JMP (P)', 'LSR A', 'ASL A', 'LDA T,X', 'STA T,Y', 'LDX 257,X', 'BNE *+5', 'RTS', 'INX'])
  })

  it('treats a bare expression as one byte, EXP and XWD too, ADR as a word', () => {
    expect(tr('  128\nEXP 144,128,0,0\nXWD ^O1000,^O251\nADR(FOO-1)\nADR (BAR)\n"("+128')).toEqual(['.byte 128', '.byte 144,128,0,0', '.byte 169', '.word FOO-1', '.word BAR', '.byte 168'])
  })

  it('counts with DCI and DCE in Q and gives DC text its last character’s top bit', () => {
    const t = tr('Q=128-1\nDEFINE DCI(A),<Q=Q+1\nDC(A)>\nDCI"END"\nENDTK==Q\nDCI"FOR"\nLDAI ENDTK\nLDAI Q\nDT"HI"\nQ=0-2\nDEFINE DCE(X),<Q=Q+2\nDC(X)>\nDCE"NF"\nLDAI Q')
    expect(t).toEqual(['.byte 69,78,196', '.byte 70,79,210', 'LDA #128', 'LDA #129', '.byte 72,73', '.byte 78,198', 'LDA #0'])
  })

  it('does the conditionals, nested, over several lines and after a label', () => {
    const t = tr('A=1\nB=0\nIFE B,<\nLDAI 1\nIFN A,<LDAI 2>\nIFE A,<LDAI 3>\nL: IFN A!B,<RTS>>\nIFN B,<LDAI 4>\nIFE B-1,<LDAI 5>\nLDAI 9')
    expect(t).toEqual(['LDA #1', 'LDA #2', 'L:', 'RTS', 'LDA #9'])
  })

  it('takes IF2 as true and IF1 as false, and IFNDEF as the question whether a name is known', () => {
    expect(tr('IF1,<LDAI 1>\nIF2,<LDAI 2>\nIFNDEF X,<LDAI 3>\nX==1\nIFNDEF X,<LDAI 4>\nLBL: IFNDEF LBL,<LDAI 5>')).toEqual(['LDA #2', 'LDA #3', 'LBL:'])
  })

  it('expands macros with a parameter and a label made up for each use', () => {
    const t = tr('DEFINE INCW(R),<\n INC R\n BNE %Q\n INC R+1\n%Q:>\nINCW FOO\nINCW BAR')
    expect(t).toEqual(['INC FOO', 'BNE G1Q', 'INC FOO+1', 'G1Q:', 'INC BAR', 'BNE G2Q', 'INC BAR+1', 'G2Q:'])
  })

  it('repeats', () => {
    expect(tr('REPEAT 3,<NOP>')).toEqual(['NOP', 'NOP', 'NOP'])
  })

  it('does not expand a macro parameter inside quotes', () => {
    expect(tr('DEFINE M(W),<LDAI "W"\nLDA W>\nM FOO')).toEqual(['LDA #87', 'LDA FOO'])
  })

  it('writes the low and high byte of a name the way the assembler wants it', () => {
    expect(tr('DEFINE LDWDI(WD),<LDAI <<WD>&^O377>\nLDYI <<WD>/^O400>>\nLDWDI ERR\nCMPI ERR-1-<ERR-1>/256*256\nLDAI <BUF&255>-1')).toEqual(['LDA #<ERR', 'LDY #>ERR', 'CMP #<ERR-1', 'LDA #<BUF-1'])
  })

  it('counts addresses for the conditions that depend on them', () => {
    const t = translate(linesOf('RADIX 10\nORG 0\nA: JMP X\nB: BLOCK 10\nC: LDA 5\nD: LDA 500\nE: 1\nF: ADR(A)\nG:'))
    expect(t.labels).toEqual({ A: 0, B: 3, C: 13, D: 15, E: 18, F: 19, G: 21 })
    // a condition on labels: the top of B and the top of C are on different pages, so the `IFN` is true
    expect(tr('ORG 250\nB: BLOCK 10\nC:\nIFN <C/256>-<B/256>,<LDAI 1>')).toEqual(['.org 250', 'B:', '.res 10', 'C:', 'LDA #1'])
  })

  it('leaves out comments, COMMENT blocks, and the lines about listings, but not a ; in a string', () => {
    expect(tr('TITLE X\nSUBTTL Y\nCOMMENT *\nLDAI 1 THIS IS TEXT\n* LDAI 2\nPAGE\nLDAI 3 ;LDAI 4\nDT";"')).toEqual(['LDA #2', 'LDA #3', '.byte 59'])
  })

  it('stops at END', () => {
    expect(tr('LDAI 1\nEND $Z\nLDAI 2')).toEqual(['LDA #1'])
  })

  it('says which line of the source is wrong', () => {
    const fail = (text: string) => {
      try {
        translate(linesOf(text))
      } catch (e) {
        return e instanceof TranslateError ? e : new Error('not a TranslateError')
      }
      return null
    }
    expect(fail('LDAI 1\nLDAI 2\nLDAI 3*\n')?.message).toMatch(/^line 3:/)
    expect(fail('IFE UNKNOWN,<NOP>')?.message).toMatch(/^line 1: .*has to be a number/)
    expect(fail('RADIX 8\nLDAI 9\nLDAI 7!')?.message).toMatch(/^line 3:/)
    expect(fail('LDAI 1\n>')?.message).toMatch(/^line 2: A > closes nothing/)
    expect(fail('LDA X*2')?.message).toMatch(/^line 1: .*can only use \+ and/)
  })

  it('keeps the line each output line came from', () => {
    const t = translate(linesOf('LDAI 1\n\nIFE 0,<\nNOP>\nIFN 0,<\nNOP>\nRTS'))
    expect(t.lines).toEqual([1, 4, 7]) // (the IFE is true: 0 = 0)
  })
})

describe('Microsoft’s file', () => {
  it('is in the repository exactly as Microsoft published it (MIT licence, github.com/microsoft/BASIC-M6502)', async () => {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
    const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(hex).toBe('8f9e48dcae34eefce0462f1e7c4379dfe2c8aa98c0b772041d9989b40bcbff3b')
    expect(licence).toContain('MIT License')
    expect(licence).toContain('Copyright (c) Microsoft Corporation')
  })
})

describe('the edits of Microsoft’s file', () => {
  it('each name the line it replaces, and the build says if the file is not the one that was meant', () => {
    expect(() => applyEdits(linesOf(source))).not.toThrow()
    const other = linesOf(source)
    other[29].text = 'LINLEN==73'
    expect(() => applyEdits(other)).toThrow(/Edit for line 30/)
    expect(new Set(EDITS.map((e) => e.line)).size).toBe(EDITS.length)
    expect(EDITS.every((e) => e.why.length > 10)).toBe(true)
  })

  it('leave every other line as Microsoft wrote it', () => {
    const edited = applyEdits(linesOf(source))
    const changed = new Set(EDITS.map((e) => e.line))
    const original = linesOf(source)
    const untouched = edited.filter((l) => !changed.has(l.line))
    expect(untouched).toEqual(original.filter((l) => !changed.has(l.line)))
  })
})

describe('the whole of m6502.asm', () => {
  it('translates for every machine in the file that it has the code for, and the assembler accepts it', () => {
    // (REALIO 2, OSI, has no GET routine in Microsoft’s file: it stops at that name. 0 is the PDP-10 simulator, written for MACRO-10 itself.)
    for (const realio of [1, 3, 4]) {
      const lines = linesOf(source).map((l) => (l.line === 10 ? { ...l, text: `REALIO=${realio}` } : l))
      const t = translate(lines)
      const r = assemble6502(t.text, 0x10000)
      expect(r.errors, `REALIO=${realio}`).toEqual([])
      expect(Object.entries(t.labels).filter(([name, addr]) => r.symbols[name] !== addr), `REALIO=${realio}`).toEqual([])
    }
  })

  it('has the same label addresses in the translator, which counts them for its conditions, as in the assembler', () => {
    const t = translate(applyEdits(linesOf(source)))
    const r = assemble6502(t.text + io, 0x10000)
    expect(r.errors).toEqual([])
    const wrong = Object.entries(t.labels).filter(([name, addr]) => r.symbols[name] !== addr)
    expect(wrong).toEqual([])
    expect(Object.keys(t.labels).length).toBeGreaterThan(800)
  })

  it('reports an error of the assembler at the line of Microsoft’s file it came from', () => {
    expect(() => buildBasic(source, io + '\nBOGUS')).toThrow(/io\.s line \d+: Unknown instruction/)
  })
})
