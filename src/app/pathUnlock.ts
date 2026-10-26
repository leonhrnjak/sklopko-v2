import { getDef } from '../engine/registry'
import { CHAPTERS } from '../model/path/chapters'
import type { Progress } from '../model/path/progress'
import { chaptersUnlockedBy } from '../model/path/steps'
import { setProgress, usePath } from './path'
import { showToast } from './store'

/** What the toast says when a chapter is done: "Chapter 7 done: the SR latch, … are in the parts list". */
export function unlockNote(chapter: string): string {
  const c = CHAPTERS.find((x) => x.id === chapter)
  const names = (c?.unlocks ?? []).map((t) => getDef(t).name)
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names.join('')
  return `Chapter ${CHAPTERS.indexOf(c!) + 1} done: ${list} ${names.length > 1 ? 'are' : 'is'} now in the parts list.`
}

/** Remember the progress, and say so when it completes a chapter that unlocks built-in parts. */
export function commitProgress(next: Progress) {
  const before = usePath.getState().progress
  setProgress(next)
  for (const c of chaptersUnlockedBy(before, next)) showToast(unlockNote(c.id))
}
