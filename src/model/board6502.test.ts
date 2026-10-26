import { describe, expect, it } from 'vitest'
import { cycle as stepCore, newCpu, reset } from '../engine/cpu6502'
import { Simulator } from '../engine/simulator'
import { toNum } from '../engine/types'
import { assemble6502 } from '../engine/asm6502'
import { BIG_ROM_SIZE, BLINK_BYTES, BLINK_SOURCE, board6502, board6502Builder, romImage, ROM_BASE, type Board6502Options } from './board6502'
import { aciaBreak, aciaType, screenText, type AciaState } from '../engine/acia'
import { BALL_SOURCE, COUNTER_SOURCE, VIA_TIMER_SOURCE, ECHO_IRQ_SOURCE, ECHO_SOURCE, HELLO_SOURCE, KEYPAD_SOURCE, SWEEP_65C02_SOURCE, TIMER_NMI_SOURCE } from './programs6502'
import { basic6502, basicLcd6502, lcd6502, sweep65c02, via6502 } from './board6502-examples'
import { BASIC_PROGRAMS, programText } from './basic-programs'
import { lcdText } from '../engine/hd44780'
import { LCD_HELLO_SOURCE } from './programs6502'
import type { LcdState } from '../engine/hd44780'
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

describe('the 6502 board with the VIA', () => {
  const board = (source: string, o: Board6502Options = {}) => start({ memory: 'big', source, devices: ['via'], viaLeds: true, ...o })

  it('needs the big memory and no other device than the terminal', () => {
    expect(() => board6502Builder({ devices: ['via'] })).toThrow(/need memory: 'big'/)
    expect(() => board6502Builder({ memory: 'big', devices: ['via', 'leds'] })).toThrow(/each other/)
    expect(() => board6502Builder({ memory: 'big', devices: ['via'], source: VIA_TIMER_SOURCE })).not.toThrow()
  })

  it('is wired as Ben Eater wired it: A14 and A13 select it through a gate, A15 is CS2, A0 to A3 are its registers', () => {
    const { b, keys } = board6502Builder({ memory: 'big', source: VIA_TIMER_SOURCE, devices: ['via'], viaLeds: true })
    const c = b.build(false)
    const wires = Object.values(c.wires)
    const into = (pin: string) => wires.filter((w) => w.to.comp === keys.via && w.to.pin === pin).length
    for (const pin of ['PHI2', 'RESB', 'CS1', 'CS2B', 'RS0', 'RS1', 'RS2', 'RS3', 'RWB', 'DI']) expect(into(pin), pin).toBe(1)
    expect(wires.some((w) => w.from.comp === keys.via && w.from.pin === 'IRQB' && w.to.comp === keys.cpu && w.to.pin === 'IRQB')).toBe(true)
    expect(wires.some((w) => w.from.comp === keys.via && w.from.pin === 'PB' && w.to.comp === keys.bar)).toBe(true)
  })

  it('timer: the interrupt routine counts on port B every 1,024 cycles, and PB7 is the timer’s square wave', { timeout: 120_000 }, () => {
    const { sim, keys } = board(VIA_TIMER_SOURCE)
    const pb = () => Array.from({ length: 8 }, (_, i) => sim.pinValue(keys.via, `PB${i}`))
    const count = () => (sim.state(keys.ram).mem as Uint8Array)[0]
    for (let n = 0; n < 200; n++) oneCycle(sim) // set up: the ports are outputs now
    expect(pb().every((v) => v === 0 || v === 1)).toBe(true)
    expect(count()).toBe(0)
    const seen: number[] = []
    const toggles: number[] = []
    let p7 = pb()[7]
    for (let n = 0; n < 4 * 1024 + 300; n++) {
      oneCycle(sim)
      if (seen[seen.length - 1] !== count()) seen.push(count())
      if (pb()[7] !== p7) {
        p7 = pb()[7]
        toggles.push(n)
      }
    }
    expect(seen).toEqual([0, 1, 2, 3, 4]) // one more at each interrupt
    expect(toggles.length).toBeGreaterThanOrEqual(4) // PB7 toggles at every timeout, by hardware, to the cycle
    expect(toggles.slice(1).map((v, i) => v - toggles[i])).toEqual(toggles.slice(1).map(() => 1024))
    // PORTB shows the count on PB0–PB6.
    const low = pb().slice(0, 7).reduce<number>((a, v, i) => a | ((v as number) << i), 0)
    expect(low).toBe(count())
  })

  it('with the terminal as well: both are built, and either one interrupts', () => {
    const { b, keys } = board6502Builder({ memory: 'big', source: VIA_TIMER_SOURCE, devices: ['terminal', 'via'], interrupt: true })
    const c = b.build(false)
    const wires = Object.values(c.wires)
    expect(keys.irqAnd).toBeDefined()
    expect(wires.some((w) => w.from.comp === keys.irqAnd && w.to.comp === keys.cpu && w.to.pin === 'IRQB')).toBe(true)
    expect(keys.termOrVia).toBeDefined()
    expect(wires.some((w) => w.from.comp === keys.termOrVia && w.to.comp === keys.mux)).toBe(true)
  })
})

