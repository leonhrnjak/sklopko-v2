import { CircuitBuilder } from './builder'
import { note } from './annotate'
import type { Circuit } from './circuit'

/** The welcome example, which the app opens with: it stays in the main chunk while the other examples load on demand. */
export function counterDisplay(): Circuit {
  const b = new CircuitBuilder()
  const clk = b.add('clock', 0, 60, { params: { hz: 2 } })
  const cnt = b.add('counter', 120, 40)
  const dec = b.add('bcd7', 280, 10)
  const seg = b.add('seg7', 440, 10)
  const rst = b.add('button', 60, 210, { label: 'Reset' })
  const co = b.add('led', 300, 230, { label: 'Carry', params: { color: 'yellow' } })
  b.wire(`${clk}.Q`, `${cnt}.CLK`)
  for (const p of ['A', 'B', 'C', 'D']) b.wire(`${cnt}.${p}`, `${dec}.${p}`)
  for (const p of 'abcdefg') b.wire(`${dec}.${p}`, `${seg}.${p}`)
  b.wire(`${rst}.Q`, `${cnt}.R`)
  b.wire(`${cnt}.CO`, `${co}.A`)
  note(
    b,
    120,
    300,
    'The clock ticks twice a second and the counter counts 0 to 9. The decoder turns the count into segments for the display, and the carry output lights the yellow LED each time it wraps around. Hold Reset to stop it at 0.',
    36,
  )
  return b.build()
}
