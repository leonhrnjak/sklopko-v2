import { useEffect, useState } from 'react'
import { sim } from '../app/sim'
import type { ViaPartState } from '../engine/components/via'
import { viaIrq } from '../engine/via6522'
import type { Comp } from '../model/circuit'

const hex = (n: number, digits = 2) => '$' + n.toString(16).toUpperCase().padStart(digits, '0')
const bits = (n: number) => n.toString(2).padStart(8, '0')

/** The flags of the interrupt registers, by bit. */
const FLAGS = ['CA2', 'CA1', 'SR', 'CB2', 'CB1', 'T2', 'T1']
const names = (n: number) => FLAGS.filter((_, i) => (n >> i) & 1).join(' ') || 'none'

/** What ACR and PCR say, in words. */
const acrText = (acr: number) =>
  [
    acr & 0x80 ? 'PB7 follows timer 1' : '',
    acr & 0x40 ? 'timer 1 free-running' : 'timer 1 one-shot',
    acr & 0x20 ? 'timer 2 counts PB6 pulses' : 'timer 2 counts cycles',
    acr & 1 ? 'port A latched at CA1' : '',
    acr & 2 ? 'port B latched at CB1' : '',
  ]
    .filter(Boolean)
    .join(', ')
const CTRL = ['input, falling edge', 'input, falling edge (independent)', 'input, rising edge', 'input, rising edge (independent)', 'output: handshake', 'output: pulse', 'output: low', 'output: high']
const pcrText = (pcr: number) => `CA1 ${pcr & 1 ? 'rising' : 'falling'} edge, CA2 ${CTRL[(pcr >> 1) & 7]}; CB1 ${pcr & 16 ? 'rising' : 'falling'} edge, CB2 ${CTRL[(pcr >> 5) & 7]}`

/** What the inspector shows of the chip now, refreshed while the simulation runs (a register changes without a pin changing). */
function useVia(id: string) {
  const read = () => {
    const st = sim.state(id) as ViaPartState | undefined
    return st && { ...st, irq: viaIrq(st) }
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

/** The registers of the 6522: the two ports with their directions, the two timers, the control registers and the interrupt flags. */
export function ViaSection({ comp }: { comp: Comp }) {
  const v = useVia(comp.id)
  if (!v) return null
  const row = (label: string, text: string) => (
    <tr>
      <th>{label}</th>
      <td>{text}</td>
    </tr>
  )
  return (
    <div className="field">
      <span>Registers</span>
      <table className="term-regs" aria-label="Registers of the VIA">
        <tbody>
          {row('Port A', `${hex(v.ora)} out, ${bits(v.ddra)} direction (1 = output)`)}
          {row('Port B', `${hex(v.orb)} out, ${bits(v.ddrb)} direction (1 = output)`)}
          {row('Timer 1', `${hex(v.t1c, 4)} counting, latch ${hex(v.t1l, 4)}${v.t1armed ? ', will interrupt' : ''}`)}
          {row('Timer 2', `${hex(v.t2c, 4)} counting${v.t2armed ? ', will interrupt' : ''}`)}
          {row('ACR', `${hex(v.acr)}: ${acrText(v.acr)}`)}
          {row('PCR', `${hex(v.pcr)}: ${pcrText(v.pcr)}`)}
          {row('Flags', `${hex(v.ifr)}: ${names(v.ifr)}`)}
          {row('Enabled', `${hex(v.ier)}: ${names(v.ier)}`)}
          {row('IRQ', v.irq ? 'asking for an interrupt' : 'quiet')}
        </tbody>
      </table>
    </div>
  )
}