describe('the 6502 board with the VIA and the LCD', () => {
  const board = (source: string, o: Board6502Options = {}) => start({ memory: 'big', source, devices: ['via', 'lcd'], ...o })
  const lines = (sim: Simulator, id: string) => lcdText(sim.state(id) as LcdState).map((l) => l.trimEnd())

  it('explains itself: every note of the three boards fits the part (600 characters) and none was dropped', () => {
    for (const c of [via6502(), lcd6502(), basicLcd6502()]) {
      const notes = Object.values(c.comps).filter((p) => p.type === 'note')
      expect(notes.length).toBeGreaterThanOrEqual(5)
      for (const n of notes) expect(String(n.params.text).length, String(n.params.text).slice(0, 30)).toBeLessThanOrEqual(600)
    }
  })

  it('needs the VIA, and the LEDs and the LCD cannot share port B', () => {
    expect(() => board6502Builder({ memory: 'big', devices: ['lcd'] })).toThrow(/needs the VIA/)
    expect(() => board6502Builder({ memory: 'big', devices: ['via', 'lcd'], viaLeds: true })).toThrow(/share port B/)
  })

  it('is wired as Ben Eater wired it: port B is the data bus, shared through a junction; PA5 is RS, PA6 R/W, PA7 E', () => {
    const { b, keys } = board6502Builder({ memory: 'big', source: LCD_HELLO_SOURCE, devices: ['via', 'lcd'] })
    const wires = Object.values(b.build(false).wires)
    const link = (fc: string, fp: string, tc: string, tp: string) => wires.some((w) => w.from.comp === fc && w.from.pin === fp && w.to.comp === tc && w.to.pin === tp)
    expect(link(keys.via, 'PB', keys.lcdBus, 'A')).toBe(true)
    expect(link(keys.lcd, 'D', keys.lcdBus, 'B')).toBe(true)
    expect(link(keys.lcdBus, 'Y', keys.via, 'PBIN')).toBe(true)
    expect(link(keys.lcdBus, 'Y', keys.lcd, 'DIN')).toBe(true)
    expect(link(keys.paSplit, 'Y1', keys.lcd, 'RS')).toBe(true) // PA5
    expect(link(keys.paSplit, 'Y2', keys.lcd, 'RW')).toBe(true) // PA6
    expect(link(keys.paSplit, 'Y3', keys.lcd, 'E')).toBe(true) // PA7
  })

  it('hello, world: the program sets the LCD up, waits for its busy flag before each byte, and writes the message', { timeout: 300_000 }, () => {
    const { sim, keys } = board(LCD_HELLO_SOURCE)
    sim.setHistory(false)
    let n = 0
    for (; n < 40_000 && lines(sim, keys.lcd)[0] !== 'Hello, world!'; n++) oneCycle(sim)
    expect(lines(sim, keys.lcd)).toEqual(['Hello, world!', ''])
    const st = sim.state(keys.lcd) as LcdState
    expect([st.display, st.cursor, st.blink, st.twoLine, st.dl8]).toEqual([true, true, false, true, true])
    expect(st.dropped).toBe(0) // nothing was written while the LCD was busy: the program waited
    expect(n).toBeGreaterThan(1500) // the clear alone keeps it busy for 1,520 cycles
  })

  it('a program that does not wait for the busy flag loses what it sends too soon, as on the real thing', { timeout: 300_000 }, () => {
    const hasty = LCD_HELLO_SOURCE.replace('lcd_wait:               ; wait until the LCD is not busy', 'lcd_wait:\n        RTS\nlcd_wait_unused:')
    const { sim, keys } = board(hasty)
    sim.setHistory(false)
    for (let n = 0; n < 20_000; n++) oneCycle(sim)
    const st = sim.state(keys.lcd) as LcdState
    expect(st.dropped).toBeGreaterThan(0)
    expect(lines(sim, keys.lcd)[0]).not.toBe('Hello, world!')
  })

  it('the BASIC computer with the LCD: the program to type in POKEs two lines onto it', { timeout: 600_000 }, () => {
    const c = basicLcd6502()
    const sim = new Simulator()
    sim.load(flatten(c))
    sim.setHistory(false)
    sim.settle()
    const type = Object.values(c.comps).find((p) => p.type === 'acia6551')!.id
    const lcd = Object.values(c.comps).find((p) => p.type === 'hd44780')!.id
    const st = () => sim.state(type) as AciaState
    for (let n = 0; n < 200_000 && !/OK$/.test(screenText(st())); n++) oneCycle(sim)
    const program = BASIC_PROGRAMS.find((p) => p.id === 'lcd')!
    expect(program.needs).toBe('lcd')
    aciaType(st(), programText(program))
    let cycles = 0
    for (; cycles < 3_000_000 && lines(sim, lcd).join('|') !== 'HELLO FROM BASIC|ON A 6502'; cycles++) oneCycle(sim)
    expect(lines(sim, lcd)).toEqual(['HELLO FROM BASIC', 'ON A 6502'])
    expect((sim.state(lcd) as LcdState).dropped).toBe(0) // BASIC is slower than the LCD
  })
})

