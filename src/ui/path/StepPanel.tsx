import { useMemo } from 'react'
import { closeStep, openMap, showStepHint, usePath } from '../../app/path'
import { checkStep, markRead, nextStep, restartStep, showStepSolution, startStep } from '../../app/pathWork'
import { useStore } from '../../app/store'
import { circuitShape, logicParts, ruleProblems } from '../../model/challengecheck'
import { goalTable } from '../../model/challenges'
import { challengeOf } from '../../model/path/chips'
import { getChapter } from '../../model/path/chapters'
import { getStep, stepAfter, stepBefore, stepsOf } from '../../model/path/steps'
import type { Block, BuildStep, Step } from '../../model/path/types'
import { CheckVerdict, StepsTable } from '../challenges/CheckVerdict'
import { rulesText } from '../challenges/rulesText'
import { TruthTableView } from '../logic/TruthTableView'
import { numberOf } from './numbers'
import { Mark } from './Mark'

/** A lesson: paragraphs, and small tables. */
export function Lesson({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) =>
        'p' in b ? (
          <p key={i} className="step-lesson">
            {b.p}
          </p>
        ) : (
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
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      )}
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
        <Lesson blocks={step.lesson} />
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

function ReadBody({ step }: { step: Step }) {
  const progress = usePath((s) => s.progress)
  const next = stepAfter(step.id)
  const nextInfo = next ? getStep(next) : undefined
  const done = step.id in progress.done
  return (
    <div className="challenge-body read">
      <div className="challenge-text">
        <Lesson blocks={step.lesson} />
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
  const progress = usePath((s) => s.progress)
  const step = id ? getStep(id) : undefined
  if (!step) return null
  const chapter = getChapter(step.chapter)
  const inChapter = stepsOf(step.chapter)
  const at = inChapter.findIndex((s) => s.id === step.id)
  const before = stepBefore(step.id)
  const after = stepAfter(step.id)
  const done = progress.done[step.id]
  return (
    <section className="wave-panel challenge-panel step-panel" aria-label="Step" data-step={step.id}>
      <div className="wave-head">
        <button onClick={() => before && startStep(before)} disabled={!before} aria-label="Previous step" title="Previous step">
          ◀
        </button>
        <span className="step-where">
          {chapter?.title} · step {at + 1} of {inChapter.length}
        </span>
        <button onClick={() => after && startStep(after)} disabled={!after} aria-label="Next step" title="Next step">
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
        <button onClick={openMap}>Map</button>
        <button onClick={closeStep} aria-label="Close step">
          ✕
        </button>
      </div>
      {step.kind === 'build' ? <BuildBody step={step} /> : <ReadBody step={step} />}
    </section>
  )
}
