import { useMemo } from 'react'
import { closeChallenge, openChallengeList, showHint, useChallenges } from '../../app/challenges'
import { nextUnsolved, restartChallenge, runCheck, showSolution, startChallenge } from '../../app/challengeWork'
import { useStore } from '../../app/store'
import { CHALLENGES, goalTable } from '../../model/challenges'
import { circuitShape, ruleProblems } from '../../model/challengecheck'
import { TruthTableView } from '../logic/TruthTableView'
import { CheckVerdict, StepsTable } from './CheckVerdict'
import { rulesText } from './rulesText'

/** Under "Solved!": the next challenge to try. */
function NextChallenge({ id }: { id: string }) {
  const next = nextUnsolved(id)
  return next ? (
    <button className="primary-action" onClick={() => startChallenge(next.id)}>
      Next: {next.title} →
    </button>
  ) : (
    <p>You have solved every challenge.</p>
  )
}

/** The panel under the canvas while a challenge is open: the lesson, the goal, and the check. */
export function ChallengePanel() {
  const id = useChallenges((s) => s.current)
  const solved = useChallenges((s) => s.solved)
  const hintShown = useChallenges((s) => s.hintShown)
  const result = useChallenges((s) => s.result)
  const circuit = useStore((s) => s.circuit)
  const ch = CHALLENGES.find((c) => c.id === id)
  const now = useMemo(() => circuitShape(circuit), [circuit])
  const resultShape = useMemo(() => (result ? circuitShape(result.of) : ''), [result])
  const table = useMemo(() => (ch?.kind === 'comb' ? goalTable(ch) : null), [ch])
  if (!ch) return null
  const fresh = result && resultShape === now
  const live = ruleProblems(circuit, ch.rules)
  const rules = rulesText(ch)
  const number = CHALLENGES.indexOf(ch) + 1
  return (
    <section className="wave-panel challenge-panel" aria-label="Challenge">
      <div className="wave-head">
        <strong>
          {number}. {ch.title}
          {solved.includes(ch.id) && (
            <span className="solved-badge" title="You have solved this one">
              {' '}
              ✔
            </span>
          )}
        </strong>
        <button onClick={openChallengeList}>All challenges</button>
        <button onClick={closeChallenge} aria-label="Close challenge">
          ✕
        </button>
      </div>
      <div className="challenge-body">
        <div className="challenge-text">
          {ch.lesson.map((p, i) => (
            <p key={i} className="lesson">
              {p}
            </p>
          ))}
          <p className="task">
            <b>Your task:</b> {ch.task}
          </p>
          {rules && <p className="rules">{rules}</p>}
          {live.length > 0 && !fresh && <p className="logic-warning">⚠ {live[0]}</p>}
          <div className="row">
            <button className="primary-action" onClick={runCheck} data-testid="challenge-check">
              Check my circuit
            </button>
            <button onClick={showHint} disabled={hintShown}>
              Hint
            </button>
            <button onClick={showSolution} title="Replace the canvas with a circuit that solves it (undo brings yours back)">
              Show a solution
            </button>
            <button onClick={restartChallenge} title="Go back to the starting circuit (undo brings your work back)">
              Start over
            </button>
          </div>
          {hintShown && <p className="challenge-hint">💡 {ch.hint}</p>}
          {fresh && result && <CheckVerdict ch={ch} check={result.check} success={<NextChallenge id={ch.id} />} />}
          {result && !fresh && <small>The circuit has changed since it was last checked.</small>}
        </div>
        <div className="challenge-goal">
          <h4>{ch.kind === 'comb' ? 'What it should do' : 'The test, step by step'}</h4>
          {table ? <TruthTableView table={table} label="Goal" /> : ch.kind === 'seq' ? <StepsTable ch={ch} /> : null}
          {ch.kind === 'comb' && <small>Every combination of the switches, counting up in binary (the first switch is the leftmost bit).</small>}
          {ch.kind === 'seq' && <small>Steps run in order from everything off; a highlighted switch is the one that changed. Switches stay as set.</small>}
        </div>
      </div>
    </section>
  )
}
