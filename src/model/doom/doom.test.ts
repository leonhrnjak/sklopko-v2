import { describe, expect, it } from 'vitest'
import { DoomMachine } from './harness'
import { castColumn, render, type Pose } from './reference'
import { MAP, screenWidth } from './tables'
import { board6502Builder } from '../board6502'
import { flatten } from '../buses'
import { Simulator } from '../../engine/simulator'
import { openFor } from '../../engine/wasmengine'
import { loadEngine } from '../../engine/wasm'
import { doomSource, POSE } from './source'
import { unpackColumns } from './reference'
import type { VideoState } from '../../engine/components/video'
import type { CpuState } from '../../engine/components/cpu'

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
  for (const columns of [160, 120, 80])
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
    for (const columns of [160, 120, 80])
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

describe('D1b: the same program on the real video part', () => {
  it('draws the reference picture, and the fill costs no extra time: the frame ends when the model says', async () => {
    const fs = await import(/* @vite-ignore */ ['node', 'fs'].join(':'))
    const x = await loadEngine(fs.readFileSync('src/engine/wasm/engine.wasm') as Uint8Array)
    for (const pose of poses().filter((_, i) => i % 7 === 0)) {
      const model = new DoomMachine(160, 'fill')
      const want = render(pose, 160)
      const { cycles } = model.frame(pose)
      const { b, keys } = board6502Builder({ hz: 1_000_000, memory: 'big', chip: 'cmos', source: doomSource(160, 'fill'), devices: ['video'] })
      const sim = new Simulator()
      sim.setFast(true)
      sim.setHistory(false)
      sim.setWasm(openFor(x))
      sim.load(flatten(b.build(false)))
      const mem = (sim.state(keys.ram) as { mem: Uint8Array }).mem
      mem[POSE.xFrac] = pose.xFrac
      mem[POSE.xCell] = pose.xCell
      mem[POSE.yFrac] = pose.yFrac
      mem[POSE.yCell] = pose.yCell
      mem[POSE.angle] = pose.angle
      sim.settle()
      const cpuCycles = () => (sim.state(keys.cpu) as CpuState).cpu.cycles
      const picture = () => Array.from(unpackColumns(Uint8Array.from((sim.state(keys.video) as VideoState).px), screenWidth(160)))
      // 1 ms is 1000 cycles. Stop 1,500 cycles before the frame ends: the last columns are not drawn yet.
      while (cpuCycles() < cycles - 1500) sim.advance(1, performance.now() + 10000)
      expect(picture(), JSON.stringify(pose)).not.toEqual(Array.from(want))
      while (cpuCycles() < cycles + 100) sim.advance(1, performance.now() + 10000)
      expect(picture(), JSON.stringify(pose)).toEqual(Array.from(want))
    }
  }, 120_000)
})
