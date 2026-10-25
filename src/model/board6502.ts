import { assemble6502 } from '../engine/asm6502'
import { frameAround, note } from './annotate'
import { CircuitBuilder } from './builder'
import type { Params } from '../engine/types'
import { boundsRect, type Circuit } from './circuit'

/**
 * A 6502 on a board, in the style of Ben Eater's breadboard computer: the CPU, a ROM with the program, a RAM, a register that
 * drives eight LEDs, and the few gates that decide which of them the address on the bus is talking to.
 *
 *     $0000–$3FFF  RAM (2 KB, repeated)          $4000–$7FFF  the LED register (write only)
 *     $8000–$FFFF  ROM (4 KB, repeated)          the CPU starts at the address stored in $FFFC–$FFFD
 *
 * With `memory: 'big'` the same map holds a RAM of 16 KB (all of $0000–$3FFF) and a ROM of 16 KB (seen at $8000 and again at $C000).
 * With the `terminal` device (Ben Eater's map) the block $4000–$7FFF is the terminal's four registers, $5000–$5003 and repeated:
 * A14 selects the chip, A15 deselects it, and A0 and A1 pick the register.
 *
 * The data bus is split in two (`D` out of the CPU, `DI` into it): a multiplexer picks what the CPU reads, RAM or ROM.
 */

export const ROM_BASE = 0xf000
export const ROM_SIZE = 0x1000
/** The big ROM: 16 KB, its image is read from `$C000` (`$8000` shows the same bytes). */
export const BIG_ROM_BASE = 0xc000
export const BIG_ROM_SIZE = 0x4000

/** The sizes of a board's memory: address bits and the ROM image's size and first address. */
const memoryOf = (m: 'small' | 'big' | undefined) =>
  m === 'big' ? { ramBits: 14, romBits: 14, romSize: BIG_ROM_SIZE, romBase: BIG_ROM_BASE } : { ramBits: 11, romBits: 12, romSize: ROM_SIZE, romBase: ROM_BASE }

/**
 * The ROM's bytes as hex text, with `bytes` placed from the first address of the image (`$F000` for the 4 KB ROM, `$C000` for the
 * 16 KB one, which `size` says) and the reset vector pointing at `start`.
 */
