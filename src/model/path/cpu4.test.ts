import { describe, expect, it } from 'vitest'
import type { Circuit } from '../circuit'
import { EXAMPLES } from '../examples'
import { cutWires } from './board'
import { cpuStage, upgradeControlRom } from './cpu4'
import { checkProject } from './run'
import { STEPS, getStep } from './steps'
import type { ProjectStep } from './types'

const projects = STEPS.filter((s): s is ProjectStep => s.kind === 'project' && s.project === 'cpu4')

/** What a learner is given at the start of a step: the stage before, and the step's own parts. */
function start(s: ProjectStep): Circuit {
  const c = structuredClone(cpuStage(projects[projects.indexOf(s) - 1]?.stage ?? 0))
  s.give?.(c)
  return c
}

describe('the CPU project', () => {
  it('has the stages in order, one step for each', () => {
    expect(projects.map((s) => s.stage)).toEqual([1, 2, 3, 4, 5, 6, 6, 7, 8])
    expect(projects.map((s) => s.id)).toEqual(['cpu-fetch', 'cpu-decode', 'cpu-ldi', 'cpu-ram', 'cpu-add', 'cpu-jump', 'cpu-same', 'cpu-decide', 'cpu-output'])
  })

  for (const s of projects) {
    describe(s.id, () => {
      // A step that only confirms what the one before built (the same stage) is done as soon as it starts.
      it('is not done by the circuit it starts from, unless it only confirms the step before', () => {
        const before = projects[projects.indexOf(s) - 1]
        expect(checkProject(s, start(s)).passed).toBe(before?.stage === s.stage)
      })

      it('is done by its stage of the reference computer, whose every line is ok', () => {
        const r = checkProject(s, cpuStage(s.stage))
        expect(r.problems).toEqual([])
        expect(r.lines.filter((l) => !l.ok)).toEqual([])
        expect(r.lines.length).toBe(s.runs.reduce((n, run) => n + run.checks.length, 0))
        expect(r.passed).toBe(true)
      })

      it('is also done by the stages after it, so a learner who goes on keeps what they had', () => {
        for (let k = s.stage + 1; k <= 8; k++) {
          const later = checkProject(s, cpuStage(k))
          expect(later.lines.filter((l) => !l.ok), `${s.id} at stage ${k}`).toEqual([])
        }
      })
    })
  }

  it('asks for the part it cannot find by its label', () => {
    const fetch = getStep('cpu-fetch') as ProjectStep
    const r = checkProject(fetch, cpuStage(0))
    expect(r.problems.join(' ')).toContain('“PC”')
    expect(r.passed).toBe(false)
  })

  it('notices a missing wire: no clock into the PC, and the opcode not reaching the Control ROM', () => {
    const without = (c: Circuit, match: (w: Circuit['wires'][string]) => boolean): Circuit => ({ ...c, wires: Object.fromEntries(Object.entries(c.wires).filter(([, w]) => !match(w))) })
    const ldi = getStep('cpu-ldi') as ProjectStep
    const full = cpuStage(3)
    const clock = Object.values(full.comps).find((k) => k.type === 'clock')!.id
    const noClock = without(full, (w) => w.from.comp === clock && full.comps[w.to.comp].label === 'ACC')
    expect(checkProject(ldi, noClock).passed).toBe(false)
    const noOpcode = without(full, (w) => w.to.pin === 'A0' && full.comps[w.to.comp].label === 'Control ROM')
    expect(checkProject(ldi, noOpcode).passed).toBe(false)
  })

  it('widens the Control ROM for step 9.9 without losing a row: the computer still jumps and halts', () => {
    const c = structuredClone(cpuStage(6))
    upgradeControlRom(c)
    const rom = Object.values(c.comps).find((k) => k.label === 'Control ROM')!
    expect(rom.params.dbits).toBe(16)
    expect(String(rom.params.data).split(' ').length).toBe(16)
    expect(checkProject(getStep('cpu-jump') as ProjectStep, c).passed).toBe(true)
  })
})

describe('the board project (step 12.4)', () => {
  const step = getStep('wire-board') as ProjectStep
  // Routing the wires of the board takes seconds: it is built once.
  const board = EXAMPLES.find((e) => e.id === step.board!.example)!.build()

  it('starts with the decoder’s gates in place and none of their wires, and does not light the LEDs', () => {
    const start = cutWires(board, step.board!.cut)
    for (const label of step.board!.cut) expect(Object.values(start.comps).some((k) => k.label === label), label).toBe(true)
    expect(Object.keys(start.wires).length).toBeLessThan(Object.keys(board.wires).length)
    const r = checkProject(step, start)
    expect(r.passed).toBe(false)
    expect(r.lines[0].got).toContain('LED register $4000')
  })

  it('is done by the board itself, which blinks the LEDs 1, 2, 4… 128 and 1 again', () => {
    const r = checkProject(step, board)
    expect(r.problems).toEqual([])
    expect(r.passed).toBe(true)
  })

  it('is not done with just one of the wires put back: RAM writes alone do not light the LEDs', () => {
    const start = cutWires(board, step.board!.cut)
    const nrw = Object.values(board.comps).find((k) => k.label === 'writing')!.id
    const back = Object.fromEntries(Object.entries(board.wires).filter(([, w]) => w.from.comp === nrw || w.to.comp === nrw))
    expect(checkProject(step, { ...start, wires: { ...start.wires, ...back } }).passed).toBe(false)
  })
})
