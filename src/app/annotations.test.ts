import { beforeEach, describe, expect, it } from 'vitest'
import { CircuitBuilder } from '../model/builder'
import { deserialize, toJSON } from '../model/serialize'
import { loadCircuit, resizeFrame, rotateSelection, select, selectInRect, undo, useStore } from './store'

const circuit = () => useStore.getState().circuit

describe('notes and frames in the store', () => {
  let frame: string
  let note: string
  let gate: string
  beforeEach(() => {
    const b = new CircuitBuilder()
    frame = b.add('frame', 100, 100, { params: { w: 400, h: 300 } })
    note = b.add('note', 120, 130)
    gate = b.add('and', 300, 200)
    loadCircuit(b.c, false)
  })

  it('resizing a frame changes its size, within limits, without touching what is inside', () => {
    resizeFrame(frame, 500, 350)
    expect(circuit().comps[frame].params).toMatchObject({ w: 500, h: 350 })
    resizeFrame(frame, 10, 10)
    expect(circuit().comps[frame].params).toMatchObject({ w: 60, h: 40 })
    resizeFrame(frame, 99999, 99999)
    expect(circuit().comps[frame].params).toMatchObject({ w: 4000, h: 4000 })
    resizeFrame(gate, 500, 500) // not a frame: ignored
    expect(circuit().comps[gate].params.w).toBeUndefined()
    expect(circuit().comps[gate].x).toBe(300)
  })

  it('a marquee selects a frame only when it holds all of it, but parts and notes as usual', () => {
    selectInRect({ x: 280, y: 180, w: 120, h: 80 }, false) // crosses the frame's inside, holds the gate
    expect(useStore.getState().selection).toEqual([gate])
    selectInRect({ x: 90, y: 90, w: 430, h: 320 }, false) // holds the whole frame
    expect(useStore.getState().selection).toEqual(expect.arrayContaining([frame, note, gate]))
    selectInRect({ x: 400, y: 100, w: 300, h: 100 }, false) // clips the frame's corner only
    expect(useStore.getState().selection).not.toContain(frame)
  })

  it('rotating leaves notes and frames upright but still rotates the parts selected with them', () => {
    select([frame, note, gate])
    rotateSelection()
    expect(circuit().comps[frame].rot).toBe(0)
    expect(circuit().comps[note].rot).toBe(0)
    expect(circuit().comps[gate].rot).toBe(1)
    undo()
    expect(circuit().comps[gate].rot).toBe(0)
  })
})

describe('notes and frames in saved circuits', () => {
  it('survive a save and a load, with their text, size and colour', () => {
    const b = new CircuitBuilder()
    b.add('note', 10, 20, { params: { text: 'Hello\nworld', cols: 20, color: 'pink' } })
    b.add('frame', 0, 0, { params: { title: 'Part A', w: 500, h: 250, color: 'green' } })
    const back = deserialize(JSON.parse(toJSON(b.c)))
    const comps = Object.values(back.comps)
    expect(comps.find((k) => k.type === 'note')!.params).toEqual({ text: 'Hello\nworld', cols: 20, color: 'pink' })
    expect(comps.find((k) => k.type === 'frame')!.params).toEqual({ title: 'Part A', w: 500, h: 250, color: 'green' })
  })

  it('values that do not fit are replaced by the defaults', () => {
    const c = deserialize({
      app: 'sklopko',
      version: 1,
      comps: [
        { id: 'n', type: 'note', x: 0, y: 0, params: { text: 'x'.repeat(601), cols: 3, color: 'purple' } },
        { id: 'f', type: 'frame', x: 0, y: 0, params: { title: 'y'.repeat(41), w: 5000, h: 10, color: 7 } },
      ],
      wires: [],
    })
    expect(c.comps.n.params).toEqual({ text: 'Note', cols: 28, color: 'yellow' })
    expect(c.comps.f.params).toEqual({ title: 'Frame', w: 300, h: 200, color: 'blue' })
  })

  it('a circuit saved before notes and frames existed still loads', () => {
    const c = deserialize({ app: 'sklopko', version: 1, comps: [{ id: 'a', type: 'and', x: 0, y: 0, params: {} }], wires: [] })
    expect(Object.keys(c.comps)).toEqual(['a'])
  })
})
