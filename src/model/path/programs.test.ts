import { describe, expect, it } from 'vitest'
import { SKASM, assemble } from '../../engine/isa'
import type { Circuit } from '../circuit'
import { cpuStage } from './cpu4'
import { buildComputer2 } from '../computer2'
import { checkProgram, withSource, withSource8 } from './run'
import { STEPS } from './steps'
import type { ProgramStep } from './types'

const programs = STEPS.filter((s): s is ProgramStep => s.kind === 'program' && s.computer !== 'cpu8')

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
