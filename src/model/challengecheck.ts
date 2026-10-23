import { getDef, hasDef } from '../engine/registry'
import { Simulator } from '../engine/simulator'
import { compareTables, type Comparison } from '../logic/compare'
import type { Cell } from '../logic/table'
import { analyzeCircuit, circuitPorts } from './analyze'
import { goalTable, type Challenge, type Rules } from './challenges'
import { flatten } from './buses'
import type { Circuit } from './circuit'

/** A step of a memory challenge that did not come out as expected. */
export interface StepFailure {
  /** 1-based. */
  step: number
  /** All switches as they were set in this step. */
  switches: Record<string, 0 | 1>
  output: string
  expected: 0 | 1
  got: Cell
}

export interface CheckResult {
  passed: boolean
  /** Reasons the circuit could not be checked or breaks the rules, in words. When there are any, `passed` is false. */
  problems: string[]
  /** Combinational challenges: the goal against the circuit. */
  comparison?: Comparison
  /** Memory challenges: the steps that went wrong (the first few), and how many steps there are. */
  failures?: StepFailure[]
  stepCount?: number
  /** Things to be careful about, which don't make it fail. */
  warnings: string[]
}

/** Parts that are never counted against the rules: they are the circuit's surroundings, not its logic. */
const FREE = new Set(['io', 'display', 'annotation'])

/** Break the rules? One sentence for each rule that is broken. */
export function ruleProblems(c: Circuit, rules: Rules | undefined): string[] {
  if (!rules) return []
  const logic = Object.values(c.comps).filter((k) => hasDef(k.type) && !FREE.has(getDef(k.type).category))
  const problems: string[] = []
  if (rules.only) {
    const wrong = [...new Set(logic.filter((k) => !rules.only!.includes(k.type)).map((k) => getDef(k.type).name))]
    if (wrong.length) {
      const allowed = rules.only.map((t) => getDef(t).name).join(', ')
      problems.push(`This challenge only allows ${allowed} gates, but the circuit uses ${wrong.join(', ')}.`)
    }
  }
  if (rules.maxParts !== undefined && logic.length > rules.maxParts)
    problems.push(`This challenge allows at most ${rules.maxParts} gate${rules.maxParts === 1 ? '' : 's'}, but the circuit has ${logic.length}.`)
  return problems
}

/** Run the steps of a memory challenge in a simulator of its own. */
function runSteps(c: Circuit, ch: Challenge & { kind: 'seq' }, inputIds: Record<string, string>, outputIds: Record<string, string>) {
  const sim = new Simulator()
  sim.load(flatten(c))
  const state: Record<string, 0 | 1> = Object.fromEntries(ch.inputs.map((n) => [n, 0 as 0 | 1]))
  const apply = () => {
    for (const n of ch.inputs) sim.setParams(inputIds[n], { ...c.comps[inputIds[n]].params, on: state[n] === 1 })
    sim.settle()
  }
  apply() // everything off first, so the circuit starts from a known state
  const failures: StepFailure[] = []
  let unstable = false
  ch.steps.forEach((step, i) => {
    Object.assign(state, step.set)
    apply()
    unstable ||= sim.unstable
    for (const [name, want] of Object.entries(step.expect)) {
      const got = sim.pinValue(outputIds[name], 'A') as Cell
      if (got !== want) failures.push({ step: i + 1, switches: { ...state }, output: name, expected: want, got })
    }
  })
  return { failures, unstable }
}

/** Does the circuit solve the challenge? Switches and LEDs are found by their labels. */
export function checkChallenge(ch: Challenge, c: Circuit): CheckResult {
  const result: CheckResult = { passed: false, problems: [], warnings: [] }
  const ports = circuitPorts(c)
  const inputIds: Record<string, string> = {}
  const outputIds: Record<string, string> = {}
  for (const name of ch.inputs) {
    const p = ports.inputs.find((x) => x.name === name)
    if (p) inputIds[name] = p.id
    else result.problems.push(`There is no switch labelled “${name}”. Select a switch and give it that label.`)
  }
  for (const name of ch.outputs) {
    const p = ports.outputs.find((x) => x.name === name)
    if (p) outputIds[name] = p.id
    else result.problems.push(`There is no LED labelled “${name}”. Select an LED and give it that label.`)
  }
  result.problems.push(...ruleProblems(c, ch.rules))
  if (result.problems.length) return result

  if (ch.kind === 'comb') {
    const a = analyzeCircuit(c, ch.inputs.map((n) => inputIds[n]), ch.outputs.map((n) => outputIds[n]))
    result.warnings = a.warnings
    result.comparison = compareTables(goalTable(ch), a.table)
    result.passed = result.comparison.equal
  } else {
    const { failures, unstable } = runSteps(c, ch, inputIds, outputIds)
    result.stepCount = ch.steps.length
    result.failures = failures.slice(0, 12)
    if (unstable) result.warnings.push('The circuit keeps changing by itself and never settles in some step (a feedback loop that does not hold a value).')
    result.passed = !failures.length && !unstable
  }
  return result
}
