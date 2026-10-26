import { CHAPTERS } from '../../model/path/chapters'
import { stepsOf } from '../../model/path/steps'
import type { Step } from '../../model/path/types'

/** The number of a chapter (1 to 14) and of a step inside its chapter, as the lessons print them: "2.6". Only for reading: progress is by id. */
export const chapterNumber = (chapter: string) => CHAPTERS.findIndex((c) => c.id === chapter) + 1
export const stepNumber = (step: Step) => stepsOf(step.chapter).findIndex((s) => s.id === step.id) + 1
export const numberOf = (step: Step) => `${chapterNumber(step.chapter)}.${stepNumber(step)}`
