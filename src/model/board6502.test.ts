import { describe, expect, it } from 'vitest'
import { cycle as stepCore, newCpu, reset } from '../engine/cpu6502'
import { Simulator } from '../engine/simulator'
import { toNum } from '../engine/types'
import { assemble6502 } from '../engine/asm6502'
import { BLINK_BYTES, BLINK_SOURCE, board6502, board6502Builder, romImage, ROM_BASE, type Board6502Options } from './board6502'
import { BALL_SOURCE, COUNTER_SOURCE, HELLO_SOURCE, KEYPAD_SOURCE, SWEEP_65C02_SOURCE } from './programs6502'
import { sweep65c02 } from './board6502-examples'
import { flatten } from './buses'

function start(o: Board6502Options = {}) {
  const { b, keys } = board6502Builder({ hz: 100, ...o })
  const sim = new Simulator()
  sim.load(flatten(b.build(false)))
  sim.settle()
  return { sim, keys }
}

/** One whole clock cycle of the CPU: the clock rises, then falls (the CPU moves on at the fall). */
const oneCycle = (sim: Simulator) => {
  sim.stepClock()
  sim.stepClock()
}

const bits = (sim: Simulator, id: string, prefix: string, n: number) => toNum(Array.from({ length: n }, (_, i) => sim.pinValue(id, `${prefix}${i}`)), 0, n)

describe('the 6502 board', () => {
  it('is a circuit that builds, and its ROM image has the reset vector at the top', () => {
    expect(Object.keys(board6502().comps).length).toBeGreaterThan(20)
    const bytes = romImage(BLINK_BYTES).split(' ')
    expect(bytes).toHaveLength(4096)
    expect(bytes.slice(0, 3)).toEqual(['A9', '01', '8D'])
    expect(bytes.slice(4092, 4094)).toEqual(['00', 'F0'])
  })

  it('has its program in 6502 assembly in the ROM, and the bytes are what that assembles to', () => {
    const r = assemble6502(BLINK_SOURCE, 0x1000)
    expect(r.errors).toEqual([])
    expect(r.base).toBe(ROM_BASE)
    expect(r.bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')).toBe(romImage(BLINK_BYTES))
    const rom = Object.values(board6502().comps).find((c) => c.type === 'rom')!
    expect(rom.params.isa).toBe('6502')
    expect(rom.params.source).toBe(BLINK_SOURCE)
  })

  it('does what the core does, cycle for cycle: address, R/W and SYNC on the pins, registers inside', () => {
    const { sim, keys } = start()
    // The same program on the core alone, with the board's memory map.
    const rom = romImage(BLINK_BYTES).split(' ').map((h) => parseInt(h, 16))
    const ram = new Uint8Array(2048)
    const read = (addr: number) => (addr >= 0x8000 ? rom[addr & 0xfff] : addr < 0x4000 ? ram[addr & 0x7ff] : 0)
    const c = newCpu()
    reset(c)
    const leds: number[] = []
    for (let n = 0; n < 300; n++) {
      const pins = {
        addr: bits(sim, keys.cpu, 'A', 16),
        rw: sim.pinValue(keys.cpu, 'RWB'),
        sync: sim.pinValue(keys.cpu, 'SYNC'),
      }
      expect(pins, `cycle ${n}`).toEqual({ addr: c.addr, rw: c.read ? 1 : 0, sync: c.sync ? 1 : 0 })
      if (!c.read && c.addr < 0x4000) ram[c.addr & 0x7ff] = c.out
      if (!c.read && c.addr >= 0x4000 && c.addr < 0x8000) leds.push(c.out)
      stepCore(c, c.read ? read(c.addr) : 0)
      oneCycle(sim)
      const cpu = sim.state(keys.cpu).cpu
      expect([cpu.pc, cpu.a, cpu.sp, cpu.p], `cycle ${n}`).toEqual([c.pc, c.a, c.sp, c.p])
    }
    expect(leds.slice(0, 9)).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 1])
    // And the LED register on the board shows the last of them.
    expect(bits(sim, keys.leds, 'Q', 8)).toBe(leds[leds.length - 1])
  })

  it('stays idle while Reset is held, then runs the reset sequence and starts the program again', () => {
    const { sim, keys } = start()
    for (let i = 0; i < 60; i++) oneCycle(sim)
    const before = sim.state(keys.cpu).cpu
    expect(before.cycles).toBeGreaterThan(50)
    sim.setState(keys.reset, { pressed: true })
    sim.settle()
    for (let i = 0; i < 5; i++) oneCycle(sim)
    expect(sim.state(keys.cpu).held).toBe(true)
    expect(sim.pinValue(keys.cpu, 'SYNC')).toBe(0)
    expect(sim.pinValue(keys.cpu, 'RWB')).toBe(1) // idle: reading, so nothing is written
    sim.setState(keys.reset, { pressed: false })
    sim.settle()
    // 7 cycles of the reset sequence, and then the first opcode fetch is on the pins, at the address in the vector.
    for (let i = 0; i < 7; i++) oneCycle(sim)
    expect(sim.pinValue(keys.cpu, 'SYNC')).toBe(1)
    expect(bits(sim, keys.cpu, 'A', 16)).toBe(0xf000)
  })
})

