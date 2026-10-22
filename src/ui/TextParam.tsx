import { useEffect, useRef, useState } from 'react'
import { setParam } from '../app/store'
import type { ParamDef } from '../engine/types'
import type { Comp } from '../model/circuit'

/**
 * Free text parameter (e.g. ROM contents). Edits stay local until the field loses focus or the selection
 * changes, so typing is one undo step. Text that doesn't match the pattern is flagged and never applied.
 */
export function TextParam({ comp, p, suggestions }: { comp: Comp; p: ParamDef; suggestions?: string[] }) {
  const saved = String(comp.params[p.key])
  const [draft, setDraft] = useState(saved)
  const latest = useRef({ draft, saved })
  useEffect(() => {
    latest.current.draft = draft
    latest.current.saved = saved
  })
  const valid = !p.pattern || new RegExp(`^(?:${p.pattern})$`).test(draft)
  const commit = () => {
    const { draft: d, saved: s } = latest.current
    if (d === s || (p.pattern && !new RegExp(`^(?:${p.pattern})$`).test(d))) return
    latest.current.saved = d // the remount that follows must not apply it a second time
    setParam(comp.id, p.key, d)
  }
  // Apply a pending edit when the inspector goes away (another part gets selected).
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => commit, [])
  const common = {
    spellCheck: false,
    maxLength: p.maxLength,
    value: draft,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
    'aria-invalid': !valid,
  }
  return (
    <label className="field">
      <span>{p.label}</span>
      {p.multiline === false ? (
        <>
          <input
            {...common}
            className={valid ? undefined : 'invalid'}
            list={suggestions ? `suggest-${p.key}` : undefined}
            autoFocus={!saved}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          {suggestions && (
            <datalist id={`suggest-${p.key}`}>
              {suggestions.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          )}
        </>
      ) : (
        <textarea {...common} className={`mono${valid ? '' : ' invalid'}`} rows={4} />
      )}
      {!valid && <small className="field-error">{p.hint ?? 'Not a valid value.'}</small>}
    </label>
  )
}
