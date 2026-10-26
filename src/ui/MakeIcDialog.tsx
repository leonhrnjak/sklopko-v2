import { useEffect, useMemo, useState } from 'react'
import { produce } from 'immer'
import { closeMakeIc, makeIC, setMakeIcReplace, useMakeIc } from '../app/ics'
import { useStore } from '../app/store'
import { newId } from '../model/circuit'
import { detectSymbol } from '../model/icsymbol'
import { IC, collapseSelection, deriveInterface, icProblems, operableInside, subCircuit } from '../model/ic'

/** Asks for a name and shows the pins an IC made from the selection (or the whole circuit) would have. */
export function MakeIcDialog() {
  const open = useMakeIc((s) => s.open)
  return open ? <Dialog /> : null
}

function Dialog() {
  const from = useMakeIc((s) => s.from)
  const replace = useMakeIc((s) => s.replace)
  const circuit = useStore((s) => s.circuit)
  // What the IC would be made of: the parts as they are, or, when they are replaced, the parts with a pin for every net that crosses their edge.
  const doc = useMemo(() => {
    if (!(replace && from)) return subCircuit(circuit, from ?? undefined)
    const made = produce(circuit, (d) => {
      collapseSelection(d, from, 'IC', newId)
    })
    const inst = Object.values(made.comps).find((k) => k.type === IC && !circuit.comps[k.id])
    return inst ? made.ics![String(inst.params.ic)].circuit : subCircuit(circuit, from)
  }, [circuit, from, replace])
  const [name, setName] = useState('')
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeMakeIc()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  const pins = deriveInterface(doc)
  const problems = icProblems(doc)
  const operable = operableInside(doc)
  const parts = Object.keys(doc.comps).length
  const submit = () => {
    if (problems.length) return
    makeIC(name, from, replace, detectSymbol)
    closeMakeIc()
  }
  const list = (items: { name: string; bits: number }[]) => (items.length ? items.map((p) => (p.bits > 1 ? `${p.name} (${p.bits} bits)` : p.name)).join(', ') : 'none')
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && closeMakeIc()}>
      <div className="modal make-ic" role="dialog" aria-modal="true" aria-label="Make IC">
        <header className="modal-head">
          <strong>Make IC</strong>
          <button className="modal-close" onClick={closeMakeIc} aria-label="Close">
            ✕
          </button>
        </header>
        <form
          className="modal-body"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <p className="challenge-intro">
            {from ? `${parts} selected part${parts === 1 ? '' : 's'} become` : 'The whole circuit becomes'} a part of its own: a box with one pin for each switch
            (or bus input) and each LED (or bus display) inside, named after its label. {replace ? 'The parts are replaced by it, wired as they were.' : 'The circuit stays as it is.'}
          </p>
          {from && (
            <label className="field check">
              <input type="checkbox" checked={replace} onChange={(e) => setMakeIcReplace(e.target.checked)} />
              <span>Replace the selected parts with the IC (the nets that cross their edge become its pins)</span>
            </label>
          )}
          <label className="setting">
            <span>Name</span>
            <input aria-label="IC name" value={name} maxLength={40} autoFocus placeholder="Half adder" onChange={(e) => setName(e.target.value)} />
          </label>
          <dl className="ic-pins">
            <dt>Inputs</dt>
            <dd data-testid="ic-inputs">{list(pins.inputs)}</dd>
            <dt>Outputs</dt>
            <dd data-testid="ic-outputs">{list(pins.outputs)}</dd>
          </dl>
          {problems.map((p) => (
            <p key={p} className="logic-warning" role="alert">
              ⚠ {p}
            </p>
          ))}
          {operable.length > 0 && (
            <p className="logic-warning">⚠ {operable.join(', ')} inside cannot be operated once the IC is a box. Use a switch for anything you want to set.</p>
          )}
          <div className="row">
            <button type="submit" className="primary-action" disabled={problems.length > 0}>
              Make IC
            </button>
            <button type="button" onClick={closeMakeIc}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
