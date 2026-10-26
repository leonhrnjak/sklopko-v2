import { newChips, type Kit } from '../model/path/chips'
import { mergeProgress, type Progress } from '../model/path/progress'
import { setProgress, usePath } from './path'
import { addChips, useKit } from './pathKit'

/** What a backup file keeps of *Learn*: the steps done and the kit. Nothing when the learner has done nothing. */
export interface LearnBackup {
  progress: Progress
  kit: Kit
}

export function learnForBackup(): LearnBackup | undefined {
  const { progress } = usePath.getState()
  const { kit } = useKit.getState()
  return Object.keys(progress.done).length || Object.keys(kit).length ? { progress, kit } : undefined
}

/** Add what a backup kept of *Learn* to this browser's: steps done in either are done, and chips built here are not replaced. */
export function restoreLearn(raw: unknown): { steps: number; chips: number } {
  const learn = raw && typeof raw === 'object' ? (raw as Partial<LearnBackup>) : {}
  const before = Object.keys(usePath.getState().progress.done).length
  setProgress(mergeProgress(usePath.getState().progress, learn.progress))
  const chips = newChips(useKit.getState().kit, learn.kit)
  if (Object.keys(chips).length) addChips(chips)
  return { steps: Object.keys(usePath.getState().progress.done).length - before, chips: Object.keys(chips).length }
}

/** Put the learner's progress and kit into a backup; what the toast says is left over (" and your progress in Learn", or nothing). */
export function addLearn(backup: { learn?: unknown }): string {
  const learn = learnForBackup()
  if (learn) backup.learn = learn
  return learn ? ' and your progress in Learn' : ''
}

/** Restore what a backup kept of Learn; what the toast says is added (", and 3 steps of Learn", or nothing). */
export function restoreText(raw: unknown): string {
  const { steps, chips } = restoreLearn(raw)
  return steps || chips ? `, and ${steps} ${steps === 1 ? 'step' : 'steps'} of Learn` : ''
}
