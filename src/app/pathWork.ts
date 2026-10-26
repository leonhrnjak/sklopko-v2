import { checkStepCircuit, stepStarter } from '../model/path/build'
import { snapshot, notBuilt, refreshChips, solutionOf } from '../model/path/chips'
import { circuitShape } from '../model/challengecheck'
import { markDone } from '../model/path/progress'
import { getStep, stepAfter } from '../model/path/steps'
import type { Step } from '../model/path/types'
import { deserialize } from '../model/serialize'
import { closeChallenge, closeChallengeList, markSolved } from './challenges'
import { openCircuit } from './documents'
import { getDoc, listDocs, metaOf } from './library'
import { closeStep, forgetProgress, openMap, setProgress, usePath } from './path'
import { clearKit, putChip, useKit } from './pathKit'
import { loadCircuit, showToast, useStore } from './store'
import { fitToScreen } from './view'

/**
 * The work on the learning path's steps: opening one, checking it, showing a solution, going on. It loads with the map and the
 * panel (see `path.ts` for what stays in the main chunk), and is modelled on `challengeWork.ts`.
 */

/** Fit the circuit to the canvas once the panel below it has taken its space. */
const fitSoon = () => requestAnimationFrame(() => requestAnimationFrame(fitToScreen))

export const currentStep = (): Step | undefined => {
  const id = usePath.getState().step
  return id ? getStep(id) : undefined
}

/** The shape of the solution that "Show a solution" put on the canvas, while it is unchanged: checking it does not count as solving. */
let shownShape: string | null = null

let opening = 0

/**
 * Open a step. A build step has a document of its own, made the first time it was started (its starting circuit, then whatever was
 * built), so coming back brings the circuit back; its panel shows under the canvas. A read step leaves the canvas as it is.
 */
export async function startStep(id: string) {
  const step = getStep(id)
  if (!step) {
    // An address or a link to a step that is not there: the map is the way to find one.
    openMap()
    return
  }
  const mine = ++opening
  const kit = useKit.getState().kit
  const build = step.kind === 'build' ? step : undefined
  const uses = build?.uses ?? []
  // The challenge panel is the other way to work on a circuit: one at a time.
  closeChallenge()
  closeChallengeList()
  shownShape = null
  usePath.setState({ step: id, mapOpen: false, hintShown: false, result: null, palette: build?.palette ?? null, ours: notBuilt(uses, kit) })
  setProgress({ ...usePath.getState().progress, current: id })
  if (!build) return
  try {
    const doc = (await listDocs('circuit')).find((d) => d.origin?.path === id)
    const rec = doc && (await getDoc(doc.id))
    if (mine !== opening) return
    if (rec) {
      openCircuit(refreshChips(deserialize(rec.data), uses, kit), { mode: 'stored', meta: metaOf(rec) })
      fitSoon()
      return
    }
  } catch {
    // A record that no longer reads: start the step again below.
  }
  if (mine !== opening) return
  openCircuit(stepStarter(build, kit), { mode: 'now', name: `Learn: ${step.title}`, origin: { path: id } })
  fitSoon()
}

/** Check the circuit on the canvas against the open build step. A pass is remembered, and the circuit becomes a chip in the kit. */
export function checkStep() {
  const step = currentStep()
  if (step?.kind !== 'build') return
  const circuit = useStore.getState().circuit
  const { check, star } = checkStepCircuit(step, circuit)
  usePath.setState({ result: { of: circuit, check, star } })
  if (!check.passed) return
  // The solution we showed is not the learner's: it stays "shown" until they change it and check again.
  const shown = shownShape !== null && circuitShape(circuit) === shownShape
  if (!shown && step.chip) putChip(step.id, snapshot(step.chip, circuit))
  setProgress(markDone(usePath.getState().progress, step.id, shown ? 'shown' : 'solved', Date.now(), star))
  if (!shown && typeof step.challenge === 'string') markSolved(step.challenge)
}

/** Replace the canvas with a solution (undo brings the learner's circuit back). The step counts as shown, and the kit gets our chip. */
export function showStepSolution() {
  const step = currentStep()
  if (step?.kind !== 'build') return
  const { kit } = useKit.getState()
  const solution = refreshChips(solutionOf(step), step.uses ?? [], kit)
  loadCircuit(solution)
  fitSoon()
  shownShape = circuitShape(solution)
  usePath.setState({ result: null })
  const { progress } = usePath.getState()
  if (step.chip && progress.done[step.id]?.how !== 'solved') putChip(step.id, snapshot(step.chip, solution))
  setProgress(markDone(progress, step.id, 'shown', Date.now()))
  showToast('This is one way to solve it. Undo (⌘Z) brings your circuit back.')
}

/** Put the starting circuit back on the canvas (undo brings the work back). */
export function restartStep() {
  const step = currentStep()
  if (step?.kind !== 'build') return
  loadCircuit(stepStarter(step, useKit.getState().kit))
  fitSoon()
  shownShape = null
  usePath.setState({ hintShown: false, result: null })
  showToast('The starting circuit is back. Undo (⌘Z) brings your work back.')
}

/** A read step is done when the learner says so. */
export function markRead() {
  const step = currentStep()
  if (step?.kind !== 'read') return
  setProgress(markDone(usePath.getState().progress, step.id, 'read', Date.now()))
}

/** Go to the step after the open one; at the end of the path, back to the map. */
export function nextStep() {
  const id = usePath.getState().step
  const next = id ? stepAfter(id) : undefined
  if (next) void startStep(next)
  else {
    closeStep()
    openMap()
  }
}

/** Forget what was done and the kit. The documents of the steps stay in the library. */
export function forgetAll() {
  forgetProgress()
  clearKit()
}
