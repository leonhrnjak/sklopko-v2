import { beforeEach, describe, expect, it } from 'vitest'
import { CircuitBuilder } from '../model/builder'
import { buildRows } from './waveform'
import { groupProbes, loadCircuit, undo, ungroupProbes, useStore } from './store'

/** Probes labelled ACC10, ACC2, ACC0, ACC1 (deliberately not in order) and one unlabelled. */
const setup = () => {
  const b = new CircuitBuilder()
  const ids = ['ACC10', 'ACC2', 'ACC0', 'ACC1'].map((label, i) => b.add('probe', 0, i * 40, { label }))
  const other = b.add('probe', 100, 0, { label: 'CLK' })
  loadCircuit(b.c, false)
  return { ids, other }
}
const params = (id: string) => useStore.getState().circuit.comps[id].params

describe('grouping probes', () => {
  beforeEach(() => loadCircuit(new CircuitBuilder().c, false))

  it('gives each probe the bit of its place in the natural order of the labels', () => {
    const { ids } = setup()
    groupProbes(ids, 'ACC')
    expect(ids.map((id) => [params(id).group, params(id).bit])).toEqual([
      ['ACC', 3], // ACC10
      ['ACC', 2], // ACC2
      ['ACC', 0], // ACC0
      ['ACC', 1], // ACC1
    ])
  })

  it('orders unlabelled probes top to bottom, then left to right', () => {
    const b = new CircuitBuilder()
    const low = b.add('probe', 50, 0)
    const high = b.add('probe', 0, 100)
    const mid = b.add('probe', 0, 0)
    loadCircuit(b.c, false)
    groupProbes([high, low, mid], 'BUS')
    expect([mid, low, high].map((id) => params(id).bit)).toEqual([0, 1, 2])
  })

  it('is one undo step, and ungroup takes probes back out', () => {
    const { ids } = setup()
    groupProbes(ids, 'ACC')
    ungroupProbes([ids[0]])
    expect(params(ids[0]).group).toBe('')
    expect(params(ids[1]).group).toBe('ACC')
    undo() // the ungroup
    expect(params(ids[0]).group).toBe('ACC')
    undo() // the whole grouping
    expect(ids.every((id) => params(id).group === '')).toBe(true)
  })

  it('ignores parts that are not probes and groups of more than 16', () => {
    const b = new CircuitBuilder()
    const sw = b.add('switch', 0, 0)
    const many = Array.from({ length: 17 }, (_, i) => b.add('probe', 0, i * 40))
    loadCircuit(b.c, false)
    groupProbes([sw], 'X')
    expect(params(sw).group).toBeUndefined()
    groupProbes(many, 'BIG')
    expect(params(many[0]).group).toBe('')
  })
})

describe('waveform rows', () => {
  beforeEach(() => loadCircuit(new CircuitBuilder().c, false))

  it('a group is one row, in the place of its first probe; the others stay single', () => {
    const { ids, other } = setup()
    groupProbes(ids, 'ACC')
    const rows = buildRows(useStore.getState().circuit.comps)
    expect(rows.map((r) => [r.name, r.group, r.width, r.probes.length])).toEqual([
      ['ACC', true, 4, 4],
      ['CLK', false, 1, 1],
    ])
    expect(rows[1].probes[0].id).toBe(other)
  })

  it('names an unlabelled probe by its place among all the probes', () => {
    const b = new CircuitBuilder()
    b.add('probe', 0, 0)
    b.add('probe', 0, 40, { label: 'Q' })
    b.add('probe', 0, 80)
    loadCircuit(b.c, false)
    expect(buildRows(useStore.getState().circuit.comps).map((r) => r.name)).toEqual(['Probe 1', 'Q', 'Probe 3'])
  })
})
