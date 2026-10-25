import { describe, expect, it } from 'vitest'
import { cycle as stepCore, newCpu, reset } from '../engine/cpu6502'
import { Simulator } from '../engine/simulator'
import { toNum } from '../engine/types'
import { assemble6502 } from '../engine/asm6502'
import { BIG_ROM_SIZE, BLINK_BYTES, BLINK_SOURCE, board6502, board6502Builder, romImage, ROM_BASE, type Board6502Options } from './board6502'
import { BALL_SOURCE, COUNTER_SOURCE, HELLO_SOURCE, KEYPAD_SOURCE, SWEEP_65C02_SOURCE, TIMER_NMI_SOURCE } from './programs6502'
import { sweep65c02 } from './board6502-examples'
import { flatten } from './buses'
import { basicRomBytes } from './basic-rom'
import { deserialize, fromShareHash, serialize, toShareHash } from './serialize'

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

  it('the timer interrupts a 65C02 in WAI: the LEDs count and the console prints stars, once for each tick', () => {
    const { sim, keys } = start({ source: TIMER_NMI_SOURCE, chip: 'cmos', devices: ['leds', 'console'], timer: 4, hz: 128 })
    let maxLeds = 0
    for (let i = 0; i < 400; i++) {
      oneCycle(sim)
      maxLeds = Math.max(maxLeds, bits(sim, keys.leds, 'Q', 8))
    }
    // 400 cycles at 128 Hz are 3.1 s: 12 ticks of a 4 Hz timer (and each is handled once: the count and the stars agree).
    const stars = sim.state(keys.console).lines.join('').length
    expect(stars).toBeGreaterThanOrEqual(11)
    expect(stars).toBeLessThanOrEqual(13)
    expect(bits(sim, keys.leds, 'Q', 8)).toBe(stars)
    expect(maxLeds).toBe(stars)
  })

  it('the probes are on the clock, the address bus, the data, R/W and SYNC', () => {
    const labels = Object.values(board6502().comps).filter((c) => c.type === 'probe').map((c) => c.label)
    expect(labels).toEqual(['Φ2', 'A', 'D (read)', 'R/W', 'SYNC'])
  })
})

/** Fills the 16 KB of RAM with a pattern, then looks at the ROM through both of its mirrors. The LEDs say how that went. */
const FILL_SOURCE = `.org $C000
start:  LDX #$FF
        TXS
        LDA #$00       ; the pointer ($00/$01) goes through the pages $02 to $3F
        STA $00
        LDA #$02
        STA $01
page:   LDY #$00
byte:   TYA            ; the pattern for the address: low byte, high byte and $A5 added up by EOR
        EOR $01
        EOR #$A5
        STA ($00),Y
        INY
        BNE byte
        INC $01
        LDA $01
        CMP #$40
        BNE page
        LDX #$00       ; page $01, by its address
one:    TXA
        EOR #$A4
        STA $0100,X
        INX
        BNE one
        LDX #$00       ; page $00 last: it held the pointer
zero:   TXA
        EOR #$A5
        STA $00,X
        INX
        BNE zero
        LDA $8000      ; the ROM is seen twice: the first byte at $8000 and at $C000
        CMP $C000
        BNE fail
        LDA $BFFF      ; and the last byte at $BFFF and at $FFFF
        CMP $FFFF
        BNE fail
        CMP #$5C
        BNE fail
        LDA #$AA
        STA $4000
done:   JMP done
fail:   LDA #$EE
        STA $4000
        JMP fail
.org $FFFC
.word start
.word $5CA7`

