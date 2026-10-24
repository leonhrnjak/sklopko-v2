import { describe, expect, it } from 'vitest'
import { assemble6502 } from '../engine/asm6502'
import { cycle, newCpu, reset, setNmi } from '../engine/cpu6502'
import { BALL_SOURCE, COUNTER_SOURCE, HELLO_SOURCE, KEYPAD_SOURCE, SWEEP_65C02_SOURCE, TIMER_NMI_SOURCE } from './programs6502'

/** A machine for the programs that is nothing but the memory map: RAM, ROM, and a function called for each device write and read. */
function run(source: string, cycles: number, dev: { write?: (reg: number, v: number) => void; read?: (reg: number) => number } = {}, cmos = false) {
  const r = assemble6502(source, 0x1000, cmos)
  expect(r.errors).toEqual([])
  expect(r.base).toBe(0xf000)
  const ram = new Uint8Array(0x800)
  const c = newCpu(cmos)
  reset(c)
  for (let n = 0; n < cycles; n++) {
    if (!c.read) {
      if (c.addr < 0x4000) ram[c.addr & 0x7ff] = c.out
      else if (c.addr < 0x8000) dev.write?.(c.addr & 7, c.out)
    }
    const get = (a: number) => (a >= 0x8000 ? r.bytes[a & 0xfff] : a < 0x4000 ? ram[a & 0x7ff] : (dev.read?.(a & 7) ?? 0))
    cycle(c, c.read ? get(c.addr) : 0)
  }
  return { ram, r }
}

describe('the programs of the 6502 examples', () => {
  it('the counter shows 0, 1, 2… on the LEDs', () => {
    const shown: number[] = []
    run(COUNTER_SOURCE, 3000, { write: (reg, v) => reg === 0 && shown.push(v) })
    expect(shown.slice(0, 5)).toEqual([0, 1, 2, 3, 4])
  })

  it('the counter wraps from 255 to 0', () => {
    const shown: number[] = []
    run(COUNTER_SOURCE, 400 * 260, { write: (reg, v) => reg === 0 && shown.push(v) })
    expect(shown.slice(254, 258)).toEqual([254, 255, 0, 1])
  })

  it('hello prints its greeting once', () => {
    let text = ''
    run(HELLO_SOURCE, 1000, { write: (reg, v) => reg === 1 && (text += String.fromCharCode(v)) })
    expect(text).toBe('Hello from a 6502!\n')
  })

  it('the keypad echo prints each key as a hex digit and shows its code on the LEDs', () => {
    let text = ''
    let leds = -1
    let pending = false
    let key = 0
    const presses = [0xa, 3, 15]
    let at = 0
    run(KEYPAD_SOURCE, 12000, {
      write: (reg, v) => {
        if (reg === 1) text += String.fromCharCode(v)
        if (reg === 0) leds = v
        if (reg === 3) pending = false
      },
      read: (reg) => {
        // A press arrives every so often, and waits until it is acknowledged.
        if (!pending && presses.length && ++at % 100 === 0) {
          key = presses.shift()!
          pending = true
        }
        return reg === 3 ? (pending ? 0x10 : 0) | key : 0
      },
    })
    expect(text).toBe('A3F')
    expect(leds).toBe(15)
  })

  it('the ball moves one pixel at a time and stays on the 16 × 16 screen', () => {
    const screen = new Array<number>(256).fill(0)
    let xy = 0
    const seen: number[] = []
    run(BALL_SOURCE, 20000, {
      write: (reg, v) => {
        if (reg === 5) xy = v
        if (reg === 6) {
          screen[xy] = v & 1
          if (v & 1) seen.push(xy)
        }
      },
      read: () => 0,
    })
    expect(screen.filter(Boolean).length).toBe(1) // one ball: the old one is taken away before the new one goes down
    expect(seen.length).toBeGreaterThan(20)
    expect(seen.slice(0, 3).map((p) => [p & 15, p >> 4])).toEqual([[4, 6], [5, 7], [6, 8]]) // down and to the right
    // It bounces: after enough frames it has been on every side.
    const xs = seen.map((p) => p & 15)
    const ys = seen.map((p) => p >> 4)
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([0, 15, 0, 15])
  })

  it('the ball turns when a direction is held', () => {
    const seen: number[] = []
    let xy = 0
    run(BALL_SOURCE, 3000, {
      write: (reg, v) => {
        if (reg === 5) xy = v
        if (reg === 6 && v & 1) seen.push(xy)
      },
      read: (reg) => (reg === 4 ? 4 : 0), // left held
    })
    const xs = seen.map((p) => p & 15)
    expect(xs.slice(0, 5)).toEqual([2, 1, 0, 0, 0]) // left until the wall, and it stays there while left is held
  })

  it('the 65C02 sweep lights one LED at a time, from the first to the last, and starts again', () => {
    const shown: number[] = []
    run(SWEEP_65C02_SOURCE, 6000, { write: (reg, v) => reg === 0 && shown.push(v) }, true)
    expect(shown.slice(0, 10)).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 1, 2])
  })

  it('the 65C02 sweep needs the 65C02: the NMOS assembler names the first instruction it does not have', () => {
    const r = assemble6502(SWEEP_65C02_SOURCE, 0x1000)
    expect(r.errors[0].message).toMatch(/instruction of the 65C02/)
  })

  it('the timer program sleeps in WAI, and each NMI counts once on the LEDs and prints one star', () => {
    // run() has no NMI pin, so this one drives the core by hand: a tick every 300 cycles.
    const r = assemble6502(TIMER_NMI_SOURCE, 0x1000, true)
    expect(r.errors).toEqual([])
    const ram = new Uint8Array(0x800)
    const c = newCpu(true)
    reset(c)
    const leds: number[] = []
    let text = ''
    const waiting: boolean[] = []
    for (let n = 1; n <= 1500; n++) {
      if (n % 300 === 0) setNmi(c, true)
      else if (n % 300 === 10) setNmi(c, false)
      if (!c.read) {
        if (c.addr < 0x4000) ram[c.addr & 0x7ff] = c.out
        else if ((c.addr & 7) === 0) leds.push(c.out)
        else if ((c.addr & 7) === 1) text += String.fromCharCode(c.out)
      }
      cycle(c, c.read ? (c.addr >= 0x8000 ? r.bytes[c.addr & 0xfff] : ram[c.addr & 0x7ff]) : 0)
      waiting.push(c.wait === 1)
    }
    expect(leds).toEqual([1, 2, 3, 4])
    expect(text).toBe('****')
    expect(waiting.filter(Boolean).length).toBeGreaterThan(1000) // asleep nearly all the time
  })
})
