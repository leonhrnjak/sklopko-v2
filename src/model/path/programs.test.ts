import { describe, expect, it } from 'vitest'
import { SKASM, assemble } from '../../engine/isa'
import type { Circuit } from '../circuit'
import { cpuStage } from './cpu4'
import { buildComputer2 } from '../computer2'
import { checkProgram, withSource, withSource6502, withSource8 } from './run'
import { EXAMPLES } from '../examples'
import { STEPS } from './steps'
import type { ProgramStep } from './types'

const programs = STEPS.filter((s): s is ProgramStep => s.kind === 'program' && !s.computer)

/** The reference computer with this program in its ROM, as the learner's circuit would be. */
const computerWith = (source: string): Circuit => withSource(cpuStage(8), source)!

describe('programs of chapter 10', () => {
  it('has the four steps in the order of the plan', () => {
    expect(programs.map((s) => s.id)).toEqual(['prog-add', 'prog-countdown', 'prog-multiply', 'prog-fib'])
  })

  for (const s of programs) {
    describe(s.id, () => {
      it('has a starter and a solution that assemble, in no more than 16 words', () => {
        for (const text of [s.starter, s.solution]) {
          const r = assemble(SKASM, text, 16)
          expect(r.errors, text).toEqual([])
        }
      })

      it('is not done by its starter (nothing is written yet)', () => {
        expect(checkProgram(s, computerWith(s.starter)).passed).toBe(false)
      })

      it('is done by its solution, on the reference computer', () => {
        const r = checkProgram(s, computerWith(s.solution))
        expect(r.problems).toEqual([])
        expect(r.lines.filter((l) => !l.ok)).toEqual([])
        expect(r.passed).toBe(true)
      })
    })
  }

  it('says a program is wrong when it is wrong on the reference computer too', () => {
    const add = programs[0]
    const r = checkProgram(add, computerWith('LDI 2\nSTA 0\nLDI 4\nADD 0\nSTA 2\nHALT'))
    expect(r.passed).toBe(false)
    expect(r.lines[0].got).toContain('your program: RAM word 2 is 6, not 7')
  })

  it('says it is the computer when the program is right but the learner’s computer is not', () => {
    const add = programs[0]
    // A computer whose adder has been cut off from the multiplexers: ADD cannot reach the ACC.
    const c = structuredClone(computerWith(add.solution))
    const adder = Object.values(c.comps).find((k) => k.label === 'Adder')!.id
    c.wires = Object.fromEntries(Object.entries(c.wires).filter(([, w]) => w.from.comp !== adder || !w.from.pin.startsWith('S')))
    const r = checkProgram(add, c)
    expect(r.passed).toBe(false)
    expect(r.lines[0].got).toContain('your computer')
    expect(r.problems.join(' ')).toContain('your program is right')
  })

  it('reports an error in the program with its line', () => {
    // The inspector keeps the text the learner typed even when it does not assemble.
    const c = structuredClone(computerWith('HALT'))
    const rom = Object.values(c.comps).find((k) => k.label === 'Program ROM')!
    rom.params = { ...rom.params, source: 'LDI 1\nNOPE 2' }
    const r = checkProgram(programs[0], c)
    expect(r.passed).toBe(false)
    expect(r.problems[0]).toMatch(/^Line 2:/)
  })
})

