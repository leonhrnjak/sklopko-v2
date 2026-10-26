import { CHAPTERS } from '../chapters'
import { registerSteps } from '../chips'
import { isDone, type Progress } from '../progress'
import type { Step } from '../types'
import { CH01 } from './ch01'
import { CH02 } from './ch02'
import { CH03 } from './ch03'
import { CH04 } from './ch04'
import { CH05 } from './ch05'
import { CH06 } from './ch06'
import { CH07 } from './ch07'
import { CH08 } from './ch08'
import { CH09 } from './ch09'
import { CH10 } from './ch10'
import { CH11 } from './ch11'
import { CH12 } from './ch12'
import { CH13 } from './ch13'
import { CH14 } from './ch14'

/** Every step, in the order of the path. Loads on demand: the main chunk has only the ids (`../index.ts`). */
export const STEPS: Step[] = [...CH01, ...CH02, ...CH03, ...CH04, ...CH05, ...CH06, ...CH07, ...CH08, ...CH09, ...CH10, ...CH11, ...CH12, ...CH13, ...CH14]

registerSteps(STEPS)

export const getStep = (id: string): Step | undefined => STEPS.find((s) => s.id === id)
export const stepsOf = (chapter: string): Step[] => STEPS.filter((s) => s.chapter === chapter)

/** Every step id, in the order a learner meets them. */
export const PATH_STEPS: readonly string[] = STEPS.map((s) => s.id)

export const hasStep = (id: string) => PATH_STEPS.includes(id)

export const stepIdsOf = (chapter: string): string[] => stepsOf(chapter).map((s) => s.id)

/** The step after `id`, or undefined at the end of the path. */
export const stepAfter = (id: string): string | undefined => PATH_STEPS[PATH_STEPS.indexOf(id) + 1]

/** The step before `id`, or undefined at the start. */
export const stepBefore = (id: string): string | undefined => {
  const at = PATH_STEPS.indexOf(id)
  return at > 0 ? PATH_STEPS[at - 1] : undefined
}

/**
 * Where *Continue* goes: the step the learner was last on, if it is not done; else the first step not done after it; else the
 * first not done at all. Undefined once everything is done.
 */
export function recommended(p: Progress): string | undefined {
  const from = p.current && hasStep(p.current) ? PATH_STEPS.indexOf(p.current) : 0
  return [...PATH_STEPS.slice(from), ...PATH_STEPS.slice(0, from)].find((id) => !isDone(p, id))
}

/** Is this step before the one the learner was last on? Then it is one they skipped, and not the way on. */
export const isBehind = (p: Progress, id: string): boolean => !!p.current && hasStep(p.current) && PATH_STEPS.indexOf(id) < PATH_STEPS.indexOf(p.current)

/**
 * The chapter the map opens on: the one of the step the learner was last on, so that finishing a chapter shows that chapter (and
 * not an earlier one with a step skipped); else the one of the recommended step.
 */
export function mapChapter(p: Progress): string | undefined {
  const id = p.current && hasStep(p.current) ? p.current : recommended(p)
  return id ? getStep(id)?.chapter : undefined
}

/** Is every step of the chapter done (solved, shown or read)? A chapter with no steps yet is not. */
export function chapterDone(p: Progress, chapter: string): boolean {
  const ids = stepIdsOf(chapter)
  return ids.length > 0 && ids.every((id) => isDone(p, id))
}

/** The built-in parts that chapters done so far have unlocked. */
export const unlockedParts = (p: Progress): string[] => CHAPTERS.flatMap((c) => (c.unlocks && chapterDone(p, c.id) ? c.unlocks : []))

/** The chapters with parts to unlock that this progress completes and the one before did not. */
export const chaptersUnlockedBy = (before: Progress, after: Progress) => CHAPTERS.filter((c) => c.unlocks && !chapterDone(before, c.id) && chapterDone(after, c.id))
