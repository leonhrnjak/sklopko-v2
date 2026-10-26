import { useEffect, useState } from 'react'
import { breakOnTerminal, typeOnTerminal } from '../app/terminal'
import { sim } from '../app/sim'
import { showToast, useStore } from '../app/store'
import { aciaPut, aciaStatus, interruptOn, receiverOn, screenText } from '../engine/acia'
import type { TerminalState } from '../engine/components/terminal'
import type { Comp } from '../model/circuit'
import { hasBasic } from '../model/basic-programs'
import { BasicPrograms } from './BasicPrograms'

const hex = (n: number, digits = 2) => '$' + n.toString(16).toUpperCase().padStart(digits, '0')

/** What the inspector shows of the chip now, refreshed while the simulation runs (a register changes without a pin of the symbol changing). */
function useTerminal(id: string) {
  const read = () => {
    const st = sim.state(id) as TerminalState | undefined
    if (!st) return undefined
    return {
      command: st.command,
      control: st.control,
      rx: st.rx,
      full: st.full,
      interrupt: st.interrupt,
      waiting: st.keys.length - st.next,
      text: screenText(st),
      status: aciaStatus(st, sim.pinValue(id, 'DSRB') === 1),
      receiver: receiverOn(st),
      interruptsOn: interruptOn(st),
    }
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

const yesNo = (b: boolean) => (b ? 'yes' : 'no')

/** The registers of the terminal chip, what is waiting on the keyboard, the screen, and buttons to type, copy, clear and break. */
export function TerminalSection({ comp }: { comp: Comp }) {
  const v = useTerminal(comp.id)
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState('')
  const basic = useStore((s) => Object.values(s.circuit.comps).some((c) => c.type === 'rom' && hasBasic(c.params.data)))
  const hasLcd = useStore((s) => Object.values(s.circuit.comps).some((c) => c.type === 'hd44780'))
  if (!v) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(v.text)
      showToast('Copied the screen text.')
    } catch {
      showToast('Could not copy: the browser did not allow it.')
    }
  }
  const clear = () => {
    const st = sim.state(comp.id) as TerminalState | undefined
    if (!st) return
    aciaPut(st, 12)
    sim.publish()
  }
  const send = () => {
    const taken = typeOnTerminal(comp.id, text)
    if (taken < text.length) showToast(`The keyboard holds 8,000 characters: ${taken} of ${text.length} were taken.`)
    setText('')
    setTyping(false)
  }

  return (
    <>
      <div className="field">
        <span>Registers</span>
        <table className="term-regs" aria-label="Registers of the terminal chip">
          <tbody>
            <tr>
              <th>Character</th>
              <td>
                {hex(v.rx)} {v.full ? '(waiting to be read)' : '(read)'}
              </td>
            </tr>
            <tr>
              <th>Status</th>
              <td>
                {hex(v.status)}: receiver full {yesNo((v.status & 8) !== 0)}, transmitter empty {yesNo((v.status & 16) !== 0)}, DSR {v.status & 64 ? 1 : 0}, interrupt {yesNo(v.interrupt)}
              </td>
            </tr>
            <tr>
              <th>Command</th>
              <td>
                {hex(v.command)}: receiver {v.receiver ? 'on' : 'off (typing waits)'}, receive interrupt {v.interruptsOn ? 'on' : 'off'}
              </td>
            </tr>
            <tr>
              <th>Control</th>
              <td>{hex(v.control)}</td>
            </tr>
          </tbody>
        </table>
        <p className="desc">
          {v.waiting === 0 ? 'Nothing is waiting on the keyboard.' : `${v.waiting} character${v.waiting === 1 ? '' : 's'} waiting on the keyboard.`}
        </p>
      </div>
      <div className="field">
        <span>Screen</span>
        <pre className="console-view" aria-label="Screen text">
          {v.text || ' '}
        </pre>
        <div className="row">
          <button onClick={() => setTyping((t) => !t)} aria-expanded={typing}>
            Type text…
          </button>
          <button onClick={copy}>Copy screen</button>
          <button onClick={clear}>Clear screen</button>
          <button onClick={() => breakOnTerminal(comp.id)} title="Sends Control+C ($03), which stops a BASIC program">
            Break
          </button>
        </div>
        {typing && (
          <>
            <textarea aria-label="Text to type" value={text} rows={4} placeholder="Paste or write what to type. Line breaks are Enter." onChange={(e) => setText(e.target.value)} />
            <div className="row">
              <button onClick={send} disabled={!text}>
                Send
              </button>
            </div>
          </>
        )}
      </div>
      {basic && (
        <details className="field" data-testid="basic-programs">
          <summary>Programs to type in</summary>
          <BasicPrograms terminalId={comp.id} hasLcd={hasLcd} hideUnavailable />
        </details>
      )}
    </>
  )
}
