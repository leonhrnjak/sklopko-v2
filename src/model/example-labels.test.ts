import { describe, expect, it } from 'vitest'
import type { Circuit } from './circuit'
import { EXAMPLES } from './examples'

/** Every Send and Receive label of a circuit (and of the ICs inside it): a name has one Send, at least one Receive, and one width. */
function problems(c: Circuit, where: string): string[] {
  const out: string[] = []
  const sends = new Map<string, number[]>()
  const recvs = new Map<string, number[]>()
  for (const k of Object.values(c.comps)) {
    if (k.type !== 'netsend' && k.type !== 'netrecv') continue
    const m = k.type === 'netsend' ? sends : recvs
    const name = String(k.params.name)
    m.set(name, [...(m.get(name) ?? []), Number(k.params.bits ?? 1)])
  }
  for (const [name, bits] of sends) {
    if (bits.length > 1) out.push(`${where}: ${name} has ${bits.length} Send labels`)
    if (!recvs.has(name)) out.push(`${where}: ${name} is sent but never received`)
  }
  for (const [name, bits] of recvs) {
    if (!sends.has(name)) out.push(`${where}: ${name} is received but never sent`)
    else if ([...bits, ...sends.get(name)!].some((n) => n !== sends.get(name)![0])) out.push(`${where}: ${name} has labels of different widths`)
  }
  for (const [id, ic] of Object.entries(c.ics ?? {})) out.push(...problems(ic.circuit as Circuit, `${where}/${id}`))
  return out
}

describe('net labels in the examples', () => {
  it('every name has one Send, a Receive and one width', () => {
    expect(EXAMPLES.flatMap((ex) => problems(ex.build(), ex.id))).toEqual([])
  }, 60000)
})
