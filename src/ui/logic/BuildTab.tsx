import { useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { closeLogic, setBuildText, useLogic } from '../../app/logic'
import { insertCircuit, showToast } from '../../app/store'
import { parseProgram, print, resolveProgram } from '../../logic/expr'
import { minimizeExpr } from '../../logic/minimize'
import { tableOfProgram, type Cell, type TruthTable } from '../../logic/table'
import { synthesize, synthesizeTable } from '../../model/synth'
import { fitView } from '../canvas/viewport'
import { TruthTableView } from './TruthTableView'

const EXAMPLES: [string, string][] = [
  ['Half adder', 'Sum = A ⊕ B\nCarry = A·B'],
  ['Full adder', 'Sum = A ⊕ B ⊕ Cin\nCout = A·B + Cin·(A ⊕ B)'],
  ['2-to-1 multiplexer', 'Y = S·B + ¬S·A'],
  ['Majority of three', 'Y = A·B + A·C + B·C'],
]

/** Put a built circuit on the canvas, close the panel and show it. */
function place(circuit: Parameters<typeof insertCircuit>[0]) {
  const ids = insertCircuit(circuit)
  if (!ids.length) return
  closeLogic()
  requestAnimationFrame(fitView)
  showToast('Built the circuit below the rest. Select, move or edit it like any other part (undo removes it).')
}

const NAMES = ['A', 'B', 'C', 'D', 'E']

function ExpressionBuilder() {
  const text = useLogic((s) => s.buildText)
  const [simplify, setSimplify] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)

  const parsed = useMemo(() => {
    const { statements, errors } = parseProgram(text)
    if (errors.length || !statements.length) return { errors, program: undefined }
    const r = resolveProgram(statements)
    return { errors: r.errors, program: r.program }
  }, [text])
  const table = useMemo(() => (parsed.program && parsed.program.inputs.length <= 6 ? tableOfProgram(parsed.program) : null), [parsed.program])

  const insert = (s: string) => {
    const el = box.current
    const [a, b] = el ? [el.selectionStart, el.selectionEnd] : [text.length, text.length]
    el?.focus() // at once, so the next key goes into the box
    flushSync(() => setBuildText(text.slice(0, a) + s + text.slice(b))) // the text is in before the caret is placed
    el?.setSelectionRange(a + s.length, a + s.length)
  }

  return (
    <div className="logic-grid">
      <section className="logic-ports">
        <h3>Expressions</h3>
        <textarea
          ref={box}
          className="mono expr-box"
          aria-label="Expressions"
          rows={8}
          spellCheck={false}
          placeholder={'Y = A·B + ¬C\n\nOne line per output. A line can use the name of another line.'}
          value={text}
          onChange={(e) => setBuildText(e.target.value)}
        />
        <div className="row symbols" aria-label="Insert a symbol">
          {[
            ['¬', 'NOT (also ! or ~ or A’)'],
            ['·', 'AND (also * or &)'],
            ['+', 'OR (also |)'],
            ['⊕', 'XOR (also ^)'],
            ['(', ''],
            [')', ''],
          ].map(([s, tip]) => (
            <button key={s} onClick={() => insert(s)} title={tip || undefined} aria-label={`Insert ${s}`}>
              {s}
            </button>
          ))}
        </div>
        <small>
          NOT binds tightest, then AND, XOR, OR. Inputs are the names no line defines.
        </small>
        <h3>Examples</h3>
        <div className="row">
          {EXAMPLES.map(([name, code]) => (
            <button key={name} onClick={() => setBuildText(code)}>
              {name}
            </button>
          ))}
        </div>
      </section>

      <section className="logic-results" aria-live="polite">
        {parsed.errors.length > 0 && (
          <ul className="asm-errors" aria-label="Errors">
            {parsed.errors.map((e, i) => (
              <li key={i}>
                <b>
                  Line {e.line}
                  {e.column > 1 ? `, column ${e.column}` : ''}:
                </b>{' '}
                {e.message}
              </li>
            ))}
          </ul>
        )}
        {!text.trim() && <p className="logic-empty">Type an expression, or pick an example.</p>}
        {parsed.program && (
          <>
            <p>
              <b>Inputs:</b> {parsed.program.inputs.join(', ') || 'none'}. <b>Outputs:</b> {parsed.program.outputs.map((o) => o.name).join(', ')}.
            </p>
            <label className="field check">
              <input type="checkbox" checked={simplify} onChange={(e) => setSimplify(e.target.checked)} />
              <span>Simplify first: build the smallest sum of products of each output instead of exactly what is written</span>
            </label>
            <div className="row">
              <button className="primary-action" onClick={() => place(synthesize(parsed.program!, { simplify }))}>
                Build circuit
              </button>
            </div>
            {table ? (
              <>
                <h3>Truth table</h3>
                <TruthTableView table={table} />
              </>
            ) : (
              <small>The truth table is shown for up to 6 inputs.</small>
            )}
          </>
        )}
      </section>
    </div>
  )
}

