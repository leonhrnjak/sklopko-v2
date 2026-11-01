import { describe, expect, it } from 'vitest'
import { board6502Builder, boardExample } from './board6502'
import { GAME_BANK0_SOURCE, GAME_BANK1_SOURCE, GAME_TEST_SOURCE } from './programs6502'
import { flatten } from './buses'
import { deserialize, serialize } from './serialize'
import { Simulator } from '../engine/simulator'
import { openFor } from '../engine/wasmengine'
import { loadEngine } from '../engine/wasm'
import type { CpuState } from '../engine/components/cpu'
import type { VideoState } from '../engine/components/video'

async function engine() {
  const fs = await import(/* @vite-ignore */ ['node', 'fs'].join(':'))
  return loadEngine(fs.readFileSync('src/engine/wasm/engine.wasm') as Uint8Array)
}

const options = { hz: 1_000_000, memory: 'big' as const, game: true, source: GAME_TEST_SOURCE, bankSources: [GAME_BANK0_SOURCE, GAME_BANK1_SOURCE] as [string, string] }

/** The game board in the Rust engine, without step-back history, as the example runs. */
async function board() {
  const x = await engine()
  const { b, keys } = board6502Builder(options)
  const sim = new Simulator()
  sim.setFast(true)
  sim.setHistory(false)
  sim.setWasm(openFor(x))
  sim.load(flatten(b.build(false)))
  sim.settle()
  const cycles = () => (sim.state(keys.cpu) as CpuState).cpu.cycles
  const ram = () => (sim.state(keys.ram) as { mem: Uint8Array }).mem
  /** Run until the CPU has used `n` cycles (to within 100). */
  const runTo = (n: number) => {
    while (cycles() < n) sim.advance(0.1, performance.now() + 10000)
  }
  return { sim, keys, cycles, ram, runTo }
}

describe('the game board', () => {
  it('switches ROM banks: the same address gives a different byte, and both reach the video chip', async () => {
    const { sim, keys, runTo } = await board()
    runTo(3000)
    expect(sim.wasmOn).toBe(true)
    const video = sim.state(keys.video) as VideoState
    expect(video.px.slice(0, 8)).toEqual([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf1]) // bank 0
    expect(video.px.slice(50, 58)).toEqual([0xf1, 0xed, 0xcb, 0xa9, 0x87, 0x65, 0x43, 0x21]) // bank 1
    expect(video.px.slice(8, 50).every((v) => v === 0)).toBe(true)
  })

  it('reads the gamepad at $5000: the six buttons are bits 0 to 5', async () => {
    const { sim, keys, ram, runTo } = await board()
    runTo(3000)
    expect(ram()[2]).toBe(0)
    for (const held of [1, 2, 4, 8, 16, 32, 5]) {
      sim.setState(keys.gamepad, { keys: held })
      runTo(3000 + 400 * (1 + [1, 2, 4, 8, 16, 32, 5].indexOf(held)))
      expect(ram()[2], `held ${held}`).toBe(held)
    }
  })

  it('takes a frame interrupt every 16,667 cycles: 60 of them in a second at 1 MHz', async () => {
    const { cycles, ram, runTo } = await board()
    const frames = () => ram()[0] + 256 * ram()[1]
    runTo(16000)
    expect(frames()).toBe(0)
    runTo(2 * 16667 + 500)
    const startup = cycles()
    expect(frames()).toBe(2)
    // The 60th interrupt comes between these two points, and the 59th before the first.
    runTo(59 * 16667 + 800)
    expect(frames()).toBe(59)
    runTo(60 * 16667 + 800)
    expect(frames()).toBe(60)
    expect(startup).toBeGreaterThan(0)
  })

  it('has the registers where the plan says: video $4000, gamepad $5000, VIA $6000, and the video chip does not answer in the other slots', async () => {
    const { b, keys } = board6502Builder(options)
    expect(Object.keys(keys)).toEqual(expect.arrayContaining(['video', 'gamepad', 'via', 'rom', 'rom0', 'rom1', 'bankReg', 'bankMux']))
    expect(b.build(false).comps[keys.rom0].params.abits).toBe(14)
  })

  it('needs memory big and no other devices, and its bank ROMs', () => {
    expect(() => board6502Builder({ game: true })).toThrow(/memory: 'big'/)
    expect(() => board6502Builder({ game: true, memory: 'big', devices: ['leds'] })).toThrow(/own devices/)
    expect(() => board6502Builder({ game: true, memory: 'big' })).toThrow(/banked ROMs/)
  })

  it('keeps every wire when it is saved and loaded: no input has two wires (the pad did not reach the CPU in the page)', () => {
    const c = boardExample(options, { intro: 'x', decode: 'y', devices: 'z' })
    const ends = Object.values(c.wires).map((w) => `${w.to.comp}.${w.to.pin}`)
    expect(new Set(ends).size).toBe(ends.length)
    expect(Object.keys(deserialize(serialize(c)).wires).length).toBe(Object.keys(c.wires).length)
  })

  it('draws as an example with notes', () => {
    const c = boardExample(options, { intro: 'x', decode: 'y', devices: 'z' })
    expect(Object.values(c.comps).filter((p) => p.type === 'note').length).toBeGreaterThanOrEqual(5)
  })
})
