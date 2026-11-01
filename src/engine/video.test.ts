import { describe, expect, it } from 'vitest'
import { board6502Builder } from '../model/board6502'
import { VIDEO_CARD_SOURCE } from '../model/programs6502'
import { flatten } from '../model/buses'
import { Simulator } from './simulator'
import { openFor } from './wasmengine'
import { loadEngine } from './wasm'
import { VIDEO_BYTES, type VideoState } from './components/video'
import { VIDEO_PALETTE, videoPixels } from './videopalette'

async function module() {
  const fs = await import(/* @vite-ignore */ ['node', 'fs'].join(':'))
  return loadEngine(fs.readFileSync('src/engine/wasm/engine.wasm') as Uint8Array)
}

/** A program on the video board (1 MHz, big memory), run in the Rust engine for `ms` thousand cycles. */
async function run(source: string, kcycles: number) {
  const x = await module()
  const { b, keys } = board6502Builder({ hz: 1_000_000, memory: 'big', source, devices: ['video'] })
  const sim = new Simulator()
  sim.setFast(true)
  sim.setHistory(false)
  sim.setWasm(openFor(x))
  sim.load(flatten(b.build(false)))
  sim.settle()
  for (let i = 0; i < kcycles; i++) sim.advance(1, performance.now() + 10000)
  expect(sim.wasmOn).toBe(true)
  return { video: sim.state(keys.video) as VideoState, ram: (sim.state(keys.ram) as { mem: Uint8Array }).mem }
}

const HEAD = `.org $C000
VADDR_L = $4000
VADDR_H = $4001
VDATA   = $4002
VCTRL   = $4003
reset:  LDX #$FF
        TXS
        LDA #0
        STA VCTRL
        STA VADDR_L
        STA VADDR_H
`
const TAIL = `done: JMP done
.org $FFFC
.word reset`

describe('the video chip', () => {
  it('draws every colour through the port, and the address counts up after each byte', async () => {
    const { video, ram } = await run(
      HEAD +
        `       LDX #0
fill:   TXA
        ASL A
        ASL A
        ASL A
        ASL A
        STA $00         ; the high nibble of X ...
        TXA
        ORA $00         ; ... and the low one: both pixels of the byte are colour X
        STA VDATA
        INX
        CPX #16
        BNE fill
        LDA VADDR_L     ; 16 bytes were written
        STA $10
` +
        TAIL,
      2,
    )
    expect(video.px.slice(0, 16)).toEqual(Array.from({ length: 16 }, (_, i) => i * 17))
    expect(video.px.slice(16).every((v) => v === 0)).toBe(true)
    expect(ram[0x10]).toBe(16)
    // the canvas side: column 0 holds colours 0..15 in pairs of rows
    const rgba = videoPixels(video.px)
    for (let c = 0; c < 16; c++) {
      const want = (0xff000000 | ((VIDEO_PALETTE[c] & 0xff) << 16) | (VIDEO_PALETTE[c] & 0xff00) | (VIDEO_PALETTE[c] >> 16)) >>> 0
      expect(rgba[2 * c * 160]).toBe(want)
      expect(rgba[(2 * c + 1) * 160]).toBe(want)
    }
  })

  it('wraps an address past the end of the picture, reads back, holds the address with the control bit, and clears', async () => {
    const { video, ram } = await run(
      HEAD +
        `       LDA #$3F        ; 7999: the last byte
        STA VADDR_L
        LDA #$1F
        STA VADDR_H
        LDA #$AB
        STA VDATA       ; byte 7999
        LDA #$CD
        STA VDATA       ; the address wrapped: byte 0
        LDA #0
        STA VADDR_L
        STA VADDR_H
        LDA VDATA       ; reads byte 0 and counts up
        STA $10
        LDA VDATA       ; byte 1 (still 0)
        STA $11
        LDA VADDR_L
        STA $12         ; 2
        LDA #1
        STA VCTRL       ; hold: the address stays
        LDA #5
        STA VADDR_L
        LDA #$77
        STA VDATA
        LDA #$88
        STA VDATA       ; the same byte again
        LDA VADDR_L
        STA $13         ; 5
        LDA VCTRL
        STA $14         ; 1
        LDA #$FF
        STA VADDR_L
        LDA #$0F
        STA VADDR_H     ; 4095
        LDA #$55
        STA VDATA       ; (held)
` +
        TAIL,
      2,
    )
    expect(video.px[7999]).toBe(0xab)
    expect(video.px[0]).toBe(0xcd)
    expect(video.px[5]).toBe(0x88)
    expect(video.px[4095]).toBe(0x55)
    expect([0x10, 0x11, 0x12, 0x13, 0x14].map((a) => ram[a])).toEqual([0xcd, 0, 2, 5, 1])
    expect(video.px).toHaveLength(VIDEO_BYTES)
    // writing bit 7 of the control register clears the screen
    const cleared = await run(
      HEAD +
        `       LDA #$12
        STA VDATA
        LDA #$80
        STA VCTRL
` +
        TAIL,
      2,
    )
    expect(cleared.video.px.every((v) => v === 0)).toBe(true)
  })

  it('draws the test card of the example: bars of colour every ten columns, a diagonal at the foot', async () => {
    const { video } = await run(VIDEO_CARD_SOURCE, 250)
    const at = (x: number, row: number) => (video.px[x * 50 + (row >> 1)] >> (row & 1 ? 0 : 4)) & 15
    for (const x of [0, 9, 10, 55, 99, 100, 159]) {
      for (const row of [0, 1, 40, 79]) expect(at(x, row), `column ${x} row ${row}`).toBe(Math.floor(x / 10))
    }
    for (const x of [0, 3, 77, 159]) for (let j = 0; j < 10; j++) expect(at(x, 80 + 2 * j)).toBe((x + j) & 15)
  })
  it('fills a wall column in one write: sky, the wall colour, floor, in as many columns as the width says, wrapping past the last', async () => {
    const { video, ram } = await run(
      HEAD +
        `FILLX = $4004
FILLTOP = $4005
FILLBOT = $4006
FILLCOL = $4007
FILLW   = $4008
SKY     = $4009
FLOOR   = $400A
        LDA #1
        STA SKY
        LDA #2
        STA FLOOR
        LDA #3
        STA FILLX
        LDA #11         ; odd rows: a wall edge inside a byte
        STA FILLTOP
        LDA #70
        STA FILLBOT
        LDA #$FE        ; only the low nibble counts
        STA FILLCOL     ; this write draws column 3
        LDA #2
        STA FILLW
        LDA #159
        STA FILLX
        LDA #0
        STA FILLTOP
        LDA #100
        STA FILLBOT
        LDA #5
        STA FILLCOL     ; columns 159 and 0, all wall
        LDA FILLW
        STA $10
        LDA SKY
        STA $11
        LDA FILLBOT
        STA $12
        LDA VADDR_L     ; the plain port is not moved by a fill
        STA $13
` +
        TAIL,
      2,
    )
    const at = (x: number, row: number) => (video.px[x * 50 + (row >> 1)] >> (row & 1 ? 0 : 4)) & 15
    for (let row = 0; row < 100; row++) expect(at(3, row), `row ${row}`).toBe(row < 11 ? 1 : row < 70 ? 14 : 2)
    for (let row = 0; row < 100; row++) {
      expect(at(159, row)).toBe(5)
      expect(at(0, row)).toBe(5)
    }
    expect(at(1, 50)).toBe(0)
    expect(at(158, 50)).toBe(0)
    expect([0x10, 0x11, 0x12, 0x13].map((a) => ram[a])).toEqual([2, 1, 100, 0])
  })
})