describe('the 6502 board with big memory', () => {
  const big = (o: Board6502Options = {}) => start({ memory: 'big', ...o })
  /** The programs of the small board begin at $F000; the big ROM begins at $C000. */
  const atC000 = (source: string) => source.replace('.org $F000', '.org $C000')

  it('refuses a program that does not begin where its ROM image does', () => {
    expect(() => board6502Builder({ memory: 'big', source: HELLO_SOURCE })).toThrow(/starts at \$F000.*begins at \$C000/)
    expect(() => board6502Builder({ source: '.org $E000\nNOP' })).toThrow(/starts at \$E000.*begins at \$F000/)
  })

  it('has a 16 KB RAM at $0000 and a 16 KB ROM at $8000, and its image has the vector at the top', () => {
    const { b, keys } = board6502Builder({ memory: 'big' })
    const c = b.build(false)
    expect([c.comps[keys.ram].params.abits, c.comps[keys.rom].params.abits]).toEqual([14, 14])
    expect(keys.romAddr).toBeUndefined() // the ROM takes A0–A13 straight from the splitter
    const image = romImage(BLINK_BYTES, 0xc000, BIG_ROM_SIZE).split(' ')
    expect(image).toHaveLength(16384)
    expect(image.slice(16380, 16382)).toEqual(['00', 'C0'])
    expect(String(c.comps[keys.rom].params.data).split(' ')).toHaveLength(16384)
  })

  it('fills all 16 KB of RAM with a pattern and sees the ROM at both of its places', { timeout: 120_000 }, () => {
    const { sim, keys } = big({ source: FILL_SOURCE, devices: ['leds'] })
    sim.setHistory(false)
    for (let n = 0; n < 400_000 && bits(sim, keys.leds, 'Q', 8) === 0; n++) oneCycle(sim)
    expect(bits(sim, keys.leds, 'Q', 8)).toBe(0xaa) // 0xEE would mean that a mirror of the ROM is wrong
    const mem = sim.state(keys.ram).mem as Uint8Array
    expect(mem).toHaveLength(16384)
    const wrong: number[] = []
    for (let a = 0; a < mem.length; a++) if (mem[a] !== ((a & 255) ^ (a >> 8) ^ 0xa5)) wrong.push(a)
    expect(wrong.slice(0, 8)).toEqual([])
  })

  it('keeps the devices where they were, and prints from a ROM in the upper half', () => {
    const { sim, keys } = big({ source: atC000(HELLO_SOURCE), devices: ['console'] })
    for (let i = 0; i < 600; i++) oneCycle(sim)
    expect(sim.state(keys.console).lines.join('\n')).toBe('Hello from a 6502!\n')
  })

  it('reads the keypad through the same A14 and A15 as the small board', () => {
    const { sim, keys } = big({ source: atC000(KEYPAD_SOURCE), devices: ['leds', 'console', 'keypad'] })
    for (let i = 0; i < 200; i++) oneCycle(sim)
    sim.setState(keys.keypad, { pressed: true, tapped: true, key: 11 })
    for (let i = 0; i < 3; i++) oneCycle(sim)
    sim.setState(keys.keypad, { pressed: false })
    for (let i = 0; i < 120; i++) oneCycle(sim)
    expect(sim.state(keys.console).lines).toEqual(['B'])
    expect(bits(sim, keys.leds, 'Q', 8)).toBe(11)
  })

  it('leaves the small board as it was: the same parts and the same wires', () => {
    const small = board6502Builder({ memory: 'small' }).b.build(false)
    const plain = board6502Builder().b.build(false)
    expect(serialize(small)).toEqual(serialize(plain))
    const rom = Object.values(small.comps).find((c) => c.type === 'rom')!
    expect([rom.params.abits, rom.params.data && String(rom.params.data).split(' ').length]).toEqual([12, 4096])
  })

  it('a 16 KB ROM survives a file and a share link', () => {
    const rom = Array.from(basicRomBytes(), (v) => v.toString(16).toUpperCase().padStart(2, '0')).join(' ')
    expect(rom.length).toBeLessThanOrEqual(49152)
    const { b, keys } = board6502Builder({ memory: 'big', rom })
    const c = b.build(false)
    const again = deserialize(JSON.parse(JSON.stringify(serialize(c))))
    expect(again.comps[keys.rom].params.data).toBe(rom)
    const hash = toShareHash(c)
    expect(fromShareHash(hash)!.comps[keys.rom].params.data).toBe(rom)
    // Measured: 18,183 characters for the board with BASIC in its ROM (written down in docs/plan-basic-computer.md, B3).
    expect(hash.length).toBeLessThan(25_000)
  })
})
