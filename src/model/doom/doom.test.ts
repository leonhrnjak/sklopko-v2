import { describe, expect, it } from 'vitest'
import { DoomMachine } from './harness'
import { castColumn, render, type Pose } from './reference'
import { MAP } from './tables'

/** 20 poses: an open cell, a position inside it and an angle, from a fixed sequence. */
function poses(): Pose[] {
  let seed = 12345
  const rnd = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return (seed >> 8) % n
  }
  const out: Pose[] = []
  while (out.length < 20) {
    const xCell = rnd(16)
    const yCell = rnd(16)
    if (MAP[yCell * 16 + xCell]) continue
    out.push({ xCell, yCell, xFrac: rnd(256), yFrac: rnd(256), angle: rnd(256) })
  }
  return out
}

describe('the D0 spike: the assembly renders what the reference renders', () => {
  for (const columns of [160, 80])
    for (const draw of ['port', 'fill'] as const)
      it(`${columns} columns, ${draw}: 20 poses give the same picture`, () => {
        const m = new DoomMachine(columns, draw)
        for (const p of poses()) {
          const { pixels } = m.frame(p)
          expect(Array.from(pixels), JSON.stringify(p)).toEqual(Array.from(render(p, columns)))
        }
      }, 120_000)

  it('the reference sees walls at a sensible range', () => {
    const h = castColumn({ xCell: 1, yCell: 1, xFrac: 128, yFrac: 128, angle: 0 }, 80, 160)
    expect(h.q).toBeGreaterThan(0)
  })
})

describe('the D0 spike: what a frame costs', () => {
  it('measures cycles a frame', () => {
    const rows: string[] = []
    for (const columns of [160, 80])
      for (const draw of ['none', 'port', 'fill'] as const) {
        const m = new DoomMachine(columns, draw)
        const cycles = poses().map((p) => m.frame(p).cycles)
        const mean = Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length)
        rows.push(`${columns} ${draw}: mean ${mean} min ${Math.min(...cycles)} max ${Math.max(...cycles)} rom code ${m.size.code} data ${m.size.data}`)
        expect(mean).toBeGreaterThan(10_000)
      }
    console.log(rows.join('\n'))
  }, 120_000)
})
