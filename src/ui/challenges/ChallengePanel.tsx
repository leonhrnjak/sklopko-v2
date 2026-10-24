import { useMemo } from 'react'
import { closeChallenge, openChallengeList, showHint, useChallenges } from '../../app/challenges'
import { nextUnsolved, restartChallenge, runCheck, showSolution, startChallenge } from '../../app/challengeWork'
import { useStore } from '../../app/store'
import { CHALLENGES, goalTable, type Challenge } from '../../model/challenges'
import { ruleProblems, type CheckResult } from '../../model/challengecheck'
import type { Circuit } from '../../model/circuit'
import { Differences } from '../logic/Differences'
import { TruthTableView } from '../logic/TruthTableView'

/** What a check was about, without the switch positions (flipping a switch doesn't change the answer). */
const shape = (c: Circuit) =>
  JSON.stringify([
    Object.values(c.comps).map((k) => [k.id, k.type, k.label, JSON.stringify(k.params.inputs ?? '')]),
    Object.values(c.wires).map((w) => [w.from.comp, w.from.pin, w.to.comp, w.to.pin]),
  ])

/** The rules as a sentence, or nothing. */
function rulesText(ch: Challenge): string | null {
  if (!ch.rules) return null
  const parts: string[] = []
  if (ch.rules.only) parts.push(`Only these gates: ${ch.rules.only.map((t) => t.toUpperCase()).join(', ')}.`)
  if (ch.rules.maxParts) parts.push(`At most ${ch.rules.maxParts} gate${ch.rules.maxParts === 1 ? '' : 's'}.`)
  return parts.join(' ')
}

/** The steps of a memory challenge, each with all the switches as they are then. */
function StepsTable({ ch }: { ch: Challenge & { kind: 'seq' } }) {
  const state: Record<string, number> = Object.fromEntries(ch.inputs.map((n) => [n, 0]))
  const rows = ch.steps.map((s) => {
    Object.assign(state, s.set)
    return { switches: { ...state }, expect: s.expect, changed: Object.keys(s.set) }
  })
  return (
    <div className="truth-wrap">
      <table className="truth" aria-label="Steps">
        <thead>
          <tr>
            <th>#</th>
            {ch.inputs.map((n) => (
              <th key={n} className="in">
                {n}
              </th>
            ))}
            {ch.outputs.map((n) => (
              <th key={n} className="out">
                {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              {ch.inputs.map((n) => (
                <td key={n} className={`in${r.changed.includes(n) ? ' changed' : ''}`}>
                  {r.switches[n]}
                </td>
              ))}
              {ch.outputs.map((n) => (
                <td key={n} className={`out v${r.expect[n] ?? 2}`}>
                  {r.expect[n] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Verdict({ ch, check, next }: { ch: Challenge; check: CheckResult; next: Challenge | undefined }) {
  return (
    <div role="status" aria-live="polite" className="challenge-verdict">
      {check.problems.length > 0 && (
        <ul className="asm-errors" aria-label="Problems">
          {check.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {check.warnings.map((w) => (
        <p key={w} className="logic-warning">
          ⚠ {w}
        </p>
      ))}
      {check.passed ? (
        <div>
          <p className="verdict good">✔ Solved! {ch.kind === 'comb' ? 'Every combination of the switches gives the right answer.' : `All ${check.stepCount} steps came out right.`}</p>
          {next ? (
            <button className="primary-action" onClick={() => startChallenge(next.id)}>
              Next: {next.title} →
            </button>
          ) : (
            <p>You have solved every challenge.</p>
          )}
        </div>
      ) : check.comparison && !check.problems.length ? (
        <>
          <p className="verdict bad">
            ✘ Not yet: {check.comparison.mismatchCount} wrong answer{check.comparison.mismatchCount === 1 ? '' : 's'} in the table.
          </p>
          <Differences c={check.comparison} aName="wanted" bName="yours" />
        </>
      ) : check.failures && !check.problems.length ? (
        <>
          <p className="verdict bad">✘ Not yet: {check.failures.length ? `step ${check.failures[0].step} of ${check.stepCount} went wrong.` : 'it never settles.'}</p>
          {check.failures.length > 0 && (
            <div className="truth-wrap">
              <table className="truth" aria-label="Differences">
                <thead>
                  <tr>
                    <th>Step</th>
                    {ch.inputs.map((n) => (
                      <th key={n} className="in">
                        {n}
                      </th>
                    ))}
                    <th>Output</th>
                    <th>wanted</th>
                    <th>yours</th>
                  </tr>
                </thead>
                <tbody>
                  {check.failures.map((f, i) => (
                    <tr key={i}>
                      <td>{f.step}</td>
                      {ch.inputs.map((n) => (
                        <td key={n} className="in">
                          {f.switches[n]}
                        </td>
                      ))}
                      <td>{f.output}</td>
                      <td className={`out v${f.expected}`}>{f.expected}</td>
                      <td className={`out v${f.got}`}>{f.got === 2 ? '?' : f.got}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
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
  const now = useMemo(() => shape(circuit), [circuit])
  const resultShape = useMemo(() => (result ? shape(result.of) : ''), [result])
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
          {fresh && result && <Verdict ch={ch} check={result.check} next={nextUnsolved(ch.id)} />}
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
