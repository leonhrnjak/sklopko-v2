import { describe, expect, it } from 'vitest'
import { SKASM, assemble } from '../engine/isa'
import { newMachine, step } from '../engine/skasm-ref'
import { ROM_WORDS } from './computer2'
import { MAP, RAYCASTER_SOURCE, bars, picture } from './raycaster'

const asm = assemble(SKASM, RAYCASTER_SOURCE, ROM_WORDS)

/** Run the program until it waits for the pad (the picture is done), pressing the buttons in `pad` one after another. */
function run(pad: number[] = []) {
  const m = newMachine()
  m.table = [...asm.table, ...new Array<number>(256 - asm.table.length).fill(0)]
  const lit = new Map<number, number>()
  let shade = 3
  const queue = [...pad]
  let at = 0
  let reads = 0
  const frames: { lit: [number, number][]; steps: number; px: number; py: number; ang: number }[] = []
  let steps = 0
  let sinceRender = 0
  const ports = {
    out(port: number, v: number) {
      if (port === 2) lit.set(v, shade)
      else if (port === 3) lit.delete(v)
      else if (port === 7) at = v
      else if (port === 8) shade = v & 3
    },
    in(port: number) {
      if (port === 2) return lit.get(at) ?? 0
      if (port === 6) {
        reads++
        return queue.shift() ?? 0
      }
      return 0
    },
  }
  while (steps < 400000) {
    if (m.pc === asm.symbols.input && sinceRender > 0) {
      frames.push({ lit: [...lit].sort((a, b) => a[0] - b[0]), steps: sinceRender, px: m.ram[0], py: m.ram[1], ang: m.ram[2] })
      sinceRender = 0
      if (!queue.length) break
    }
    step(m, asm.words, ports)
    steps++
    sinceRender++
  }
  return { frames, m, reads }
}

/** A picture as the sorted [position, shade] pairs of its lit pixels. */
const pairs = (px: Map<number, number>) => [...px].sort((a, b) => a[0] - b[0])
const expected = (px: number, py: number, ang: number) => pairs(picture(bars(px, py, ang)))

describe('raycaster', () => {
  it('assembles, and fits in the ROM with room to spare', () => {
    expect(asm.errors).toEqual([])
    expect(asm.lineOf.length).toBeLessThan(ROM_WORDS)
    expect(asm.table.length).toBeLessThanOrEqual(256)
  })

  it('draws the picture a plain TypeScript raycaster draws, from the starting spot', () => {
    const { frames } = run()
    expect(frames).toHaveLength(1)
    expect(frames[0].lit).toEqual(expected(24, 24, 0))
    // The spike's measurement: a picture takes about 6300 instructions, so about 3 to 6 seconds on the circuit.
    expect(frames[0].steps).toBeLessThan(8000)
  })

  it('the first picture, as the screen shows it', () => {
    const { frames } = run()
    const shades = new Map(frames[0].lit)
    const rows = Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => String(shades.get(y * 16 + x) ?? '.')).join(''))
    expect(rows).toEqual([
      '33...........333',
      '33...........333',
      '33...........333',
      '33333.......3333',
      '33333.....333333',
      '3333322...333333',
      '33333222.2333333',
      '3333322212333333',
      '3333322212333333',
      '33333222.2333333',
      '3333322...333333',
      '33333.....333333',
      '33333.......3333',
      '33...........333',
      '33...........333',
      '33...........333',
    ])
  })

  it('turning and walking: every picture matches, for a walk round the map', () => {
    // up = 1, down = 2, left = 4, right = 8
    const pad = [8, 8, 8, 8, 1, 1, 1, 8, 8, 1, 4, 4, 4, 2, 2, 1, 1, 1, 1, 1, 1]
    const { frames } = run(pad)
    expect(frames).toHaveLength(pad.length + 1)
    for (const f of frames) expect(f.lit, `at ${f.px},${f.py} facing ${f.ang}`).toEqual(expected(f.px, f.py, f.ang))
    // It really moved and turned.
    expect(new Set(frames.map((f) => `${f.px},${f.py},${f.ang}`)).size).toBeGreaterThan(8)
  })

  it('does not walk through a wall', () => {
    // Facing the north wall (angle 48 = -16) from cell (1,1): walk up until blocked.
    const turn = Array.from({ length: 16 }, () => 4)
    const walk = Array.from({ length: 12 }, () => 1)
    const { frames } = run([...turn, ...walk])
    const last = frames.at(-1)!
    expect(MAP[last.py >> 4][last.px >> 4]).toBe(0)
    for (const f of frames) expect(MAP[f.py >> 4][f.px >> 4], `at ${f.px},${f.py}`).toBe(0)
  })
})
