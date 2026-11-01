import { describe, expect, it } from 'vitest'
import { board6502Builder } from '../board6502'
import { flatten } from '../buses'
import { Simulator } from '../../engine/simulator'
import { openFor } from '../../engine/wasmengine'
import { loadEngine } from '../../engine/wasm'
import { assemble6502 } from '../../engine/asm6502'
import { doomSource } from './source'
import { BUTTON, GAME_CELLS, MAX_TICKS, newGame, tick } from './game'
import { render, unpackColumns } from './reference'
import { GAME_MAP, screenWidth } from './tables'
import type { CpuState } from '../../engine/components/cpu'
import type { VideoState } from '../../engine/components/video'

const { up, down, left, right, a, b } = BUTTON

describe('the rules (TypeScript reference)', () => {
  it('walks forward, and stops a margin short of a wall', () => {
    const g = newGame()
    for (let i = 0; i < 400; i++) tick(g, up)
    // Facing east along the south corridor: the door at cell 3 is the first solid cell, so x stops short of 3.0 by the margin.
    expect(g.pose.xCell).toBe(2)
    expect(g.pose.xFrac).toBeGreaterThan(200)
    expect(g.pose.xFrac).toBeLessThanOrEqual(255 - 32 + 7)
  })

  it('opens the door in front of it, and only a door', () => {
    const g = newGame()
    for (let i = 0; i < 400; i++) tick(g, up)
    expect(g.map[14 * 16 + 3]).not.toBe(0)
    tick(g, b)
    expect(g.map[14 * 16 + 3]).toBe(0)
    for (let i = 0; i < 60; i++) tick(g, up)
    expect(g.pose.xCell).toBeGreaterThanOrEqual(3)
    const h = newGame()
    for (let i = 0; i < 20; i++) tick(h, b)
    expect(h.map).toEqual(GAME_MAP)
  })

  it('turns, and strafes with A', () => {
    const g = newGame()
    for (let i = 0; i < 64; i++) tick(g, right)
    expect(g.pose.angle).toBe(64)
    const h = newGame()
    h.pose.angle = 192
    h.pose.yCell = 5
    const y0 = h.pose.yFrac
    for (let i = 0; i < 10; i++) tick(h, a | right)
    expect(h.pose.yFrac).toBeGreaterThan(y0 - 1)
    expect(h.pose.angle).toBe(192)
  })
})

async function engine() {
  const fs = await import(/* @vite-ignore */ ['node', 'fs'].join(':'))
  return loadEngine(fs.readFileSync('src/engine/wasm/engine.wasm') as Uint8Array)
}

/** The game ROM on the game board in the Rust engine, without history, as the example runs it. */
export async function gameBoard() {
  const x = await engine()
  const source = doomSource(160, 'fill', true)
  const r = assemble6502(source, 0x4000, true)
  if (r.errors.length) throw new Error(r.errors.map((e) => `line ${e.line}: ${e.message}`).join('\n'))
  const { b: builder, keys } = board6502Builder({ hz: 1_000_000, memory: 'big', chip: 'cmos', game: true, source, bankSources: ['.org $8000\n.byte 0', '.org $8000\n.byte 0'] })
  const sim = new Simulator()
  sim.setFast(true)
  sim.setHistory(false)
  sim.setWasm(openFor(x))
  sim.load(flatten(builder.build(false)))
  sim.settle()
  const cycles = () => (sim.state(keys.cpu) as CpuState).cpu.cycles
  const ram = () => (sim.state(keys.ram) as { mem: Uint8Array }).mem
  const frames = () => {
    const m = ram()
    return m[GAME_CELLS.frames] + 256 * m[GAME_CELLS.frames + 1]
  }
  const run = (n: number) => {
    const to = cycles() + n
    while (cycles() < to) sim.advance(0.1, performance.now() + 10000)
  }
  const pad = (keysHeld: number) => sim.setState(keys.gamepad, { keys: keysHeld })
  const picture = () => unpackColumns(Uint8Array.from((sim.state(keys.video) as VideoState).px), screenWidth(160))
  return { sim, keys, cycles, ram, frames, run, pad, picture, size: r.bytes.length }
}

describe('the game on the board', () => {
  it('draws what the reference draws, frame after frame, through a scripted walk that opens the door', async () => {
    const g = await gameBoard()
    // What is held while each picture is made: walk to the door, open it, go through, turn, strafe, back up, stand.
    const script = [...Array(8).fill(up), up | b, ...Array(7).fill(up), ...Array(4).fill(right), ...Array(3).fill(up | a | left), ...Array(3).fill(down), 0]
    const ref = newGame()
    // The pad is read when a picture starts, which is right after the one before it ends: so the buttons for picture f+1 are set while f is drawn.
    g.pad(script[0])
    g.run(60000)
    g.pad(script[1])
    let opened = false
    const t0 = g.cycles()
    for (let f = 0; f < script.length; f++) {
      // Run to the end of picture f (the program counts it after the last column), then to the middle of the next one.
      while (g.frames() <= f) g.run(100)
      const m = g.ram()
      const ticks = m[GAME_CELLS.shownTicks]
      expect(ticks, `frame ${f}`).toBeGreaterThanOrEqual(1)
      expect(ticks).toBeLessThanOrEqual(MAX_TICKS)
      for (let i = 0; i < ticks; i++) tick(ref, script[f])
      const shown = Array.from(m.slice(GAME_CELLS.shown, GAME_CELLS.shown + 5))
      expect(shown, `frame ${f}: pose after ${ticks} ticks, held ${script[f]}`).toEqual([ref.pose.xFrac, ref.pose.xCell, ref.pose.yFrac, ref.pose.yCell, ref.pose.angle])
      expect(Array.from(g.picture()), `frame ${f}: picture`).toEqual(Array.from(render(ref.pose, 160, ref.map)))
      if (ref.map[14 * 16 + 3] === 0) opened = true
      g.run(60000)
      g.pad(script[f + 2] ?? 0)
    }
    // The frame rate the D0 table promised (130,000 cycles a frame with the fill, about 7.7 a second), within 25 percent.
    const perFrame = (g.cycles() - t0) / script.length
    console.log(`game: ${Math.round(perFrame)} cycles a picture on average over ${script.length} pictures, ${(1_000_000 / perFrame).toFixed(1)} a second`)
    expect(perFrame).toBeLessThan(130_300 * 1.25)
    expect(opened).toBe(true)
    expect(ref.pose.xCell).toBeGreaterThanOrEqual(3)
  }, 300_000)
})
