import { create } from 'zustand'
import type { CheckResult } from '../model/challengecheck'
import type { Circuit } from '../model/circuit'

/**
 * What the app shows of the challenges: whether the list and the panel are open, which challenge, what is solved. The challenges
 * themselves and what is done with them are in `challengeWork.ts`, which loads with the panels (this file is in the main chunk).
 */

export const KEY = 'sklopko.challenges.v1'

function loadSolved(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (Array.isArray(raw)) return raw.filter((id): id is string => typeof id === 'string')
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

export function resetProgress() {
  useChallenges.setState({ solved: [] })
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing stored anyway.
  }
}

/** Remember that a challenge is solved (by its own panel, or by the step of the learning path that is that challenge). */
export function markSolved(id: string) {
  const { solved } = useChallenges.getState()
  if (solved.includes(id)) return
  const next = [...solved, id]
  useChallenges.setState({ solved: next })
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Not remembered after a reload.
  }
}
