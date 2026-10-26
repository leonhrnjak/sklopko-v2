import { getDef, hasDef } from '../engine/registry'
import { compareTables, type Comparison } from '../logic/compare'
import type { Cell } from '../logic/table'
import { analyzeCircuit, circuitPorts } from './analyze'
import { goalTable, type Challenge, type Rules } from './challenges'
import { busModel } from './buses'
import type { Circuit } from './circuit'
import { runSteps, type TestStep } from './testbench'

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

/** The logic parts of a circuit, custom ICs counted as the parts they are made of. */
const logicOf = (c: Circuit) => Object.values(busModel(c).circuit.comps).filter((k) => hasDef(k.type) && !FREE.has(getDef(k.type).category))

/** How many logic parts the circuit has in all (what the `maxParts` rule counts). */
export const logicParts = (c: Circuit) => logicOf(c).length

/** What a check was about, without the switch positions (flipping a switch doesn't change the answer). */
export const circuitShape = (c: Circuit) =>
  JSON.stringify([
    Object.values(c.comps).map((k) => [k.id, k.type, k.label, JSON.stringify(k.params.inputs ?? '')]),
    Object.values(c.wires).map((w) => [w.from.comp, w.from.pin, w.to.comp, w.to.pin]),
  ])

/** Break the rules? One sentence for each rule that is broken. */
export function ruleProblems(c: Circuit, rules: Rules | undefined): string[] {
  if (!rules) return []
  const logic = logicOf(c)
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

/** Run the steps of a memory challenge in a simulator of its own (the shared step runner of `testbench.ts`). */
function runChallengeSteps(c: Circuit, ch: Challenge & { kind: 'seq' }, inputIds: Record<string, string>, outputIds: Record<string, string>) {
  const steps: TestStep[] = ch.steps.map((step, i) => ({
    line: i + 1,
    text: '',
    actions: [
      { kind: 'set', values: step.set },
      { kind: 'expect', values: step.expect },
    ],
  }))
  const run = runSteps(c, steps, inputIds, outputIds)
  const state: Record<string, 0 | 1> = Object.fromEntries(ch.inputs.map((n) => [n, 0 as 0 | 1]))
  const failures: StepFailure[] = []
  run.outcomes.forEach((o, i) => {
    Object.assign(state, ch.steps[i].set)
    for (const f of o.failures) failures.push({ step: i + 1, switches: { ...state }, output: f.output, expected: f.expected, got: f.got })
  })
  return { failures, unstable: run.unstable }
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
    const { failures, unstable } = runChallengeSteps(c, ch, inputIds, outputIds)
    result.stepCount = ch.steps.length
    result.failures = failures.slice(0, 12)
    if (unstable) result.warnings.push('The circuit keeps changing by itself and never settles in some step (a feedback loop that does not hold a value).')
    result.passed = !failures.length && !unstable
  }
  return result
}