describe('the 6502 board with the terminal', () => {
  const board = (source: string, interrupt = false) => start({ memory: 'big', source, devices: ['terminal'], interrupt })
  const screen = (sim: Simulator, id: string) => screenText(sim.state(id) as AciaState)
  const type = (sim: Simulator, id: string, text: string) => aciaType(sim.state(id) as AciaState, text)
  /** Run until the screen shows `text` (at most `max` cycles); returns whether it did. */
  const until = (sim: Simulator, id: string, text: string, max = 20_000) => {
    for (let n = 0; n < max && screen(sim, id) !== text; n++) oneCycle(sim)
    return screen(sim, id) === text
  }

  it('needs the big memory, and has no device but the VIA', () => {
    expect(() => board6502Builder({ devices: ['terminal'] })).toThrow(/need memory: 'big'/)
    expect(() => board6502Builder({ memory: 'big', devices: ['terminal', 'leds'] })).toThrow(/each other/)
    expect(() => board6502Builder({ memory: 'big', devices: ['terminal'], source: ECHO_SOURCE })).not.toThrow()
  })

  it('is wired as Ben Eater wired it: A14 and A15 select the chip, A0 and A1 pick the register, R/W and the data bus go straight on', () => {
    const { b, keys } = board6502Builder({ memory: 'big', source: ECHO_SOURCE, devices: ['terminal'] })
    const c = b.build(false)
    const t = keys.terminal
    expect(c.comps[t].type).toBe('acia6551')
    const into = (pin: string) => Object.values(c.wires).filter((w) => [w.from, w.to].some((r) => r.comp === t && (r.pin === pin || r.pin.startsWith(pin)))).length
    for (const pin of ['PHI2', 'RESB', 'CS0', 'CS1B', 'RS0', 'RS1', 'RWB', 'DI', 'D']) expect(into(pin), pin).toBeGreaterThan(0)
    expect(into('IRQB')).toBe(0) // the polling program does not use the interrupt
    const irq = board6502Builder({ memory: 'big', source: ECHO_IRQ_SOURCE, devices: ['terminal'], interrupt: true })
    const ic = irq.b.build(false)
    expect(Object.values(ic.wires).some((w) => w.from.comp === irq.keys.terminal && w.from.pin === 'IRQB' && w.to.comp === irq.keys.cpu && w.to.pin === 'IRQB')).toBe(true)
  })

  it('echo: prints HELLO, then sends back what is typed, an Enter as a new line', () => {
    const { sim, keys } = board(ECHO_SOURCE)
    expect(until(sim, keys.terminal, 'HELLO\n')).toBe(true)
    type(sim, keys.terminal, 'hi there\r')
    expect(until(sim, keys.terminal, 'HELLO\nHI THERE\n')).toBe(true)
    type(sim, keys.terminal, 'x')
    expect(until(sim, keys.terminal, 'HELLO\nHI THERE\nX')).toBe(true)
  })

  it('echo: a key typed before the program turns the receiver on waits for it', () => {
    const { sim, keys } = board(ECHO_SOURCE)
    type(sim, keys.terminal, 'q')
    expect(until(sim, keys.terminal, 'HELLO\nQ')).toBe(true)
  })

  it('echo: the break key arrives like any other (Control+C is $03, which the screen does not show)', () => {
    const { sim, keys } = board(ECHO_SOURCE)
    expect(until(sim, keys.terminal, 'HELLO\n')).toBe(true)
    aciaBreak(sim.state(keys.terminal) as AciaState)
    for (let n = 0; n < 400; n++) oneCycle(sim)
    expect((sim.state(keys.terminal) as AciaState).keys.length).toBe((sim.state(keys.terminal) as AciaState).next) // it was read
    expect(screen(sim, keys.terminal)).toBe('HELLO\n')
  })

  it('echo by interrupt: the main program keeps counting, and every key interrupts it', () => {
    const { sim, keys } = board(ECHO_IRQ_SOURCE, true)
    const count = () => {
      const m = sim.state(keys.ram).mem as Uint8Array
      return m[0] | (m[1] << 8)
    }
    expect(until(sim, keys.terminal, 'HELLO\n')).toBe(true)
    for (let n = 0; n < 200; n++) oneCycle(sim)
    const before = count()
    expect(before).toBeGreaterThan(0)
    type(sim, keys.terminal, 'ok\r')
    expect(until(sim, keys.terminal, 'HELLO\nOK\n')).toBe(true)
    for (let n = 0; n < 200; n++) oneCycle(sim)
    expect(count()).toBeGreaterThan(before + 20) // it went on counting between and after the interrupts
    expect(sim.pinValue(keys.terminal, 'IRQB')).toBe(1) // and the line is released
  })

  it('echo by interrupt: without the wire the chip raises its flag but the CPU never answers', () => {
    const { sim, keys } = board(ECHO_IRQ_SOURCE, false)
    expect(until(sim, keys.terminal, 'HELLO\n')).toBe(true)
    type(sim, keys.terminal, 'a')
    for (let n = 0; n < 600; n++) oneCycle(sim)
    expect(screen(sim, keys.terminal)).toBe('HELLO\n')
    expect(sim.pinValue(keys.terminal, 'IRQB')).toBe(0)
  })

  it('reads the ROM at $8000 and up whatever the terminal says, and RAM below $4000', () => {
    const { sim, keys } = board(ECHO_SOURCE)
    expect(until(sim, keys.terminal, 'HELLO\n')).toBe(true)
    // The program ran from the ROM and used the stack in the RAM to call SEND; it also finished the greeting, so both work.
    const stack = (sim.state(keys.ram).mem as Uint8Array).slice(0x1f0, 0x200)
    expect(stack.some((v) => v !== 0)).toBe(true)
  })
})

