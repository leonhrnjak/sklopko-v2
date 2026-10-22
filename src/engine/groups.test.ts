import { describe, expect, it } from 'vitest'
import type { Trace } from './components/io'
import { formatValue, groupTrace, naturalOrder } from './groups'
import type { V } from './types'

const tr = (...steps: [number, V][]): Trace => ({ t: steps.map((s) => s[0]), v: steps.map((s) => s[1]) })

describe('group traces', () => {
  it('reads the bits as a number, at every moment one of them changes', () => {
    const lo = tr([0, 0], [100, 1], [300, 0])
    const hi = tr([0, 0], [200, 1])
    const g = groupTrace([lo, hi], [0, 1])
    expect(g.t).toEqual([0, 100, 200, 300])
    expect(g.v).toEqual([0, 1, 3, 2])
  })

  it('uses the bit positions, not the order of the probes', () => {
    const a = tr([0, 1])
    const b = tr([0, 0])
    expect(groupTrace([a, b], [0, 3]).v).toEqual([1])
    expect(groupTrace([a, b], [3, 0]).v).toEqual([8])
  })

  it('is unknown until every probe has recorded something, and while any bit is unknown', () => {
    const a = tr([0, 1], [500, 2], [600, 1])
    const b = tr([100, 1])
    const g = groupTrace([a, b], [0, 1])
    expect(g.t).toEqual([0, 100, 500, 600])
    expect(g.v).toEqual([-1, 3, -1, 3])
  })

  it('leaves out moments where the number does not change', () => {
    const a = tr([0, 0], [100, 1])
    const b = tr([0, 0], [100, 0], [200, 1]) // a probe may record a change that cancels out in the number
    const g = groupTrace([a, b], [0, 0]) // two probes on the same bit position
    expect(g.v.every((v, i) => i === 0 || v !== g.v[i - 1])).toBe(true)
  })

  it('handles one probe, no probes, and probes with no history', () => {
    expect(groupTrace([tr([5, 1])], [0])).toEqual({ t: [5], v: [1] })
    expect(groupTrace([], [])).toEqual({ t: [], v: [] })
    expect(groupTrace([tr(), tr()], [0, 1])).toEqual({ t: [], v: [] })
  })

  it('handles a lot of transitions', () => {
    const a = tr(...Array.from({ length: 5000 }, (_, i): [number, V] => [i, (i & 1) as V]))
    const b = tr(...Array.from({ length: 5000 }, (_, i): [number, V] => [i, ((i >> 1) & 1) as V]))
    const g = groupTrace([a, b], [0, 1])
    expect(g.t).toHaveLength(5000)
    expect(g.v[1234]).toBe(1234 & 3)
  })
})

describe('number formats', () => {
  it('hex is padded to the group width', () => {
    expect(formatValue(233, 8, 'hex')).toBe('E9')
    expect(formatValue(5, 8, 'hex')).toBe('05')
    expect(formatValue(5, 4, 'hex')).toBe('5')
    expect(formatValue(5, 12, 'hex')).toBe('005')
  })
  it('decimal is not padded, binary is', () => {
    expect(formatValue(233, 8, 'dec')).toBe('233')
    expect(formatValue(5, 8, 'dec')).toBe('5')
    expect(formatValue(5, 8, 'bin')).toBe('00000101')
  })
  it('unknown is X in every format', () => {
    for (const f of ['hex', 'dec', 'bin'] as const) expect(formatValue(-1, 8, f)).toBe('X')
  })
})

describe('natural order', () => {
  it('sorts numbers inside names as numbers', () => {
    expect(['ACC10', 'ACC2', 'ACC1', 'ACC0'].sort(naturalOrder)).toEqual(['ACC0', 'ACC1', 'ACC2', 'ACC10'])
  })
})
