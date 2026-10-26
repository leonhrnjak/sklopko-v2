import { checkStepCircuit, stepStarter } from '../model/path/build'
import { chipTable, snapshot, notBuilt, refreshChips, solutionOf } from '../model/path/chips'
import { circuitShape } from '../model/challengecheck'
import type { Circuit } from '../model/circuit'
import { cpuStage } from '../model/path/cpu4'
import { markDone } from '../model/path/progress'
import { checkProject } from '../model/path/run'
import { STEPS, getStep, stepAfter, unlockedParts } from '../model/path/steps'
import type { ProjectStep, Question, Step } from '../model/path/types'
import { deserialize } from '../model/serialize'
import { closeChallenge, closeChallengeList, markSolved } from './challenges'
import { flushSave, openCircuit } from './documents'
import { stopGoals, watchGoals } from './pathGoals'
import { getDoc, listDocs, metaOf } from './library'
import { closeStep, forgetProgress, openMap, setProgress, usePath } from './path'
import { clearKit, putChip, useKit } from './pathKit'
import { clearProject, useProject } from './pathProject'
import { commitProgress } from './pathUnlock'
import { loadCircuit, showToast, useStore } from './store'
import { fitToScreen } from './view'

/**
 * The work on the learning path's steps: opening one, checking it, showing a solution, going on. It loads with the map and the
 * panel (see `path.ts` for what stays in the main chunk), and is modelled on `challengeWork.ts`.
 */

/** Fit the circuit to the canvas once the panel below it has taken its space. */
const fitSoon = () => {
  requestAnimationFrame(() => requestAnimationFrame(fitToScreen))
  // The panel under the canvas has not always taken its room by then (a step opened from its address): once more when it has.
  window.setTimeout(fitToScreen, 300)
}

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
  const explore = step.kind === 'explore' ? step : undefined
  const project = step.kind === 'project' ? step : undefined
  const uses = build?.uses ?? (step.kind === 'project' ? step.uses : undefined) ?? []
  // The challenge panel is the other way to work on a circuit: one at a time.
  closeChallenge()
  closeChallengeList()
  stopGoals()
  clearProject()
  shownShape = null
  const playable = explore ?? project
  usePath.setState({ step: id, mapOpen: false, hintShown: false, result: null, palette: build?.palette ?? (playable?.palette && [...new Set([...playable.palette, ...unlockedParts(usePath.getState().progress)])]) ?? null, ours: notBuilt(uses, kit) })
  setProgress({ ...usePath.getState().progress, current: id })
  if (!build && !explore && !project) return
  const watch = () => explore && watchGoals(explore, !!usePath.getState().progress.done[id])
  try {
    const doc = (await listDocs('circuit')).find((d) => d.origin?.path === id)
    const rec = doc && (await getDoc(doc.id))
    if (mine !== opening) return
    if (rec) {
      openCircuit(refreshChips(deserialize(rec.data), uses, kit), { mode: 'stored', meta: metaOf(rec) })
      fitSoon()
      watch()
      return
    }
  } catch {
    // A record that no longer reads: start the step again below.
  }
  if (mine !== opening) return
  openCircuit(build ? stepStarter(build, kit) : explore ? explore.open.build() : await projectStarter(project!), { mode: 'now', name: `Learn: ${step.title}`, origin: { path: id } })
  if (mine !== opening) return
  fitSoon()
  watch()
}

/**
 * What a step of the CPU project starts from: the learner's circuit at the end of the step before, or the reference computer of that stage
 * when they skipped it, and the parts this step gives.
 */
async function projectStarter(step: ProjectStep): Promise<Circuit> {
  const mine = STEPS.filter((s): s is ProjectStep => s.kind === 'project' && s.project === step.project)
  const before = mine[mine.indexOf(step) - 1]
  flushSave() // what is on the canvas may be the circuit of the step before, not yet kept
  let c: Circuit | undefined
  try {
    const doc = before && (await listDocs('circuit')).find((d) => d.origin?.path === before.id)
    const rec = doc && (await getDoc(doc.id))
    if (rec) c = deserialize(rec.data)
  } catch {
    // A circuit that no longer reads: the reference one is the way on.
  }
  c ??= structuredClone(cpuStage(before?.stage ?? 0))
  step.give?.(c)
  if (step.uses?.length) c.ics = { ...chipTable(step.uses, useKit.getState().kit), ...c.ics }
  return c
}

