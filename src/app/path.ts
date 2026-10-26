import { create } from 'zustand'
import type { CheckResult } from '../model/challengecheck'
import type { Circuit } from '../model/circuit'
import { LEARN_ROOT, PATH_STEP_COUNT, learnFromPath, learnUrl } from '../model/path'
import { PROGRESS_KEY, emptyProgress, parseProgress, type Progress } from '../model/path/progress'
import { onCircuitOpened } from './documents'

/**
 * What the app shows of the learning path (*Learn: From NAND to a computer*, `docs/plan-learn-path.md`): whether the map is open,
 * which step, what is done. The steps themselves and what is done with them are in `pathWork.ts`, the kit in `pathKit.ts`, and the
 * map and the panel in `ui/path/`: they load with the panels (this file is in the main chunk, so it stays small).
 */

function loadProgress(): Progress {
  try {
    return parseProgress(JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? 'null'))
  } catch {
    // Storage unavailable or corrupt: no progress remembered.
    return emptyProgress()
  }
}

/** What the last check of the open step was about, and what it found. */
export interface StepResult {
  /** The circuit it was of: the result is out of date once the circuit has changed. */
  of: Circuit
  check: CheckResult
  star: boolean
}

interface PathState {
  /** The map of chapters and steps is showing. */
  mapOpen: boolean
  /** The step being worked on; its panel is showing. */
  step: string | null
  progress: Progress
  /** The parts the palette offers while a step is open (besides the kit); null shows them all. */
  palette: string[] | null
  hintShown: boolean
  result: StepResult | null
  /** The chips the open step uses that the learner has not built: the circuit has ours. */
  ours: string[]
}

export const usePath = create<PathState>(() => ({ mapOpen: false, step: null, progress: loadProgress(), palette: null, hintShown: false, result: null, ours: [] }))

/** Remember the progress, in the store and in this browser. */
export function setProgress(progress: Progress) {
  usePath.setState({ progress })
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress))
  } catch {
    // Not remembered after a reload.
  }
}

export function forgetProgress() {
  usePath.setState({ progress: emptyProgress() })
  try {
    localStorage.removeItem(PROGRESS_KEY)
  } catch {
    // Nothing stored anyway.
  }
}

/** The number of steps done, for the button's ring (step ids are permanent, so every entry is a step of the path). */
export const useDoneCount = () => usePath((s) => Math.min(Object.keys(s.progress.done).length, PATH_STEP_COUNT))

export const openMap = () => usePath.setState({ mapOpen: true })
export const closeMap = () => usePath.setState({ mapOpen: false })
export const showStepHint = () => usePath.setState({ hintShown: true })

/** Close the panel: the palette shows every part again. The circuit stays as it is. */
export const closeStep = () => usePath.setState({ step: null, palette: null, hintShown: false, result: null, ours: [] })

/** Open the map, or the step an address names. Called once the first circuit is on the canvas. */
export async function openLearnRoute(route: { step: string | null }) {
  if (!route.step) {
    openMap()
    return
  }
  const { startStep } = await import('./pathWork')
  await startStep(route.step)
}

// The address bar follows: `/learn` for the map, `/learn/<id>` for a step, and back to the plain root when both are closed.
usePath.subscribe((s, prev) => {
  if (s.mapOpen === prev.mapOpen && s.step === prev.step) return
  const want = s.mapOpen ? LEARN_ROOT : s.step ? learnUrl(s.step) : null
  if (want) {
    if (location.pathname !== want) history.replaceState(null, '', want + location.search)
  } else if (learnFromPath(location.pathname)) {
    history.replaceState(null, '', '/' + location.search)
  }
})

// Another document on the canvas (File → New, an example, My circuits) ends the step: its panel is about the document it made.
onCircuitOpened((origin) => {
  const { step } = usePath.getState()
  if (step && origin?.path !== step) closeStep()
})
