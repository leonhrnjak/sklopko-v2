import { frameAround, note } from './annotate'
import { CircuitBuilder } from './builder'
import { boundsRect, type Circuit } from './circuit'

/**
 * A 6502 on a board, in the style of Ben Eater's breadboard computer: the CPU, a ROM with the program, a RAM, a register that
 * drives eight LEDs, and the few gates that decide which of them the address on the bus is talking to.
 *
 *     $0000–$3FFF  RAM (2 KB, repeated)          $4000–$7FFF  the LED register (write only)
 *     $8000–$FFFF  ROM (4 KB, repeated)          the CPU starts at the address stored in $FFFC–$FFFD
 *
 * The data bus is split in two (`D` out of the CPU, `DI` into it): a multiplexer picks what the CPU reads, RAM or ROM.
 */

export const ROM_BASE = 0xf000
export const ROM_SIZE = 0x1000

/** The ROM's 4096 bytes as hex text, with `bytes` placed from `$F000` and the reset vector pointing at `start`. */
export function romImage(bytes: number[], start = ROM_BASE): string {
  const image = new Array<number>(ROM_SIZE).fill(0)
  bytes.forEach((b, i) => (image[i] = b))
  image[0xffc - 0x000] = start & 255
  image[0xffd - 0x000] = start >> 8
  return image.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
}

/**
 * One LED lit, moving left, over and over, as it is written in the ROM's inspector (`BLINK_BYTES` is what it assembles to):
 *
 *     F000  A9 01       LDA #$01     the pattern: one bit set
 *     F002  8D 00 40    STA $4000    show it on the LEDs
 *     F005  0A          ASL A        shift it left; the bit falls off the end after the eighth step
 *     F006  D0 FA       BNE $F002    not zero yet: show the next position
 *     F008  4C 00 F0    JMP $F000    start again
 */
export const BLINK_SOURCE = `.org $F000
start:  LDA #$01    ; one bit set
show:   STA $4000   ; show it on the LEDs
        ASL A       ; shift it left
        BNE show    ; until the bit falls off the end
        JMP start   ; then begin again
.org $FFFC
.word start`


export const BLINK_BYTES = [0xa9, 0x01, 0x8d, 0x00, 0x40, 0x0a, 0xd0, 0xfa, 0x4c, 0x00, 0xf0]

export interface Board6502Options {
  /** Clock speed in Hz. */
  hz?: number
  /** The ROM's contents as hex text (`romImage`). */
  rom?: string
}

