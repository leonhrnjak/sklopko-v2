import type { IcSymbol } from '../../engine/components/ic'
import type { Challenge, Rules } from '../challenges'
import type { Circuit } from '../circuit'

/**
 * The learning path, *Learn: From NAND to a computer* (see `docs/plan-learn-path.md`). These are the shapes of its chapters and
 * steps. The steps themselves are in `steps/` and load on demand; the small list of their ids that the main chunk needs is
 * `index.ts`.
 */

/** What a step asks of the learner. `program` comes with the milestone that needs it. */
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
export type Block =
  | { p: string }
  | { table: { head: string[]; rows: string[][]; highlight?: number[] } }
  | { kmap: KmapFigure }
  | { quiz: Question[] }
  /** An instruction word of the computer, as 16 bits to click, with its fields and what it means. */
  | { word: { value: number } }
  /** What the learner has done on the path: the chips in their kit, and the steps of each chapter. */
  | { journey: true }

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
  /** The screen of a terminal (by label) has a line that says this (spaces at the ends do not count). */
  | { terminal: string; line: string }
  /** A 6502 (by label) has this address on its pins, reading or writing: seen in some cycle of the run. */
  | { cpu: string; addr: number; rw: 'read' | 'write' }
)

export interface ExploreStep extends StepBase {
  kind: 'explore'
  /** The circuit to play with: built on the spot, or an example of the gallery (the build writes it routed, and the app fetches it). */
  open: { build: () => Circuit } | { example: string }
  /** What to do, in one sentence. */
  task: string
  /** The parts the palette offers. */
  palette?: string[]
  goals: Goal[]
  /** The goals tick one after the other: a later one does not count until the ones before it have. */
  ordered?: boolean
}

/**
 * Something to find in a computer that is running, by the label of a part: a counter, register, display or ROM as a number, an LED, a word of a
 * RAM, or the numbers a part took in the run so far (in order, each only when it changed; `is` has to be found among them, in a row, or be all of them with `exact`).
 */
export type Expect = { value: string; is: number } | { led: string; is: 0 | 1 } | { ram: string; at: number; is: number } | { trace: string; is: number[]; exact?: true }

/** What the computer should show after `after` clock ticks (full cycles: up and down). `text` is the line of the checklist. */
export interface CpuCheck {
  after: number
  text: string
  expect: Expect[]
}

/** A test program (SKASM, put into the part labelled *Program ROM*) and what the learner's computer should do running it. */
export interface CpuRun {
  title: string
  program: string
  checks: CpuCheck[]
}

/**
 * A step of the CPU project: one circuit, the learner's, that grows from step to step. It starts from the circuit at the end of the step
 * before (or the reference one, `cpuStage(stage - 1)`, when that step was skipped), and is checked by running test programs on it.
 */
export interface ProjectStep extends StepBase {
  kind: 'project'
  /** The project it belongs to; every step of it shares one circuit. */
  project: 'cpu4' | 'board6502'
  /** What the step asks for, in one sentence. */
  task: string
  /** The stage of the reference computer (`cpuStage`) this step ends with: its solution, and the next step's start when this one is skipped. */
  stage: number
  /** Parts given at the start of the step, on top of the circuit it starts from (the Control ROM, say). */
  give?: (c: Circuit) => void
  /**
   * A step on a board of an example instead of the learner's CPU: the example (its id) is the solution, and the step starts with the wires of
   * the parts labelled in `cut` taken off, for the learner to put back. Its test programs are not put in a ROM: the board runs its own.
   */
  board?: { example: string; cut: string[] }
  /** Ids of build steps whose chips the palette offers (the learner's, or ours when they have not built them). */
  uses?: string[]
  /** The parts the palette offers. */
  palette: string[]
  runs: CpuRun[]
}

/** What a finished program should have done on the computer: words of RAM, the numbers written to the output in order, the ACC. */
export interface ProgramExpect {
  ram?: Record<number, number>
  /** The text on the console at the end. */
  console?: string
  /** On a 6502 board: the numbers the LED register took, found in this order in a row (the first is what it held at the start). */
  ledTrace?: number[]
  /** On a 6502 board: what the LED register holds at the end. */
  leds?: number
  /** On a 6502 board: the first line of the LCD (trailing spaces left out). */
  lcd?: string
  /** Every STA to address 15, in order (the output register's loads). */
  writes?: number[]
  acc?: number
}

/** A test run of a learner's program, on their computer and on the reference one. `set` changes the numbers on the lines `NAME = n` first. */
export interface ProgramTest {
  title: string
  set?: Record<string, number>
  /** Replace the numbers of the first `.byte` line (the table) first. */
  bytes?: number[]
  expect: ProgramExpect
}

/**
 * A program to write (SKASM, in the Program ROM's inspector) for the computer built in chapter 9. It is run until HALT on the learner's
 * computer and on the reference one; when the two disagree the verdict says which is wrong.
 */
export interface ProgramStep extends StepBase {
  kind: 'program'
  /** The computer it runs on: the 4-bit one built in chapter 9 (the default), the 8-bit one of the Computers examples, or a 6502 board of an example. */
  computer?: 'cpu4' | 'cpu8' | 'board6502'
  /** The example that is the canvas, for a computer that is an example's (the 8-bit one: `computer-sieve`). */
  example?: string
  /** The most clock ticks a program may take before it counts as stuck, on a 6502 board (it is checked after each few ticks, and a program that has done what it should is not run on). */
  maxTicks?: number
  /** Instructions the program must use (CALL and RET, say), found in the text outside comments. */
  needs?: string[]
  task: string
  /** What the Program ROM holds when the step starts. */
  starter: string
  /** A program that does it, for *Show a solution*. */
  solution: string
  tests: ProgramTest[]
}

export type Step = ReadStep | BuildStep | ExploreStep | ProjectStep | ProgramStep
