import { editFsm, selectInFsm, useFsm } from '../../app/fsm'
import { validateFsm } from '../../model/fsm'
import { deleteState, deleteTransition, issuesFor, moveTransition, renameState, setReset, toggleStateOutput, toggleTransitionOutput, updateTransition } from '../../model/fsm-edit'
import { IssueList, OutputChecks, TextBox } from './parts'

/** Edits the state or transition that is selected in the diagram: name, guard, outputs, where it goes. */
export function Selected() {
  const fsm = useFsm((s) => s.fsm)
  const sel = useFsm((s) => s.selected)
  const state = sel?.kind === 'state' ? fsm.states.find((s) => s.id === sel.id) : undefined
  const trans = sel?.kind === 'transition' ? fsm.transitions.find((t) => t.id === sel.id) : undefined

  if (!state && !trans)
    return (
      <p className="fsm-hint" data-testid="fsm-nothing-selected">
        Select a state or a transition to edit it. In the Table view, everything can be edited in rows.
      </p>
    )

  if (state) {
    const issues = issuesFor(validateFsm(fsm), { state: state.id })
    return (
      <section className="fsm-selected" aria-label={`State ${state.name}`}>
        <h3>State</h3>
        <div className="row fsm-selected-row">
          <label className="field inline">
            <span>Name</span>
            <TextBox value={state.name} label="State name" maxLength={20} data-fsm-focus onText={(v) => editFsm((f) => renameState(f, state.id, v), { merge: `state:${state.id}` })} />
          </label>
          <label className="field inline check">
            <input type="radio" name="fsm-reset" checked={fsm.reset === state.id} onChange={() => editFsm((f) => setReset(f, state.id))} aria-label="Reset state" />
            <span>Reset state</span>
          </label>
          <button className="danger" onClick={() => (editFsm((f) => deleteState(f, state.id)), selectInFsm(null))}>
            Delete state
          </button>
        </div>
        {fsm.type === 'moore' ? (
          <div className="field">
            <span>Outputs that are 1 in this state</span>
            <OutputChecks fsm={fsm} on={state.outputs} label={`Outputs in ${state.name}`} onToggle={(o) => editFsm((f) => toggleStateOutput(f, state.id, o))} />
          </div>
        ) : (
          <small>In a Mealy machine the outputs are set on the transitions.</small>
        )}
        <IssueList issues={issues} />
      </section>
    )
  }

  const t = trans!
  const issues = issuesFor(validateFsm(fsm), { transition: t.id })
  return (
    <section className="fsm-selected" aria-label="Transition">
      <h3>Transition</h3>
      <div className="row fsm-selected-row">
        <label className="field inline">
          <span>From</span>
          <select value={t.from} aria-label="From state" onChange={(e) => editFsm((f) => updateTransition(f, t.id, { from: e.target.value }))}>
            {fsm.states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field inline">
          <span>To</span>
          <select value={t.to} aria-label="To state" onChange={(e) => editFsm((f) => updateTransition(f, t.id, { to: e.target.value }))}>
            {fsm.states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field inline grow">
          <span>When</span>
          <TextBox
            value={t.guard}
            label="Guard"
            className="mono"
            data-fsm-focus
            placeholder={fsm.inputs.length ? `an expression, such as ${fsm.inputs[0]}${fsm.inputs[1] ? ` & !${fsm.inputs[1]}` : ''}; empty means always` : 'empty: always'}
            onText={(v) => editFsm((f) => updateTransition(f, t.id, { guard: v }), { merge: `guard:${t.id}` })}
          />
        </label>
      </div>
      {fsm.type === 'mealy' && (
        <div className="field">
          <span>Outputs that are 1 on this transition</span>
          <OutputChecks fsm={fsm} on={t.outputs} label="Outputs on this transition" onToggle={(o) => editFsm((f) => toggleTransitionOutput(f, t.id, o))} />
        </div>
      )}
      <div className="row">
        <button onClick={() => editFsm((f) => moveTransition(f, t.id, -1))} title="Try this one earlier: the first transition whose guard holds is taken">
          Earlier
        </button>
        <button onClick={() => editFsm((f) => moveTransition(f, t.id, 1))} title="Try this one later">
          Later
        </button>
        <button className="danger" onClick={() => (editFsm((f) => deleteTransition(f, t.id)), selectInFsm(null))}>
          Delete transition
        </button>
      </div>
      <IssueList issues={issues} />
    </section>
  )
}