export function romImage(bytes: number[], start = 0x10000 - ROM_SIZE, size = ROM_SIZE): string {
  const image = new Array<number>(size).fill(0)
  bytes.forEach((b, i) => (image[i] = b))
  image[size - 4] = start & 255
  image[size - 3] = start >> 8
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

/** What can be on the board, at its memory-mapped addresses (see `programs6502.ts`). */
export type Device6502 = 'leds' | 'console' | 'speaker' | 'keypad' | 'gamepad' | 'screen' | 'terminal'

export interface Board6502Options {
  /** Clock speed in Hz. */
  hz?: number
  /** The ROM's contents as hex text (`romImage`). */
  rom?: string
  /** The program in 6502 assembly, assembled into the ROM (the blink program if neither this nor `rom` is given). */
  source?: string
  /** `'small'` (the default): RAM 2 KB, ROM 4 KB. `'big'`: RAM 16 KB at `$0000`, ROM 16 KB at `$8000`, as on Ben Eater's computer. */
  memory?: 'small' | 'big'
  /** The devices on the board; only the LEDs if not given. The terminal needs `memory: 'big'` and is the only device then. */
  devices?: Device6502[]
  /** With the terminal: its IRQ pin goes to the CPU's (a typed character interrupts it). */
  interrupt?: boolean
  /** With the terminal: a switch on its DSR pin (status bit 6), a setting a program can read; the BASIC computer asks its start-up questions when it is on. */
  dsrSwitch?: { label: string; on?: boolean }
  /** The chip: the NMOS 6502 (the default) or the WDC 65C02. The program is assembled for it. */
  chip?: 'nmos' | 'cmos'
  /** A timer that interrupts the CPU (NMI) this many times a second. */
  timer?: number
  /** Probes on the clock, the address bus, the data it reads, R/W and SYNC, ready for the timing view and the waveform panel. */
  probes?: boolean
}

/** The ROM's parameters for a program: its source, and the bytes that assembles to. */
function programParams(o: Board6502Options): Params {
  if (o.rom) return { data: o.rom }
  // (The blink program begins at $F000; in the 16 KB ROM the image begins at $C000.)
  const source = o.source ?? (o.memory === 'big' ? BLINK_SOURCE.replace('.org $F000', '.org $C000') : BLINK_SOURCE)
  const cmos = o.chip === 'cmos'
  const { romSize, romBase } = memoryOf(o.memory)
  const r = assemble6502(source, romSize, cmos)
  if (r.errors.length) throw new Error(`The program does not assemble: line ${r.errors[0].line}: ${r.errors[0].message}`)
  // The image is the ROM from its first address on, so a program must begin there (the first .org).
  if (r.base !== romBase) throw new Error(`The program starts at $${r.base.toString(16).toUpperCase()}, but this board's ROM image begins at $${romBase.toString(16).toUpperCase()}.`)
  return { isa: cmos ? '65c02' : '6502', source, data: r.bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ') }
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
  const mem = memoryOf(o.memory)
  const big = o.memory === 'big'
  const has = new Set(o.devices ?? ['leds'])
  const term = has.has('terminal')
  if (term && !(big && has.size === 1)) throw new Error("The terminal needs memory: 'big' and is the only device on its board.")
  const simple = has.size === 1 && has.has('leds') // the first board: the LED register answers to the whole block
  const links: { from: string; to: string; name?: string }[] = []
  const wire = (from: string, to: string, name?: string) => links.push({ from, to, name })

  const POWER = 0
  const CPU = 300
  const DECODE = 760
  const MEMORY = 1300
  const OUTPUT = 1800
  const INPUT = 2800
  const DISPLAY = 2300

  // The clock and the reset button. RES is active low, so the button goes through an inverter: idle = 1, pressed = 0.
  const clk = part(POWER, 'clk', 'clock', { params: { hz: o.hz ?? 4 }, label: 'Clock (Φ2)' })
  const reset = part(POWER, 'reset', 'button', { label: 'Reset' })
  const nreset = part(POWER, 'nreset', 'not', { label: 'RES is low while pressed' })
  wire(`${reset}.Q`, `${nreset}.A`)

  // The CPU. In bus mode its address, data out and data in are three bus pins.
  const cpu = part(CPU, 'cpu', 'cpu6502', { params: { bus: true, ...(o.chip === 'cmos' ? { chip: 'cmos' } : {}) }, label: o.chip === 'cmos' ? 'CPU (65C02)' : 'CPU' })
  wire(`${clk}.Q`, `${cpu}.PHI2`)
  wire(`${nreset}.Y`, `${cpu}.RESB`)
  // A timer for interrupts: NMI is active low and a falling edge counts, so the line rests high and drops when the timer rises.
  if (o.timer) {
    const timer = part(POWER, 'timer', 'clock', { params: { hz: o.timer }, label: 'Timer (interrupts the CPU)' })
    const ntimer = part(POWER, 'ntimer', 'not', { label: 'NMI is low at a tick' })
    wire(`${timer}.Q`, `${ntimer}.A`)
    wire(`${ntimer}.Y`, `${cpu}.NMIB`)
  }

  // Address decoding: the address bus is cut into the low bits (inside the RAM and the ROM) and the top wires, one each: A14 and
  // A15 say which chip is meant. The small board also splits A11–A13 off, for the ROM's smaller size.
  const split = part(DECODE, 'split', 'splitter', big
    ? { params: { bits: 16, split: '14,1,1' }, label: 'address: A0–A13, A14, A15' }
    : { params: { bits: 16, split: '11,1,1,1,1,1' }, label: 'address: A0–A10, A11, A12, A13, A14, A15' })
  wire(`${cpu}.A`, `${split}.A`)
  const a14 = `${split}.${big ? 'Y1' : 'Y4'}`
  const a15 = `${split}.${big ? 'Y2' : 'Y5'}`
  const nrw = part(DECODE, 'nrw', 'not', { label: 'writing' })
  wire(`${cpu}.RWB`, `${nrw}.A`)
  const ramSel = part(DECODE, 'ramSel', 'nor', { label: 'RAM: A15 = 0, A14 = 0' })
  wire(a15, `${ramSel}.A`)
  wire(a14, `${ramSel}.B`)
  const ramWe = part(DECODE, 'ramWe', 'and', { label: 'write RAM' })
  wire(`${ramSel}.Y`, `${ramWe}.A`)
  wire(`${nrw}.Y`, `${ramWe}.B`)
  // The terminal looks at the address wires itself (A14 and A15 are its chip selects), so it needs no strobe.
  let ledWe = ''
  if (!term) {
    const nA15 = part(DECODE, 'nA15', 'not', { label: 'A15 = 0' })
    wire(a15, `${nA15}.A`)
    ledWe = part(DECODE, 'ledWe', 'and', { params: { inputs: 3 }, label: simple ? 'LEDs: A15 = 0, A14 = 1, writing' : 'devices: A15 = 0, A14 = 1, writing' })
    wire(`${nA15}.Y`, `${ledWe}.A`)
    wire(a14, `${ledWe}.B`)
    wire(`${nrw}.Y`, `${ledWe}.C`)
  }
  // With several devices the low three address bits say which register is meant: a decoder turns them into one strobe each.
  let lowSplit = ''
  let strobe: (n: number) => string = () => `${ledWe}.Y`
  if (term) {
    lowSplit = part(DECODE, 'lowSplit', 'splitter', { params: { bits: 16, split: '1,1,14' }, label: 'address: A0, A1, the rest' })
    wire(`${cpu}.A`, `${lowSplit}.A`)
  } else if (!simple) {
    lowSplit = part(DECODE, 'lowSplit', 'splitter', { params: { bits: 16, split: '1,1,1,13' }, label: 'address: A0, A1, A2, the rest' })
    wire(`${cpu}.A`, `${lowSplit}.A`)
    const dec = part(DECODE, 'dec', 'decoder', { params: { n: 3 }, label: 'which register: A0–A2' })
    wire(`${lowSplit}.Y0`, `${dec}.A0`)
    wire(`${lowSplit}.Y1`, `${dec}.A1`)
    wire(`${lowSplit}.Y2`, `${dec}.A2`)
    wire(`${ledWe}.Y`, `${dec}.EN`)
    strobe = (n) => `${dec}.Y${n}`
  }

  // Memory.
  const rom = part(MEMORY, 'rom', 'rom', {
    params: { bus: true, abits: mem.romBits, dbits: 8, ...programParams(o) },
    label: big ? 'ROM $8000–$FFFF (16 KB, twice)' : 'ROM $F000–$FFFF',
  })
  if (big) wire(`${split}.Y0`, `${rom}.A`) // A0–A13 straight in: A14 is not looked at, so the ROM shows twice
  else {
    const romAddr = part(MEMORY, 'romAddr', 'merger', { params: { bits: 12, split: '11,1' }, label: 'A0–A11' })
    wire(`${split}.Y0`, `${romAddr}.A0`)
    wire(`${split}.Y1`, `${romAddr}.A1`)
    wire(`${romAddr}.Y`, `${rom}.A`)
  }
  const ram = part(MEMORY, 'ram', 'ram', { params: { bus: true, dbits: 8, abits: mem.ramBits }, label: big ? 'RAM $0000–$3FFF (16 KB)' : 'RAM $0000–$07FF' })
  wire(`${split}.Y0`, `${ram}.A`)
  wire(`${cpu}.D`, `${ram}.D`)
  wire(`${ramWe}.Y`, `${ram}.WE`)
  wire(`${clk}.Q`, `${ram}.CLK`)
  // What the CPU reads: the ROM when A15 = 1, otherwise the RAM; with devices to read, the block $4000–$7FFF is theirs.
  const readable = has.has('keypad') || has.has('gamepad') || term
  const mux = part(MEMORY, 'mux', 'busmux', { params: { bits: 8, n: readable ? 4 : 2 }, label: 'what the CPU reads' })
  wire(`${ram}.Q`, `${mux}.I0`)
  wire(`${rom}.D`, `${mux}.I1`)
  if (readable) {
    // Four inputs take a two-bit select, A15 and A14 put together.
    const sel = part(MEMORY, 'sel', 'merger', { params: { bits: 2, split: '1,1' }, label: 'A15, A14' })
    wire(a15, `${sel}.A0`)
    wire(a14, `${sel}.A1`)
    wire(`${sel}.Y`, `${mux}.S`)
    wire(`${rom}.D`, `${mux}.I3`) // A15 = 1 is the ROM, whatever A14 says
  } else wire(a15, `${mux}.S0`)
  wire(`${mux}.Y`, `${cpu}.DI`)

  // Devices. Each has a register at an address of the block $4000–$7FFF: a write is a strobe from the decoder on the rising clock edge.
  const shown: string[] = []
  const dev = (col: number, key: string, type: string, opts: Parameters<CircuitBuilder['add']>[3] = {}) => {
    shown.push(key)
    return part(col, key, type, opts)
  }
  if (term) {
    const t = dev(DISPLAY, 'terminal', 'acia6551', { params: { bus: true }, label: 'Terminal (6551) $5000–$5003' })
    wire(`${clk}.Q`, `${t}.PHI2`)
    wire(`${nreset}.Y`, `${t}.RESB`)
    wire(a14, `${t}.CS0`)
    wire(a15, `${t}.CS1B`)
    wire(`${lowSplit}.Y0`, `${t}.RS0`)
    wire(`${lowSplit}.Y1`, `${t}.RS1`)
    wire(`${cpu}.RWB`, `${t}.RWB`)
    wire(`${cpu}.D`, `${t}.DI`)
    if (o.interrupt) wire(`${t}.IRQB`, `${cpu}.IRQB`)
    if (o.dsrSwitch) {
      const sw = dev(INPUT, 'dsrSwitch', 'switch', { params: { on: !!o.dsrSwitch.on }, label: o.dsrSwitch.label })
      wire(`${sw}.Q`, `${t}.DSRB`)
    }
    wire(`${t}.D`, `${mux}.I2`)
  }
  if (has.has('leds')) {
    const leds = dev(OUTPUT, 'leds', 'busreg', { params: { bits: 8 }, label: simple ? 'LED register $4000' : 'LED register $4000 (LEDS)' })
    wire(`${cpu}.D`, `${leds}.D`)
    wire(strobe(0), `${leds}.LD`)
    wire(`${clk}.Q`, `${leds}.CLK`)
    const bar = dev(OUTPUT, 'bar', 'bar', { params: { bus: true, n: 8 }, label: 'LEDs' })
    wire(`${leds}.Q`, `${bar}.I`)
  }
  if (has.has('console')) {
    const con = dev(DISPLAY, 'console', 'console', { params: { bus: true }, label: 'Console $4001: prints what is written' })
    wire(`${cpu}.D`, `${con}.D`)
    wire(strobe(1), `${con}.WE`)
    wire(`${clk}.Q`, `${con}.CLK`)
  }
  if (has.has('speaker')) {
    const reg = dev(OUTPUT, 'spkReg', 'busreg', { params: { bits: 8 }, label: 'Speaker register $4002' })
    wire(`${cpu}.D`, `${reg}.D`)
    wire(strobe(2), `${reg}.LD`)
    wire(`${clk}.Q`, `${reg}.CLK`)
    const bit = dev(OUTPUT, 'spkBit', 'splitter', { params: { bits: 8, split: '1,7' }, label: 'bit 0 is the speaker' })
    wire(`${reg}.Q`, `${bit}.A`)
    const spk = dev(OUTPUT, 'speaker', 'speaker', { label: 'Speaker' })
    wire(`${bit}.Y0`, `${spk}.A`)
  }
  if (has.has('screen')) {
    const xy = dev(OUTPUT, 'xyReg', 'busreg', { params: { bits: 8 }, label: 'Pixel place $4005: x 0–3, y 4–7' })
    wire(`${cpu}.D`, `${xy}.D`)
    wire(strobe(5), `${xy}.LD`)
    wire(`${clk}.Q`, `${xy}.CLK`)
    const xySplit = dev(OUTPUT, 'xySplit', 'splitter', { params: { bits: 8, split: '4,4' }, label: 'x, y' })
    wire(`${xy}.Q`, `${xySplit}.A`)
    const dBit = dev(OUTPUT, 'dBit', 'splitter', { params: { bits: 8, split: '1,7' }, label: 'bit 0 of the data' })
    wire(`${cpu}.D`, `${dBit}.A`)
    const fb = dev(DISPLAY, 'screen', 'framebuffer', { params: { bus: true, colors: 2 }, label: 'Screen $4006: sets or clears the pixel' })
    wire(`${xySplit}.Y0`, `${fb}.X`)
    wire(`${xySplit}.Y1`, `${fb}.Y`)
    wire(`${dBit}.Y0`, `${fb}.D`)
    wire(strobe(6), `${fb}.WE`)
    wire(`${clk}.Q`, `${fb}.CLK`)
  }
  // What the CPU reads from the devices: the keypad (A2 = 0, $4003) or the gamepad (A2 = 1, $4004), eight bits each.
  const zeros = (key: string, bits: number) => `${dev(INPUT, key, 'busconst', { params: { bits, value: '0' }, label: 'zeros' })}.Q`
  let keyBus = ''
  let padBus = ''
  if (has.has('keypad')) {
    const kp = dev(INPUT, 'keypad', 'keypad', { params: { bus: true, sticky: true }, label: 'Keypad $4003 (write: it was read)' })
    wire(strobe(3), `${kp}.RST`)
    const m = dev(INPUT, 'keyBus', 'merger', { params: { bits: 8, split: '4,1,3' }, label: 'KEY: code in 0–3, press waiting in 4' })
    wire(`${kp}.K`, `${m}.A0`)
    wire(`${kp}.P`, `${m}.A1`)
    wire(zeros('keyZeros', 3), `${m}.A2`)
    keyBus = `${m}.Y`
  }
  if (has.has('gamepad')) {
    const pad = dev(INPUT, 'gamepad', 'gamepad', { params: { bus: true }, label: 'Gamepad: read $4004' })
    const m = dev(INPUT, 'padBus', 'merger', { params: { bits: 8, split: '6,2' }, label: 'PAD: U D L R A B in bits 0–5' })
    wire(`${pad}.BTN`, `${m}.A0`)
    wire(zeros('padZeros', 2), `${m}.A1`)
    padBus = `${m}.Y`
  }
  if (readable && !term) {
    let bus = keyBus || padBus
    if (keyBus && padBus) {
      const pick = dev(INPUT, 'devRead', 'busmux', { params: { bits: 8, n: 2 }, label: 'keypad or gamepad: A2' })
      wire(keyBus, `${pick}.I0`)
      wire(padBus, `${pick}.I1`)
      wire(`${lowSplit}.Y2`, `${pick}.S0`)
      bus = `${pick}.Y`
    }
    wire(bus, `${mux}.I2`)
  }
  const addr = dev(OUTPUT, 'addr', 'busdisp', { params: { bits: 16 }, label: 'Address bus' })
  wire(`${cpu}.A`, `${addr}.A`)
  const data = dev(OUTPUT, 'data', 'busdisp', { params: { bits: 8 }, label: 'Data the CPU reads' })
  wire(`${mux}.Y`, `${data}.A`)
  const sync = dev(OUTPUT, 'sync', 'led', { params: { color: 'green' }, label: 'SYNC: fetching an instruction' })
  wire(`${cpu}.SYNC`, `${sync}.A`)
  const write = dev(OUTPUT, 'write', 'led', { params: { color: 'red' }, label: 'Writing (R/W = 0)' })
  wire(`${nrw}.Y`, `${write}.A`)

  // Probes, under the clock: the signals of one cycle, for the timing view and the waveform panel.
  const timing: string[] = []
  if (o.probes) {
    const probe = (key: string, label: string, from: string, bits = 1) => {
      const id = part(POWER, key, 'probe', { label, ...(bits > 1 ? { params: { bits } } : {}) }, 20)
      timing.push(key)
      wire(from, `${id}.A`)
    }
    probe('pPhi2', 'Φ2', `${clk}.Q`)
    probe('pAddr', 'A', `${cpu}.A`, 16)
    probe('pData', 'D (read)', `${mux}.Y`, 8)
    probe('pRw', 'R/W', `${cpu}.RWB`)
    probe('pSync', 'SYNC', `${cpu}.SYNC`)
  }

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
  return { b, keys, shown, timing }
}

/** What a board example says about itself: the text over the CPU's, the decoder's and the devices' frames. */
export interface BoardTexts {
  intro: string
  /** About the memory (a note over its frame); the default describes the program ROM and the RAM of the small boards. */
  memory?: string
  /** About the address decoding (a note over its frame); the default depends on the devices. */
  decode?: string
  /** About the devices (a note over their frame); the first board has none. */
  devices?: string
}

const CPU_NOTE = 'The CPU has no memory of its own program: after RES goes high it reads the two bytes at $FFFC and $FFFD, jumps to that address, and fetches the instruction there (SYNC lights while it fetches). Select it to see its registers. Press Reset to start it again.'
const DECODE_NOTE = 'The address bus has 16 wires. A15 and A14 say which chip is meant: 00 is the RAM, 01 is the LED register, 1x is the ROM. The CPU says it is writing with R/W = 0; only then do the RAM and the LED register take the data on the bus.'
const DEVICE_DECODE_NOTE =
  'The address bus has 16 wires. A15 and A14 say which chip is meant: 00 is the RAM, 01 is the block of devices, 1x is the ROM. In the block of devices A0, A1 and A2 pick one of eight registers (the other address wires are ignored, so the block repeats). The CPU says it is writing with R/W = 0; only then does the RAM or a device take the data on the bus.'
const MEMORY_NOTE = 'The ROM holds the program, with the start address at its very top ($FFFC). The RAM is where the CPU keeps its data, and its stack. A multiplexer chooses whether the CPU reads the RAM or the ROM.'

/** A board as an example: the parts of `board6502Builder`, framed and explained. */
export function boardExample(o: Board6502Options, t: BoardTexts): Circuit {
  const { b, keys, shown, timing } = board6502Builder(o)
  const ids = (...parts: string[]) => parts.filter((k) => keys[k]).map((k) => keys[k])
  const simple = (o.devices ?? ['leds']).length === 1 && (o.devices ?? ['leds'])[0] === 'leds'
  frameAround(b, 'THE CPU: a real MOS 6502', ids('clk', 'reset', 'nreset', 'timer', 'ntimer', 'cpu', ...timing), 'blue')
  frameAround(b, 'ADDRESS DECODING: who is it talking to?', ids('split', 'nrw', 'ramSel', 'ramWe', 'nA15', 'ledWe', 'lowSplit', 'dec'), 'yellow')
  frameAround(b, 'MEMORY: ROM and RAM', ids('rom', 'romAddr', 'ram', 'mux', 'sel'), 'green')
  frameAround(b, simple ? 'OUTPUT' : 'DEVICES', ids(...shown), 'pink')
  note(b, 0, -420, t.intro, 60)
  note(b, 300, -230, CPU_NOTE, 38, 'blue')
  note(b, 760, -230, t.decode ?? (simple ? DECODE_NOTE : DEVICE_DECODE_NOTE), 38, 'yellow')
  note(b, 1300, -230, t.memory ?? MEMORY_NOTE, 38, 'green')
  if (t.devices) note(b, 1800, -230, t.devices, 48, 'pink')
  return b.build()
}

/** The board as an example: a 6502 blinking eight LEDs from the program in its ROM. */
export const board6502 = (): Circuit =>
  boardExample({ probes: true }, {
    intro: 'A real processor, the MOS 6502 of the Apple II and the Commodore 64, on a board of its own. Unlike the computers built from gates, it is one part: you see only what its pins do. In every clock cycle it puts an address on the address bus, says whether it is reading or writing, and moves one byte. Press Clock step and watch the address bus, SYNC and the data it reads. The program in the ROM shows one lit LED moving left.',
  })
