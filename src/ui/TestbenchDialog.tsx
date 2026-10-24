import { useEffect, useMemo, useState } from 'react'
import { closeTestbench, setTests, useTestbench } from '../app/testbench'
import { useStore } from '../app/store'
import { levelsOf } from '../model/ic'
import { runTests, testNames, type TestRun } from '../model/testbench'

const SAMPLE = `# One step on each line. Switches are set, a clock is pulsed, LEDs are read.
A=1 B=1; expect Y=1
A=0; expect Y=0`

/** A testbench for the circuit: steps as text, saved with it, and what a run of them found. */
export function TestbenchDialog() {
  const open = useTestbench((s) => s.open)
  return open ? <Dialog /> : null
}

function Dialog() {
  const circuit = useStore((s) => s.circuit)
  const inside = levelsOf(circuit).length > 0
  const saved = circuit.tests ?? ''
  const [draft, setDraft] = useState(saved)
  const [result, setResult] = useState<{ run: TestRun | null; errors: { line: number; message: string }[] } | null>(null)
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target instanceof HTMLTextAreaElement) && closeTestbench()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  const names = useMemo(() => testNames(circuit), [circuit])
  const commit = () => setTests(draft)
  const run = () => {
    commit()
    setResult(runTests(circuit, draft))
  }
  const failed = result?.run ? result.run.outcomes.filter((o) => o.problem || o.failures.length) : []
  const shown = (v: number) => (v === 2 ? 'unknown' : String(v))
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && (commit(), closeTestbench())}>
      <div className="modal testbench" role="dialog" aria-modal="true" aria-label="Tests">
        <header className="modal-head">
          <strong>Tests</strong>
          <button
            className="modal-close"
            onClick={() => {
              commit()
              closeTestbench()
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="modal-body">
          {inside ? (
            <p className="logic-warning">The tests belong to the whole circuit: go back out of the IC to see or change them.</p>
          ) : (
            <>
              <p className="challenge-intro">
                Write steps for this circuit, one on each line. They are run in order from the circuit switched on with every switch off; the
                tests are saved with the circuit. Separate the parts of a line with <code>;</code>:{' '}
                <code>A=1 B=0</code> sets switches, <code>pulse CLK</code> raises a switch and lowers it again, <code>expect Q=1</code> reads
                LEDs.
              </p>
              <p className="challenge-intro">
                Switches: <b data-testid="test-inputs">{names.inputs.join(', ') || 'none'}</b>. LEDs: <b data-testid="test-outputs">{names.outputs.join(', ') || 'none'}</b>.
              </p>
              <textarea
                className="test-text"
                aria-label="Test steps"
                rows={10}
                spellCheck={false}
                value={draft}
                placeholder={SAMPLE}
                onChange={(e) => {
                  setDraft(e.target.value)
                  setResult(null)
                }}
                onBlur={commit}
              />
              <div className="row">
                <button className="primary-action" onClick={run} disabled={!draft.trim()}>
                  Run tests
                </button>
              </div>
              {result && result.errors.length > 0 && (
                <ul className="test-results" aria-label="Errors">
                  {result.errors.map((e) => (
                    <li key={e.line} className="bad">
                      Line {e.line}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
              {result?.run && (
                <>
                  <p className={failed.length || result.run.unstable ? 'logic-warning' : 'challenge-count ok'} role="status" data-testid="test-summary">
                    {failed.length || result.run.unstable
                      ? `${failed.length} of ${result.run.outcomes.length} step${result.run.outcomes.length === 1 ? '' : 's'} did not pass.`
                      : `All ${result.run.outcomes.length} step${result.run.outcomes.length === 1 ? '' : 's'} passed.`}
                  </p>
                  {result.run.unstable && <p className="logic-warning">The circuit keeps changing by itself and never settles in some step (a feedback loop that does not hold a value).</p>}
                  {failed.length > 0 && (
                    <ul className="test-results" aria-label="Failing steps">
                      {failed.map((o) => (
                        <li key={o.line} className="bad">
                          <b>Line {o.line}</b> <code>{o.text}</code>
                          {o.problem && <div>{o.problem}</div>}
                          {o.failures.map((f) => (
                            <div key={f.output}>
                              {f.output} was {shown(f.got)}, expected {f.expected}.
                            </div>
                          ))}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
