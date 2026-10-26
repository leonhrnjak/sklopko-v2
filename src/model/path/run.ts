import { SKASM } from '../../engine/isa'
import { Simulator } from '../../engine/simulator'
import { beginnerWords } from '../beginner'
import { flatten } from '../buses'
import type { Circuit } from '../circuit'
import { displayValue, labelled } from './goals'
import type { CpuRun, Expect, ProjectStep } from './types'

/** What a check of a project step found: problems that stop it (a part is missing), then a line for each thing looked at. */
export interface ProjectResult {
  passed: boolean
  problems: string[]
  lines: { text: string; ok: boolean; /** What the computer showed instead. */ got?: string }[]
}

/** The pins that make a part's number: a counter's Q, a register's Q, a hex display's inputs, a ROM's data. */
function pinsOf(type: string, params: Record<string, unknown>): string[] | undefined {
  if (type === 'counterld' || type === 'counter') return [0, 1, 2, 3].map((i) => `Q${i}`)
  if (type === 'register') return ['QA', 'QB', 'QC', 'QD']
  if (type === 'rom') return Array.from({ length: Number(params.dbits) || 4 }, (_, i) => `D${i}`)
  return undefined
}

/** The number a part shows, or null while it is unknown (or the part is not one that has a number). */
export function partValue(c: Circuit, sim: Simulator, label: string): number | null {
  const k = labelled(c, label)
  if (!k) return null
  if (k.type === 'hexdisp') return displayValue(c, label, sim)
  const pins = pinsOf(k.type, k.params)
  if (!pins) return null
  let n = 0
  for (let i = 0; i < pins.length; i++) {
    const v = sim.pinValue(k.id, pins[i])
    if (v !== 0 && v !== 1) return null
    n |= v << i
  }
  return n
}

const labels = (e: Expect) => ('value' in e ? e.value : e.led)

/** Parts a run needs, by label. */
const wanted = (runs: readonly CpuRun[]) => [...new Set(runs.flatMap((r) => r.checks.flatMap((k) => k.expect.map(labels))).concat('Program ROM'))]

/** The circuit with a test program in its Program ROM. */
function withProgram(c: Circuit, program: string): Circuit | undefined {
  const rom = labelled(c, 'Program ROM')
  if (!rom || rom.type !== 'rom') return undefined
  return { ...c, comps: { ...c.comps, [rom.id]: { ...rom, params: { ...rom.params, isa: SKASM.id, source: program, data: beginnerWords(program) } } } }
}

/**
 * Run a step's test programs on the learner's computer: each program goes into the Program ROM, the clock is ticked, and after the
 * ticks a check names, the parts it looks at are read by their labels.
 */
export function checkProject(step: ProjectStep, circuit: Circuit): ProjectResult {
  const result: ProjectResult = { passed: false, problems: [], lines: [] }
  for (const label of wanted(step.runs)) if (!labelled(circuit, label)) result.problems.push(`There is no part labelled “${label}”. Select the part and give it that label.`)
  if (!Object.values(circuit.comps).some((k) => k.type === 'clock')) result.problems.push('There is no clock.')
  if (result.problems.length) return result
  let unstable = false
  for (const run of step.runs) {
    const c = withProgram(circuit, run.program)!
    const sim = new Simulator()
    sim.load(flatten(c))
    sim.settle()
    const last = Math.max(...run.checks.map((k) => k.after))
    for (let t = 0; t <= last; t++) {
      for (const check of run.checks.filter((k) => k.after === t)) {
        const wrong: string[] = []
        for (const e of check.expect) {
          if ('value' in e) {
            const got = partValue(c, sim, e.value)
            if (got !== e.is) wrong.push(`${e.value} is ${got === null ? 'unknown' : got}, not ${e.is}`)
          } else {
            const k = labelled(c, e.led)!
            const got = sim.pinValue(k.id, 'A')
            if (got !== e.is) wrong.push(`${e.led} is ${got === 1 ? 'lit' : got === 0 ? 'dark' : 'unknown'}, not ${e.is ? 'lit' : 'dark'}`)
          }
        }
        result.lines.push({ text: `${run.title}: ${check.text}`, ok: !wrong.length, ...(wrong.length ? { got: wrong.join('; ') } : {}) })
      }
      // One tick: the clock goes up and comes down again.
      sim.stepClock()
      sim.stepClock()
      unstable ||= sim.unstable
    }
  }
  if (unstable) result.problems.push('The circuit never settles (a feedback loop that does not hold a value).')
  result.passed = result.lines.every((l) => l.ok) && !result.problems.length
  return result
}
