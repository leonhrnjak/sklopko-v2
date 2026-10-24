import { useEffect, useMemo, useState } from 'react'
import { closeMakeIc, makeIC, useMakeIc } from '../app/ics'
import { useStore } from '../app/store'
import { deriveInterface, icProblems, operableInside, subCircuit } from '../model/ic'

/** Asks for a name and shows the pins an IC made from the selection (or the whole circuit) would have. */
export function MakeIcDialog() {
  const open = useMakeIc((s) => s.open)
  return open ? <Dialog /> : null
}

function Dialog() {
  const from = useMakeIc((s) => s.from)
  const circuit = useStore((s) => s.circuit)
  const doc = useMemo(() => subCircuit(circuit, from ?? undefined), [circuit, from])
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
    makeIC(name, from)
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
            (or bus input) and each LED (or bus display) inside, named after its label. The circuit stays as it is.
          </p>
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
