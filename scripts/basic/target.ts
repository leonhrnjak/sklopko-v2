/**
 * Our build of Microsoft BASIC: `m6502.asm` with a short, visible list of edits, translated (`macro10.ts`), joined with our
 * own I/O and start-up code (`io.s`) and assembled with the app's own 6502 assembler into a 16 KB ROM image.
 *
 * Microsoft's file has one block of switches per machine (`REALIO`); this build is the KIM-1 one with its hooks pointed at the
 * terminal of this computer. An edit names the line it replaces, as it is in the file (whitespace aside), and the build fails if
 * the line is not that: Microsoft's code stays untouched except for what is listed here, and why.
 */

import { assemble6502, type Asm6502Result } from '../../src/engine/asm6502'
import { linesOf, translate, type SourceLine } from './macro10'

export interface Edit {
  /** The line of `m6502.asm` this replaces. */
  line: number
  /** That line as it is in the file (runs of white space count as one space). */
  was: string
  /** What replaces it: no lines, one or several. */
  now: string[]
  why: string
}

/** The address of the ROM, and what the computer's memory map puts where. */
export const ROM_BASE = 0xc000
export const ROM_SIZE = 0x4000

export const EDITS: Edit[] = [
  { line: 10, was: 'REALIO=4 ;5=STM', now: ['REALIO=1'], why: 'The KIM-1 build is the plainest: no machine-specific I/O but the few hooks below.' },
  { line: 30, was: 'LINLEN==72 ;TERMINAL LINE LENGTH.', now: ['LINLEN==40'], why: 'The terminal is 40 columns wide.' },
  { line: 35, was: 'IFN REALIO-1,<KIMROM==0>', now: ['KIMROM==0'], why: 'Keep the start-up that asks for the memory size and the width, and the authors’ names behind "A".' },
  { line: 37, was: 'RAMLOC= ^O40000 ;USED ONLY IF ROMSW=1', now: ['RAMLOC= ^O1400'], why: 'BASIC’s program text starts at $0300 (page 0 is its variables, page 1 the stack, page 2 ours).' },
  { line: 77, was: 'DISKO==1', now: ['DISKO==0'], why: 'No LOAD and SAVE: there is no tape.' },
  {
    line: 78,
    was: 'OUTCH=^O17240 ;1EA0',
    now: ['MEMTOP==^O40000\t\t;THE FIRST ADDRESS AFTER OUR RAM: THE TERMINAL IS THERE'],
    why: 'OUTCH is a routine in io.s now. MEMTOP is where the 16 KB of RAM ends.',
  },
  { line: 79, was: 'ROMLOC==^O20000', now: ['ROMLOC==^O140000'], why: 'BASIC is in the ROM from $C000.' },
  { line: 80, was: 'RORSW==0', now: ['RORSW==1'], why: 'The 6502 here has ROR (the KIM-1’s first chips did not), so BASIC need not emulate it.' },
  { line: 81, was: 'CZGETL=^O17132>', now: ['\t>'], why: 'CZGETL (the GET command) is a routine in io.s now.' },
  { line: 1754, was: 'JSR ^O17132> ;1E5A FOR MOS TECH.', now: ['\tJSR\tTERMIN>\t;OUR TERMINAL (io.s)'], why: 'Read a character from the terminal, not from the KIM-1 monitor.' },
  { line: 2206, was: 'ISCNTC: LDAI 1', now: ['ISCNTC: JSR\tTRMBRK\t\t;OUR TERMINAL (io.s): [C]=1 IF CONTROL-C WAS TYPED', '\tBCC\tISCRTS', '\tLDAI\t3', '\tCMPI\t3>'], why: 'Break check on the terminal. Falls into STOP with C=1 and Z=1 for a Control-C, as the KIM-1 code did.' },
  { line: 2207, was: 'BIT ^O13500', now: [], why: 'Replaced above.' },
  { line: 2208, was: 'BMI ISCRTS', now: [], why: 'Replaced above.' },
  { line: 2209, was: 'LDXI 8', now: [], why: 'Replaced above.' },
  { line: 2210, was: 'LDAI 3', now: [], why: 'Replaced above.' },
  { line: 2211, was: 'CMPI 3>', now: [], why: 'Replaced above.' },
  {
    line: 2749,
    was: 'NCMPOS==<<<LINLEN/CLMWID>-1>*CLMWID> ;CLMWID BEYOND WHICH THERE ARE',
    now: ['NCMPOS==<<LINLEN/CLMWID>*CLMWID>\t;CLMWID BEYOND WHICH THERE ARE'],
    why: 'The start-up code that asks the width computes the last comma field as width/14*14; the value assembled in as the default was one field less. This makes them the same, so the screen does not depend on whether the questions were asked.',
  },
  { line: 2281, was: 'IFE REALIO-1,< ;KIM CASSETTE I/O', now: ['IFN\tDISKO,<\t\t;KIM CASSETTE I/O'], why: 'The cassette routines go with LOAD and SAVE, which this build does not have.' },
  {
    line: 6761,
    was: 'LDWDI MEMORY',
    now: [
      '\tJSR\tASKQS\t\t;OUR I/O (io.s): [Z]=1 IF THE START-UP QUESTIONS ARE SWITCHED OFF',
      '\tBNE\tASKMEM\t\t;ON: ASK, AS MICROSOFT’S BASIC DOES',
      '\tLDWDI\tMEMTOP\t\t;OFF: THE MEMORY IS WHAT THERE IS',
      '\tJMP\tUSEDEF',
      'ASKMEM:\tLDWDI\tMEMORY',
    ],
    why: 'The start-up questions are a switch on the board. With them off, BASIC is told the size of the memory and does not test it.',
  },
  {
    line: 6768,
    was: "BEQ TYPAUT> ;YES TYPE AUTHOR'S NAME.",
    now: ['\tJEQ\tTYPAUT>\t;(A JUMP: THE EDIT BELOW MAKES THE BRANCH TOO LONG)'],
    why: 'The code added at the start of the questions pushes the authors’ names (TYPAUT) out of reach of a branch.',
  },
  {
    line: 6787,
    was: 'INC LINNUM+1',
    now: ['\tINC\tLINNUM+1', '\tLDA\tLINNUM+1', '\tCMPI\tMEMTOP/^D256', '\tBEQ\tUSEDEC\t\t;OUR RAM ENDS HERE: THE TERMINAL IS NEXT, DO NOT TEST IT'],
    why: 'With the questions on, the memory test (an empty answer) stops at the end of the RAM instead of writing into the terminal.',
  },
  {
    line: 6814,
    was: 'USEDEC: LDWD LINNUM ;GET SIZE OF MEMORY INPUT.',
    now: [
      'USEDEC:\tLDWD\tLINNUM\t\t;GET SIZE OF MEMORY INPUT.',
      '\tCPYI\tMEMTOP/^D256\t;OUR RAM ENDS AT MEMTOP: THE TERMINAL IS NEXT',
      '\tBCC\tUSEDEF\t\t;BELOW IT: AS TYPED',
      '\tBNE\tCAPMEM\t\t;ABOVE IT: TOO MUCH',
      '\tCMPI\t0\t\t;IN ITS LAST PAGE: ONLY THE FIRST BYTE IS RAM',
      '\tBEQ\tUSEDEF',
      'CAPMEM:\tLDWDI\tMEMTOP',
    ],
    why: 'A memory size typed at MEMORY SIZE? (or found by the test) is held to MEMTOP: BASIC keeps its strings just below the top of memory, which must not be the terminal.',
  },
  {
    line: 6823,
    was: 'LDWDI TTYWID',
    now: ['\tJSR\tASKQS\t\t;OUR I/O (io.s): [Z]=1 IF THE START-UP QUESTIONS ARE SWITCHED OFF', '\tBEQ\tASKAGN\t\t;OFF: THE WIDTH STAYS AS ASSEMBLED', '\tLDWDI\tTTYWID'],
    why: 'The terminal width is part of the same switch.',
  },
  { line: 6935, was: 'IFE REALIO-1,< DT"KIM BASIC V1.1">', now: ['IFE REALIO-1,<\tDT"SKLOPKO BASIC V1.1">'], why: 'The banner. Microsoft’s copyright line below it stays.' },
  { line: 6948, was: 'BLOCK 100 ;SPACE FOR TEMP STACK.', now: [], why: 'Nothing is kept after the code in a ROM build; io.s goes there.' },
]

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The source with the edits made. A replaced line keeps its number in the lines that take its place, so errors point into the original. */
export function applyEdits(src: SourceLine[], edits: Edit[] = EDITS): SourceLine[] {
  const byLine = new Map(edits.map((e) => [e.line, e]))
  const out: SourceLine[] = []
  for (const l of src) {
    const e = byLine.get(l.line)
    if (!e) {
      out.push(l)
      continue
    }
    if (collapse(l.text) !== e.was) throw new Error(`Edit for line ${e.line}: the line is “${collapse(l.text)}”, not “${e.was}”.`)
    for (const text of e.now) out.push({ text, line: l.line })
  }
  return out
}

