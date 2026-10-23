import { useState } from 'react'
import type { Fsm, FsmIssue } from '../../model/fsm'

/** A text box that changes the machine as you type. Boxes edited close together share one undo step (`merge`). */
export function TextBox({ value, onText, label, className, ...rest }: { value: string; onText: (v: string) => void; label: string; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return <input {...rest} className={className} aria-label={label} value={value} spellCheck={false} onChange={(e) => onText(e.target.value)} />
}

/** A name that is changed when you leave the box or press Enter, so half-typed names never reach the guards that use it. */
export function NameBox({ value, onCommit, label, valid, ...rest }: { value: string; onCommit: (v: string) => void; label: string; valid?: (v: string) => boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    // The machine changed under the box (undo, another view): show it.
    setSeen(value)
    setDraft(value)
  }
  const commit = () => {
    const v = draft.trim()
    if (!v || v === value || (valid && !valid(v))) setDraft(value)
    else onCommit(v)
  }
  return (
    <input
      {...rest}
      aria-label={label}
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') setDraft(value)
      }}
    />
  )
}

/** One check box per output of the machine: which of them are 1. */
export function OutputChecks({ fsm, on, onToggle, label }: { fsm: Fsm; on: string[]; onToggle: (output: string) => void; label: string }) {
  if (!fsm.outputs.length) return <small>No outputs yet.</small>
  return (
    <span className="fsm-checks" role="group" aria-label={label}>
      {fsm.outputs.map((o) => (
        <label key={o} className="fsm-check">
          <input type="checkbox" checked={on.includes(o)} onChange={() => onToggle(o)} />
          <span>{o}</span>
        </label>
      ))}
    </span>
  )
}

const ICON: Record<FsmIssue['level'], string> = { error: '✖', warning: '▲', info: 'ℹ' }

/** Messages from the checker. `onPick` is told which state or transition a message is about. */
export function IssueList({ issues, onPick, label = 'Problems' }: { issues: FsmIssue[]; onPick?: (issue: FsmIssue) => void; label?: string }) {
  if (!issues.length) return null
  return (
    <ul className="fsm-issues" aria-label={label}>
      {issues.map((issue, i) => (
        <li key={i} className={`fsm-issue ${issue.level}`}>
          <span aria-hidden="true">{ICON[issue.level]}</span>
          {onPick && (issue.state || issue.transition) ? (
            <button className="linklike" onClick={() => onPick(issue)}>
              {issue.message}
            </button>
          ) : (
            <span>{issue.message}</span>
          )}
        </li>
      ))}
    </ul>
  )
}