describe('the 6502 board with devices', () => {
  const cycles = (sim: Simulator, n: number) => {
    for (let i = 0; i < n; i++) oneCycle(sim)
  }

  it('the counter program counts on the LEDs', () => {
    const { sim, keys } = start({ source: COUNTER_SOURCE, devices: ['leds'] })
    const seen: number[] = []
    for (let i = 0; i < 1500; i++) {
      oneCycle(sim)
      const v = bits(sim, keys.leds, 'Q', 8)
      if (v !== seen[seen.length - 1]) seen.push(v)
    }
    expect(seen.slice(0, 6)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('hello prints on the console, which sits at $4001', () => {
    const { sim, keys } = start({ source: HELLO_SOURCE, devices: ['console'] })
    cycles(sim, 600)
    expect(sim.state(keys.console).lines.join('\n')).toBe('Hello from a 6502!\n')
  })

  it('a key pressed on the keypad is echoed on the console and the LEDs, and acknowledged', () => {
    const { sim, keys } = start({ source: KEYPAD_SOURCE, devices: ['leds', 'console', 'keypad'] })
    cycles(sim, 200)
    expect(sim.state(keys.console).lines).toEqual([''])
    for (const key of [11, 2]) {
      sim.setState(keys.keypad, { pressed: true, tapped: true, key })
      cycles(sim, 3)
      sim.setState(keys.keypad, { pressed: false })
      cycles(sim, 120)
    }
    expect(sim.state(keys.console).lines).toEqual(['B2']) // once each: the press was acknowledged
    expect(bits(sim, keys.leds, 'Q', 8)).toBe(2)
  })

  it('the ball is drawn on the screen, and the gamepad steers it', () => {
    const { sim, keys } = start({ source: BALL_SOURCE, devices: ['screen', 'gamepad'] })
    const lit = () => {
      const px: number[] = sim.state(keys.screen).px
      return px.flatMap((v, i) => (v ? [[i % 16, Math.floor(i / 16)]] : []))
    }
    // Between taking the old ball away and putting the new one down the screen is empty for a few dozen cycles; wait for it.
    const settle = () => {
      for (let i = 0; i < 400 && lit().length !== 1; i++) oneCycle(sim)
      expect(lit()).toHaveLength(1)
      return lit()[0]
    }
    cycles(sim, 400)
    const [x0] = settle()
    // Hold left: the ball runs to the left wall and stays there.
    sim.setState(keys.gamepad, { keys: 4 })
    cycles(sim, 3000)
    expect(settle()[0]).toBe(0)
    expect(x0).toBeGreaterThan(0)
  })

  it('with every device on the board, the keypad and the gamepad are told apart by A2 and the speaker follows bit 0 of $4002', () => {
    const source = `.org $F000
start: LDA $4003
       STA $4000      ; the keypad on the LEDs
       LDA $4004
       STA $4001      ; the gamepad on the console
       LDA #1
       STA $4002      ; the speaker on...
       LDA #0
       STA $4002      ; ...and off
       JMP start
.org $FFFC
.word start`
    const { sim, keys } = start({ source, devices: ['leds', 'console', 'speaker', 'keypad', 'gamepad', 'screen'] })
    sim.setState(keys.keypad, { pressed: true, tapped: true, key: 6 })
    sim.setState(keys.gamepad, { keys: 32 }) // B: code 32 is a space, which the console prints
    sim.settle()
    const speaker = new Set<number>()
    for (let i = 0; i < 200; i++) {
      oneCycle(sim)
      speaker.add(sim.pinValue(keys.speaker, 'A'))
    }
    expect(bits(sim, keys.leds, 'Q', 8)).toBe(0x16) // key 6, and bit 4: a press waits
    expect(sim.state(keys.console).lines[0]).toMatch(/^ +$/)
    expect([...speaker].sort()).toEqual([0, 1])
  })

  it('a 65C02 board runs a 65C02 program: the CPU part and the ROM are set to the chip', () => {
    const { sim, keys } = start({ source: SWEEP_65C02_SOURCE, chip: 'cmos', devices: ['leds'] })
    const seen: number[] = []
    for (let i = 0; i < 2600; i++) {
      oneCycle(sim)
      const v = bits(sim, keys.leds, 'Q', 8)
      if (v !== seen[seen.length - 1]) seen.push(v)
    }
    expect(seen.slice(0, 10)).toEqual([0, 1, 2, 4, 8, 16, 32, 64, 128, 1])
    const rom = Object.values(sweep65c02().comps).find((c) => c.type === 'rom')!
    const cpu = Object.values(sweep65c02().comps).find((c) => c.type === 'cpu6502')!
    expect([rom.params.isa, cpu.params.chip]).toEqual(['65c02', 'cmos'])
  })
})