describe('programs of chapter 11, on the 8-bit computer', () => {
  const eight = STEPS.filter((s): s is ProgramStep => s.kind === 'program' && s.computer === 'cpu8')
  // Routing the wires takes seconds: the computer is built once, and only the program is swapped.
  const base = buildComputer2({ id: 'test', name: 'test', source: 'HALT', hz: 16, devices: ['console'], note: '' })
  const computer = (source: string) => withSource8(base, source)!

  it('has the three programs, in order', () => {
    expect(eight.map((s) => s.id)).toEqual(['prog-console', 'prog-table-sum', 'prog-call'])
  })

  for (const s of eight) {
    describe(s.id, () => {
      it('has a starter and a solution that assemble', () => {
        for (const text of [s.starter, s.solution]) expect(assemble(SKASM, text, 256).errors, text).toEqual([])
      })

      it('is not done by its starter, and is done by its solution', () => {
        expect(checkProgram(s, computer(s.starter)).passed).toBe(false)
        const r = checkProgram(s, computer(s.solution))
        expect(r.problems).toEqual([])
        expect(r.lines.filter((l) => !l.ok)).toEqual([])
        expect(r.passed).toBe(true)
      })
    })
  }

  it('changes the numbers of the table, so a program that adds the constants itself does not pass', () => {
    const table = eight.find((s) => s.id === 'prog-table-sum')!
    const cheat = checkProgram(table, computer('LDI 25\nHALT\n.byte 3, 9, 4, 7, 2'))
    expect(cheat.passed).toBe(false)
    expect(cheat.lines.map((l) => l.ok)).toEqual([true, false, false])
  })

  it('asks for CALL and RET, and changes START', () => {
    const call = eight.find((s) => s.id === 'prog-call')!
    const without = checkProgram(call, computer('START = 1\nLDI START\nSHL\nSHL\nSHL\nHALT'))
    expect(without.passed).toBe(false)
    expect(without.problems).toEqual(['The program has to use CALL.', 'The program has to use RET.'])
    expect(without.lines.map((l) => l.ok)).toEqual([true, true, true])
    // A mention in a comment is not a use.
    expect(checkProgram(call, computer('; CALL RET\nSTART = 1\nLDI START\nSHL\nSHL\nSHL\nHALT')).problems.length).toBe(2)
  })
})

describe('programs of chapter 13, on a 6502 board', () => {
  const boards = STEPS.filter((s): s is ProgramStep => s.kind === 'program' && s.computer === 'board6502')
  // Routing the wires of a board takes seconds: each example is built once.
  const built = new Map<string, Circuit>()
  const computer = (s: ProgramStep, source: string): Circuit => {
    if (!built.has(s.example!)) built.set(s.example!, EXAMPLES.find((e) => e.id === s.example)!.build())
    return withSource6502(built.get(s.example!)!, source)!
  }

  it('has the six programs, in order', () => {
    expect(boards.map((s) => s.id)).toEqual(['asm-leds', 'asm-count', 'asm-arith', 'asm-string', 'asm-subroutine', 'asm-lcd'])
  })

  for (const s of boards) {
    describe(s.id, () => {
      it('has a starter and a solution that assemble for its board', () => {
        expect(withSource6502(computer(s, s.starter), s.starter), 'starter').toBeDefined()
        expect(withSource6502(computer(s, s.solution), s.solution), 'solution').toBeDefined()
      })

      it('is not done by its starter, and is done by its solution', () => {
        expect(checkProgram(s, computer(s, s.starter)).passed).toBe(false)
        const r = checkProgram(s, computer(s, s.solution))
        expect(r.problems).toEqual([])
        expect(r.lines.filter((l) => !l.ok)).toEqual([])
        expect(r.passed).toBe(true)
      })
    })
  }

  it('says where a program has to begin when it does not begin where the ROM does', () => {
    const lcd = boards.find((s) => s.id === 'asm-lcd')!
    const wrong = computer(lcd, lcd.solution)
    const rom = Object.values(wrong.comps).find((k) => k.type === 'rom' && String(k.label).startsWith('ROM'))!
    rom.params = { ...rom.params, source: '.org $F000\nstart: JMP start\n.org $FFFC\n.word start' }
    expect(checkProgram(lcd, wrong).problems[0]).toContain('.org $C000')
  })

  it('asks for the instructions it teaches: INX, TXA and BNE', () => {
    const count = boards.find((s) => s.id === 'asm-count')!
    const r = checkProgram(count, computer(count, '.org $F000\nstart: LDA #1\n STA $4000\ndone: JMP done\n.org $FFFC\n.word start'))
    expect(r.problems).toEqual(['The program has to use INX.', 'The program has to use TXA.', 'The program has to use BNE.'])
  })

  it('asks for the instructions it teaches: CLC, ADC and CMP', () => {
    const arith = boards.find((s) => s.id === 'asm-arith')!
    const r = checkProgram(arith, computer(arith, '.org $F000\nstart: LDA #1\n STA $4000\ndone: JMP done\n.org $FFFC\n.word start'))
    expect(r.problems).toEqual(['The program has to use CLC.', 'The program has to use ADC.', 'The program has to use CMP.'])
  })
})
