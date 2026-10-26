import { useEffect, useState } from 'react'
import { sim } from '../app/sim'
import type { LcdPartState } from '../engine/components/lcd'
import { lcdText } from '../engine/hd44780'
import type { Comp } from '../model/circuit'

const hex = (n: number, digits = 2) => '$' + n.toString(16).toUpperCase().padStart(digits, '0')

/** What the inspector shows of the display now, refreshed while the simulation runs (a character is written without a pin of the symbol changing). */
function useLcd(id: string) {
  const read = () => {
    const st = sim.state(id) as LcdPartState | undefined
    return st && { text: lcdText(st), st: { ...st, ddram: [], cgram: st.cgram.slice() } }
  }
  const [view, setView] = useState(read)
  useEffect(() => {
    const refresh = () =>
      setView((old) => {
        const now = read()
        return old && now && JSON.stringify(old) === JSON.stringify(now) ? old : now
      })
    refresh()
    const timer = window.setInterval(refresh, 100)
    const off = sim.subscribe(refresh)
    return () => {
      window.clearInterval(timer)
      off()
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  return view
}

/** One custom character as text: a block for a lit dot. */
const art = (rows: number[]) => rows.map((r) => [...Array(5)].map((_, b) => ((r >> (4 - b)) & 1 ? '█' : '·')).join('')).join('\n')

/** The display's text, its modes, the address counter, the busy flag and the custom characters. */
export function LcdSection({ comp }: { comp: Comp }) {
  const v = useLcd(comp.id)
  if (!v) return null
  const { st, text } = v
  const row = (label: string, value: string) => (
    <tr>
      <th>{label}</th>
      <td>{value}</td>
    </tr>
  )
  return (
    <>
      <div className="field">
        <span>Display</span>
        <pre className="console-view" aria-label="Text on the LCD">
          {st.display ? text.map((l) => l.replace(/\s+$/, '') || ' ').join('\n') : '(display off)\n '}
        </pre>
        <p className="desc">{st.last}.</p>
      </div>
      <div className="field">
        <span>State</span>
        <table className="term-regs" aria-label="State of the LCD">
          <tbody>
            {row('Interface', `${st.dl8 ? '8' : '4'}-bit, ${st.twoLine ? '2 lines' : '1 line'}`)}
            {row('Display', `${st.display ? 'on' : 'off'}, cursor ${st.cursor ? 'on' : 'off'}, blink ${st.blink ? 'on' : 'off'}`)}
            {row('Entry mode', `${st.up ? 'increment' : 'decrement'}${st.entryShift ? ', shift display' : ''}`)}
            {row('Address', `${hex(st.ac)} in the ${st.cg ? 'CGRAM' : 'DDRAM'}, display shifted ${st.shift}`)}
            {row('Busy', st.busy > 0 ? `yes, ${st.busy} cycles more` : 'no')}
            {row('Ignored', st.dropped ? `${st.dropped} written while it was busy` : 'nothing')}
          </tbody>
        </table>
      </div>
      <details className="field">
        <summary>Custom characters (CGRAM)</summary>
        <div className="lcd-cg">
          {Array.from({ length: 8 }, (_, i) => (
            <pre key={i} aria-label={`Custom character ${i}`}>
              {art(st.cgram.slice(i * 8, i * 8 + 8))}
            </pre>
          ))}
        </div>
      </details>
    </>
  )
}