export interface BasicBuild {
  /** The 16 KB image, from $C000. */
  rom: number[]
  /** Label addresses and constants of the assembly. */
  symbols: Record<string, number>
  /** The assembly of the translation and of `io.s`, for reading. */
  assembly: string
  /** Where each assembled line came from: `m6502.asm` line n, or `io.s` line n. */
  origin(assemblyLine: number): string
}

/** Build the ROM image from the text of `m6502.asm` and of `io.s`. Throws, saying where, if either does not translate or assemble. */
export function buildBasic(source: string, io: string, edits: Edit[] = EDITS): BasicBuild {
  const t = translate(applyEdits(linesOf(source), edits))
  const assembly = t.text + io
  const translated = t.lines.length
  const origin = (n: number) => (n <= translated ? `m6502.asm line ${t.lines[n - 1]}` : `io.s line ${n - translated}`)
  const r: Asm6502Result = assemble6502(assembly, 0x10000)
  if (r.errors.length) {
    const lines = assembly.split('\n')
    throw new Error(r.errors.slice(0, 5).map((e) => `${origin(e.line)}: ${e.message}  [${lines[e.line - 1].trim()}]`).join('\n'))
  }
  return { rom: r.bytes.slice(ROM_BASE, ROM_BASE + ROM_SIZE), symbols: r.symbols, assembly, origin }
}
