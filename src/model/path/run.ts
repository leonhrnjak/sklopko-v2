import { SKASM, assemble, toHexBytes, toHexWords } from '../../engine/isa'
import { Simulator } from '../../engine/simulator'
import { beginnerWords } from '../beginner'
import { flatten } from '../buses'
import type { Circuit } from '../circuit'
import { displayValue, labelled } from './goals'
import { cpuStage } from './cpu4'
import type { CpuRun, Expect, ProgramExpect, ProgramStep, ProjectStep } from './types'

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

const labels = (e: Expect) => ('value' in e ? e.value : 'ram' in e ? e.ram : e.led)

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
          } else if ('ram' in e) {
            const mem = sim.state(labelled(c, e.ram)!.id)?.mem as ArrayLike<number> | undefined
            const got = mem?.[e.at]
            if (got !== e.is) wrong.push(`${e.ram} word ${e.at} is ${got ?? 'unknown'}, not ${e.is}`)
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

// ---- Programs -----------------------------------------------------------------------------------------------

/** What a program did: whether it reached HALT (and in how many ticks), what is left in the ACC and the RAM, and the numbers sent to the output. */
export interface Outcome {
  halted: boolean
  cycles: number
  acc: number | null
  ram: number[]
  writes: number[]
  /** What is on the console, on a computer that has one. */
  text?: string
}

/** The most ticks a program may take before it counts as never stopping. */
export const MAX_TICKS = 400

/** The circuit with this program (text) in its Program ROM. */
export const withSource = (c: Circuit, source: string): Circuit | undefined => withProgram(c, source)

/** Run a program on a computer until it reaches HALT. A string is what is wrong with the computer (a part is missing). */
export function runProgram(circuit: Circuit, source: string, needOutput = false): Outcome | string {
  for (const label of ['Program ROM', 'Halted', 'ACC', 'RAM', ...(needOutput ? ['Output'] : [])]) if (!labelled(circuit, label)) return `There is no part labelled “${label}”.`
  if (!Object.values(circuit.comps).some((k) => k.type === 'clock')) return 'There is no clock.'
  const c = withProgram(circuit, source)!
  const sim = new Simulator()
  sim.load(flatten(c))
  sim.settle()
  const halted = labelled(c, 'Halted')!
  const ram = labelled(c, 'RAM')!
  const out = labelled(c, 'Output')
  const writes: number[] = []
  let cycles = 0
  while (cycles < MAX_TICKS && sim.pinValue(halted.id, 'A') !== 1) {
    // A load of the output register at this tick (the clock rises next): what it takes is what the program wrote.
    if (out && sim.pinValue(out.id, 'LD') === 1) {
      let n = 0
      for (let i = 0; i < 4; i++) n |= (sim.pinValue(out.id, 'ABCD'[i]) === 1 ? 1 : 0) << i
      writes.push(n)
    }
    sim.stepClock()
    sim.stepClock()
    cycles++
  }
  return { halted: sim.pinValue(halted.id, 'A') === 1, cycles, acc: partValue(c, sim, 'ACC'), ram: Array.from(sim.state(ram.id).mem as ArrayLike<number>), writes }
}

// The 8-bit computer (the Computers examples): one computer only, and a console.

/** The circuit with this program in the Program ROM of the 8-bit computer (its words, and the table of its `.byte` lines). */
export function withSource8(c: Circuit, source: string): Circuit | undefined {
  const rom = labelled(c, 'Program')
  if (!rom || rom.type !== 'rom') return undefined
  const r = assemble(SKASM, source, 256)
  if (r.errors.length) return undefined
  return { ...c, comps: { ...c.comps, [rom.id]: { ...rom, params: { ...rom.params, isa: SKASM.id, source, data: toHexWords(r.words, SKASM.bits), tdata: toHexBytes(r.table) } } } }
}

/** The most ticks a program may take on the 8-bit computer (it is slower to simulate, and the programs are short). */
export const MAX_TICKS_8 = 3000

/** Run a program on the 8-bit computer until it reaches HALT. A string is what is wrong with the computer (a part is missing). */
export function runProgram8(circuit: Circuit, source: string): Outcome | string {
  for (const label of ['Program', 'Halted', 'ACC', 'Data RAM']) if (!labelled(circuit, label)) return `There is no part labelled “${label}”.`
  const c = withSource8(circuit, source)
  if (!c) return 'The program does not assemble.'
  const sim = new Simulator()
  sim.load(flatten(c))
  sim.settle()
  const halted = labelled(c, 'Halted')!
  const acc = labelled(c, 'ACC')!
  const ram = labelled(c, 'Data RAM')!
  const screen = labelled(c, 'LCD text display')
  let cycles = 0
  while (cycles < MAX_TICKS_8 && sim.pinValue(halted.id, 'A') !== 1) {
    sim.stepClock()
    sim.stepClock()
    cycles++
  }
  let a = 0
  for (let i = 0; i < 8; i++) a |= (sim.pinValue(acc.id, `Q${i}`) === 1 ? 1 : 0) << i
  return {
    halted: sim.pinValue(halted.id, 'A') === 1,
    cycles,
    acc: a,
    ram: Array.from(sim.state(ram.id).mem as ArrayLike<number>),
    writes: [],
    text: screen ? String((sim.state(screen.id) as { lines: string[] }).lines.join('\n')) : '',
  }
}

/** What differs between what a program did and what was wanted, as sentences; nothing when it is right. */
export function wrongIn(o: Outcome, want: ProgramExpect): string[] {
  const wrong: string[] = []
  if (!o.halted) wrong.push(`it did not stop (no HALT in ${o.cycles} ticks)`)
  if (want.console !== undefined && (o.text ?? '').trim() !== want.console) wrong.push(`the console shows “${(o.text ?? '').trim()}”, not “${want.console}”`)
  for (const [at, is] of Object.entries(want.ram ?? {})) if (o.ram[Number(at)] !== is) wrong.push(`RAM word ${at} is ${o.ram[Number(at)]}, not ${is}`)
  if (want.acc !== undefined && o.acc !== want.acc) wrong.push(`the ACC is ${o.acc}, not ${want.acc}`)
  if (want.writes && (o.writes.length !== want.writes.length || o.writes.some((w, i) => w !== want.writes![i]))) wrong.push(`the output got ${o.writes.length ? o.writes.join(' ') : 'nothing'}, not ${want.writes.join(' ')}`)
  return wrong
}

/** Put these numbers on the first `.byte` line (the table), if the program has one. */
const patchBytes = (source: string, bytes?: number[]) => (bytes ? source.replace(/\.byte[^\n]*/i, `.byte ${bytes.join(', ')}`) : source)

/** The source with its comments taken out. */
const code = (source: string) => source.replace(/(;|\/\/).*$/gm, '')

/** Put `NAME = value` on the line that defines the constant NAME, if the program has one. */
const patchConstants = (source: string, set: Record<string, number> = {}) =>
  Object.entries(set).reduce((src, [name, value]) => src.replace(new RegExp(`^(\\s*${name}\\s*=\\s*)\\S+`, 'm'), `$1${value}`), source)

/**
 * Check a learner's program: each test runs it on the reference computer and on theirs. A program that is wrong on the reference is wrong;
 * one that is right there but not on theirs is a computer that does not work yet, and the verdict says so.
 */
export function checkProgram(step: ProgramStep, circuit: Circuit): ProjectResult {
  if (step.computer === 'cpu8') return checkProgram8(step, circuit)
  const result: ProjectResult = { passed: false, problems: [], lines: [] }
  const rom = labelled(circuit, 'Program ROM')
  if (!rom || rom.type !== 'rom') {
    result.problems.push('There is no part labelled “Program ROM”.')
    return result
  }
  const source = String(rom.params.source ?? '')
  const asm = assemble(SKASM, source, 16)
  if (asm.errors.length) {
    for (const e of asm.errors.slice(0, 4)) result.problems.push(`Line ${e.line}: ${e.message}`)
    return result
  }
  const needOutput = step.tests.some((t) => t.expect.writes)
  const reference = cpuStage(8)
  for (const test of step.tests) {
    const src = patchConstants(source, test.set)
    const mine = runProgram(circuit, src, needOutput)
    const theirs = runProgram(reference, src, needOutput) as Outcome
    const wantWrong = wrongIn(theirs, test.expect)
    const line = { text: test.title, ok: false } as ProjectResult['lines'][number]
    if (wantWrong.length) line.got = `your program: ${wantWrong.join('; ')}`
    else if (typeof mine === 'string') line.got = mine
    else {
      const mineWrong = wrongIn(mine, test.expect)
      if (mineWrong.length) line.got = `your computer: ${mineWrong.join('; ')}`
      else line.ok = true
    }
    if (!line.ok && !wantWrong.length) result.problems.push(`${test.title}: your program is right (it works on the reference computer), but your computer gives a different answer. Look for the step of chapter 9 that builds what the program uses.`)
    result.lines.push(line)
  }
  result.problems = [...new Set(result.problems)]
  result.passed = result.lines.every((l) => l.ok)
  return result
}

/** Check a program on the 8-bit computer: it runs on the circuit on the canvas, which has the Program ROM. */
function checkProgram8(step: ProgramStep, circuit: Circuit): ProjectResult {
  const result: ProjectResult = { passed: false, problems: [], lines: [] }
  const rom = labelled(circuit, 'Program')
  if (!rom || rom.type !== 'rom') {
    result.problems.push('There is no part labelled “Program”.')
    return result
  }
  const source = String(rom.params.source ?? '')
  const asm = assemble(SKASM, source, 256)
  if (asm.errors.length) {
    for (const e of asm.errors.slice(0, 4)) result.problems.push(`Line ${e.line}: ${e.message}`)
    return result
  }
  for (const word of step.needs ?? []) if (!new RegExp(`\\b${word}\\b`, 'i').test(code(source))) result.problems.push(`The program has to use ${word}.`)
  for (const test of step.tests) {
    const o = runProgram8(circuit, patchBytes(patchConstants(source, test.set), test.bytes))
    const line = { text: test.title, ok: false } as ProjectResult['lines'][number]
    if (typeof o === 'string') line.got = o
    else {
      const wrong = wrongIn(o, test.expect)
      if (wrong.length) line.got = wrong.join('; ')
      else line.ok = true
    }
    result.lines.push(line)
  }
  result.passed = result.lines.every((l) => l.ok) && !result.problems.length
  return result
}
