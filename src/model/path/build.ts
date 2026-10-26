import { checkChallenge, logicParts, type CheckResult } from '../challengecheck'
import type { Circuit } from '../circuit'
import { challengeOf, chipTable, type Kit } from './chips'
import type { BuildStep } from './types'

/** The circuit a build step starts from: the challenge's labelled switches and LEDs, and the chips the step uses in its table. */
export function stepStarter(step: BuildStep, kit: Kit): Circuit {
  const c = challengeOf(step).starter()
  if (step.uses?.length) c.ics = chipTable(step.uses, kit)
  return c
}

export interface StepCheck {
  check: CheckResult
  /** The step has a par, and the circuit meets it. */
  star: boolean
  /** The logic parts in the circuit, custom ICs counted as what they are made of. */
  parts: number
}

/** Does the circuit solve the step? It is the challenge's own check; the par only decides the star. */
export function checkStepCircuit(step: BuildStep, circuit: Circuit): StepCheck {
  const check = checkChallenge(challengeOf(step), circuit)
  const parts = logicParts(circuit)
  return { check, parts, star: check.passed && !!step.star && parts <= step.star.maxParts }
}
