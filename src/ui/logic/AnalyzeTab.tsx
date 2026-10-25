import { useState } from 'react'
import { sendToBuild } from '../../app/logic'
import { showToast, useStore } from '../../app/store'
import { print } from '../../logic/expr'
import { minimizeExpr } from '../../logic/minimize'
import { tableToText, type Cell } from '../../logic/table'
import { MAX_ANALYZE_INPUTS } from '../../model/analyze'
import { KarnaughMap } from './KarnaughMap'
import { TruthTableView } from './TruthTableView'
import { useCircuitAnalysis } from './ports'

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    showToast(`${what} copied to the clipboard.`)
  } catch {
    window.prompt(`Copy the ${what}:`, text)
  }
}

/** Sweep chosen switches, read chosen LEDs: the truth table, the smallest expression and the Karnaugh map. */
export function AnalyzeTab() {
  const { ports, inputIds, outputIds, toggle, result, error } = useCircuitAnalysis()
  const [mapOutput, setMapOutput] = useState(0)
  const hasOtherIo = useStore((s) => Object.values(s.circuit.comps).some((k) => k.type === 'hexin' || k.type === 'hexdisp' || k.type === 'seg7'))

  if (!ports.inputs.length || !ports.outputs.length)
    return (
      <p className="logic-empty">
        This tab works out what a circuit does. Put at least one <b>Switch</b> and one <b>LED</b> on the canvas and wire them up; give them labels
        (A, B, Y…) to name the columns. Or open an example, such as <i>Basic gates</i>.
        {hasOtherIo && (
          <>
            <br />
            <br />
            This circuit uses 4-bit inputs or displays, which this tab does not read: it only sweeps Switches and reads LEDs.
          </>
        )}
      </p>
    )

  const table = result?.table
  const expressions = table
    ? table.outputs.map((name, o) => `${name} = ${print(minimizeExpr(table.values[o] as Cell[], table.inputs))}`)
    : []
  const unknown = !!table?.values.some((v) => v.includes(2))
  const shown = Math.min(mapOutput, (table?.outputs.length ?? 1) - 1)

  return (
    <div className="logic-grid">
      <section className="logic-ports" aria-label="Choose inputs and outputs">
        <h3>Inputs (switches)</h3>
        <ul className="port-list">
          {ports.inputs.map((p) => (
            <li key={p.id}>
              <label>
                <input
                  type="checkbox"
                  checked={inputIds.includes(p.id)}
                  disabled={!inputIds.includes(p.id) && inputIds.length >= MAX_ANALYZE_INPUTS}
                  onChange={() => toggle(p.id, 'in')}
                />
                <span>{p.name}</span>
              </label>
            </li>
          ))}
        </ul>
        <small>The first is the most significant bit. Up to {MAX_ANALYZE_INPUTS} are swept; switches not chosen stay as they are.</small>
        <h3>Outputs (LEDs)</h3>
        <ul className="port-list">
          {ports.outputs.map((p) => (
            <li key={p.id}>
              <label>
                <input type="checkbox" checked={outputIds.includes(p.id)} onChange={() => toggle(p.id, 'out')} />
                <span>{p.name}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="logic-results" aria-live="polite">
        {error && <p className="field-error">{error}</p>}
        {!table && !error && <p className="logic-empty">Choose at least one input and one output.</p>}
        {result?.warnings.map((w) => (
          <p key={w} className="logic-warning">
            ⚠ {w}
          </p>
        ))}
        {table && (
          <>
            <h3>Smallest expression</h3>
            <pre className="expressions" aria-label="Expressions">
              {expressions.join('\n')}
            </pre>
            {unknown && <small>Unknown (?) values are treated as “don’t care” when simplifying.</small>}
            <div className="row">
              <button onClick={() => copy(expressions.join('\n'), 'Expressions')}>Copy expressions</button>
              <button onClick={() => sendToBuild(expressions.join('\n'))} title="Open the Build tab with these expressions, to build them as a circuit">
                Use in Build tab
              </button>
            </div>

            <h3>Truth table</h3>
            <TruthTableView table={table} />
            <div className="row">
              <button onClick={() => copy(tableToText(table), 'Truth table')}>Copy table</button>
            </div>

            <h3>Karnaugh map</h3>
            {table.inputs.length >= 1 && table.inputs.length <= 4 ? (
              <>
                {table.outputs.length > 1 && (
                  <label className="field inline">
                    <span>Output</span>
                    <select value={shown} onChange={(e) => setMapOutput(Number(e.target.value))} aria-label="Map of output">
                      {table.outputs.map((name, o) => (
                        <option key={name} value={o}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <KarnaughMap values={table.values[shown] as Cell[]} names={table.inputs} output={table.outputs[shown]} />
              </>
            ) : (
              <p className="logic-empty">A Karnaugh map needs 1 to 4 inputs; {table.inputs.length ? `you have ${table.inputs.length}` : 'there are none'}.</p>
            )}
          </>
        )}
      </section>
    </div>
  )
}
