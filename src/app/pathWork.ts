import { checkStepCircuit, stepStarter } from '../model/path/build'
import { chipTable, snapshot, notBuilt, refreshChips, solutionOf } from '../model/path/chips'
import { circuitShape } from '../model/challengecheck'
import type { Circuit } from '../model/circuit'
import { cutWires } from '../model/path/board'
import { cpuStage } from '../model/path/cpu4'
import { markDone } from '../model/path/progress'
import { checkProgram, checkProject, withSource, withSource6502, withSource8 } from '../model/path/run'
import { STEPS, getStep, stepAfter, unlockedParts } from '../model/path/steps'
import type { ProgramStep, ProjectStep, Question, Step } from '../model/path/types'
import { deserialize } from '../model/serialize'
import { closeChallenge, closeChallengeList, markSolved } from './challenges'
import { flushSave, openCircuit } from './documents'
import { stopGoals, watchGoals } from './pathGoals'
import { getDoc, listDocs, metaOf } from './library'
import { closeStep, forgetProgress, openMap, setProgress, usePath } from './path'
import { clearKit, putChip, useKit } from './pathKit'
import { clearProject, useProject } from './pathProject'
import { commitProgress } from './pathUnlock'
import { loadCircuit, select, showToast, useStore } from './store'
import { setWaveOpen } from './waveform'
import { fitToScreen, fitWhileResizing } from './view'

/**
 * The work on the learning path's steps: opening one, checking it, showing a solution, going on. It loads with the map and the
 * panel (see `path.ts` for what stays in the main chunk), and is modelled on `challengeWork.ts`.
 */

/** Fit the circuit to the canvas once the panel below it has taken its space. */
const fitSoon = () => {
  requestAnimationFrame(() => requestAnimationFrame(fitToScreen))
  // The panel under the canvas has not always taken its room by then (a step opened from its address): once more when it has.
  window.setTimeout(fitToScreen, 300)
  fitWhileResizing(3000)
}

export const currentStep = (): Step | undefined => {
  const id = usePath.getState().step
  return id ? getStep(id) : undefined
}

/** The shape of the solution that "Show a solution" put on the canvas, while it is unchanged: checking it does not count as solving. */
let shownShape: string | null = null
/** The program the learner was shown, while it is unchanged. */
let shownSource: string | null = null

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
  const program = step.kind === 'program' ? step : undefined
  const uses = build?.uses ?? (step.kind === 'project' ? step.uses : undefined) ?? []
  // The challenge panel is the other way to work on a circuit: one at a time.
  closeChallenge()
  closeChallengeList()
  stopGoals()
  clearProject()
  shownShape = null
  shownSource = null
  const playable = explore ?? project
  usePath.setState({ step: id, mapOpen: false, hintShown: false, result: null, palette: build?.palette ?? (playable?.palette && [...new Set([...playable.palette, ...unlockedParts(usePath.getState().progress)])]) ?? null, ours: notBuilt(uses, kit) })
  setProgress({ ...usePath.getState().progress, current: id })
  if (!build && !explore && !project && !program) return
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
  let start: Circuit
  try {
    start = build ? stepStarter(build, kit) : explore ? await exploreStart(explore) : program ? await programStarter(program) : await projectStarter(project!)
  } catch {
    // The 8-bit computer is a file fetched from the site: it may not be there (offline, before the first visit).
    if (mine === opening) showToast('The computer for this step could not be loaded.')
    return
  }
  if (mine !== opening) return
  openCircuit(start, { mode: 'now', name: `Learn: ${step.title}`, origin: { path: id } })
  // A board of an example has probes, which open the waveforms and take the room the step's panel needs: they are one click away in the toolbar.
  // (They open after the circuit is rendered, so this waits a moment.)
  if ((explore && 'example' in explore.open) || program?.example || project?.board) setTimeout(() => setWaveOpen(false), 200)
  fitSoon()
  watch()
}

/** An example of the gallery, routed: the build writes each one to `examples/<id>.json`. */
async function fetchExample(id: string): Promise<Circuit> {
  const res = await fetch(`${import.meta.env.BASE_URL}examples/${id}.json`)
  if (!res.ok) throw new Error(`Example ${id}: ${res.status}`)
  return deserialize(await res.json())
}

/** The circuit an explore step opens with. */
const exploreStart = async (step: Extract<Step, { kind: 'explore' }>): Promise<Circuit> => ('build' in step.open ? step.open.build() : fetchExample(step.open.example))

