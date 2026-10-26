import type { IcSymbol } from '../../engine/components/ic'
import type { Challenge } from '../challenges'
import type { Circuit } from '../circuit'

/**
 * The learning path, *Learn: From NAND to a computer* (see `docs/plan-learn-path.md`). These are the shapes of its chapters and
 * steps. The steps themselves are in `steps/` and load on demand; the small list of their ids that the main chunk needs is
 * `index.ts`.
 */

/** What a step asks of the learner. L1 has `read` and `build`; the others come with the milestones that need them. */
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

/** A paragraph, or a small table (place values, a truth table). */
export type Block = { p: string } | { table: { head: string[]; rows: string[][] } }

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
}

export type Step = ReadStep | BuildStep
