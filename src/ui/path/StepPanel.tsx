import { useEffect, useMemo } from 'react'
import type { Cell } from '../../logic/table'
import { closeStep, openMap, showStepHint, usePath } from '../../app/path'
import { useGoals } from '../../app/pathGoals'
import { useProject } from '../../app/pathProject'
import { toggleSheet, useSheet } from '../../app/pathSheet'
import { clearSpot, focusSpot, hoverSpot } from '../../app/pathSpot'
import { checkStep, editProgram, markRead, nextStep, restartStep, showStepSolution, startStep } from '../../app/pathWork'
import { useStore } from '../../app/store'
import { circuitShape, logicParts, ruleProblems } from '../../model/challengecheck'
import { goalTable } from '../../model/challenges'
import { challengeOf } from '../../model/path/chips'
import { getChapter } from '../../model/path/chapters'
import { getStep, stepAfter, stepBefore, stepsOf } from '../../model/path/steps'
import type { Block, BuildStep, ExploreStep, ProgramStep, ProjectStep, Step } from '../../model/path/types'
import { CheckVerdict, StepsTable } from '../challenges/CheckVerdict'
import { rulesText } from '../challenges/rulesText'
import { KarnaughMap } from '../logic/KarnaughMap'
import { TruthTableView } from '../logic/TruthTableView'
import { numberOf } from './numbers'
import { Mark } from './Mark'
import { Quiz } from './Quiz'
import { Spotlight } from './Spotlight'
import { Journey } from './Journey'
import { InstructionWord } from './Word'

/** The values of a map's output over its inputs: 1 on the listed rows, 0 elsewhere. */
const mapValues = (inputs: string[], ones: number[]): Cell[] => Array.from({ length: 2 ** inputs.length }, (_, row) => (ones.includes(row) ? 1 : 0))

/** A paragraph, in which [[label]] names a part of the circuit on the canvas: pointing at it outlines the part, clicking brings it forward. */
function Paragraph({ text }: { text: string }) {
  const parts = text.split(/\[\[(.+?)\]\]/)
  return (
    <p className="step-lesson">
      {parts.map((t, i) =>
        i % 2 === 0 ? (
          t
        ) : (
          <button key={i} className="spot-name" onMouseEnter={() => hoverSpot(t)} onMouseLeave={() => hoverSpot(null)} onFocus={() => hoverSpot(t)} onBlur={() => hoverSpot(null)} onClick={() => focusSpot(t)} title="Show it on the canvas">
            {t}
          </button>
        ),
      )}
    </p>
  )
}

