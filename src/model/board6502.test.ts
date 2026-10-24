import { describe, expect, it } from 'vitest'
import { cycle as stepCore, newCpu, reset } from '../engine/cpu6502'
import { Simulator } from '../engine/simulator'
import { toNum } from '../engine/types'
import { assemble6502 } from '../engine/asm6502'
import { BLINK_BYTES, BLINK_SOURCE, board6502, board6502Builder, romImage, ROM_BASE } from './board6502'
import { flatten } from './buses'

function start() {
  const { b, keys } = board6502Builder({ hz: 100 })
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
