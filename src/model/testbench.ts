import { Simulator } from '../engine/simulator'
import { circuitPorts } from './analyze'
import { flatten } from './buses'
import type { Circuit } from './circuit'
import type { Cell } from '../logic/table'

/**
 * A testbench for any circuit: steps written as text, one for each line, run in order from the circuit switched on with every
 * switch off. In a line, separated by `;`, in the order written:
 *   `A=1 B=0`        set switches (by label; Switch1, Switch2… for those with none)
 *   `pulse CLK`      raise a switch and lower it again: one rising and one falling edge, settling after each
 *   `expect Q=1`     read LEDs (by label) and compare
 * `#` or `//` starts a comment; empty lines are skipped. The text is saved with the circuit (`Circuit.tests`).
 */
export type Action = { kind: 'set'; values: Record<string, 0 | 1> } | { kind: 'pulse'; name: string } | { kind: 'expect'; values: Record<string, 0 | 1> }

export interface TestStep {
  /** 1-based line of the text. */
  line: number
  /** The line as written, without its comment. */
  text: string
  actions: Action[]
}

export interface TestParseError {
  line: number
  message: string
}

const NAME = '[A-Za-z_][A-Za-z0-9_]*'

/** Read the text into steps, or say what is wrong with which line. */
export function parseTests(text: string): { steps: TestStep[]; errors: TestParseError[] } {
  const steps: TestStep[] = []
  const errors: TestParseError[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    const body = raw.replace(/(?:\/\/|#).*$/, '').trim()
    if (!body) return
    const actions: Action[] = []
    let bad = ''
    for (const part of body.split(';')) {
      const seg = part.trim()
      if (!seg) continue
      const pulse = new RegExp(`^pulse(?:\\s+(${NAME}))?$`, 'i').exec(seg)
      if (pulse) {
        if (!pulse[1]) {
          bad = 'pulse needs the name of a switch: pulse CLK.'
          break
        }
        actions.push({ kind: 'pulse', name: pulse[1] })
        continue
      }
      const expect = /^expect(?:\s+(.*))?$/i.exec(seg)
      const assigns = (expect ? (expect[1] ?? '') : seg).split(/[\s,]+/).filter(Boolean)
      if (!assigns.length) {
        bad = 'expect needs what to expect: expect Q=1.'
        break
      }
      const values: Record<string, 0 | 1> = {}
      for (const a of assigns) {
        const m = new RegExp(`^(${NAME})=([01])$`).exec(a)
        if (!m) {
          bad = `“${a}” is not NAME=0 or NAME=1${expect ? '' : ', “pulse NAME” or “expect NAME=…”'}.`
          break
        }
        values[m[1]] = Number(m[2]) as 0 | 1
      }
      if (bad) break
      actions.push({ kind: expect ? 'expect' : 'set', values })
    }
    if (bad) errors.push({ line, message: bad })
    else steps.push({ line, text: body, actions })
  })
  return { steps, errors }
}

/** One thing a step expected that did not come out. */
export interface Failure {
  /** 1-based line of the text. */
  line: number
  output: string
  expected: 0 | 1
  got: Cell
}

export interface StepOutcome {
  line: number
  text: string
  /** The step could not run (a name that is no switch or LED of the circuit): why. */
  problem?: string
  failures: Failure[]
}

export interface TestRun {
  outcomes: StepOutcome[]
  /** Every step ran and everything expected came out. */
  passed: boolean
  /** The circuit kept changing by itself in some step (a feedback loop that never settles). */
  unstable: boolean
}

/**
 * Run steps in a simulator of its own on switches and LEDs found by name: `inputs` and `outputs` map a name to the part's id.
 * Used for the testbench and for the challenges with memory (which are steps with a `set` and an `expect`).
 */
export function runSteps(c: Circuit, steps: TestStep[], inputs: Record<string, string>, outputs: Record<string, string>): TestRun {
  const sim = new Simulator()
  sim.load(flatten(c))
  const state: Record<string, 0 | 1> = Object.fromEntries(Object.keys(inputs).map((n) => [n, 0 as 0 | 1]))
  const apply = (name: string) => sim.setParams(inputs[name], { ...c.comps[inputs[name]].params, on: state[name] === 1 })
  for (const name of Object.keys(inputs)) apply(name)
  sim.settle() // everything off first, so the circuit starts from a known state
  let unstable = false
  const settle = () => {
    sim.settle()
    unstable ||= sim.unstable
  }
  const outcomes = steps.map((step): StepOutcome => {
    const out: StepOutcome = { line: step.line, text: step.text, failures: [] }
    for (const action of step.actions) {
      if (out.problem) break
      if (action.kind === 'set') {
        const unknown = Object.keys(action.values).find((n) => !(n in inputs))
        if (unknown) out.problem = `There is no switch called ${unknown}.`
        else {
          for (const [n, v] of Object.entries(action.values)) {
            state[n] = v
            apply(n)
          }
          settle()
        }
      } else if (action.kind === 'pulse') {
        if (!(action.name in inputs)) out.problem = `There is no switch called ${action.name}.`
        else {
          const was = state[action.name]
          state[action.name] = 1
          apply(action.name)
          settle()
          state[action.name] = 0
          apply(action.name)
          settle()
          // A switch that was on stays on after its pulse.
          if (was === 1) {
            state[action.name] = 1
            apply(action.name)
            settle()
          }
        }
      } else {
        for (const [n, want] of Object.entries(action.values)) {
          if (!(n in outputs)) {
            out.problem = `There is no LED called ${n}.`
            break
          }
          const got = sim.pinValue(outputs[n], 'A') as Cell
          if (got !== want) out.failures.push({ line: step.line, output: n, expected: want, got })
        }
      }
    }
    return out
  })
  return { outcomes, passed: outcomes.every((o) => !o.problem && !o.failures.length) && !unstable, unstable }
}

/** Run the testbench text of a circuit. Names are those the Logic window shows: labels, or Switch1 / LED1… when there are none. */
export function runTests(c: Circuit, text: string): { run: TestRun | null; errors: TestParseError[] } {
  const { steps, errors } = parseTests(text)
  if (errors.length) return { run: null, errors }
  const ports = circuitPorts(c)
  const inputs = Object.fromEntries(ports.inputs.map((p) => [p.name, p.id]))
  const outputs = Object.fromEntries(ports.outputs.map((p) => [p.name, p.id]))
  return { run: runSteps(c, steps, inputs, outputs), errors }
}

/** The names the testbench can use: the circuit's switches and LEDs. */
export function testNames(c: Circuit): { inputs: string[]; outputs: string[] } {
  const ports = circuitPorts(c)
  return { inputs: ports.inputs.map((p) => p.name), outputs: ports.outputs.map((p) => p.name) }
}