/** The circuit a step's document holds, if it has one and it reads. */
async function storedCircuit(stepId: string): Promise<Circuit | undefined> {
  try {
    const doc = (await listDocs('circuit')).find((d) => d.origin?.path === stepId)
    const rec = doc && (await getDoc(doc.id))
    return rec ? deserialize(rec.data) : undefined
  } catch {
    // A circuit that no longer reads: the reference one is the way on.
    return undefined
  }
}

/** What a program step starts from: the computer the learner built in chapter 9 (ours if they did not), with the step's starting program in its ROM. */
async function programStarter(step: ProgramStep): Promise<Circuit> {
  if (step.computer === 'cpu8' || step.computer === 'board6502') {
    // The computer is an example's: the build writes it routed, so there is nothing to build here.
    const base = await fetchExample(step.example ?? 'computer-sieve')
    return (step.computer === 'cpu8' ? withSource8(base, step.starter) : withSource6502(base, step.starter)) ?? base
  }
  flushSave()
  const last = [...STEPS].reverse().find((s): s is ProjectStep => s.kind === 'project' && s.project === 'cpu4')
  const base = (last && (await storedCircuit(last.id))) ?? structuredClone(cpuStage(last?.stage ?? 8))
  return withSource(base, step.starter) ?? base
}

/** The text of the program in the circuit's Program ROM. */
const romOf = (c: Circuit) => Object.values(c.comps).find((k) => k.label === 'Program ROM' || k.label === 'Program' || (k.type === 'rom' && String(k.label).startsWith('ROM $')))
const sourceOf = (c: Circuit) => String(romOf(c)?.params.source ?? '')

/** Select the Program ROM, so its inspector shows the program to edit. */
export function editProgram() {
  const rom = romOf(useStore.getState().circuit)
  if (rom) select([rom.id])
}

/** Run the program in the circuit on the canvas, on the learner's computer and on ours. A pass is remembered. */
function checkProgramStep(step: ProgramStep) {
  const circuit = useStore.getState().circuit
  const result = checkProgram(step, circuit)
  useProject.setState({ step: step.id, of: circuit, result })
  if (!result.passed) return
  const shown = shownSource !== null && sourceOf(circuit) === shownSource
  commitProgress(markDone(usePath.getState().progress, step.id, shown ? 'shown' : 'solved', Date.now()))
}

/** Put a solution in the ROM. The step counts as shown. */
function showProgramSolution(step: ProgramStep) {
  const now = useStore.getState().circuit
  const circuit = step.computer === 'cpu8' ? withSource8(now, step.solution) : step.computer === 'board6502' ? withSource6502(now, step.solution) : withSource(now, step.solution)
  if (!circuit) return
  loadCircuit(circuit)
  shownSource = step.solution
  useProject.setState({ of: null, result: null })
  showToast('This is one way to write it. Undo (⌘Z) brings your program back.')
  commitProgress(markDone(usePath.getState().progress, step.id, 'shown', Date.now()))
}

/**
 * What a step of the CPU project starts from: the learner's circuit at the end of the step before, or the reference computer of that stage
 * when they skipped it, and the parts this step gives.
 */
async function projectStarter(step: ProjectStep): Promise<Circuit> {
  // A step on a board of an example starts from the board with its wires cut, whatever else was done.
  if (step.board) return cutWires(await fetchExample(step.board.example), step.board.cut)
  const mine = STEPS.filter((s): s is ProjectStep => s.kind === 'project' && s.project === step.project)
  const before = mine[mine.indexOf(step) - 1]
  flushSave() // what is on the canvas may be the circuit of the step before, not yet kept
  let c = before && (await storedCircuit(before.id))
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
  if (step?.kind === 'program') return checkProgramStep(step)
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
  if (step?.kind === 'program') return showProgramSolution(step)
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
async function showProjectSolution(step: ProjectStep) {
  let solution: Circuit
  try {
    solution = step.board ? await fetchExample(step.board.example) : structuredClone(cpuStage(step.stage))
  } catch {
    showToast('The computer for this step could not be loaded.')
    return
  }
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
  if (step?.kind !== 'build' && step?.kind !== 'explore' && step?.kind !== 'project' && step?.kind !== 'program') return
  try {
    loadCircuit(step.kind === 'build' ? stepStarter(step, useKit.getState().kit) : step.kind === 'explore' ? await exploreStart(step) : step.kind === 'program' ? await programStarter(step) : await projectStarter(step))
  } catch {
    showToast('The computer for this step could not be loaded.')
    return
  }
  shownSource = null
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
