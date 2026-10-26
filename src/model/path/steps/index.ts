import { registerSteps } from '../chips'
import { isDone, type Progress } from '../progress'
import type { Step } from '../types'
import { CH01 } from './ch01'
import { CH02 } from './ch02'

/** Every step, in the order of the path. Loads on demand: the main chunk has only the ids (`../index.ts`). */
export const STEPS: Step[] = [...CH01, ...CH02]

registerSteps(STEPS)

export const getStep = (id: string): Step | undefined => STEPS.find((s) => s.id === id)
export const stepsOf = (chapter: string): Step[] => STEPS.filter((s) => s.chapter === chapter)

/** Every step id, in the order a learner meets them. */
export const PATH_STEPS: readonly string[] = STEPS.map((s) => s.id)

export const hasStep = (id: string) => PATH_STEPS.includes(id)

export const stepIdsOf = (chapter: string): string[] => stepsOf(chapter).map((s) => s.id)

/** The step after `id`, or undefined at the end of the path. */
export const stepAfter = (id: string): string | undefined => PATH_STEPS[PATH_STEPS.indexOf(id) + 1]

/** The step before `id`, or undefined at the start. */
export const stepBefore = (id: string): string | undefined => {
  const at = PATH_STEPS.indexOf(id)
  return at > 0 ? PATH_STEPS[at - 1] : undefined
}

/**
 * Where *Continue* goes: the step the learner was last on, if it is not done; else the first step not done after it; else the
 * first not done at all. Undefined once everything is done.
 */
export function recommended(p: Progress): string | undefined {
  const from = p.current && hasStep(p.current) ? PATH_STEPS.indexOf(p.current) : 0
  return [...PATH_STEPS.slice(from), ...PATH_STEPS.slice(0, from)].find((id) => !isDone(p, id))
}
