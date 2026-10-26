import { create } from 'zustand'
import { goalHolds, tick } from '../model/path/goals'
import { markDone } from '../model/path/progress'
import type { ExploreStep } from '../model/path/types'
import { usePath } from './path'
import { commitProgress } from './pathUnlock'
import { sim } from './sim'
import { useStore } from './store'

/**
 * The goals of an explore step, ticked while the learner plays: after each settled step of the simulator they are looked at again,
 * by label, and a goal that has held once stays ticked. The step is done when every goal is. Loads with the step panel.
 */

interface GoalsState {
  /** The step these ticks are for. */
  step: string | null
  ticked: boolean[]
}

export const useGoals = create<GoalsState>(() => ({ step: null, ticked: [] }))

let stopWatching: (() => void) | null = null

export function stopGoals() {
  stopWatching?.()
  stopWatching = null
  useGoals.setState({ step: null, ticked: [] })
}

/** Start looking at a step's goals. A step that is done already shows them all ticked, and stays done. */
export function watchGoals(step: ExploreStep, alreadyDone: boolean) {
  stopGoals()
  useGoals.setState({ step: step.id, ticked: step.goals.map(() => alreadyDone) })
  const look = () => {
    const before = useGoals.getState().ticked
    const circuit = useStore.getState().circuit
    const ticked = tick(step.goals, before, !!step.ordered, (g) => goalHolds(g, circuit, sim))
    if (ticked.every((t, i) => t === before[i])) return
    useGoals.setState({ ticked })
    if (ticked.every(Boolean)) commitProgress(markDone(usePath.getState().progress, step.id, 'solved', Date.now()))
  }
  stopWatching = sim.subscribe(look)
}

// Closing the step, or going to another, ends the watching.
usePath.subscribe((s) => {
  if (useGoals.getState().step !== null && s.step !== useGoals.getState().step) stopGoals()
})
