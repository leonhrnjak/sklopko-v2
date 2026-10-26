import { describe, expect, it } from 'vitest'
import type { Circuit } from '../circuit'
import { cpuStage } from './cpu4'
import { checkProject } from './run'
import { STEPS, getStep } from './steps'
import type { ProjectStep } from './types'

const projects = STEPS.filter((s): s is ProjectStep => s.kind === 'project')

/** What a learner is given at the start of a step: the stage before, and the step's own parts. */
function start(s: ProjectStep): Circuit {
  const c = structuredClone(cpuStage(s.stage - 1))
  s.give?.(c)
  return c
}

describe('the CPU project', () => {
  it('has the stages in order, one step for each', () => {
    expect(projects.map((s) => s.stage)).toEqual(projects.map((_, i) => i + 1))
    expect(projects.map((s) => s.id).slice(0, 4)).toEqual(['cpu-fetch', 'cpu-decode', 'cpu-ldi'])
  })

  for (const s of projects) {
    describe(s.id, () => {
      it('is not done by the circuit it starts from', () => {
        expect(checkProject(s, start(s)).passed).toBe(false)
      })

      it('is done by its stage of the reference computer, whose every line is ok', () => {
        const r = checkProject(s, cpuStage(s.stage))
        expect(r.problems).toEqual([])
        expect(r.lines.filter((l) => !l.ok)).toEqual([])
        expect(r.lines.length).toBe(s.runs.reduce((n, run) => n + run.checks.length, 0))
        expect(r.passed).toBe(true)
      })

      it('is also done by the stages after it, so a learner who goes on keeps what they had', () => {
        for (let k = s.stage + 1; k <= projects.length; k++) {
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
})
