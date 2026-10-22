import { useMemo, useState } from 'react'
import { openTextFile } from '../../app/files'
import { compareTables, type Comparison } from '../../logic/compare'
import { parseProgram, resolveProgram } from '../../logic/expr'
import { tableOfProgram, type TruthTable } from '../../logic/table'
import { MAX_ANALYZE_INPUTS, analyzeCircuit, circuitPorts } from '../../model/analyze'
import { deserialize } from '../../model/serialize'
import { useCircuitAnalysis } from './ports'

interface Other {
  table?: TruthTable
  warnings: string[]
  errors: string[]
}

/** The verdict, and the rows where the two differ. */
function Verdict({ c, aName, bName }: { c: Comparison; aName: string; bName: string }) {
  if (c.problems.length)
    return (
      <div className="verdict bad" role="status">
        {c.problems.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
    )
  const rows = 2 ** c.inputs.length
  return (
    <div role="status">
      {c.equal ? (
        <p className="verdict good">
          ✔ Equivalent: {aName} and {bName} give the same value for {c.outputs.join(', ')} in all {rows} combination{rows === 1 ? '' : 's'} of{' '}
          {c.inputs.join(', ') || 'no inputs'}.
        </p>
      ) : (
        <>
          <p className="verdict bad">
            ✘ Not equivalent: they differ in {c.mismatchCount} place{c.mismatchCount === 1 ? '' : 's'}.
          </p>
          <div className="truth-wrap">
            <table className="truth" aria-label="Differences">
              <thead>
                <tr>
                  {c.inputs.map((n) => (
                    <th key={n} className="in">
                      {n}
                    </th>
                  ))}
                  <th>Output</th>
                  <th>{aName}</th>
                  <th>{bName}</th>
                </tr>
              </thead>
              <tbody>
                {c.mismatches.map((m, i) => (
                  <tr key={i}>
                    {c.inputs.map((n) => (
                      <td key={n} className="in">
                        {m.inputs[n]}
                      </td>
                    ))}
                    <td>{m.output}</td>
                    <td className={`out v${m.a}`}>{m.a === 2 ? '?' : m.a}</td>
                    <td className={`out v${m.b}`}>{m.b === 2 ? '?' : m.b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {c.mismatchCount > c.mismatches.length && <small>The first {c.mismatches.length} are shown.</small>}
        </>
      )}
      {(c.onlyInA.length > 0 || c.onlyInB.length > 0) && (
        <small>
          Not compared (no output of that name on the other side): {[...c.onlyInA.map((o) => `${o} (${aName})`), ...c.onlyInB.map((o) => `${o} (${bName})`)].join(', ')}.
        </small>
      )}
    </div>
  )
}

/** Is the circuit on the canvas the same as an expression, or as another circuit file? */
export function CompareTab() {
  const mine = useCircuitAnalysis()
  const [mode, setMode] = useState<'expression' | 'file'>('expression')
  const [text, setText] = useState('')
  const [file, setFile] = useState<{ name: string; other: Other } | null>(null)

  const other = useMemo<Other>(() => {
    if (mode === 'file') return file?.other ?? { warnings: [], errors: [] }
    const { statements, errors } = parseProgram(text)
    if (errors.length) return { warnings: [], errors: errors.map((e) => `Line ${e.line}: ${e.message}`) }
    if (!statements.length) return { warnings: [], errors: [] }
    const r = resolveProgram(statements)
    return r.program ? { table: tableOfProgram(r.program), warnings: [], errors: [] } : { warnings: [], errors: r.errors.map((e) => `Line ${e.line}: ${e.message}`) }
  }, [mode, text, file])

  const openFile = async () => {
    const f = await openTextFile('.json,application/json')
    if (!f) return
    try {
      const c = deserialize(JSON.parse(f.text))
      const ports = circuitPorts(c)
      if (!ports.inputs.length || !ports.outputs.length) return setFile({ name: f.name, other: { warnings: [], errors: ['That circuit needs at least one switch and one LED.'] } })
      const a = analyzeCircuit(c, ports.inputs.slice(0, MAX_ANALYZE_INPUTS).map((p) => p.id), ports.outputs.map((p) => p.id))
      setFile({ name: f.name, other: { table: a.table, warnings: a.warnings, errors: ports.inputs.length > MAX_ANALYZE_INPUTS ? [`That circuit has ${ports.inputs.length} switches; only the first ${MAX_ANALYZE_INPUTS} were used.`] : [] } })
    } catch (e) {
      setFile({ name: f.name, other: { warnings: [], errors: [`Could not read ${f.name}: ${(e as Error).message}`] } })
    }
  }

  const mineTable = mine.result?.table
  const comparison = mineTable && other.table ? compareTables(mineTable, other.table) : null
  const otherName = mode === 'file' ? (file?.name ?? 'the file') : 'the expression'

  return (
    <div className="logic-grid">
      <section className="logic-ports">
        <h3>The circuit on the canvas</h3>
        {mineTable ? (
          <p>
            Inputs <b>{mineTable.inputs.join(', ')}</b>, outputs <b>{mineTable.outputs.join(', ')}</b>. Choose which switches and LEDs count in the Analyze tab.
          </p>
        ) : (
          <p className="logic-empty">It needs at least one switch and one LED (choose them in the Analyze tab).</p>
        )}
        <h3>Compare it with</h3>
        <div className="seg" role="radiogroup" aria-label="Compare with">
          {(['expression', 'file'] as const).map((m) => (
            <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
              {m === 'expression' ? 'An expression' : 'A circuit file'}
            </button>
          ))}
        </div>
        {mode === 'expression' ? (
          <>
            <textarea
              className="mono expr-box"
              aria-label="Expression to compare with"
              rows={5}
              spellCheck={false}
              placeholder={`${mineTable?.outputs[0] ?? 'Y'} = A·B + ¬C`}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <small>Outputs are matched by name, so name the line like the LED (for example Y).</small>
          </>
        ) : (
          <>
            <div className="row">
              <button onClick={openFile}>Open a circuit file…</button>
              {file && <small>{file.name}</small>}
            </div>
            <small>Its switches and LEDs are matched with this circuit’s by name (the labels), inputs and outputs alike.</small>
          </>
        )}
      </section>

      <section className="logic-results" aria-live="polite">
        {other.errors.length > 0 && (
          <ul className="asm-errors" aria-label="Errors">
            {other.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {[...(mine.result?.warnings ?? []), ...other.warnings].map((w) => (
          <p key={w} className="logic-warning">
            ⚠ {w}
          </p>
        ))}
        {comparison ? <Verdict c={comparison} aName="the circuit" bName={otherName} /> : !other.errors.length && <p className="logic-empty">Give it something to compare with.</p>}
      </section>
    </div>
  )
}
