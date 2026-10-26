import type { IcSymbol } from '../../engine/components/ic'
import type { Challenge, Rules } from '../challenges'
import type { Circuit } from '../circuit'

/**
 * The learning path, *Learn: From NAND to a computer* (see `docs/plan-learn-path.md`). These are the shapes of its chapters and
 * steps. The steps themselves are in `steps/` and load on demand; the small list of their ids that the main chunk needs is
 * `index.ts`.
 */

/** What a step asks of the learner. `read`, `build` and `explore` exist; the others come with the milestones that need them. */
export type StepKind = 'read' | 'explore' | 'build' | 'project' | 'program'

export interface Chapter {
  /** Permanent. */
  id: string
  title: string
  /** One line on the map. */
  blurb: string
  /** Built-in part types that unlock when every step of the chapter is done or shown (from L3 on). */
  unlocks?: string[]
}

/** A multiple-choice question with one right answer and a sentence on why. */
export interface Question {
  q: string
  options: string[]
  /** The index of the right option. */
  answer: number
  why: string
}

/** A Karnaugh map of one output: the inputs in order (the first is the leftmost bit) and the rows where the output is 1. */
export interface KmapFigure {
  inputs: string[]
  output: string
  ones: number[]
}

/**
 * A paragraph, a small table (place values, a truth table; `highlight` marks rows of it), a Karnaugh map, or questions to answer
 * (practice: they never block going on).
 */
export type Block = { p: string } | { table: { head: string[]; rows: string[][]; highlight?: number[] } } | { kmap: KmapFigure } | { quiz: Question[] }

export interface StepBase {
  /** Permanent: progress, the kit and the step's document are stored by it. */
  id: string
  chapter: string
  title: string
  kind: StepKind
  /** One line on the map. */
  summary: string
  /** What the panel shows. */
  lesson: Block[]
  hint?: string
}

export interface ReadStep extends StepBase {
  kind: 'read'
}

export interface BuildStep extends StepBase {
  kind: 'build'
  /** An existing challenge's id (its goal and rules are used), or one written for the step. */
  challenge: string | Challenge
  /** What to build, in one sentence. Left out: the challenge's own task. */
  task?: string
  /** A solution that uses the chips in `uses`. Left out: the challenge's own solution. */
  solution?: () => Circuit
  /** The name of the chip the passing circuit becomes in the learner's kit. */
  chip?: string
  /** The gate the chip is, so that it is drawn with that gate's symbol (see `ICDef.symbol`). */
  symbol?: IcSymbol
  /** Ids of the steps whose chips the starting circuit has (the learner's own, or ours when they have not built them). */
  uses?: string[]
  /** The parts the palette offers, besides the kit. The rules still decide what passes. */
  palette?: string[]
  /** An optional par: a star for meeting it. A star never blocks anything. */
  star?: { maxParts: number }
  /** Rules that replace the challenge's own: how an existing challenge is made NAND-only for the path. */
  rules?: Rules
  /** Shown as a link in the done-card: a step to go back to now that this one is done. */
  after?: { step: string; text: string }
}

/**
 * Something to reach while playing with a prepared circuit, found by label. `text` is the line of the checklist. A goal that has held
 * once stays ticked.
 */
export type Goal = { text: string } & (
  | { led: string; is: 0 | 1 }
  /** A hex display (its four inputs) or a bus display, as a number. */
  | { display: string; is: number }
  | { oscillating: true }
  /** Switches, by label, are set like this (the others do not matter). */
  | { switches: Record<string, 0 | 1> }
  /** A word of a RAM (by label) holds this. */
  | { memory: string; at: number; is: number }
)

export interface ExploreStep extends StepBase {
  kind: 'explore'
  /** The circuit to play with. */
  open: { build: () => Circuit }
  /** What to do, in one sentence. */
  task: string
  /** The parts the palette offers. */
  palette?: string[]
  goals: Goal[]
  /** The goals tick one after the other: a later one does not count until the ones before it have. */
  ordered?: boolean
}

export type Step = ReadStep | BuildStep | ExploreStep
