import { type Challenge, CHALLENGES, getChallenge } from '../model/challenges'
import { checkChallenge } from '../model/challengecheck'
import { deserialize } from '../model/serialize'
import { markSolved, useChallenges } from './challenges'
import { openCircuit } from './documents'
import { getDoc, listDocs, metaOf } from './library'
import { setExampleUrl } from './runtime'
import { loadCircuit, showToast, useStore } from './store'
import { fitToScreen } from './view'

/** Fit the circuit to the canvas once the panel below it has taken its space. */
const fitSoon = () => requestAnimationFrame(() => requestAnimationFrame(fitToScreen))

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
  if (check.passed) markSolved(ch.id)
}