/** The board's parts and wires, and the id of each named part. */
export function board6502Builder(o: Board6502Options = {}) {
  const b = new CircuitBuilder()
  const keys: Record<string, string> = {}
  const cols: Record<number, number> = {}
  const part = (col: number, key: string, type: string, opts: Parameters<CircuitBuilder['add']>[3] = {}, gap = 40) => {
    const y = (cols[col] ??= 0)
    const id = b.add(type, col, y, opts)
    cols[col] = y + boundsRect(b.c.comps[id]).h + gap + (opts.label ? 20 : 0)
    return (keys[key] = id)
  }
  const links: { from: string; to: string; name?: string }[] = []
  const wire = (from: string, to: string, name?: string) => links.push({ from, to, name })

  const POWER = 0
  const CPU = 300
  const DECODE = 760
  const MEMORY = 1300
  const OUTPUT = 1800

  // The clock and the reset button. RES is active low, so the button goes through an inverter: idle = 1, pressed = 0.
  const clk = part(POWER, 'clk', 'clock', { params: { hz: o.hz ?? 4 }, label: 'Clock (Φ2)' })
  const reset = part(POWER, 'reset', 'button', { label: 'Reset' })
  const nreset = part(POWER, 'nreset', 'not', { label: 'RES is low while pressed' })
  wire(`${reset}.Q`, `${nreset}.A`)

  // The CPU. In bus mode its address, data out and data in are three bus pins.
  const cpu = part(CPU, 'cpu', 'cpu6502', { params: { bus: true }, label: 'CPU' })
  wire(`${clk}.Q`, `${cpu}.PHI2`)
  wire(`${nreset}.Y`, `${cpu}.RESB`)

  // Address decoding: the address bus is cut into the low 11 bits (inside a RAM) and A11–A15, one wire each.
  const split = part(DECODE, 'split', 'splitter', { params: { bits: 16, split: '11,1,1,1,1,1' }, label: 'address: A0–A10, A11, A12, A13, A14, A15' })
  wire(`${cpu}.A`, `${split}.A`)
  const nrw = part(DECODE, 'nrw', 'not', { label: 'writing' })
  wire(`${cpu}.RWB`, `${nrw}.A`)
  const ramSel = part(DECODE, 'ramSel', 'nor', { label: 'RAM: A15 = 0, A14 = 0' })
  wire(`${split}.Y5`, `${ramSel}.A`)
  wire(`${split}.Y4`, `${ramSel}.B`)
  const ramWe = part(DECODE, 'ramWe', 'and', { label: 'write RAM' })
  wire(`${ramSel}.Y`, `${ramWe}.A`)
  wire(`${nrw}.Y`, `${ramWe}.B`)
  const nA15 = part(DECODE, 'nA15', 'not', { label: 'A15 = 0' })
  wire(`${split}.Y5`, `${nA15}.A`)
  const ledWe = part(DECODE, 'ledWe', 'and', { params: { inputs: 3 }, label: 'LEDs: A15 = 0, A14 = 1, writing' })
  wire(`${nA15}.Y`, `${ledWe}.A`)
  wire(`${split}.Y4`, `${ledWe}.B`)
  wire(`${nrw}.Y`, `${ledWe}.C`)

  // Memory.
  const rom = part(MEMORY, 'rom', 'rom', { params: { bus: true, abits: 12, dbits: 8, data: o.rom ?? romImage(BLINK_BYTES), ...(o.rom ? {} : { isa: '6502', source: BLINK_SOURCE }) }, label: 'ROM $F000–$FFFF' })
  const romAddr = part(MEMORY, 'romAddr', 'merger', { params: { bits: 12, split: '11,1' }, label: 'A0–A11' })
  wire(`${split}.Y0`, `${romAddr}.A0`)
  wire(`${split}.Y1`, `${romAddr}.A1`)
  wire(`${romAddr}.Y`, `${rom}.A`)
  const ram = part(MEMORY, 'ram', 'ram', { params: { bus: true, dbits: 8, abits: 11 }, label: 'RAM $0000–$07FF' })
  wire(`${split}.Y0`, `${ram}.A`)
  wire(`${cpu}.D`, `${ram}.D`)
  wire(`${ramWe}.Y`, `${ram}.WE`)
  wire(`${clk}.Q`, `${ram}.CLK`)
  // What the CPU reads: the ROM when A15 = 1, otherwise the RAM.
  const mux = part(MEMORY, 'mux', 'busmux', { params: { bits: 8, n: 2 }, label: 'what the CPU reads' })
  wire(`${ram}.Q`, `${mux}.I0`)
  wire(`${rom}.D`, `${mux}.I1`)
  wire(`${split}.Y5`, `${mux}.S0`)
  wire(`${mux}.Y`, `${cpu}.DI`)

  // Output: a register that takes what the CPU writes to $4000, and eight LEDs.
  const leds = part(OUTPUT, 'leds', 'busreg', { params: { bits: 8 }, label: 'LED register $4000' })
  wire(`${cpu}.D`, `${leds}.D`)
  wire(`${ledWe}.Y`, `${leds}.LD`)
  wire(`${clk}.Q`, `${leds}.CLK`)
  const bar = part(OUTPUT, 'bar', 'bar', { params: { bus: true, n: 8 }, label: 'LEDs' })
  wire(`${leds}.Q`, `${bar}.I`)
  const addr = part(OUTPUT, 'addr', 'busdisp', { params: { bits: 16 }, label: 'Address bus' })
  wire(`${cpu}.A`, `${addr}.A`)
  const data = part(OUTPUT, 'data', 'busdisp', { params: { bits: 8 }, label: 'Data the CPU reads' })
  wire(`${mux}.Y`, `${data}.A`)
  const sync = part(OUTPUT, 'sync', 'led', { params: { color: 'green' }, label: 'SYNC: fetching an instruction' })
  wire(`${cpu}.SYNC`, `${sync}.A`)
  const write = part(OUTPUT, 'write', 'led', { params: { color: 'red' }, label: 'Writing (R/W = 0)' })
  wire(`${nrw}.Y`, `${write}.A`)

  const sent = new Map<string, boolean>()
  for (const l of links) {
    if (!l.name) {
      b.wire(l.from, l.to)
      continue
    }
    if (!sent.has(l.name)) sent.set(l.name, b.tap(l.from, l.name) !== undefined)
    if (sent.get(l.name) && b.tag(l.to, l.name)) continue
    b.wire(l.from, l.to)
  }
  return { b, keys }
}

/** The board as an example: a 6502 blinking eight LEDs from the program in its ROM. */
export function board6502(): Circuit {
  const { b, keys } = board6502Builder()
  const ids = (...parts: string[]) => parts.map((k) => keys[k])
  frameAround(b, 'THE CPU: a real MOS 6502', ids('clk', 'reset', 'nreset', 'cpu'), 'blue')
  frameAround(b, 'ADDRESS DECODING: who is it talking to?', ids('split', 'nrw', 'ramSel', 'ramWe', 'nA15', 'ledWe'), 'yellow')
  frameAround(b, 'MEMORY: ROM and RAM', ids('rom', 'romAddr', 'ram', 'mux'), 'green')
  frameAround(b, 'OUTPUT', ids('leds', 'bar', 'addr', 'data', 'sync', 'write'), 'pink')
  note(
    b,
    0,
    -420,
    'A real processor, the MOS 6502 of the Apple II and the Commodore 64, on a board of its own. Unlike the computers built from gates, it is one part: you see only what its pins do. In every clock cycle it puts an address on the address bus, says whether it is reading or writing, and moves one byte. Press Clock step and watch the address bus, SYNC and the data it reads. The program in the ROM shows one lit LED moving left.',
    60,
  )
  note(
    b,
    300,
    -230,
    'The CPU has no memory of its own program: after RES goes high it reads the two bytes at $FFFC and $FFFD, jumps to that address, and fetches the instruction there (SYNC lights while it fetches). Select it to see its registers. Press Reset to start it again.',
    38,
    'blue',
  )
  note(
    b,
    760,
    -230,
    'The address bus has 16 wires. A15 and A14 say which chip is meant: 00 is the RAM, 01 is the LED register, 1x is the ROM. The CPU says it is writing with R/W = 0; only then do the RAM and the LED register take the data on the bus.',
    38,
    'yellow',
  )
  note(
    b,
    1300,
    -230,
    'The ROM holds the program, with the start address at its very top ($FFFC). The RAM is where the CPU keeps its data, and its stack. A multiplexer chooses whether the CPU reads the RAM or the ROM.',
    38,
    'green',
  )
  return b.build()
}