describe('the BASIC computer', () => {
  const find = (c: ReturnType<typeof basic6502>, type: string) => Object.values(c.comps).find((p) => p.type === type)!.id
  function boot() {
    const c = basic6502()
    const sim = new Simulator()
    sim.load(flatten(c))
    sim.setHistory(c.history !== false)
    sim.settle()
    const term = find(c, 'acia6551')
    const st = () => sim.state(term) as AciaState
    const run = (until: () => boolean, max = 3_000_000) => {
      for (let n = 0; n < max && !until(); n++) oneCycle(sim)
      return until()
    }
    const idle = (n = 3000) => {
      for (let i = 0; i < n; i++) oneCycle(sim)
    }
    return { c, sim, term, st, run, idle, screen: () => screenText(st()) }
  }
  /** Type a line and run until BASIC prints OK after it again. */
  const enter = (m: ReturnType<typeof boot>, text: string, max = 3_000_000) => {
    const before = (m.screen().match(/OK/g) ?? []).length
    aciaType(m.st(), text + '\r')
    return m.run(() => (m.screen().match(/OK/g) ?? []).length > before, max)
  }

  it('is the board of B5 with the BASIC ROM, a 1 MHz clock and no step-back history', () => {
    const c = basic6502()
    expect(c.history).toBe(false)
    expect(c.comps[find(c, 'clock')].params.hz).toBe(1_000_000)
    expect(String(c.comps[find(c, 'rom')].params.data).split(' ')).toHaveLength(16384)
    expect(Object.values(c.comps).filter((p) => p.type === 'switch')).toHaveLength(1)
    expect(deserialize(JSON.parse(JSON.stringify(serialize(c)))).history).toBe(false)
  })

  it('explains itself: every note fits the part (600 characters) and none was dropped for being too long', () => {
    const notes = Object.values(basic6502().comps).filter((p) => p.type === 'note')
    expect(notes).toHaveLength(5)
    for (const n of notes) expect(String(n.params.text).length, String(n.params.text).slice(0, 30)).toBeLessThanOrEqual(600)
    expect(notes.every((n) => n.params.text !== 'Note')).toBe(true)
  })

  it('starts by itself: the memory it has, the banner, and OK', { timeout: 60_000 }, () => {
    const m = boot()
    expect(m.run(() => /OK$/.test(m.screen()))).toBe(true)
    expect(m.screen().trimStart()).toBe('15615 BYTES FREE\n\nSKLOPKO BASIC V1.1\nCOPYRIGHT 1978 MICROSOFT\n\nOK')
  })

  it('adds, and runs a program typed in', { timeout: 120_000 }, () => {
    const m = boot()
    m.run(() => /OK$/.test(m.screen()))
    expect(enter(m, 'PRINT 2+2')).toBe(true)
    expect(m.screen()).toMatch(/PRINT 2\+2\n 4\n\nOK$/)
    for (const line of ['10 FOR I=1 TO 3', '20 PRINT "HELLO";I', '30 NEXT I']) {
      aciaType(m.st(), line + '\r') // a program line is stored, and BASIC does not say OK
      expect(m.run(() => m.st().next >= m.st().keys.length)).toBe(true)
      m.idle(20_000)
    }
    expect(enter(m, 'RUN')).toBe(true)
    expect(m.screen()).toMatch(/HELLO 1\nHELLO 2\nHELLO 3\n\nOK$/)
  })

  it('asks the start-up questions when its switch is on at Reset, and does not when it is off', { timeout: 120_000 }, () => {
    const m = boot()
    m.run(() => /OK$/.test(m.screen()))
    expect(m.screen()).not.toContain('MEMORY SIZE?')
    m.sim.setParams(find(m.c, 'switch'), { on: true })
    m.sim.reset() // a cold start: the screen and the program are gone
    m.sim.settle()
    expect(m.run(() => /MEMORY SIZE\? $/.test(m.screen() + ' '))).toBe(true)
    aciaType(m.st(), '\r')
    expect(m.run(() => /TERMINAL WIDTH\? $/.test(m.screen() + ' '))).toBe(true)
    aciaType(m.st(), '\r')
    expect(m.run(() => /OK$/.test(m.screen()))).toBe(true)
    expect(m.screen()).toContain('15615 BYTES FREE')
  })

  it('runs the programs to type in on the board as it does on the bare core: the table prints its first row within a few seconds of cycles', { timeout: 300_000 }, () => {
    const m = boot()
    m.run(() => /OK$/.test(m.screen()))
    const table = BASIC_PROGRAMS.find((p) => p.id === 'table')!
    aciaType(m.st(), programText(table, false))
    expect(m.run(() => m.st().next >= m.st().keys.length)).toBe(true)
    m.idle(20_000)
    const start = m.screen().length
    aciaType(m.st(), 'RUN\r')
    let cycles = 0
    expect(m.run(() => (cycles++, / {3}9\n/.test(m.screen().slice(start))), 3_000_000)).toBe(true)
    expect(cycles).toBeLessThan(500_000)
    expect(m.screen()).toContain('    1   2   3   4   5   6   7   8   9')
  })

  it('the board’s Reset button restarts BASIC on a blank screen: the old text and what was typed ahead are gone', { timeout: 120_000 }, () => {
    const m = boot()
    m.run(() => /OK$/.test(m.screen()))
    expect(enter(m, 'PRINT 2+2')).toBe(true)
    aciaType(m.st(), 'LEFT OVER') // typed, never read
    m.sim.setState(find(m.c, 'button'), { pressed: true })
    m.idle(40)
    expect(m.screen()).toBe('')
    m.sim.setState(find(m.c, 'button'), { pressed: false })
    expect(m.run(() => /OK$/.test(m.screen()))).toBe(true)
    expect(m.screen().trimStart()).toBe('15615 BYTES FREE\n\nSKLOPKO BASIC V1.1\nCOPYRIGHT 1978 MICROSOFT\n\nOK')
  })

  it('left running keeps its memory flat: the screen and the keyboard buffer are bounded', { timeout: 300_000 }, () => {
    const m = boot()
    m.run(() => /OK$/.test(m.screen()))
    aciaType(m.st(), '10 PRINT "X";:GOTO 10\rRUN\r')
    m.idle(300_000)
    expect(m.screen()).toContain('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX') // a whole line of them: it is running
    const lines = m.st().lines.length
    const history = (m.sim as unknown as { history: unknown[] }).history.length
    m.idle(300_000)
    expect(m.st().lines.length).toBeLessThanOrEqual(200)
    expect(m.st().lines.length).toBeGreaterThanOrEqual(lines - 1)
    expect((m.sim as unknown as { history: unknown[] }).history.length).toBe(history)
    expect(history).toBe(0)
  })
})