const NEXT: Record<Cell, Cell> = { 0: 1, 1: 2, 2: 0 }

function TableBuilder() {
  const [n, setN] = useState(2)
  const [name, setName] = useState('Y')
  const [values, setValues] = useState<Cell[]>([0, 0, 0, 1])
  const inputs = NAMES.slice(0, n)
  const validName = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !inputs.includes(name)
  const table: TruthTable = { inputs, outputs: [name], values: [values] }
  const expression = useMemo(() => print(minimizeExpr(values, inputs)), [values, n]) // oxlint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="logic-grid">
      <section className="logic-ports">
        <h3>Truth table</h3>
        <label className="field inline">
          <span>Inputs</span>
          <select
            value={n}
            aria-label="Number of inputs"
            onChange={(e) => {
              const k = Number(e.target.value)
              setN(k)
              setValues(Array(2 ** k).fill(0))
            }}
          >
            {[1, 2, 3, 4, 5].map((k) => (
              <option key={k} value={k}>
                {k} ({NAMES.slice(0, k).join(', ')})
              </option>
            ))}
          </select>
        </label>
        <label className="field inline">
          <span>Output name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Output name" aria-invalid={!validName} className={validName ? undefined : 'invalid'} maxLength={12} />
        </label>
        {!validName && <small className="field-error">A name with letters, digits and underscores, different from the inputs.</small>}
        <small>Click an output value to change it: 0, 1, or X (a “don’t care”: the circuit may do either).</small>
      </section>
      <section className="logic-results">
        <div className="truth-wrap">
          <table className="truth editable" aria-label="Truth table to build">
            <thead>
              <tr>
                {inputs.map((i) => (
                  <th key={i} className="in">
                    {i}
                  </th>
                ))}
                <th className="out">{name || '?'}</th>
              </tr>
            </thead>
            <tbody>
              {values.map((v, row) => (
                <tr key={row}>
                  {inputs.map((_, i) => (
                    <td key={i} className="in">
                      {(row >> (n - 1 - i)) & 1}
                    </td>
                  ))}
                  <td className={`out v${v}`}>
                    <button className="cellbtn" onClick={() => setValues(values.map((x, r) => (r === row ? NEXT[x] : x)))} aria-label={`Row ${row}`}>
                      {v === 2 ? 'X' : v}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          <b>Smallest expression:</b> <code>{validName ? `${name} = ${expression}` : expression}</code>
        </p>
        <div className="row">
          <button className="primary-action" disabled={!validName} onClick={() => place(synthesizeTable(table))}>
            Build circuit
          </button>
        </div>
      </section>
    </div>
  )
}

/** Build a circuit from expressions, or from a truth table you fill in. */
export function BuildTab() {
  const [mode, setMode] = useState<'expression' | 'table'>('expression')
  return (
    <>
      <div className="seg" role="radiogroup" aria-label="Build from">
        {(['expression', 'table'] as const).map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
            {m === 'expression' ? 'Expressions' : 'Truth table'}
          </button>
        ))}
      </div>
      {mode === 'expression' ? <ExpressionBuilder /> : <TableBuilder />}
    </>
  )
}