/** A lesson: paragraphs, small tables (some rows marked), Karnaugh maps and questions. */
export function Lesson({ blocks, stepId }: { blocks: Block[]; stepId: string }) {
  return (
    <>
      {blocks.map((b, i) => {
        if ('p' in b) return <Paragraph key={i} text={b.p} />
        if ('quiz' in b) return <Quiz key={i} stepId={stepId} questions={b.quiz} />
        if ('word' in b) return <InstructionWord key={i} initial={b.word.value} />
        if ('journey' in b) return <Journey key={i} />
        if ('kmap' in b) return <KarnaughMap key={i} values={mapValues(b.kmap.inputs, b.kmap.ones)} names={b.kmap.inputs} output={b.kmap.output} />
        return (
          <div key={i} className="truth-wrap">
            <table className="truth">
              <thead>
                <tr>
                  {b.table.head.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.table.rows.map((row, r) => (
                  <tr key={r} className={b.table.highlight?.includes(r) ? 'hl' : undefined}>
                    {row.map((cell, c) => (
                      <td key={c}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </>
  )
}

/** Under "Solved!": the chip that went into the kit, the star, and the way on. */
function Earned({ step, parts, star }: { step: BuildStep; parts: number; star: boolean }) {
  const next = stepAfter(step.id)
  const nextStepInfo = next ? getStep(next) : undefined
  return (
    <div className="step-earned">
      {step.chip && (
        <p className="chip-earned" data-testid="chip-earned">
          <span className="chipicon">{step.chip}</span> is in your kit ({parts} NAND{parts === 1 ? '' : 's'} inside)
        </p>
      )}
      {step.star && <p className={star ? 'star-earned' : 'star-todo'}>{star ? `⭐ You met the par of ${step.star.maxParts}!` : `⭐ Do it with ${step.star.maxParts} gates for a star.`}</p>}
      {step.after && (
        <p className="step-after" data-testid="step-after">
          {step.after.text}{' '}
          <button className="link-button inline" onClick={() => startStep(step.after!.step)}>
            Go to {getStep(step.after.step)?.title} →
          </button>
        </p>
      )}
      <button className="primary-action" onClick={nextStep} data-testid="step-next">
        {nextStepInfo ? `Next: ${nextStepInfo.title} →` : 'Back to the map'}
      </button>
    </div>
  )
}

function BuildBody({ step }: { step: BuildStep }) {
  const hintShown = usePath((s) => s.hintShown)
  const result = usePath((s) => s.result)
  const ours = usePath((s) => s.ours)
  const circuit = useStore((s) => s.circuit)
  const ch = challengeOf(step)
  const now = useMemo(() => circuitShape(circuit), [circuit])
  const resultShape = useMemo(() => (result ? circuitShape(result.of) : ''), [result])
  const table = useMemo(() => (ch.kind === 'comb' ? goalTable(ch) : null), [ch])
  const fresh = result && resultShape === now
  const live = ruleProblems(circuit, ch.rules)
  const rules = rulesText(ch)
  return (
    <div className="challenge-body">
      <div className="challenge-text">
        <Lesson blocks={step.lesson} stepId={step.id} />
        <p className="task">
          <b>Your task:</b> {step.task ?? ch.task}
        </p>
        {rules && <p className="rules">{rules}</p>}
        {ours.length > 0 && (
          <p className="step-ours" data-testid="step-ours">
            You haven’t built{' '}
            {ours.map((id, i) => (
              <span key={id}>
                {i > 0 && (i === ours.length - 1 ? ' or ' : ', ')}
                <button className="link-button inline" onClick={() => startStep(id)}>
                  {(getStep(id) as BuildStep).chip}
                </button>
              </span>
            ))}{' '}
            yet, so this step uses ours.
          </p>
        )}
        {live.length > 0 && !fresh && <p className="logic-warning">⚠ {live[0]}</p>}
        <div className="row">
          <button className="primary-action" onClick={checkStep} data-testid="step-check">
            Check my circuit
          </button>
          <button onClick={showStepHint} disabled={hintShown}>
            Hint
          </button>
          <button onClick={showStepSolution} title="Replace the canvas with a circuit that solves it (undo brings yours back)">
            Show a solution
          </button>
          <button onClick={restartStep} title="Go back to the starting circuit (undo brings your work back)">
            Start over
          </button>
        </div>
        {hintShown && <p className="challenge-hint">💡 {step.hint ?? ch.hint}</p>}
        {fresh && result && <CheckVerdict ch={ch} check={result.check} success={<Earned step={step} parts={logicParts(result.of)} star={result.star} />} />}
        {result && !fresh && <small>The circuit has changed since it was last checked.</small>}
      </div>
      <div className="challenge-goal">
        <h4>{ch.kind === 'comb' ? 'What it should do' : 'The test, step by step'}</h4>
        {table ? <TruthTableView table={table} label="Goal" /> : ch.kind === 'seq' ? <StepsTable ch={ch} /> : null}
        {ch.kind === 'comb' && <small>Every combination of the switches, counting up in binary (the first switch is the leftmost bit).</small>}
        {ch.kind === 'seq' && <small>Steps run in order from everything off; a highlighted switch is the one that changed. Switches stay as set.</small>}
      </div>
    </div>
  )
}

/** A step of the CPU project: the lesson and the task, and the test programs with a line for each thing looked at. */
function ProjectBody({ step }: { step: ProjectStep }) {
  const hintShown = usePath((s) => s.hintShown)
  const ours = usePath((s) => s.ours)
  const circuit = useStore((s) => s.circuit)
  const checked = useProject((s) => (s.step === step.id ? s : null))
  const fresh = !!checked?.result && checked.of === circuit
  const result = fresh ? checked.result : null
  const next = stepAfter(step.id)
  const nextInfo = next ? getStep(next) : undefined
  const lineOf = (run: string, text: string) => result?.lines.find((l) => l.text === `${run}: ${text}`)
  return (
    <div className="challenge-body">
      <div className="challenge-text">
        <Lesson blocks={step.lesson} stepId={step.id} />
        <p className="task">
          <b>Your task:</b> {step.task}
        </p>
        {ours.length > 0 && (
          <p className="step-ours" data-testid="step-ours">
            You haven’t built{' '}
            {ours.map((id, i) => (
              <span key={id}>
                {i > 0 && (i === ours.length - 1 ? ' or ' : ', ')}
                <button className="link-button inline" onClick={() => startStep(id)}>
                  {(getStep(id) as BuildStep).chip}
                </button>
              </span>
            ))}{' '}
            yet, so the parts list has ours.
          </p>
        )}
        <div className="row">
          <button className="primary-action" onClick={checkStep} data-testid="step-check">
            Check my circuit
          </button>
          <button onClick={showStepHint} disabled={hintShown}>
            Hint
          </button>
          <button onClick={showStepSolution} title="Replace the canvas with a circuit that does it (undo brings yours back)">
            Show a solution
          </button>
          <button onClick={restartStep} title="Go back to where this step started (undo brings your work back)">
            Start over
          </button>
        </div>
        {hintShown && step.hint && <p className="challenge-hint">💡 {step.hint}</p>}
        {result && result.problems.length > 0 && (
          <ul className="asm-errors" aria-label="Problems">
            {result.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {result?.passed && (
          <div role="status" className="challenge-verdict">
            <p className="verdict good">✔ Solved! Every test program ran as it should.</p>
            <div className="step-earned">
              <button className="primary-action" onClick={nextStep} data-testid="step-next">
                {nextInfo ? `Next: ${nextInfo.title} →` : 'Back to the map'}
              </button>
            </div>
          </div>
        )}
        {checked?.result && !fresh && <small>The circuit has changed since it was last checked.</small>}
      </div>
      <div className="challenge-goal">
        <h4>The test programs</h4>
        {step.runs.map((run) => (
          <div key={run.title} className="project-run">
            <b>{run.title}</b>
            <pre>{run.program}</pre>
            <ul className="goals" data-testid="project-lines">
              {run.checks.map((k) => {
                const line = lineOf(run.title, k.text)
                return (
                  <li key={k.text} className={line ? (line.ok ? 'project-line ok' : 'project-line bad') : 'project-line'}>
                    <span aria-hidden>{line ? (line.ok ? '☑' : '☒') : '☐'}</span> {k.text}
                    {line?.got && <small> ({line.got})</small>}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        <small>Each program is put into the Program ROM and the clock is ticked; then the parts are read by their labels.</small>
      </div>
    </div>
  )
}

/** A program step: the lesson and the task, a button to edit the program, and a line for each test run. */
function ProgramBody({ step }: { step: ProgramStep }) {
  const hintShown = usePath((s) => s.hintShown)
  const circuit = useStore((s) => s.circuit)
  const checked = useProject((s) => (s.step === step.id ? s : null))
  const fresh = !!checked?.result && checked.of === circuit
  const result = fresh ? checked.result : null
  const next = stepAfter(step.id)
  const nextInfo = next ? getStep(next) : undefined
  return (
    <div className="challenge-body">
      <div className="challenge-text">
        <Lesson blocks={step.lesson} stepId={step.id} />
        <p className="task">
          <b>Your task:</b> {step.task}
        </p>
        <div className="row">
          <button onClick={editProgram} data-testid="edit-program" title="Select the Program ROM: its inspector shows the program to edit">
            Edit the program
          </button>
          <button className="primary-action" onClick={checkStep} data-testid="step-check">
            Check my program
          </button>
          <button onClick={showStepHint} disabled={hintShown}>
            Hint
          </button>
          <button onClick={showStepSolution} title="Put a program that does it in the ROM (undo brings yours back)">
            Show a solution
          </button>
          <button onClick={restartStep} title="Go back to the starting program (undo brings yours back)">
            Start over
          </button>
        </div>
        {hintShown && step.hint && <p className="challenge-hint">💡 {step.hint}</p>}
        {result && result.problems.length > 0 && (
          <ul className="asm-errors" aria-label="Problems">
            {result.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {result?.passed && (
          <div role="status" className="challenge-verdict">
            <p className="verdict good">✔ Solved! {step.computer ? 'The program does what it should.' : 'It runs on both computers.'}</p>
            <div className="step-earned">
              <button className="primary-action" onClick={nextStep} data-testid="step-next">
                {nextInfo ? `Next: ${nextInfo.title} →` : 'Back to the map'}
              </button>
            </div>
          </div>
        )}
        {checked?.result && !fresh && <small>The circuit or the program has changed since it was last checked.</small>}
      </div>
      <div className="challenge-goal">
        <h4>The tests</h4>
        <ul className="goals" data-testid="project-lines">
          {step.tests.map((t) => {
            const line = result?.lines.find((l) => l.text === t.title)
            return (
              <li key={t.title} className={line ? (line.ok ? 'project-line ok' : 'project-line bad') : 'project-line'}>
                <span aria-hidden>{line ? (line.ok ? '☑' : '☒') : '☐'}</span> {t.title}
                {line?.got && <small> ({line.got})</small>}
              </li>
            )
          })}
        </ul>
        <small>{step.computer === 'cpu8' ? 'The program runs until HALT on the 8-bit computer.' : step.computer === 'board6502' ? 'The program runs on the board until it has done what the test says.' : 'The program runs until HALT on your computer and on the reference one.'}</small>
      </div>
    </div>
  )
}

const NONE: boolean[] = []

/** An explore step: the lesson and what to do, and the goals as a checklist that ticks while the learner plays. */
function ExploreBody({ step }: { step: ExploreStep }) {
  const hintShown = usePath((s) => s.hintShown)
  const done = usePath((s) => step.id in s.progress.done)
  const ticked = useGoals((s) => (s.step === step.id ? s.ticked : NONE))
  const count = step.goals.filter((_, i) => done || ticked[i]).length
  const next = stepAfter(step.id)
  const nextInfo = next ? getStep(next) : undefined
  return (
    <div className="challenge-body">
      <div className="challenge-text">
        <Lesson blocks={step.lesson} stepId={step.id} />
        <p className="task">
          <b>Your task:</b> {step.task}
        </p>
        <div className="row">
          <button onClick={showStepHint} disabled={hintShown || !step.hint}>
            Hint
          </button>
          <button onClick={restartStep} title="Go back to the starting circuit (undo brings your work back)">
            Start over
          </button>
        </div>
        {hintShown && step.hint && <p className="challenge-hint">💡 {step.hint}</p>}
      </div>
      <div className="challenge-goal">
        <h4>Goals</h4>
        <ul className="goals" data-testid="goals">
          {step.goals.map((g, i) => {
            const on = done || ticked[i]
            return (
              <li key={i} className={on ? 'goal on' : 'goal'} aria-label={`${g.text}: ${on ? 'reached' : 'not yet'}`}>
                <span aria-hidden>{on ? '☑' : '☐'}</span> {g.text}
              </li>
            )
          })}
        </ul>
        <small>
          {count} of {step.goals.length}
          {count < step.goals.length && ' · keep playing'}
        </small>
        {done && (
          <div className="step-earned">
            <p className="step-done" data-testid="explore-done">
              ✔ Done.
            </p>
            <button className="primary-action" onClick={nextStep} data-testid="step-next">
              {nextInfo ? `Next: ${nextInfo.title} →` : 'Back to the map'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ReadBody({ step }: { step: Step }) {
  const progress = usePath((s) => s.progress)
  const next = stepAfter(step.id)
  const nextInfo = next ? getStep(next) : undefined
  const done = step.id in progress.done
  return (
    <div className="challenge-body read">
      <div className="challenge-text">
        <Lesson blocks={step.lesson} stepId={step.id} />
      </div>
      <div className="read-next">
        <button
          className="primary-action"
          onClick={() => {
            markRead()
            nextStep()
          }}
          data-testid="step-next"
        >
          {nextInfo ? `${done ? 'Next' : 'Got it, next'}: ${nextInfo.title} →` : 'Got it, back to the map'}
        </button>
        <small>Nothing to build here: read, then go on.</small>
      </div>
    </div>
  )
}

/** The panel under the canvas while a step of the learning path is open: where you are, the lesson, and what to do. */
export function StepPanel() {
  const id = usePath((s) => s.step)
  // Pointing at a name belongs to the step it was in.
  useEffect(() => clearSpot, [id])
  const progress = usePath((s) => s.progress)
  const folded = useSheet((s) => s.folded)
  const step = id ? getStep(id) : undefined
  if (!step) return null
  const chapter = getChapter(step.chapter)
  const inChapter = stepsOf(step.chapter)
  const at = inChapter.findIndex((s) => s.id === step.id)
  const before = stepBefore(step.id)
  const after = stepAfter(step.id)
  const done = progress.done[step.id]
  return (
    <section className={`wave-panel challenge-panel step-panel${folded ? ' folded' : ''}`} aria-label="Step" data-step={step.id}>
      <div className="wave-head">
        <button className="step-nav" onClick={() => before && startStep(before)} disabled={!before} aria-label="Previous step" title="Previous step">
          ◀
        </button>
        <span className="step-where">
          {chapter?.title} · step {at + 1} of {inChapter.length}
        </span>
        <button className="step-nav" onClick={() => after && startStep(after)} disabled={!after} aria-label="Next step" title="Next step">
          ▶
        </button>
        <strong>
          {numberOf(step)} {step.title}
          {done && (
            <span className="solved-badge" title={done.how === 'shown' ? 'You were shown the solution' : 'Done'}>
              {' '}
              <Mark how={done.how} />
              {done.star && ' ⭐'}
            </span>
          )}
        </strong>
        <button className="sheet-fold" onClick={toggleSheet} aria-expanded={!folded} data-testid="sheet-fold" title={folded ? 'Show the lesson' : 'Fold the lesson away to use the parts list'}>
          {folded ? 'Lesson ▴' : 'Parts ▾'}
        </button>
        <button onClick={openMap}>Map</button>
        <button onClick={closeStep} aria-label="Close step">
          ✕
        </button>
      </div>
      <Spotlight />
      {step.kind === 'build' ? <BuildBody step={step} /> : step.kind === 'explore' ? <ExploreBody step={step} /> : step.kind === 'project' ? <ProjectBody step={step} /> : step.kind === 'program' ? <ProgramBody step={step} /> : <ReadBody step={step} />}
    </section>
  )
}
