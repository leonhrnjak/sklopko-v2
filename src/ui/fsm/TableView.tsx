import { useMemo } from 'react'
import { addTransition, deleteState, deleteTransition, moveTransition, renameState, setReset, stateTable, toggleStateOutput, toggleTransitionOutput, updateTransition, addState, issuesFor } from '../../model/fsm-edit'
import { editFsm, selectInFsm, useFsm } from '../../app/fsm'
import { validateFsm } from '../../model/fsm'
import { IssueList, TextBox } from './parts'

/** The machine as tables: the states, the transitions grouped by the state they leave, and what the machine does for every input. */
export function TableView() {
  const fsm = useFsm((s) => s.fsm)
  const sel = useFsm((s) => s.selected)
  const issues = useMemo(() => validateFsm(fsm), [fsm])
  const nameOf = (id: string) => fsm.states.find((s) => s.id === id)?.name ?? id
  const table = useMemo(() => stateTable(fsm), [fsm])
  const selected = (kind: 'state' | 'transition', id: string) => (sel?.kind === kind && sel.id === id ? 'selected' : undefined)

  return (
    <div className="fsm-table-view">
      <h3>States</h3>
      <div className="fsm-scroll">
        <table className="fsm-table" aria-label="States">
          <thead>
            <tr>
              <th>Reset</th>
              <th>Name</th>
              {fsm.type === 'moore' && fsm.outputs.map((o) => <th key={o} title={`Is ${o} 1 in this state?`}>{o}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {fsm.states.map((s) => {
              const own = issuesFor(issues, { state: s.id })
              return (
                <tr key={s.id} className={selected('state', s.id)} onFocus={() => selectInFsm({ kind: 'state', id: s.id })}>
                  <td>
                    <input type="radio" name="table-reset" checked={fsm.reset === s.id} onChange={() => editFsm((f) => setReset(f, s.id))} aria-label={`${s.name} is the reset state`} />
                  </td>
                  <td>
                    <TextBox value={s.name} label={`Name of ${s.name}`} maxLength={20} className={own.some((i) => i.level === 'error') ? 'invalid' : undefined} onText={(v) => editFsm((f) => renameState(f, s.id, v), { merge: `state:${s.id}` })} />
                  </td>
                  {fsm.type === 'moore' &&
                    fsm.outputs.map((o) => (
                      <td key={o}>
                        <input type="checkbox" checked={s.outputs.includes(o)} aria-label={`${o} in ${s.name}`} onChange={() => editFsm((f) => toggleStateOutput(f, s.id, o))} />
                      </td>
                    ))}
                  <td>
                    <button className="danger" aria-label={`Delete state ${s.name}`} title="Delete this state and its transitions" onClick={() => editFsm((f) => deleteState(f, s.id))}>
                      ✕
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button onClick={() => editFsm((f) => addState(f, 200, 200).fsm)}>+ State</button>
      </div>

      <h3>Transitions</h3>
      <small>Within a state they are tried from the top; the first whose condition holds is taken. If none holds the machine stays.</small>
      <div className="fsm-scroll">
        <table className="fsm-table" aria-label="Transitions">
          <thead>
            <tr>
              <th>From</th>
              <th>When</th>
              <th>To</th>
              {fsm.type === 'mealy' && fsm.outputs.map((o) => <th key={o} title={`Is ${o} 1 on this transition?`}>{o}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {fsm.states.map((s) => {
              const out = fsm.transitions.filter((t) => t.from === s.id)
              const cols = 4 + (fsm.type === 'mealy' ? fsm.outputs.length : 0)
              return [
                ...out.map((t, i) => {
                  const own = issuesFor(issues, { transition: t.id })
                  return (
                    <tr key={t.id} className={selected('transition', t.id)} onFocus={() => selectInFsm({ kind: 'transition', id: t.id })}>
                      <td>{i === 0 ? s.name : ''}</td>
                      <td>
                        <TextBox
                          value={t.guard}
                          label={`Condition of the transition ${s.name} to ${nameOf(t.to)}`}
                          className={`mono${own.some((x) => x.level === 'error') ? ' invalid' : ''}`}
                          placeholder={fsm.inputs.length ? 'always' : ''}
                          onText={(v) => editFsm((f) => updateTransition(f, t.id, { guard: v }), { merge: `guard:${t.id}` })}
                        />
                      </td>
                      <td>
                        <select value={t.to} aria-label={`Target of the transition ${s.name} to ${nameOf(t.to)}`} onChange={(e) => editFsm((f) => updateTransition(f, t.id, { to: e.target.value }))}>
                          {fsm.states.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      {fsm.type === 'mealy' &&
                        fsm.outputs.map((o) => (
                          <td key={o}>
                            <input type="checkbox" checked={t.outputs.includes(o)} aria-label={`${o} on the transition ${s.name} to ${nameOf(t.to)}`} onChange={() => editFsm((f) => toggleTransitionOutput(f, t.id, o))} />
                          </td>
                        ))}
                      <td className="fsm-actions">
                        <button aria-label="Try earlier" title="Try this one earlier" disabled={i === 0} onClick={() => editFsm((f) => moveTransition(f, t.id, -1))}>
                          ▲
                        </button>
                        <button aria-label="Try later" title="Try this one later" disabled={i === out.length - 1} onClick={() => editFsm((f) => moveTransition(f, t.id, 1))}>
                          ▼
                        </button>
                        <button className="danger" aria-label="Delete transition" title="Delete this transition" onClick={() => editFsm((f) => deleteTransition(f, t.id))}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  )
                }),
                ...out.flatMap((t) => {
                  const own = issuesFor(issues, { transition: t.id })
                  return own.length
                    ? [
                        <tr key={`${t.id}-issues`} className="fsm-issue-row">
                          <td colSpan={cols}>
                            <IssueList issues={own} />
                          </td>
                        </tr>,
                      ]
                    : []
                }),
                <tr key={`${s.id}-add`} className="fsm-add-row">
                  <td colSpan={cols}>
                    {!out.length && <span className="fsm-from">{s.name}: </span>}
                    <button aria-label={`Add a transition from ${s.name}`} onClick={() => editFsm((f) => addTransition(f, s.id, s.id).fsm)}>
                      + Transition from {s.name}
                    </button>
                  </td>
                </tr>,
              ]
            })}
          </tbody>
        </table>
      </div>

      {table.rows.length > 0 && (
        <>
          <h3>What the machine does</h3>
          <small>
            For each state and each setting of the inputs {fsm.inputs.length ? `(${fsm.inputs.join('')})` : ''}: the next state{fsm.outputs.length ? ' and the outputs that are 1' : ''}.
          </small>
          <div className="fsm-scroll">
            <table className="fsm-table derived" aria-label="State table">
              <thead>
                <tr>
                  <th>State</th>
                  {table.conditions.map((c) => (
                    <th key={c} className="mono">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => (
                  <tr key={row.state}>
                    <td>{nameOf(row.state)}</td>
                    {row.cells.map((cell, i) => (
                      <td key={i}>
                        {nameOf(cell.to)}
                        {cell.outputs.length > 0 && <span className="fsm-out"> / {cell.outputs.join(' ')}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {table.rows.length === 0 && fsm.inputs.length > 4 && <small>The state table is shown for up to 4 inputs.</small>}
    </div>
  )
}
