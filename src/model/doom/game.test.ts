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
    // What is held while each picture is made: walk to the door, open it, go through, then turn, strafe, back up and stand. The pictures
    // come faster or slower as the walls do, so the script goes by where the reference is, not by the picture's number.
    let phase = 0
    let phaseFrames = 0
    const heldNext = (ref: ReturnType<typeof newGame>): number => {
      phaseFrames++
      if (phase === 0 && ref.pose.xCell === 2 && ref.pose.xFrac > 128) phase = (phaseFrames = 0) + 1
      else if (phase === 1 && ref.map[14 * 16 + 3] === 0) phase = (phaseFrames = 0) + 2
      else if (phase === 2 && ref.pose.xCell >= 4) phase = (phaseFrames = 0) + 3
      else if (phase === 3 && phaseFrames > 3) phase = (phaseFrames = 0) + 4
      else if (phase === 4 && phaseFrames > 3) phase = (phaseFrames = 0) + 5
      else if (phase === 5 && phaseFrames > 3) phase = (phaseFrames = 0) + 6
      return [up, up | b, up, right, up | a | left, down, 0][phase]
    }
    const ref = newGame()
    // The pad is read when a picture starts, which is right after the one before it ends: so the buttons for picture f+1 are set while f is drawn.
    g.pad(up)
    g.run(30000)
    g.pad(up)
    let opened = false
    const t0 = g.cycles()
    let pictures = 0
    const pads: number[] = [up, up]
    for (let f = 0; f < 60 && phase < 6; f++) {
      // Run to the end of picture f (the program counts it after the last column), then to the middle of the next one.
      while (g.frames() <= f) g.run(100)
      const m = g.ram()
      const ticks = m[GAME_CELLS.shownTicks]
      expect(ticks, `frame ${f}`).toBeGreaterThanOrEqual(1)
      expect(ticks).toBeLessThanOrEqual(MAX_TICKS)
      for (let i = 0; i < ticks; i++) tick(ref, pads[f])
      const shown = Array.from(m.slice(GAME_CELLS.shown, GAME_CELLS.shown + 5))
      expect(shown, `frame ${f}: pose after ${ticks} ticks, held ${pads[f]}`).toEqual([ref.pose.xFrac, ref.pose.xCell, ref.pose.yFrac, ref.pose.yCell, ref.pose.angle])
      expect(Array.from(g.picture()), `frame ${f}: picture`).toEqual(Array.from(render(ref.pose, 160, ref.map)))
      if (ref.map[14 * 16 + 3] === 0) opened = true
      pictures++
      g.run(60000)
      const next = heldNext(ref)
      pads.push(next)
      g.pad(next)
    }
    // D3's target: a picture in under 120,000 cycles on average (D0 measured 130,300 with the multiplies).
    const perFrame = (g.cycles() - t0) / pictures
    console.log(`game: ${Math.round(perFrame)} cycles a picture on average over ${pictures} pictures, ${(1_000_000 / perFrame).toFixed(1)} a second`)
    expect(perFrame).toBeLessThan(120_000)
    expect(opened).toBe(true)
    expect(ref.pose.xCell).toBeGreaterThanOrEqual(3)
  }, 300_000)
})
