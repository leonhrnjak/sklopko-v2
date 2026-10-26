/**
 * What the learner has done on the path: kept in `localStorage` under `sklopko.path.v1`, read at startup for the button's ring and
 * *Continue*. Pure, so it is tested without a browser.
 */

export const PROGRESS_KEY = 'sklopko.path.v1'

export type How = 'solved' | 'shown' | 'read'

export interface Done {
  at: number
  how: How
  /** The step's par was met. */
  star?: true
}

export interface Progress {
  v: 1
  done: Record<string, Done>
  /** The step the learner was on last. */
  current?: string
  /** The answers given to quizzes, by step (from L2 on). */
  quiz: Record<string, number[]>
}

export const emptyProgress = (): Progress => ({ v: 1, done: {}, quiz: {} })

const isHow = (h: unknown): h is How => h === 'solved' || h === 'shown' || h === 'read'

/** A stored value as progress. Anything broken is ignored, step by step, so one bad entry loses only itself. */
export function parseProgress(raw: unknown): Progress {
  const p = emptyProgress()
  if (!raw || typeof raw !== 'object' || (raw as { v?: unknown }).v !== 1) return p
  const { done, current, quiz } = raw as { done?: unknown; current?: unknown; quiz?: unknown }
  if (done && typeof done === 'object') {
    for (const [id, d] of Object.entries(done)) {
      const e = d as Partial<Done> | null
      if (e && typeof e === 'object' && isHow(e.how) && typeof e.at === 'number' && Number.isFinite(e.at)) p.done[id] = { at: e.at, how: e.how, ...(e.star === true ? { star: true as const } : {}) }
    }
  }
  if (typeof current === 'string') p.current = current
  if (quiz && typeof quiz === 'object') {
    for (const [id, a] of Object.entries(quiz)) if (Array.isArray(a) && a.every((n) => Number.isInteger(n))) p.quiz[id] = a as number[]
  }
  return p
}

/**
 * The progress with a step done. Solving beats being shown the solution, and neither is lost to a later `read`; a star once earned
 * stays. The time of the first completion is kept.
 */
export function markDone(p: Progress, id: string, how: How, at: number, star = false): Progress {
  const old = p.done[id]
  const kept: How = old && old.how === 'solved' ? 'solved' : how
  const done: Done = { at: old?.at ?? at, how: kept, ...(old?.star || star ? { star: true as const } : {}) }
  return { ...p, done: { ...p.done, [id]: done } }
}

export const isDone = (p: Progress, id: string) => id in p.done

/** How many of these steps are done. Steps the path no longer has (an older version's) do not count. */
export const countDone = (p: Progress, ids: readonly string[]) => ids.reduce((n, id) => n + (isDone(p, id) ? 1 : 0), 0)

/**
 * Progress from a backup added to this browser's: a step done in either is done (solving beats being shown, a star stays), and the quiz answers
 * of a step that has none here come along. Where the learner was last stays as it is. `theirs` is read as `parseProgress` reads it.
 */
export function mergeProgress(mine: Progress, theirs: unknown): Progress {
  const other = parseProgress(theirs)
  let merged = mine
  for (const [id, d] of Object.entries(other.done)) merged = markDone(merged, id, d.how, d.at, !!d.star)
  const quiz = { ...merged.quiz }
  for (const [id, a] of Object.entries(other.quiz)) if (!(id in quiz)) quiz[id] = a
  return { ...merged, quiz }
}
