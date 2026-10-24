import { create } from 'zustand'
import { CHALLENGES, getChallenge, type Challenge } from '../model/challenges'
import { checkChallenge, type CheckResult } from '../model/challengecheck'
import type { Circuit } from '../model/circuit'
import { deserialize } from '../model/serialize'
import { fitToScreen } from './view'
import { openCircuit } from './documents'
import { getDoc, listDocs, metaOf } from './library'
import { loadCircuit, showToast, useStore } from './store'
import { setExampleUrl } from './runtime'

/** Fit the circuit to the canvas once the panel below it has taken its space. */
const fitSoon = () => requestAnimationFrame(() => requestAnimationFrame(fitToScreen))

const KEY = 'sklopko.challenges.v1'

function loadSolved(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (Array.isArray(raw)) return raw.filter((id): id is string => typeof id === 'string' && !!getChallenge(id))
  } catch {
    // Storage unavailable or corrupt: no progress remembered.
  }
  return []
}

interface ChallengeState {
  /** The list of challenges is showing. */
  listOpen: boolean
  /** The challenge being worked on; its panel is showing. */
  current: string | null
  /** Ids of the challenges solved so far (kept in this browser). */
  solved: string[]
  hintShown: boolean
  /** The last check, and the circuit it was of: it is out of date once the circuit has changed. */
  result: { of: Circuit; check: CheckResult } | null
}

export const useChallenges = create<ChallengeState>(() => ({ listOpen: false, current: null, solved: loadSolved(), hintShown: false, result: null }))

export const openChallengeList = () => useChallenges.setState({ listOpen: true })
export const closeChallengeList = () => useChallenges.setState({ listOpen: false })
export const closeChallenge = () => useChallenges.setState({ current: null, hintShown: false, result: null })
export const showHint = () => useChallenges.setState({ hintShown: true })

/**
 * Open the work on a challenge: the document made the first time it was started (its starting circuit, then whatever was built),
 * so coming back to a challenge brings your circuit back. Its panel shows under the canvas.
 */
export async function startChallenge(id: string) {
  const ch = getChallenge(id)
  if (!ch) return
  useChallenges.setState({ current: id, listOpen: false, hintShown: false, result: null })
  setExampleUrl(null)
  try {
    const mine = (await listDocs('circuit')).find((d) => d.origin?.challenge === id)
    const rec = mine && (await getDoc(mine.id))
    if (rec) {
      openCircuit(deserialize(rec.data), { mode: 'stored', meta: metaOf(rec) })
      fitSoon()
      return
    }
  } catch {
    // A record that no longer reads: start the challenge again below.
  }
  openCircuit(ch.starter(), { mode: 'now', name: `Challenge: ${ch.title}`, origin: { challenge: id } })
  fitSoon()
}

/** Put the starting circuit back on the canvas (undo brings the work back). */
export function restartChallenge() {
  const ch = currentChallenge()
  if (!ch) return
  loadCircuit(ch.starter())
  fitSoon()
  useChallenges.setState({ hintShown: false, result: null })
  showToast('The starting circuit is back. Undo (⌘Z) brings your work back.')
}

/** Replace the canvas with a solution. */
export function showSolution() {
  const ch = currentChallenge()
  if (!ch) return
  loadCircuit(ch.solution())
  fitSoon()
  useChallenges.setState({ result: null })
  showToast('This is one way to solve it. Undo (⌘Z) brings your circuit back.')
}

export const currentChallenge = (): Challenge | undefined => {
  const id = useChallenges.getState().current
  return id ? getChallenge(id) : undefined
}

/** The challenge after `id` that is not solved yet, going round the list; undefined if all are solved. */
export function nextUnsolved(id: string): Challenge | undefined {
  const { solved } = useChallenges.getState()
  const at = CHALLENGES.findIndex((c) => c.id === id)
  for (let i = 1; i <= CHALLENGES.length; i++) {
    const c = CHALLENGES[(at + i) % CHALLENGES.length]
    if (!solved.includes(c.id)) return c
  }
  return undefined
}

/** Check the circuit on the canvas against the current challenge, and remember it if it is solved. */
export function runCheck() {
  const ch = currentChallenge()
  if (!ch) return
  const circuit = useStore.getState().circuit
  const check = checkChallenge(ch, circuit)
  useChallenges.setState({ result: { of: circuit, check } })
  if (check.passed && !useChallenges.getState().solved.includes(ch.id)) {
    const solved = [...useChallenges.getState().solved, ch.id]
    useChallenges.setState({ solved })
    try {
      localStorage.setItem(KEY, JSON.stringify(solved))
    } catch {
      // Not remembered after a reload.
    }
  }
}

export function resetProgress() {
  useChallenges.setState({ solved: [] })
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing stored anyway.
  }
}
