import { useMemo, useState } from 'react'
import {
  codesFor,
  editFsm,
  loadFsmFile,
  placeFsmCircuit,
  redoFsm,
  saveFsmFile,
  selectInFsm,
  setCustomCode,
  setEncoding,
  startFromBlank,
  startFromExample,
  tryGenerate,
  undoFsm,
  useFsm,
} from '../../app/fsm'
import { MAX_FSM_INPUTS, MAX_FSM_OUTPUTS, codeText, ENCODING_NAMES, stateBits, validateEncoding, validateFsm, type EncodingKind, type FsmIssue } from '../../model/fsm'
import { FSM_EXAMPLES } from '../../model/fsm-examples'
import { addInput, addOutput, removeInput, removeOutput, renameInput, renameOutput } from '../../model/fsm-edit'
import { fitView } from '../canvas/viewport'
import { IssueList, NameBox, TextBox } from './parts'

const GATES = new Set(['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor', 'buf'])

/** The machine as a whole: its name, type, inputs, outputs and codes; what the checker says; and the button that builds the circuit. */
export function SidePanel() {
  const fsm = useFsm((s) => s.fsm)
  const encoding = useFsm((s) => s.encoding)
  const custom = useFsm((s) => s.custom)
  const canUndo = useFsm((s) => s.past.length > 0)
  const canRedo = useFsm((s) => s.future.length > 0)
  const [fileError, setFileError] = useState<string | null>(null)

  const enc = useMemo(() => codesFor(fsm, encoding, custom), [fsm, encoding, custom])
  const issues = useMemo(() => [...validateFsm(fsm), ...validateEncoding(fsm, enc)], [fsm, enc])
  const errors = issues.filter((i) => i.level === 'error')
  const made = useMemo(() => (errors.length ? null : tryGenerate(fsm, encoding, custom)), [fsm, encoding, custom, errors.length])
  const counts = useMemo(() => {
    if (!made || made instanceof Error) return null
    const parts = Object.values(made.circuit.comps)
    return { gates: parts.filter((c) => GATES.has(c.type)).length, flops: parts.filter((c) => c.type === 'dff').length }
  }, [made])

  const pick = (issue: FsmIssue) => {
    if (issue.transition) selectInFsm({ kind: 'transition', id: issue.transition })
    else if (issue.state) selectInFsm({ kind: 'state', id: issue.state })
  }
  const problems = issues.filter((i) => i.level !== 'info')
  const notes = issues.filter((i) => i.level === 'info')

  return (
    <aside className="fsm-side" aria-label="State machine settings">
      <div className="fsm-build">
        <button
          className="primary-action"
          disabled={errors.length > 0}
          onClick={() => {
            if (placeFsmCircuit()) requestAnimationFrame(fitView)
          }}
        >
          Generate circuit
        </button>
        {errors.length > 0 ? (
          <small className="field-error">Fix the {errors.length === 1 ? 'error' : `${errors.length} errors`} under Checks first.</small>
        ) : counts ? (
          <small data-testid="fsm-counts">
            Builds {counts.gates} gate{counts.gates === 1 ? '' : 's'} and {counts.flops} flip-flop{counts.flops === 1 ? '' : 's'}, with a clock and a Reset switch.
          </small>
        ) : null}
      </div>
      <div className="row">
        <button onClick={undoFsm} disabled={!canUndo} title="Undo the last change to the machine">
          Undo
        </button>
        <button onClick={redoFsm} disabled={!canRedo} title="Redo">
          Redo
        </button>
        <select
          value=""
          aria-label="Start from"
          onChange={(e) => {
            const v = e.target.value
            if (v === 'blank') startFromBlank()
            else if (v) startFromExample(Number(v))
          }}
        >
          <option value="" disabled>
            Start from…
          </option>
          <option value="blank">Blank machine</option>
          {FSM_EXAMPLES.map((f, i) => (
            <option key={f.name} value={i}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <button
          onClick={() => {
            saveFsmFile()
            setFileError(null)
          }}
          title="Save the machine as a .fsm.json file"
        >
          Save file
        </button>
        <button onClick={async () => setFileError(await loadFsmFile())} title="Open a .fsm.json file">
          Open file…
        </button>
      </div>
      {fileError && <small className="field-error">{fileError}</small>}
      <small>The machine is also kept in this browser (see My circuits), so it is here next time.</small>

      <label className="field">
        <span>Name</span>
        <TextBox value={fsm.name} label="Machine name" maxLength={40} onText={(name) => editFsm((f) => ({ ...f, name }), { merge: 'name' })} />
      </label>

      <div className="field">
        <span id="fsm-type-label">Outputs depend on</span>
        <div className="seg" role="radiogroup" aria-labelledby="fsm-type-label">
          {(['moore', 'mealy'] as const).map((t) => (
            <button key={t} role="radio" aria-checked={fsm.type === t} className={fsm.type === t ? 'active' : ''} onClick={() => editFsm((f) => ({ ...f, type: t }))}>
              {t === 'moore' ? 'Moore: the state' : 'Mealy: state and inputs'}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Inputs (switches)</span>
        <ul className="fsm-names" aria-label="Inputs">
          {fsm.inputs.map((n, i) => (
            <li key={i}>
              <NameBox value={n} label={`Input ${i + 1} name`} maxLength={12} onCommit={(v) => editFsm((f) => renameInput(f, i, v))} />
              <button onClick={() => editFsm((f) => removeInput(f, i))} aria-label={`Remove input ${n}`} title="Remove this input">
                ✕
              </button>
            </li>
          ))}
        </ul>
        <div className="row">
          <button onClick={() => editFsm(addInput)} disabled={fsm.inputs.length >= MAX_FSM_INPUTS}>
            + Input
          </button>
        </div>
      </div>

      <div className="field">
        <span>Outputs (LEDs)</span>
        <ul className="fsm-names" aria-label="Outputs">
          {fsm.outputs.map((n, i) => (
            <li key={i}>
              <NameBox value={n} label={`Output ${i + 1} name`} maxLength={12} onCommit={(v) => editFsm((f) => renameOutput(f, i, v))} />
              <button onClick={() => editFsm((f) => removeOutput(f, i))} aria-label={`Remove output ${n}`} title="Remove this output">
                ✕
              </button>
            </li>
          ))}
        </ul>
        <div className="row">
          <button onClick={() => editFsm(addOutput)} disabled={fsm.outputs.length >= MAX_FSM_OUTPUTS}>
            + Output
          </button>
        </div>
      </div>

      <label className="field">
        <span>State codes</span>
        <select value={encoding} aria-label="Encoding" onChange={(e) => setEncoding(e.target.value as EncodingKind)}>
          {(Object.keys(ENCODING_NAMES) as EncodingKind[]).map((k) => (
            <option key={k} value={k}>
              {ENCODING_NAMES[k]}
            </option>
          ))}
        </select>
      </label>
      <table className="fsm-codes" aria-label="State codes">
        <thead>
          <tr>
            <th>State</th>
            <th>
              {stateBits(enc.bits)
                .reverse()
                .join(' ')}
            </th>
          </tr>
        </thead>
        <tbody>
          {fsm.states.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td className="mono">
                {encoding === 'custom' ? (
                  <NameBox
                    value={codeText(enc.codes[s.id] ?? 0, enc.bits)}
                    label={`Code of ${s.name}`}
                    className="fsm-code-input mono"
                    inputMode="numeric"
                    maxLength={16}
                    valid={(v) => /^[01]+$/.test(v)}
                    onCommit={(v) => setCustomCode(s.id, parseInt(v, 2))}
                  />
                ) : (
                  codeText(enc.codes[s.id] ?? 0, enc.bits)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <small>
        {enc.bits} flip-flop{enc.bits === 1 ? '' : 's'}. {encoding === 'onehot' ? 'One-hot: a flip-flop per state, and the logic is simple.' : 'Codes that no state uses are “don’t cares”, so the logic can be smaller.'}
      </small>

      <h3>Checks</h3>
      {problems.length === 0 && <p className="fsm-ok">No problems found.</p>}
      <IssueList issues={problems} onPick={pick} />
      {notes.length > 0 && (
        <details>
          <summary>
            {notes.length} note{notes.length === 1 ? '' : 's'}
          </summary>
          <IssueList issues={notes} onPick={pick} label="Notes" />
        </details>
      )}
    </aside>
  )
}
