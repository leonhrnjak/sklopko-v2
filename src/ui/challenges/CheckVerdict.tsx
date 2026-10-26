import type { ReactNode } from 'react'
import type { CheckResult } from '../../model/challengecheck'
import type { Challenge } from '../../model/challenges'
import { Differences } from '../logic/Differences'

/** The steps of a memory challenge, each with all the switches as they are then. */
export function StepsTable({ ch }: { ch: Challenge & { kind: 'seq' } }) {
  const state: Record<string, number> = Object.fromEntries(ch.inputs.map((n) => [n, 0]))
  const rows = ch.steps.map((s) => {
    Object.assign(state, s.set)
    return { switches: { ...state }, expect: s.expect, changed: Object.keys(s.set), pulse: s.pulse }
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
                <td key={n} className={`in${r.changed.includes(n) || r.pulse === n ? ' changed' : ''}`}>
                  {r.pulse === n ? '⏉' : r.switches[n]}
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

/** What a check found: the problems and warnings, then either "Solved!" (with `success` under it) or the differences from what was wanted. */
export function CheckVerdict({ ch, check, success }: { ch: Challenge; check: CheckResult; success: ReactNode }) {
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
          {success}
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
                          {f.pulse === n ? '⏉' : f.switches[n]}
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