/** Run the open project step's test programs on the circuit on the canvas. A pass is remembered. */
function checkProjectStep(step: ProjectStep) {
  const circuit = useStore.getState().circuit
  const result = checkProject(step, circuit)
  useProject.setState({ step: step.id, of: circuit, result })
  if (!result.passed) return
  const shown = shownShape !== null && circuitShape(circuit) === shownShape
  commitProgress(markDone(usePath.getState().progress, step.id, shown ? 'shown' : 'solved', Date.now()))
}

/** Check the circuit on the canvas against the open build step. A pass is remembered, and the circuit becomes a chip in the kit. */
export function checkStep() {
  const step = currentStep()
  if (step?.kind === 'project') return checkProjectStep(step)
  if (step?.kind !== 'build') return
  const circuit = useStore.getState().circuit
  const { check, star } = checkStepCircuit(step, circuit)
  usePath.setState({ result: { of: circuit, check, star } })
  if (!check.passed) return
  // The solution we showed is not the learner's: it stays "shown" until they change it and check again.
  const shown = shownShape !== null && circuitShape(circuit) === shownShape
  if (!shown && step.chip) putChip(step.id, snapshot(step.chip, circuit))
  commitProgress(markDone(usePath.getState().progress, step.id, shown ? 'shown' : 'solved', Date.now(), star))
  if (!shown && typeof step.challenge === 'string') markSolved(step.challenge)
}

/** Replace the canvas with a solution (undo brings the learner's circuit back). The step counts as shown, and the kit gets our chip. */
export function showStepSolution() {
  const step = currentStep()
  if (step?.kind === 'project') return showProjectSolution(step)
  if (step?.kind !== 'build') return
  const { kit } = useKit.getState()
  const solution = refreshChips(solutionOf(step), step.uses ?? [], kit)
  loadCircuit(solution)
  fitSoon()
  shownShape = circuitShape(solution)
  usePath.setState({ result: null })
  const { progress } = usePath.getState()
  if (step.chip && progress.done[step.id]?.how !== 'solved') putChip(step.id, snapshot(step.chip, solution))
  showToast('This is one way to solve it. Undo (⌘Z) brings your circuit back.')
  // After the toast: a chapter this completes says what it unlocked, which matters more.
  commitProgress(markDone(progress, step.id, 'shown', Date.now()))
}

/** Replace the canvas with the reference computer at the end of this step. The step counts as shown. */
function showProjectSolution(step: ProjectStep) {
  const solution = structuredClone(cpuStage(step.stage))
  loadCircuit(solution)
  fitSoon()
  shownShape = circuitShape(solution)
  useProject.setState({ of: null, result: null })
  showToast('This is one way to build it. Undo (⌘Z) brings your circuit back.')
  commitProgress(markDone(usePath.getState().progress, step.id, 'shown', Date.now()))
}

/** Put the starting circuit back on the canvas (undo brings the work back). */
export async function restartStep() {
  const step = currentStep()
  if (step?.kind !== 'build' && step?.kind !== 'explore' && step?.kind !== 'project') return
  loadCircuit(step.kind === 'build' ? stepStarter(step, useKit.getState().kit) : step.kind === 'explore' ? step.open.build() : await projectStarter(step))
  useProject.setState({ of: null, result: null })
  fitSoon()
  shownShape = null
  usePath.setState({ hintShown: false, result: null })
  if (step.kind === 'explore') watchGoals(step, !!usePath.getState().progress.done[step.id])
  showToast('The starting circuit is back. Undo (⌘Z) brings your work back.')
}

/** A read step is done when the learner says so. */
export function markRead() {
  const step = currentStep()
  if (step?.kind !== 'read') return
  commitProgress(markDone(usePath.getState().progress, step.id, 'read', Date.now()))
}

/** Remember an answer to question `i` of a step's quiz. A step whose questions are all answered right counts as read. */
export function answerQuiz(stepId: string, i: number, choice: number, questions: readonly Question[]) {
  const { progress } = usePath.getState()
  const given = Array.from({ length: questions.length }, (_, k) => progress.quiz[stepId]?.[k] ?? -1)
  given[i] = choice
  let next = { ...progress, quiz: { ...progress.quiz, [stepId]: given } }
  if (getStep(stepId)?.kind === 'read' && questions.every((q, k) => given[k] === q.answer)) next = markDone(next, stepId, 'read', Date.now())
  commitProgress(next)
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
