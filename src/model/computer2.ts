import { SKASM, SKASM_OPS, assemble, toHexBytes, toHexWords } from '../engine/isa'
import { SKASM_CONTROL_1, SKASM_CONTROL_2, SKASM_CONTROL_3, SKASM_ROWS, SKASM_SIGNALS_1, SKASM_SIGNALS_2, SKASM_SIGNALS_3 } from '../engine/signal-presets'
import { assembleSignals, parseRows, parseSignals, splitPlan } from '../engine/signals'
import { CircuitBuilder } from './builder'
import { RAYCASTER_SOURCE } from './raycaster'
import { boundsRect, type Circuit } from './circuit'

/**
 * The computer that runs SKASM (see `engine/isa.ts`). It has the devices an example asks for, and only those, reached with
 * `OUT` and `IN` through the ports every computer shares:
 *
 *   console   `OUT CHAR` prints the accumulator as a character
 *   lcd       `OUT PIXEL_ON` lights the pixel at (low nibble, high nibble) of the accumulator, `OUT PIXEL_OFF` darkens it;
 *             `OUT PIXEL_AT` chooses a pixel and `IN PIXEL` reads its shade;
 *             `OUT PIXEL_COLOR` chooses the shade (0 to 3, brightest at first) that PIXEL_ON paints
 *   speaker   `OUT SPEAKER` flips it
 *   keypad    `IN KEY` reads it (the key in bits 0–3, bit 4 set while a press is waiting); `OUT KEY_ACK` says it has been read
 *   gamepad   `IN PAD` reads the buttons held right now, one bit each (up 1, down 2, left 4, right 8, A 16, B 32)
 *   number    `OUT NUMBER` shows the accumulator on a decimal display
 *
 * The data RAM has 256 bytes: an instruction's address field reaches the first 16, the index register X (TAX, LDX, STX...) all of them.
 */

export const ROM_WORDS = 256

// ---- The decimal display -----------------------------------------------------------------------

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')

/** The decimal digits of 16 × n for n = 0–15 (the high nibble's value), as two ROMs: tens and ones, then hundreds. */
const sixteens = Array.from({ length: 16 }, (_, n) => n * 16)
export const SIXTEENS_TENS_ONES = sixteens.map((v) => hex2((Math.floor(v / 10) % 10) * 16 + (v % 10))).join(' ')
export const SIXTEENS_HUNDREDS = sixteens.map((v) => Math.floor(v / 100).toString(16).toUpperCase()).join(' ')

// ---- Control ROMs ------------------------------------------------------------------------------

/**
 * Three ROMs turn an instruction into control signals. All are addressed by 8 bits: the opcode (bits 4–7 of the word)
 * and the sub-opcode (the instruction's bits 0–3 for opcode 14, bits 12–15 for opcode 15, otherwise 0).
 *
 * What the bits are called, and which ones each instruction switches on, is written in words in `engine/signal-presets.ts`
 * (`SKASM_SIGNALS_1` and `SKASM_CONTROL_1`, and the same for ROMs 2 and 3); the words are assembled from that text here. The
 * ROMs, in short: ROM 1 loads the accumulator (from where: the constant, the ALU, RAM, a shift, a port, X or the table), writes
 * RAM, sets the flags, jumps (also on carry or zero), halts, subtracts and picks the logic operation; ROM 2 has the
 * jumps on the other flag states, the port write and the index register X; ROM 3 has CALL and RET.
 */
const ROM_BITS = [16, 8, 8]

/** The words of one control ROM, assembled from its text (an instruction the text does not list is 0). */
function assembleControl(signals: string, control: string, bits: number): number[] {
  const { layout, errors: layoutErrors } = parseSignals(signals)
  const { rows } = parseRows(SKASM_ROWS)
  const r = assembleSignals(layout, rows, control, ROM_WORDS, bits)
  const errors = [...layoutErrors, ...r.errors]
  if (errors.length) throw new Error(`A control ROM does not assemble: ${errors.map((e) => `${e.line}: ${e.message}`).join('; ')}`)
  return r.words
}

/** The three control ROMs as arrays of words, indexed by opcode + 16 × sub-opcode. */
export function controlWords(): { rom1: number[]; rom2: number[]; rom3: number[] } {
  const texts = [SKASM_CONTROL_1, SKASM_CONTROL_2, SKASM_CONTROL_3]
  for (const name of Object.keys(SKASM_OPS))
    if (!texts.some((t) => new RegExp(`^${name}:`, 'm').test(t))) throw new Error(`The control ROMs have no row for ${name}`)
  const [rom1, rom2, rom3] = [SKASM_SIGNALS_1, SKASM_SIGNALS_2, SKASM_SIGNALS_3].map((signals, i) => assembleControl(signals, texts[i], ROM_BITS[i]))
  return { rom1, rom2, rom3 }
}

const hexRom = (words: number[], digits: number) => words.map((w) => w.toString(16).toUpperCase().padStart(digits, '0')).join(' ')
export const CONTROL_1 = hexRom(controlWords().rom1, 4)
export const CONTROL_2 = hexRom(controlWords().rom2, 2)
export const CONTROL_3 = hexRom(controlWords().rom3, 2)

// ---- Programs ----------------------------------------------------------------------------------

/** A ball bounces round the LCD: both directions turn round at the edges. */
export const BALL_SOURCE = `; A ball bounces round the 16x16 screen.
; OUT PIXEL_ON lights the pixel at (x = low nibble, y = high nibble) of the accumulator, OUT PIXEL_OFF darkens it.
; The position is one byte, y*16 + x, so moving right is +1 and moving down is +16.
pos = 0
sx = 1            ; +1 right, -1 left
sy = 2            ; +16 down, -16 up
next = 3

        LDI 0x35
        STA pos
        LDI 1
        STA sx
        LDI 16
        STA sy
        LDA pos
        OUT PIXEL_ON
move:   LDA pos
        ADD sx
        ADD sy
        STA next
        OUT PIXEL_ON    ; light the new pixel before darkening the old one
        LDA pos
        OUT PIXEL_OFF
        LDA next
        STA pos
        SHL
        SHL
        SHL
        SHL             ; x is now in the high nibble
        CMPI 0xF0       ; at the right edge?
        JZ flipx
        CMPI 0          ; at the left edge?
        JZ flipx
ycheck: LDA pos
        SHR
        SHR
        SHR
        SHR             ; y
        CMPI 15         ; at the bottom?
        JZ flipy
        CMPI 0          ; at the top?
        JZ flipy
        JMP move
flipx:  LDI 0
        SUB sx          ; sx = -sx
        STA sx
        JMP ycheck
flipy:  LDI 0
        SUB sy
        STA sy
        JMP move
`

/** A siren: the speaker is flipped over and over with a pause between, and the pause changes. */
export const SIREN_SOURCE = `; A siren. OUT SPEAKER flips the speaker; a note is the speaker flipped 16 times with a pause
; between flips, and the shorter the pause, the higher the note. The notes glide up, then down.
wait = 0          ; the pause: counted down in the loop below
dir = 1           ; added to the pause after each note: -1 higher, +1 lower
left = 2          ; flips left in this note

        LDI 12
        STA wait        ; start low
        LDI -1
        STA dir
note:   LDI 16
        STA left
flip:   OUT SPEAKER      ; flip the speaker
        LDA wait
pause:  SUBI 1
        JNC pause       ; about 2 x wait cycles
        LDA left
        SUBI 1
        STA left
        JZ notedone
        JMP flip
notedone: LDA wait
        ADD dir
        STA wait
        CMPI 1
        JZ top          ; shortest pause: highest note, turn round
        CMPI 12
        JZ bottom
        JMP note
top:    LDI 1
        STA dir
        JMP note
bottom: LDI -1
        STA dir
        JMP note
`

/** A calculator for whole numbers up to 255: + - x and /, with a keypad and a display. */
export const CALC_SOURCE = `; A calculator for whole numbers up to 255. Keys: 0-9, + - x / (codes 10-13), = (14), C (15).
; OUT CHAR prints a character on the display. IN KEY reads the keypad: the key in bits 0-3, and bit 4 set while a key
; is waiting. OUT KEY_ACK tells the keypad that the key has been read.
key = 0
a = 1             ; the number before the operator
cur = 2           ; the number being typed
op = 3            ; 1 +, 2 -, 3 x, 4 /, 0 none yet
t = 4
h = 5             ; hundreds, when printing
u = 6             ; tens, when printing

reset:  LDI 0
        STA a
        STA cur
        STA op
main:   IN KEY
        ANDI 16         ; bit 4 of the keypad word is 1 when a key is waiting
        JZ main
        IN KEY
        SUBI 16         ; the key, 0-15
        STA key
        OUT KEY_ACK
        CMPI 10
        JNC command     ; 10 or more: not a digit

; A digit: cur = cur x 10 + digit, unless the number would no longer fit in 8 bits.
        LDA cur
        CMPI 26
        JNC main        ; 26 x 10 is already too much
        SHL
        STA t           ; 2 x cur
        SHL
        SHL             ; 8 x cur
        ADD t           ; 10 x cur
        ADD key
        JNC fits
        JMP main        ; carry: too big
fits:   STA cur
        LDA key
        ADDI 48         ; digit to character
        OUT CHAR
        JMP main

command: LDA key
        CMPI 10
        JZ plus
        CMPI 11
        JZ minus
        CMPI 12
        JZ times
        CMPI 13
        JZ divide
        CMPI 14
        JZ equals
        CMPI 15
        JZ clear
        JMP main
plus:   LDI 43          ; '+'
        OUT CHAR
        LDI 1
        STA op
        JMP setop
minus:  LDI 45          ; '-'
        OUT CHAR
        LDI 2
        STA op
        JMP setop
times:  LDI 120         ; 'x'
        OUT CHAR
        LDI 3
        STA op
        JMP setop
divide: LDI 47          ; '/'
        OUT CHAR
        LDI 4
        STA op
setop:  LDA cur         ; the number typed so far is the first number
        STA a
        LDI 0
        STA cur
        JMP main

equals: LDI 61          ; '='
        OUT CHAR
        LDA op
        CMPI 1
        JZ doadd
        CMPI 2
        JZ dosub
        CMPI 3
        JZ domul
        CMPI 4
        JZ dodiv
        LDA cur         ; no operator: just the number
        JMP show
doadd:  LDA a
        ADD cur
        JNC show
        JMP error       ; carry: more than 255
dosub:  LDA a
        SUB cur
        JNC show        ; no borrow: not negative
        STA t
        LDI 45          ; '-'
        OUT CHAR
        LDI 0
        SUB t           ; the size of the negative number
        JMP show
domul:  LDI 0
        STA t           ; the total
mloop:  LDA cur         ; add a to the total, cur times
        CMPI 0
        JZ mdone
        SUBI 1
        STA cur
        LDA t
        ADD a
        JNC mok
        JMP error
mok:    STA t
        JMP mloop
mdone:  LDA t
        JMP show
dodiv:  LDA cur
        CMPI 0
        JZ error        ; divide by zero
        LDI 0
        STA t           ; the quotient
dloop:  LDA a           ; subtract cur from a as often as it goes
        SUB cur
        JNC dsub
        LDA t
        JMP show
dsub:   STA a
        LDA t
        ADDI 1
        STA t
        JMP dloop

; Print the accumulator as decimal, without leading zeros: count the hundreds, then the tens.
show:   STA t
        LDI 0
        STA h
        STA u
hloop:  LDA t
        CMPI 100
        JNC hsub
tloop:  LDA t
        CMPI 10
        JNC tsub
        LDA h
        CMPI 0
        JZ nohund
        ADDI 48
        OUT CHAR
        JMP tens        ; after hundreds the tens digit is printed even if it is 0
nohund: LDA u
        CMPI 0
        JZ ones
tens:   LDA u
        ADDI 48
        OUT CHAR
ones:   LDA t
        ADDI 48
        OUT CHAR
        LDI 10          ; new line
        OUT CHAR
        JMP reset
hsub:   SUBI 100
        STA t
        LDA h
        ADDI 1
        STA h
        JMP hloop
tsub:   SUBI 10
        STA t
        LDA u
        ADDI 1
        STA u
        JMP tloop
error:  LDI 69          ; 'E'
        OUT CHAR
        LDI 10
        OUT CHAR
        JMP reset
clear:  LDI 10
        OUT CHAR
        JMP reset
`

const assembled = (source: string) => {
  const r = assemble(SKASM, source, ROM_WORDS)
  if (r.errors.length) throw new Error(`Program does not assemble: ${r.errors.map((e) => `${e.line}: ${e.message}`).join('; ')}`)
  return r
}
export const programWords = (source: string) => toHexWords(assembled(source).words, SKASM.bits)
/** The table of a program (its `.byte` lines) as the hex text of the ROM's `tdata`. */
export const programTable = (source: string) => toHexBytes(assembled(source).table)

// ---- The circuit -------------------------------------------------------------------------------

export type Device = 'lcd' | 'speaker' | 'console' | 'keypad' | 'gamepad' | 'number'

export interface Computer2Options {
  source: string
  /** Clock rate in Hz. */
  hz: number
  /** What is connected, each at its own port (see `SKASM`'s PORTS): any combination. */
  devices: Device[]
  /** Octaves the speaker plays up (a slow circuit makes notes too low to hear). */
  octaves?: number
  /** The keypad's keys. */
  keypad?: 'hex' | 'calc'
  /** Add probes (CLK, PC, ACC and Carry) for the waveform panel. */
  probes?: boolean
}

/** Parts that have a bus mode are placed with it on (the builder otherwise keeps their scalar pins, like an old file). */
const BUS = { bus: true }

/**
 * The computer, and the id of each named part. Parts are stacked in columns, left to right in the order data flows. Data
 * travels on 8-bit buses (PC, ACC, RAM, the instruction's fields); single control bits are ordinary wires.
 */
export function computer2Builder(o: Computer2Options) {
  const has = (d: Device) => o.devices.includes(d)
  const b = new CircuitBuilder()
  const keys: Record<string, string> = {}
  const cols: Record<string, { x: number; y: number }> = {}
  /** Add a part at the next free spot of a column (x position) and remember it under `key`. */
  const part = (col: number, key: string, type: string, opts: Parameters<CircuitBuilder['add']>[3] = {}, gap = 40) => {
    const c = (cols[col] ??= { x: col, y: 0 })
    const id = b.add(type, c.x, c.y, opts)
    c.y += boundsRect(b.c.comps[id]).h + gap + (opts.label ? 20 : 0)
    return (keys[key] = id)
  }
  // The signals that reach many parts (the control bits, the clock, the accumulator, the address field) are sent by name: a
  // Send label at the source and a Receive label at each destination are one wire. Labels are placed last, when every part
  // is in place; a label that has no room is replaced by an ordinary wire.
  const links: { from: string; to: string }[] = []
  const netNames = new Map<string, { name: string; bits: number }>()
  const wire = (from: string, to: string) => {
    links.push({ from, to })
  }
  const named = (pin: string, name: string, bits = 1) => netNames.set(pin, { name, bits })
  const splitter = (col: number, key: string, bits: number, split: number[], label: string, from: string) => {
    const s = part(col, key, 'splitter', { params: { bits, split: split.join(',') }, label }, 20)
    wire(from, `${s}.A`)
    return s
  }
  const merger = (col: number, key: string, bits: number, split: number[], label: string, from: string[]) => {
    const m = part(col, key, 'merger', { params: { bits, split: split.join(',') }, label }, 20)
    from.forEach((f, i) => wire(f, `${m}.A${i}`))
    return `${m}.Y`
  }
  const busconst = (col: number, key: string, bits: number, value: number, label?: string) =>
    `${part(col, key, 'busconst', { params: { bits, value: value.toString(16).toUpperCase() }, ...(label ? { label } : {}) }, 20)}.Q`

  // Columns, left to right.
  const FETCH = 0
  const ROM = 380
  const FIELDS = 760
  const CTL = 1080
  const DECODE = 1440
  const MEM = 1740
  const BSEL = 2060
  const ALU = 2400
  const LOGIC_UNIT = 2760
  const RESULT = 3100
  const INMUX = 3440
  const ACCMUX = 3780
  const ACC = 4120
  const DEVICES = 4460
  const NUMBER_A = 4830
  const NUMBER_B = 5170

  // ---- Fetch: the 8-bit program counter and the program ROM -------------------------------------------
  const clk = part(FETCH, 'clk', 'clock', { params: { hz: o.hz }, label: 'Clock' })
  const pc = part(FETCH, 'pc', 'busctr', { params: { bits: 8 }, label: 'PC' })
  const zero = part(FETCH, 'zero0', 'const', { params: { value: 0 } })
  const prog = part(ROM, 'prog', 'rom', { params: { ...BUS, abits: 8, dbits: 16, isa: SKASM.id, source: o.source, data: programWords(o.source), table: 'on', tdata: programTable(o.source) }, label: 'Program' })
  named(`${clk}.Q`, 'CLK')
  named(`${zero}.Q`, 'GND')
  wire(`${pc}.Q`, `${prog}.A`)
  wire(`${clk}.Q`, `${pc}.CLK`)

  // The instruction word: the address field (bits 0–3: a RAM address, a port, or the low bits of a jump target), the four
  // opcode bits (4–7) one by one, and the constant (bits 8–15) in two nibbles.
  const ir = splitter(FIELDS, 'ir', 16, [4, 1, 1, 1, 1, 4, 4], 'instruction fields', `${prog}.D`)
  const ADDR = `${ir}.Y0`
  named(ADDR, 'ADDR', 4)
  const num = merger(FIELDS, 'num', 8, [4, 4], 'the constant', [`${ir}.Y5`, `${ir}.Y6`])
  const target = merger(FIELDS, 'target', 8, [4, 4], 'jump target', [ADDR, `${ir}.Y5`])

  // ---- Decode: three control ROMs, addressed by the opcode and the sub-opcode ----------------------------
  // Opcodes 14 and 15 are extension groups: their sub-opcode is in bits 0–3 (14) or bits 12–15 (15). For every other
  // opcode the sub-opcode is 0.
  const gate = (col: number, key: string, type: string, label: string, ins: string[], inputs = ins.length) => {
    const g = part(col, key, type, { ...(type === 'not' || inputs === 2 ? {} : { params: { inputs } }), label }, 20)
    ins.forEach((from, i) => wire(from, `${g}.${String.fromCharCode(65 + i)}`))
    return g
  }
  const isExt = gate(CTL, 'ext', 'and', 'opcode 14 or 15: extension', [`${ir}.Y2`, `${ir}.Y3`, `${ir}.Y4`])
  const subWhich = part(CTL, 'subWhich', 'busmux', { params: { bits: 4, n: 2 }, label: 'sub-opcode: bits 0–3 (14) or 12–15 (15)' }, 20)
  wire(ADDR, `${subWhich}.I0`)
  wire(`${ir}.Y6`, `${subWhich}.I1`)
  wire(`${ir}.Y1`, `${subWhich}.S0`)
  const sub = part(CTL, 'sub', 'busmux', { params: { bits: 4, n: 2 }, label: 'sub-opcode (0 for other opcodes)' }, 20)
  wire(busconst(CTL, 'zero4', 4, 0), `${sub}.I0`)
  wire(`${subWhich}.Y`, `${sub}.I1`)
  wire(`${isExt}.Y`, `${sub}.S0`)
  const ctlAddr = merger(CTL, 'ctlAddr', 8, [1, 1, 1, 1, 4], 'opcode, sub-opcode', [`${ir}.Y1`, `${ir}.Y2`, `${ir}.Y3`, `${ir}.Y4`, `${sub}.Y`])
  const ctl = part(CTL, 'ctl', 'rom', { params: { ...BUS, abits: 8, dbits: 16, data: CONTROL_1, signals: SKASM_SIGNALS_1, rows: SKASM_ROWS }, label: 'Control' })
  const ctl2 = part(CTL, 'ctl2', 'rom', { params: { ...BUS, abits: 8, dbits: 8, data: CONTROL_2, signals: SKASM_SIGNALS_2, rows: SKASM_ROWS }, label: 'Control 2' })
  const ctl3 = part(CTL, 'ctl3', 'rom', { params: { ...BUS, abits: 8, dbits: 8, data: CONTROL_3, signals: SKASM_SIGNALS_3, rows: SKASM_ROWS }, label: 'Control 3' })
  wire(ctlAddr, `${ctl}.A`)
  wire(ctlAddr, `${ctl2}.A`)
  wire(ctlAddr, `${ctl3}.A`)
  // The control bits, one wire each (the source of the accumulator and the logic operation are small buses). The ROMs' signal
  // lists say how the words are taken apart, so the bits are named in one place.
  const splitControl = (key: string, text: string, bits: number, label: string, rom: string) => {
    const plan = splitPlan(parseSignals(text).layout, bits)
    const s = splitter(CTL, key, bits, plan.widths, label, `${rom}.D`)
    return (name: string) => `${s}.Y${plan.output[name]}`
  }
  const c1 = splitControl('cs', SKASM_SIGNALS_1, 16, 'control bits', ctl)
  const [LOAD_ACC, SRC, WRITE_RAM, SAVE_FLAGS, JUMP, JNC, JZ, HALT, SUBTRACT, B_IS_NUM, LOGIC, LOGIC_OP, CARRY_IN] = [
    'LOAD_ACC', 'SRC', 'WRITE_RAM', 'SAVE_FLAGS', 'JUMP', 'JNC', 'JZ', 'HALT', 'SUBTRACT', 'B_IS_NUM', 'LOGIC', 'LOGIC_OP', 'CARRY_IN',
  ].map(c1)
  named(LOAD_ACC, 'LOAD_ACC')
  named(WRITE_RAM, 'WRITE_RAM')
  named(SAVE_FLAGS, 'SAVE_FLAGS')
  named(SUBTRACT, 'SUBTRACT')
  named(B_IS_NUM, 'B_IS_NUM')
  named(LOGIC, 'LOGIC')
  const c2 = splitControl('cs2', SKASM_SIGNALS_2, 8, 'control 2 bits', ctl2)
  const c3 = splitControl('cs3', SKASM_SIGNALS_3, 8, 'control 3 bits', ctl3)
  const [CALL_W, RET_W] = ['CALL', 'RET'].map(c3)
  const [JNZ2, JC2, PORT_WRITE, INDIRECT_W, X_FROM_ACC_W, X_FROM_CONST_W, X_UP_W, X_DOWN_W] = ['JNZ', 'JC', 'PORT_WRITE', 'INDIRECT', 'X_FROM_ACC', 'X_FROM_CONST', 'X_UP', 'X_DOWN'].map(c2)

  const flags = part(ACC, 'flags', 'busreg', { params: { bits: 2 }, label: 'Flags' })
  const fs = splitter(ACC, 'fs', 2, [1, 1], 'carry, zero', `${flags}.Q`)
  const [CARRY, ZERO] = [`${fs}.Y0`, `${fs}.Y1`]
  named(CARRY, 'CARRY')

  // The program counter loads a jump target when the instruction jumps, or when its condition holds: JNC with the carry
  // clear, JC with it set, JZ with the zero flag, JNZ without it.
  const ncarry = gate(CTL, 'ncarry', 'not', 'no carry', [CARRY])
  const nzero = gate(CTL, 'nzero', 'not', 'not zero', [ZERO])
  const jnc = gate(CTL, 'jnc', 'and', 'JNC and no carry', [JNC, `${ncarry}.Y`])
  const jc = gate(CTL, 'jc', 'and', 'JC and carry', [JC2, CARRY])
  const jz = gate(CTL, 'jz', 'and', 'JZ and zero', [JZ, ZERO])
  const jnz = gate(CTL, 'jnz', 'and', 'JNZ and not zero', [JNZ2, `${nzero}.Y`])
  const take = gate(CTL, 'take', 'or', 'load PC', [JUMP, `${jnc}.Y`, `${jc}.Y`, `${jz}.Y`, `${jnz}.Y`, CALL_W, RET_W])
  wire(`${take}.Y`, `${pc}.LD`)

  // CALL and RET: a return stack of 16 addresses and a pointer to the next free one. CALL writes PC + 1 at the pointer, moves
  // the pointer up and jumps; RET moves the pointer down, reads the address there and jumps to it.
  const sp = part(FETCH, 'sp', 'busreg', { params: { bits: 4 }, label: 'Stack pointer' })
  const spStep = part(FETCH, 'spStep', 'busmux', { params: { bits: 4, n: 2 }, label: '+1 for CALL, −1 for RET' }, 20)
  wire(busconst(FETCH, 'one4', 4, 1), `${spStep}.I0`)
  wire(busconst(FETCH, 'minusOne4', 4, 15), `${spStep}.I1`)
  wire(RET_W, `${spStep}.S0`)
  const spAdd = part(FETCH, 'spAdd', 'busadd', { params: { bits: 4 }, label: 'Stack pointer ± 1' })
  wire(`${sp}.Q`, `${spAdd}.A`)
  wire(`${spStep}.Y`, `${spAdd}.B`)
  const spLoad = gate(FETCH, 'spLoad', 'or', 'CALL or RET', [CALL_W, RET_W])
  wire(`${spAdd}.S`, `${sp}.D`)
  wire(`${spLoad}.Y`, `${sp}.LD`)
  wire(`${clk}.Q`, `${sp}.CLK`)
  const stackAddr = part(FETCH, 'stackAddr', 'busmux', { params: { bits: 4, n: 2 }, label: 'stack address (RET: pointer − 1)' }, 20)
  wire(`${sp}.Q`, `${stackAddr}.I0`)
  wire(`${spAdd}.S`, `${stackAddr}.I1`)
  wire(RET_W, `${stackAddr}.S0`)
  const pcPlus = part(FETCH, 'pcPlus', 'busadd', { params: { bits: 8 }, label: 'PC + 1 (the return address)' })
  wire(`${pc}.Q`, `${pcPlus}.A`)
  wire(busconst(FETCH, 'one8pc', 8, 1), `${pcPlus}.B`)
  const stack = part(FETCH, 'stack', 'ram', { params: { ...BUS, dbits: 8, abits: 4 }, label: 'Return stack' })
  wire(`${stackAddr}.Y`, `${stack}.A`)
  wire(`${pcPlus}.S`, `${stack}.D`)
  wire(CALL_W, `${stack}.WE`)
  wire(`${clk}.Q`, `${stack}.CLK`)
  const pcNext = part(FETCH, 'pcNext', 'busmux', { params: { bits: 8, n: 2 }, label: 'PC load: target, or return address' }, 20)
  wire(target, `${pcNext}.I0`)
  wire(`${stack}.Q`, `${pcNext}.I1`)
  wire(RET_W, `${pcNext}.S0`)
  wire(`${pcNext}.Y`, `${pc}.D`)
  const nhalt = gate(CTL, 'nhalt', 'not', 'not halted', [HALT])
  wire(`${nhalt}.Y`, `${pc}.EN`)
  const halted = part(FETCH, 'halted', 'led', { label: 'Halted', params: { color: 'red' } })
  wire(HALT, `${halted}.A`)
  const stop = part(FETCH, 'stop', 'breakpoint', { label: 'Pause at HALT', params: { value: 1 } })
  wire(HALT, `${stop}.A`)

  // ---- Which port is addressed: one comparator per port the devices need --------------------------------
  // The port number of OUT and IN is the address field.
  const ports: Record<number, string> = {}
  /** The output of a comparator that is 1 when the port number is `n`. */
  const select = (n: number) =>
    (ports[n] ??= (() => {
      const c = part(DECODE, `sel${n}`, 'buscmp', { params: { bits: 4 }, label: `port ${n}` }, 20)
      wire(ADDR, `${c}.A`)
      wire(busconst(DECODE, `port${n}`, 4, n), `${c}.B`)
      return `${c}.EQ`
    })())
  /** 1 for the cycle in which the program does `OUT` to port `n`. */
  const writeTo = (n: number, label: string) => `${gate(DECODE, `we${n}`, 'and', label, [PORT_WRITE, select(n)])}.Y`

  // ---- Execute: RAM, adder/subtractor, logic, accumulator ----------------------------------------------
  const ram = part(MEM, 'ram', 'ram', { params: { ...BUS, dbits: 8, abits: 8 }, label: 'Data RAM' })
  const acc = part(ACC, 'acc', 'busreg', { params: { bits: 8 }, label: 'ACC' })
  const ACC_OUT = `${acc}.Q`
  named(ACC_OUT, 'ACC', 8)
  wire(WRITE_RAM, `${ram}.WE`)
  wire(`${clk}.Q`, `${ram}.CLK`)
  wire(ACC_OUT, `${ram}.D`)

  // The index register X, and the RAM address: the instruction's address field (the first 16 bytes) or X (all 256).
  // X loads the accumulator (TAX), the constant (LDXI) or itself plus or minus 1 (INX, DEX).
  const x = part(MEM, 'x', 'busreg', { params: { bits: 8 }, label: 'X' })
  const X_OUT = `${x}.Q`
  wire(X_OUT, `${prog}.TA`) // LDT: the table in the program ROM, read at X
  const addrLow = merger(MEM, 'addrLow', 8, [4, 4], 'direct address', [ADDR, busconst(MEM, 'zero4a', 4, 0)])
  const raddr = part(MEM, 'raddr', 'busmux', { params: { bits: 8, n: 2 }, label: 'RAM address: direct or X' }, 60)
  wire(addrLow, `${raddr}.I0`)
  wire(X_OUT, `${raddr}.I1`)
  wire(INDIRECT_W, `${raddr}.S0`)
  wire(`${raddr}.Y`, `${ram}.A`)
  const xStep = gate(MEM, 'xStep', 'or', 'INX or DEX', [X_UP_W, X_DOWN_W])
  const step = part(MEM, 'step', 'busmux', { params: { bits: 8, n: 2 }, label: '+1 or −1' }, 20)
  wire(busconst(MEM, 'one8', 8, 1), `${step}.I0`)
  wire(busconst(MEM, 'minusOne8', 8, 255), `${step}.I1`)
  wire(X_DOWN_W, `${step}.S0`)
  const xAdder = part(MEM, 'xAdder', 'busadd', { params: { bits: 8 }, label: 'X ± 1' })
  wire(X_OUT, `${xAdder}.A`)
  wire(`${step}.Y`, `${xAdder}.B`)
  const xSel = merger(MEM, 'xSel', 2, [1, 1], 'X from: ACC, constant, or ±1', [X_FROM_CONST_W, `${xStep}.Y`])
  const xNext = part(MEM, 'xNext', 'busmux', { params: { bits: 8, n: 4 }, label: 'next X' }, 20)
  wire(ACC_OUT, `${xNext}.I0`)
  wire(num, `${xNext}.I1`)
  wire(`${xAdder}.S`, `${xNext}.I2`)
  wire(`${xAdder}.S`, `${xNext}.I3`)
  wire(xSel, `${xNext}.S`)
  const xLoad = gate(MEM, 'xLoad', 'or', 'load X', [X_FROM_ACC_W, X_FROM_CONST_W, X_UP_W, X_DOWN_W])
  wire(`${xNext}.Y`, `${x}.D`)
  wire(`${xLoad}.Y`, `${x}.LD`)
  wire(`${clk}.Q`, `${x}.CLK`)

  // The second operand: RAM, or the constant of the instruction (ADDI, SUBI, CMPI, ANDI...), then inverted for subtraction.
  const bsel = part(BSEL, 'bsel', 'busmux', { params: { bits: 8, n: 2 }, label: 'operand B' }, 60)
  wire(`${ram}.Q`, `${bsel}.I0`)
  wire(num, `${bsel}.I1`)
  wire(B_IS_NUM, `${bsel}.S0`)
  const OPERAND_B = `${bsel}.Y`
  const notB = part(BSEL, 'notB', 'busgate', { params: { bits: 8, op: 'not' }, label: 'B inverted' }, 40)
  wire(OPERAND_B, `${notB}.A`)
  const bx = part(BSEL, 'bx', 'busmux', { params: { bits: 8, n: 2 }, label: 'B, or its opposite for SUB' }, 60)
  wire(OPERAND_B, `${bx}.I0`)
  wire(`${notB}.Y`, `${bx}.I1`)
  wire(SUBTRACT, `${bx}.S0`)
  const adder = part(ALU, 'adder', 'busadd', { params: { bits: 8 }, label: 'Adder' })
  wire(ACC_OUT, `${adder}.A`)
  wire(`${bx}.Y`, `${adder}.B`)
  // The carry in: 0 for ADD, 1 for SUB; ADC and SBC use the carry flag (after a subtraction it is the borrow, so SBC takes its opposite).
  const useCarry = part(ALU, 'useCarry', 'and', { label: 'ADC / SBC and carry' }, 20)
  wire(CARRY_IN, `${useCarry}.A`)
  wire(CARRY, `${useCarry}.B`)
  const carryIn = part(ALU, 'carryIn', 'xor', { label: 'carry in: SUB xor flag' }, 20)
  wire(SUBTRACT, `${carryIn}.A`)
  wire(`${useCarry}.Y`, `${carryIn}.B`)
  wire(`${carryIn}.Y`, `${adder}.Ci`)

  // The logic unit: AND, OR and XOR of the accumulator and the second operand, one op chosen by control bits 13–14; then
  // the ALU result is the adder's sum or the logic result (control bit 12).
  const logicOps = (['and', 'or', 'xor'] as const).map((op) => {
    const g = part(LOGIC_UNIT, op, 'busgate', { params: { bits: 8, op }, label: `A ${op} B` }, 20)
    wire(ACC_OUT, `${g}.A`)
    wire(OPERAND_B, `${g}.B`)
    return g
  })
  const lm = part(LOGIC_UNIT, 'logicMux', 'busmux', { params: { bits: 8, n: 4 }, label: 'logic result' }, 60)
  logicOps.forEach((g, i) => wire(`${g}.Y`, `${lm}.I${i}`))
  wire(LOGIC_OP, `${lm}.S`)
  const rm = part(RESULT, 'result', 'busmux', { params: { bits: 8, n: 2 }, label: 'ALU result' }, 60)
  wire(`${adder}.S`, `${rm}.I0`)
  wire(`${lm}.Y`, `${rm}.I1`)
  wire(LOGIC, `${rm}.S0`)
  const RESULT_OUT = `${rm}.Y`

  // ---- The keypad is the one device with an input: IN KEY ------------------------------------------------
  const keypad = has('keypad') ? part(DEVICES, 'keypad', 'keypad', { label: 'Keypad', params: { ...BUS, sticky: true, layout: o.keypad ?? 'hex' } }) : undefined
  const zero8 = busconst(INMUX, 'zero8', 8, 0)
  /** What IN puts on the bus: the keypad (its key in bits 0–3, bit 4 set while a press is waiting) when port KEY is addressed, otherwise 0. */
  let portIn = zero8
  if (keypad) {
    const keyWord = merger(INMUX, 'keyWord', 8, [4, 1, 3], 'the keypad word', [`${keypad}.K`, `${keypad}.P`, busconst(INMUX, 'zero3', 3, 0)])
    const inKey = part(INMUX, 'inKey', 'busmux', { params: { bits: 8, n: 2 }, label: 'IN KEY' }, 60)
    wire(zero8, `${inKey}.I0`)
    wire(keyWord, `${inKey}.I1`)
    wire(select(5), `${inKey}.S0`)
    portIn = `${inKey}.Y`
  }
  // The screen can be read back: IN PIXEL gives 1 or 0 for the pixel chosen with OUT PIXEL_AT (wired up with the screen, below).
  let pixelWord = ''
  if (has('lcd')) {
    pixelWord = part(INMUX, 'pixelWord', 'merger', { params: { bits: 8, split: '1,1,1,1,1,1,1,1' }, label: 'the pixel read back' }, 20)
    const inPixel = part(INMUX, 'inPixel', 'busmux', { params: { bits: 8, n: 2 }, label: 'IN PIXEL' }, 60)
    wire(portIn, `${inPixel}.I0`)
    wire(`${pixelWord}.Y`, `${inPixel}.I1`)
    wire(select(2), `${inPixel}.S0`)
    portIn = `${inPixel}.Y`
  }
  // The gamepad: IN PAD gives the six buttons held right now (up, down, left, right, A, B in bits 0–5).
  if (has('gamepad')) {
    const pad = part(DEVICES, 'gamepad', 'gamepad', { label: 'Gamepad', params: BUS })
    const padWord = merger(INMUX, 'padWord', 8, [6, 2], 'the gamepad word', [`${pad}.BTN`, busconst(INMUX, 'zero2', 2, 0)])
    const inPad = part(INMUX, 'inPad', 'busmux', { params: { bits: 8, n: 2 }, label: 'IN PAD' }, 60)
    wire(portIn, `${inPad}.I0`)
    wire(padWord, `${inPad}.I1`)
    wire(select(6), `${inPad}.S0`)
    portIn = `${inPad}.Y`
  }

  // What the accumulator loads: the constant, the ALU result, RAM, shifted left, shifted right, or a port.
  const nibbles = splitter(ACCMUX, 'shiftSplit', 8, [1, 6, 1], 'ACC for shifting', ACC_OUT)
  const shl = merger(ACCMUX, 'shl', 8, [1, 1, 6], 'ACC shifted left', [`${zero}.Q`, `${nibbles}.Y0`, `${nibbles}.Y1`])
  const shr = merger(ACCMUX, 'shr', 8, [6, 1, 1], 'ACC shifted right', [`${nibbles}.Y1`, `${nibbles}.Y2`, `${zero}.Q`])
  const amux = part(ACCMUX, 'amux', 'busmux', { params: { bits: 8, n: 8 }, label: 'ACC input' }, 60)
  ;[num, RESULT_OUT, `${ram}.Q`, shl, shr, portIn, X_OUT, `${prog}.TD`].forEach((from, i) => wire(from, `${amux}.I${i}`))
  wire(SRC, `${amux}.S`)
  wire(`${amux}.Y`, `${acc}.D`)
  wire(LOAD_ACC, `${acc}.LD`)
  wire(`${clk}.Q`, `${acc}.CLK`)

  // ---- Flags: carry (for SUB it means "borrowed") and zero ---------------------------------------------------
  // A logic instruction clears the carry, and the zero flag looks at the ALU result.
  const cx = part(ALU, 'cx', 'xor', { label: 'carry xor SUB' })
  wire(`${adder}.Co`, `${cx}.A`)
  wire(SUBTRACT, `${cx}.B`)
  const nlogic = part(ALU, 'nlogic', 'not', { label: 'not a logic or X instruction' }, 20)
  const logicOrX = gate(ALU, 'logicOrX', 'or', 'logic, INX or DEX', [LOGIC, `${xStep}.Y`])
  wire(`${logicOrX}.Y`, `${nlogic}.A`)
  const carryOut = part(ALU, 'carryOut', 'and', { label: 'carry, 0 for logic' }, 20)
  wire(`${cx}.Y`, `${carryOut}.A`)
  wire(`${nlogic}.Y`, `${carryOut}.B`)
  const isZero = part(ALU, 'isZero', 'buscmp', { params: { bits: 8 }, label: 'result is zero' })
  // INX and DEX set the zero flag from the new X, not from the ALU.
  const zsrc = part(ALU, 'zsrc', 'busmux', { params: { bits: 8, n: 2 }, label: 'zero test: result, or X ± 1' }, 20)
  wire(RESULT_OUT, `${zsrc}.I0`)
  wire(`${xAdder}.S`, `${zsrc}.I1`)
  wire(`${xStep}.Y`, `${zsrc}.S0`)
  wire(`${zsrc}.Y`, `${isZero}.A`)
  wire(zero8, `${isZero}.B`)
  const flagWord = merger(ACC, 'flagWord', 2, [1, 1], 'carry, zero', [`${carryOut}.Y`, `${isZero}.EQ`])
  wire(flagWord, `${flags}.D`)
  wire(SAVE_FLAGS, `${flags}.LD`)
  wire(`${clk}.Q`, `${flags}.CLK`)

  // ---- The devices ---------------------------------------------------------------------------------
  if (has('console')) {
    const con = part(DEVICES, 'console', 'console', { params: BUS, label: 'LCD text display' })
    wire(writeTo(1, 'OUT CHAR'), `${con}.WE`)
    wire(`${clk}.Q`, `${con}.CLK`)
    wire(ACC_OUT, `${con}.D`)
  }
  if (has('lcd')) {
    const screen = part(DEVICES, 'screen', 'framebuffer', { params: { ...BUS, colors: 4, palette: 'shades', read: 'on' }, label: 'LCD' })
    const xy = splitter(DEVICES, 'xy', 8, [4, 4], 'column, row', ACC_OUT)
    wire(`${xy}.Y0`, `${screen}.X`)
    wire(`${xy}.Y1`, `${screen}.Y`)
    // PIXEL_ON paints the current shade, PIXEL_OFF paints 0 (shade 0). OUT PIXEL_COLOR sets the shade; the register holds it
    // inverted, so that after a reset (all zeros) the shade is 3, the brightest, and programs that never choose one draw as before.
    const shadeBits = splitter(DEVICES, 'shadeBits', 8, [2, 6], 'the shade (low two bits)', ACC_OUT)
    const shadeNot = part(DEVICES, 'shadeNot', 'busgate', { params: { bits: 2, op: 'not' }, label: 'shade, inverted' }, 20)
    wire(`${shadeBits}.Y0`, `${shadeNot}.A`)
    const shadeReg = part(DEVICES, 'shadeReg', 'busreg', { params: { bits: 2 }, label: 'PIXEL_COLOR: the shade (inverted)' })
    wire(`${shadeNot}.Y`, `${shadeReg}.D`)
    wire(writeTo(8, 'OUT PIXEL_COLOR'), `${shadeReg}.LD`)
    wire(`${clk}.Q`, `${shadeReg}.CLK`)
    const shadeOut = part(DEVICES, 'shadeOut', 'busgate', { params: { bits: 2, op: 'not' }, label: 'the shade' }, 20)
    wire(`${shadeReg}.Q`, `${shadeOut}.A`)
    const onBoth = merger(DEVICES, 'onBoth', 2, [1, 1], 'PIXEL_ON, twice', [select(2), select(2)])
    const paint = part(DEVICES, 'paint', 'busgate', { params: { bits: 2, op: 'and' }, label: 'shade for PIXEL_ON, 0 for PIXEL_OFF' }, 20)
    wire(`${shadeOut}.Y`, `${paint}.A`)
    wire(onBoth, `${paint}.B`)
    wire(`${paint}.Y`, `${screen}.D`)
    const fbSel = gate(DECODE, 'fbSel', 'or', 'PIXEL_ON or PIXEL_OFF', [select(2), select(3)])
    const fbWe = gate(DECODE, 'fbWe', 'and', 'OUT to the screen', [PORT_WRITE, `${fbSel}.Y`])
    wire(`${fbWe}.Y`, `${screen}.WE`)
    wire(`${clk}.Q`, `${screen}.CLK`)
    // OUT PIXEL_AT chooses the pixel to read: a register holds the address, split into column and row.
    const readAt = part(DEVICES, 'readAt', 'busreg', { params: { bits: 8 }, label: 'PIXEL_AT: the pixel to read' })
    wire(ACC_OUT, `${readAt}.D`)
    wire(writeTo(7, 'OUT PIXEL_AT'), `${readAt}.LD`)
    wire(`${clk}.Q`, `${readAt}.CLK`)
    const rxy = splitter(DEVICES, 'rxy', 8, [4, 4], 'column, row to read', `${readAt}.Q`)
    wire(`${rxy}.Y0`, `${screen}.RX`)
    wire(`${rxy}.Y1`, `${screen}.RY`)
    const shadeRead = splitter(DEVICES, 'shadeRead', 2, [1, 1], 'the shade read back', `${screen}.Q`)
    wire(`${shadeRead}.Y0`, `${pixelWord}.A0`)
    wire(`${shadeRead}.Y1`, `${pixelWord}.A1`)
    for (let i = 2; i < 8; i++) wire(`${zero}.Q`, `${pixelWord}.A${i}`)
  }
  if (has('speaker')) {
    // OUT SPEAKER flips the speaker's T flip-flop.
    const toggle = part(DEVICES, 'toggle', 'tff', { label: 'Speaker flip-flop' })
    wire(writeTo(4, 'OUT SPEAKER'), `${toggle}.T`)
    wire(`${clk}.Q`, `${toggle}.CLK`)
    const spk = part(DEVICES, 'speaker', 'speaker', { label: 'Speaker', params: { octaves: o.octaves ?? 0 } })
    wire(`${toggle}.Q`, `${spk}.A`)
  }
  // OUT KEY_ACK tells the keypad its key has been read. The keypad listens to RST at every instant, not only at a clock
  // edge, and the decoding glitches for a moment whenever the instruction changes (the opcode settles before the
  // sub-opcode). So the strobe goes through a flip-flop that only looks at it on the clock edge.
  if (keypad) {
    const ack = part(DEVICES, 'ackFlop', 'dff', { label: 'KEY_ACK strobe (flip-flop)' })
    wire(writeTo(5, 'OUT KEY_ACK'), `${ack}.D`)
    wire(`${clk}.Q`, `${ack}.CLK`)
    wire(`${ack}.Q`, `${keypad}.RST`)
  }

  // ---- Readouts ------------------------------------------------------------------------------------
  const readout = (col: number, key: string, from: string, label: string) => {
    const d = part(col, key, 'busdisp', { params: { bits: 8, format: 'hex' }, label })
    wire(from, `${d}.A`)
  }
  readout(FETCH, 'pcDisp', `${pc}.Q`, 'PC')
  readout(ACC, 'accDisp', ACC_OUT, 'ACC')
  const carry = part(ACC, 'carry', 'led', { label: 'Carry', params: { color: 'yellow' } })
  const zflag = part(ACC, 'zflag', 'led', { label: 'Zero', params: { color: 'red' } })
  wire(CARRY, `${carry}.A`)
  wire(ZERO, `${zflag}.A`)

  // ---- The decimal display: OUT NUMBER loads the output register; 16 × high nibble + low nibble, added digit by digit ------
  // The low nibble converts directly. Two ROMs hold 16 × n for the high nibble as decimal digits.
  if (has('number')) {
    const out = part(NUMBER_A, 'out', 'busreg', { params: { bits: 8 }, label: 'Output' })
    wire(ACC_OUT, `${out}.D`)
    wire(writeTo(0, 'OUT NUMBER'), `${out}.LD`)
    wire(`${clk}.Q`, `${out}.CLK`)
    const os = splitter(NUMBER_A, 'outSplit', 8, [4, 4], 'low nibble, high nibble', `${out}.Q`)
    const decLo = part(NUMBER_A, 'decLo', 'bin2bcd', { params: BUS, label: 'Low nibble in decimal' })
    wire(`${os}.Y0`, `${decLo}.B`)
    const decRomTO = part(NUMBER_A, 'decRomTO', 'rom', { params: { ...BUS, abits: 4, dbits: 8, data: SIXTEENS_TENS_ONES }, label: '16 × n: tens, ones' })
    const decRomH = part(NUMBER_A, 'decRomH', 'rom', { params: { ...BUS, abits: 4, dbits: 4, data: SIXTEENS_HUNDREDS }, label: '16 × n: hundreds' })
    wire(`${os}.Y1`, `${decRomTO}.A`)
    wire(`${os}.Y1`, `${decRomH}.A`)
    const ts = splitter(NUMBER_B, 'tensOnes', 8, [4, 4], 'ones, tens', `${decRomTO}.D`)
    const decOnes = part(NUMBER_B, 'decOnes', 'bcdadd', { params: BUS, label: 'Ones' })
    const decTens = part(NUMBER_B, 'decTens', 'bcdadd', { params: BUS, label: 'Tens' })
    const decHund = part(NUMBER_B, 'decHund', 'bcdadd', { params: BUS, label: 'Hundreds' })
    wire(`${ts}.Y0`, `${decOnes}.A`)
    wire(`${decLo}.O`, `${decOnes}.B`)
    wire(`${ts}.Y1`, `${decTens}.A`)
    wire(merger(NUMBER_B, 'tensB', 4, [1, 1, 1, 1], 'the low nibble’s tens digit', [`${decLo}.T0`, `${zero}.Q`, `${zero}.Q`, `${zero}.Q`]), `${decTens}.B`)
    wire(`${decOnes}.Co`, `${decTens}.Ci`)
    wire(`${decRomH}.D`, `${decHund}.A`)
    wire(busconst(NUMBER_B, 'zero4h', 4, 0), `${decHund}.B`)
    wire(`${decTens}.Co`, `${decHund}.Ci`)
    ;[
      [decHund, 'dispHund', 'Output (decimal)'],
      [decTens, 'dispTens', undefined],
      [decOnes, 'dispOnes', undefined],
    ].forEach(([from, key, label]) => {
      const d = part(NUMBER_B, key!, 'hexdisp', { params: BUS, ...(label ? { label } : {}) })
      wire(`${from}.S`, `${d}.IN`)
    })
  }

  // ---- Probes: the program counter and the accumulator are each recorded as one number in the waveform panel ---------
  if (o.probes) {
    const signals: [string, string, number][] = [
      ['CLK', `${clk}.Q`, 1],
      ['PC', `${pc}.Q`, 8],
      ['ACC', ACC_OUT, 8],
      ['Carry', CARRY, 1],
    ]
    signals.forEach(([label, from, bits], i) => {
      const probe = part(FETCH, `probe${i}`, 'probe', { label, ...(bits > 1 ? { params: { bits } } : {}) }, 10)
      wire(from, `${probe}.A`)
    })
  }

  const byFrom = new Map<string, string[]>()
  for (const l of links) byFrom.set(l.from, [...(byFrom.get(l.from) ?? []), l.to])
  for (const [from, targets] of byFrom) {
    const net = netNames.get(from)
    const sent = net && targets.length >= 3 ? b.tap(from, net.name, 20, net.bits) : undefined
    for (const to of targets) if (!(sent && net && b.tag(to, net.name, 20, net.bits))) b.wire(from, to)
  }
  return { b, keys }
}

/** A program on the computer: what is connected, how fast it runs, and a note that says what to look at. */
export interface Program {
  id: string
  name: string
  source: string
  hz: number
  devices: Device[]
  octaves?: number
  keypad?: 'hex' | 'calc'
  probes?: boolean
  note: string
}

/**
 * Fibonacci: RAM[0] = a, RAM[1] = b, RAM[2] = a + b. Each number is sent to the decimal display (`OUT NUMBER`) as soon as it
 * is known, so it reads 000 001 001 002 003 005 008 013 021 034 055 089 144 233. The next sum no longer fits in 8 bits
 * (carry): it stops.
 */
export const FIBONACCI_SOURCE = `; Fibonacci: RAM[0] = a, RAM[1] = b, RAM[2] = a + b.
; Every number is sent to the decimal display (OUT NUMBER) as soon as it is known.
; When a sum no longer fits in 8 bits the carry flag is set and the loop ends.

        LDI 0
        STA 0        ; a = 0
        OUT NUMBER   ; show 0
        LDI 1
        STA 1        ; b = 1
loop:   LDA 1
        OUT NUMBER   ; show b
        ADD 0        ; acc = b + a, sets the carry flag
        STA 2        ; t = a + b
        LDA 1
        STA 0        ; a = b
        LDA 2
        STA 1        ; b = t
        JNC loop     ; no carry: next number
        HALT
`

/**
 * Tic-tac-toe for two players on the LCD and the hex keypad. Each player's marks are kept as three row bytes (bit c of row r =
 * a mark in column c), always for "the player to move" (me) and "the other player" (opp); after every move the two sets swap, so
 * one copy of the code serves both players. A win is tested with the bits: three in a row is a row byte of 7, three in a column
 * is a non-zero AND of the three rows, and a diagonal is the AND of the rows shifted so its cells line up in bit 0.
 */
export const TICTACTOE_SOURCE = `; Tic-tac-toe for two players. X starts. The nine keys 0 1 2 / 4 5 6 / 8 9 A of the keypad are the nine cells.
; The board is drawn on the 16x16 screen: cells are 4x4 pixels, 5 apart, with grid lines between them.
; Each player's marks are three row bytes: bit c of row r is set for a mark at row r, column c.
; "me" is the player to move and "opp" the other one; after each move the two swap, so the code serves both.
me0 = 0
me1 = 1
me2 = 2
opp0 = 3
opp1 = 4
opp2 = 5
turn = 6          ; 0 = X to move, 1 = O to move
moves = 7         ; marks placed so far
key = 8
b = 9             ; the bit of the chosen column (1, 2 or 4)
cx = 10           ; 5 * the chosen column
pos = 11          ; the screen position of the cell's top left pixel: y * 16 + x
t = 12

; ---- the grid: two vertical lines at x = 5 and 10, two horizontal ones at y = 5 and 10 ----
        LDI 5
vline1: OUT PIXEL_ON
        ADDI 16
        JNC vline1      ; the carry says we have gone past the bottom
        LDI 10
vline2: OUT PIXEL_ON
        ADDI 16
        JNC vline2
        LDI 80          ; y = 5, x = 0
hline1: OUT PIXEL_ON
        ADDI 1
        CMPI 96
        JNZ hline1
        LDI 160         ; y = 10
hline2: OUT PIXEL_ON
        ADDI 1
        CMPI 176
        JNZ hline2

; ---- wait for a key (bit 4 of IN KEY says one is waiting), read it and acknowledge it ----
wait:   IN KEY
        ANDI 16
        JZ wait
        IN KEY
        ANDI 15
        STA key
        OUT KEY_ACK

; ---- the column is the low two bits of the key (3 is no column); the row is the key divided by 4 (3 is no row) ----
        ANDI 3
        CMPI 3
        JZ wait
        CMPI 0
        JZ col0
        CMPI 1
        JZ col1
        LDI 4           ; column 2
        STA b
        LDI 10
        STA cx
        JMP rows
col0:   LDI 1
        STA b
        LDI 0
        STA cx
        JMP rows
col1:   LDI 2
        STA b
        LDI 5
        STA cx
rows:   LDA key
        SHR
        SHR
        CMPI 3
        JZ wait
        CMPI 0
        JZ row0
        CMPI 1
        JZ row1

; ---- place the mark if the cell is free; the top left pixel of the cell is 17 + 80 * row + 5 * column ----
        LDA me2
        OR opp2
        AND b
        JNZ wait        ; taken: ignore the key
        LDA me2
        OR b
        STA me2
        LDI 177
        ADD cx
        STA pos
        JMP draw
row0:   LDA me0
        OR opp0
        AND b
        JNZ wait
        LDA me0
        OR b
        STA me0
        LDI 17
        ADD cx
        STA pos
        JMP draw
row1:   LDA me1
        OR opp1
        AND b
        JNZ wait
        LDA me1
        OR b
        STA me1
        LDI 97
        ADD cx
        STA pos

; ---- draw an X or an O: eight pixels, each reached from the last by adding the difference ----
draw:   LDA turn
        CMPI 0          ; LDA does not set the zero flag
        JNZ drawo
        LDA pos
        OUT PIXEL_ON
        ADDI 17
        OUT PIXEL_ON
        ADDI 17
        OUT PIXEL_ON
        ADDI 17
        OUT PIXEL_ON
        ADDI 253
        OUT PIXEL_ON
        ADDI 241
        OUT PIXEL_ON
        ADDI 241
        OUT PIXEL_ON
        ADDI 241
        OUT PIXEL_ON
        JMP check
drawo:  LDA pos
        ADDI 1
        OUT PIXEL_ON
        ADDI 1
        OUT PIXEL_ON
        ADDI 17
        OUT PIXEL_ON
        ADDI 16
        OUT PIXEL_ON
        ADDI 15
        OUT PIXEL_ON
        ADDI 255
        OUT PIXEL_ON
        ADDI 239
        OUT PIXEL_ON
        ADDI 240
        OUT PIXEL_ON

; ---- three in a row? rows: a row byte of 7. Columns: the three rows have a bit in common. Diagonals: shift rows so cells line up ----
check:  LDA me0
        CMPI 7
        JZ win
        LDA me1
        CMPI 7
        JZ win
        LDA me2
        CMPI 7
        JZ win
        LDA me0
        AND me1
        AND me2
        JNZ win
        LDA me1         ; the diagonal from top left: bit 0 of row 0, bit 1 of row 1, bit 2 of row 2
        SHR
        STA t
        LDA me2
        SHR
        SHR
        AND t
        AND me0
        ANDI 1
        JNZ win
        LDA me0         ; the other diagonal: bit 2 of row 0, bit 1 of row 1, bit 0 of row 2
        SHR
        SHR
        STA t
        LDA me1
        SHR
        AND t
        AND me2
        ANDI 1
        JNZ win

; ---- no win: a full board is a draw, otherwise swap the players and wait for the next key ----
        LDA moves
        ADDI 1
        STA moves
        CMPI 9
        JZ tie
        LDA me0
        STA t
        LDA opp0
        STA me0
        LDA t
        STA opp0
        LDA me1
        STA t
        LDA opp1
        STA me1
        LDA t
        STA opp1
        LDA me2
        STA t
        LDA opp2
        STA me2
        LDA t
        STA opp2
        LDA turn
        XORI 1
        STA turn
        JMP wait

; ---- the result goes to the text console ----
win:    LDA turn
        CMPI 0
        JNZ owins
        LDI 88          ; X
        JMP said
owins:  LDI 79          ; O
said:   OUT CHAR
        LDI 32
        OUT CHAR
        LDI 119         ; w
        OUT CHAR
        LDI 105         ; i
        OUT CHAR
        LDI 110         ; n
        OUT CHAR
        LDI 115         ; s
        OUT CHAR
        HALT
tie:    LDI 68          ; D
        OUT CHAR
        LDI 114         ; r
        OUT CHAR
        LDI 97          ; a
        OUT CHAR
        LDI 119         ; w
        OUT CHAR
        HALT
`

/**
 * Pong against a wall, on the LCD and the gamepad. The ball is one byte (y * 16 + x) that moves by sx + sy each frame, like the
 * bouncing ball; the paddle is three pixels in column 0, kept as the byte of its top pixel. The gamepad's up and down move it.
 * Every return scores a point on the decimal display and speeds the game up; a ball that reaches column 0 ends it.
 */
export const PONG_SOURCE = `; Pong against a wall. Hold up or down on the gamepad to move your paddle (the three pixels on the left edge).
; The ball is one byte, y * 16 + x. Each frame it moves by sx + sy (+1 or -1 sideways, +16 or -16 up and down, as bytes).
; Return the ball to score (shown on the decimal display); every return makes the game faster. Miss it and the game ends.
pos = 0           ; the ball
sx = 1            ; +1 right, 255 (= -1) left
sy = 2            ; +16 down, 240 (= -16) up
next = 3
ppos = 4          ; the paddle's top pixel, y * 16 (0 to 208)
key = 5
score = 6
wait = 7          ; the pause between frames: counted down, and shorter after every return

        LDI 0x38
        STA pos
        LDI 1
        STA sx
        LDI 16
        STA sy
        LDI 96
        STA ppos
        LDI 20
        STA wait
        LDA pos
        OUT PIXEL_ON    ; the ball
        LDI 96
        OUT PIXEL_ON    ; the paddle
        LDI 112
        OUT PIXEL_ON
        LDI 128
        OUT PIXEL_ON
        LDI 0
        OUT NUMBER

; ---- the gamepad: while up (bit 0) is held the paddle moves up, while down (bit 1) is held it moves down ----
frame:  IN PAD
        STA key
        ANDI 1
        JNZ up
        LDA key
        ANDI 2
        JNZ down
        JMP move
up:     LDA ppos
        CMPI 0
        JZ move         ; already at the top
        SUBI 16
        STA ppos
        OUT PIXEL_ON
        ADDI 48         ; the old bottom pixel
        OUT PIXEL_OFF
        JMP move
down:   LDA ppos
        CMPI 208
        JZ move         ; already at the bottom
        OUT PIXEL_OFF
        ADDI 16
        STA ppos
        ADDI 32
        OUT PIXEL_ON
        JMP move

; ---- the ball: light the new pixel, darken the old one ----
move:   LDA pos
        ADD sx
        ADD sy
        STA next
        OUT PIXEL_ON
        LDA pos
        OUT PIXEL_OFF
        LDA next
        STA pos

; ---- column 0: missed. Column 15: the wall, turn round. Column 1: is the paddle there? ----
        ANDI 15
        CMPI 0
        JZ lost
        CMPI 15
        JZ wall
        CMPI 1
        JZ paddle
ycheck: LDA pos
        SHR
        SHR
        SHR
        SHR
        CMPI 0
        JZ top
        CMPI 15
        JZ bottom
        JMP pause
wall:   LDI 255
        STA sx
        JMP ycheck
top:    LDI 16
        STA sy
        JMP pause
bottom: LDI 240
        STA sy
        JMP pause

; ---- the paddle covers rows ppos, ppos + 16 and ppos + 32: the ball's row minus ppos is 0, 16 or 32 ----
paddle: LDA pos
        ANDI 240
        SUB ppos
        CMPI 0
        JZ hit
        CMPI 16
        JZ hit
        CMPI 32
        JZ hit
        JMP ycheck
hit:    LDI 1
        STA sx          ; back to the right
        LDA score
        ADDI 1
        STA score
        OUT NUMBER
        LDA wait
        CMPI 4
        JZ ycheck       ; as fast as it gets
        SUBI 2
        STA wait
        JMP ycheck

pause:  LDA wait
slow:   SUBI 1
        JNZ slow
        JMP frame
lost:   HALT
`

/**
 * Snake on the LCD and the gamepad. The body is eight RAM bytes, head first; each frame they all move one place along
 * (the machine cannot address RAM by a variable, so it is eight copies in a row), and the tail pixel is darkened unless the snake
 * just ate. The gamepad steers. The walls are lit pixels round the edge, and the snake dies on a wall or on itself.
 */
export const SNAKE_SOURCE = `; Snake. Steer with the direction pad of the gamepad. Eat the food to grow to length 8 and win.
; The snake is eight RAM bytes s0 (head) to s7 (tail); each is a screen position, y * 16 + x. Every frame each byte takes
; the value of the one before it, a new head goes in s0, and the pixel of the old tail is darkened.
; The program cannot use a variable as a RAM address, so a variable length means jumping to the right piece of code.
s0 = 0
s1 = 1
s2 = 2
s3 = 3
s4 = 4
s5 = 5
s6 = 6
s7 = 7
dir = 8           ; the step per frame: 1 right, 255 left (-1), 16 down, 240 up (-16)
len = 9           ; how many of the eight bytes are the snake
food = 10
next = 11         ; the new head
key = 12
wait = 13         ; the pause between frames, shorter after every meal
rnd = 14          ; changes every frame; the food goes where it points
grow = 15         ; 1 when the snake ate in this frame

        LDI 136
        STA s0
        LDI 135
        STA s1
        LDI 134
        STA s2
        LDI 1
        STA dir
        LDI 3
        STA len
        LDI 24
        STA wait
        LDI 91
        STA rnd
; ---- the walls: the four edges of the screen ----
        LDI 0
top:    OUT PIXEL_ON
        ADDI 1
        CMPI 16
        JNZ top
        LDI 240
bottom: OUT PIXEL_ON
        ADDI 1
        JNC bottom
        LDI 0
left:   OUT PIXEL_ON
        ADDI 16
        JNC left
        LDI 15
right:  OUT PIXEL_ON
        ADDI 16
        JNC right
        LDA s0
        OUT PIXEL_ON
        LDA s1
        OUT PIXEL_ON
        LDA s2
        OUT PIXEL_ON
        LDA len
        OUT NUMBER
        JMP place

; ---- the gamepad turns the snake (up 1, down 2, left 4, right 8), unless that would turn it straight back ----
frame:  LDA rnd
        ADDI 37
        STA rnd
        IN PAD
        STA key
        ANDI 1
        JNZ kup
        LDA key
        ANDI 2
        JNZ kdown
        LDA key
        ANDI 4
        JNZ kleft
        LDA key
        ANDI 8
        JNZ kright
        JMP move
kup:    LDI 240
        JMP turn
kdown:  LDI 16
        JMP turn
kleft:  LDI 255
        JMP turn
kright: LDI 1
turn:   STA next
        ADD dir
        JZ move         ; the sum is 0: the opposite direction
        LDA next
        STA dir

; ---- the new head, and the walls (column 0 or 15, row 0 or 15) ----
move:   LDA s0
        ADD dir
        STA next
        ANDI 15
        CMPI 0
        JZ dead
        CMPI 15
        JZ dead
        LDA next
        SHR
        SHR
        SHR
        SHR
        CMPI 0
        JZ dead
        CMPI 15
        JZ dead

; ---- the body: the new head is on s1 (impossible), s2 (if it is body), ... ----
        LDA next
        CMP s1
        JZ dead
        LDA next
        CMP s2
        JNZ c3
        LDA len
        CMPI 4          ; s2 is body when the snake is at least 4 long (otherwise it is the tail, which moves away)
        JC c3
        JMP dead
c3:     LDA next
        CMP s3
        JNZ c4
        LDA len
        CMPI 5
        JC c4
        JMP dead
c4:     LDA next
        CMP s4
        JNZ c5
        LDA len
        CMPI 6
        JC c5
        JMP dead
c5:     LDA next
        CMP s5
        JNZ meal
        LDA len
        CMPI 7
        JC meal
        JMP dead

; ---- food: the snake grows and the tail stays; otherwise the tail pixel goes out ----
meal:   LDA next
        CMP food
        JNZ walk
        LDA len
        ADDI 1
        STA len
        OUT NUMBER
        LDA wait
        SUBI 2
        STA wait
        LDI 1
        STA grow
        JMP shift
walk:   LDI 0
        STA grow
        LDA len
        CMPI 3
        JZ tail3
        CMPI 4
        JZ tail4
        CMPI 5
        JZ tail5
        CMPI 6
        JZ tail6
        LDA s6          ; length 7
        JMP erase
tail6:  LDA s5
        JMP erase
tail5:  LDA s4
        JMP erase
tail4:  LDA s3
        JMP erase
tail3:  LDA s2
erase:  OUT PIXEL_OFF

; ---- every byte takes its neighbour's value; the new head goes in s0 and lights up ----
shift:  LDA s6
        STA s7
        LDA s5
        STA s6
        LDA s4
        STA s5
        LDA s3
        STA s4
        LDA s2
        STA s3
        LDA s1
        STA s2
        LDA s0
        STA s1
        LDA next
        STA s0
        OUT PIXEL_ON
        LDA len
        CMPI 8
        JZ won
        LDA grow
        CMPI 0
        JNZ place
more:   LDA food
        OUT PIXEL_ON    ; the food is lit again every frame, in case the tail's pixel put it out
        LDA wait
slow:   SUBI 1
        JNZ slow
        JMP frame

; ---- a new meal at (rnd mod 16, rnd / 16), moved in from the wall if it is on it ----
place:  LDA rnd
        ANDI 15
        CMPI 0
        JNZ px1
        LDI 1
px1:    CMPI 15
        JNZ px2
        LDI 14
px2:    STA next
        LDA rnd
        SHR
        SHR
        SHR
        SHR
        CMPI 0
        JNZ py1
        LDI 1
py1:    CMPI 15
        JNZ py2
        LDI 14
py2:    SHL
        SHL
        SHL
        SHL
        OR next
        STA food
        JMP more

dead:   LDI 71          ; G
        OUT CHAR
        LDI 97          ; a
        OUT CHAR
        LDI 109         ; m
        OUT CHAR
        LDI 101         ; e
        OUT CHAR
        LDI 32
        OUT CHAR
        LDI 111         ; o
        OUT CHAR
        LDI 118         ; v
        OUT CHAR
        LDI 101         ; e
        OUT CHAR
        LDI 114         ; r
        OUT CHAR
        HALT
won:    LDI 89          ; Y
        OUT CHAR
        LDI 111         ; o
        OUT CHAR
        LDI 117         ; u
        OUT CHAR
        LDI 32
        OUT CHAR
        LDI 119         ; w
        OUT CHAR
        LDI 105         ; i
        OUT CHAR
        LDI 110         ; n
        OUT CHAR
        HALT
`

/**
 * The sieve of Eratosthenes: a flag for each number in RAM, reached with the index register X (the flag of n is at n + 16, because
 * the first 16 bytes are the program's variables). Prints the primes below 240.
 */
export const SIEVE_SOURCE = `; The sieve of Eratosthenes. A flag for each number lives in RAM at address n + 16: 0 means "might be prime", 1 means
; "a multiple of something smaller". The first 16 bytes are variables, reached directly. The flags are reached through the
; index register X: TAX puts the address in X, LDX reads the byte it points to, STX writes it.
n = 0             ; the candidate
m = 1             ; its multiples
t = 2             ; the number being printed
h = 3             ; hundreds digit
u = 4             ; tens digit

        LDI 2
        STA n
outer:  LDA n
        ADDI 16
        TAX             ; X points to the flag of n
        LDX             ; ACC = the flag
        CMPI 0
        JNZ next        ; not zero: a multiple of a smaller number

; ---- n is prime: print it as a decimal number and a space ----
        LDA n
        STA t
        LDI 0
        STA h
        STA u
hloop:  LDA t
        CMPI 100
        JNC hsub
tloop:  LDA t
        CMPI 10
        JNC tsub
        LDA h
        CMPI 0
        JZ nohund
        ADDI 48
        OUT CHAR
        JMP tens        ; after hundreds the tens digit is printed even if it is 0
nohund: LDA u
        CMPI 0
        JZ ones
tens:   LDA u
        ADDI 48
        OUT CHAR
ones:   LDA t
        ADDI 48
        OUT CHAR
        LDI 32
        OUT CHAR
        JMP multiples
hsub:   SUBI 100
        STA t
        LDA h
        ADDI 1
        STA h
        JMP hloop
tsub:   SUBI 10
        STA t
        LDA u
        ADDI 1
        STA u
        JMP tloop

; ---- flag 2n, 3n, 4n ... as multiples, up to 239 ----
multiples: LDA n
        STA m
mark:   LDA m
        ADD n
        JC next         ; past 255
        STA m
        CMPI 240
        JNC next        ; 240 or more: done with this prime
        ADDI 16
        TAX
        LDI 1
        STX             ; flag it
        JMP mark

next:   LDA n
        ADDI 1
        STA n
        CMPI 240
        JC outer        ; carry: n is still below 240
        HALT
`

/**
 * A sine wave scrolls across the LCD. The height of the wave at each of 16 columns is a byte of the table (`.byte`), read with
 * LDT: X picks the table entry, which moves one place along every frame.
 */
export const SINE_SOURCE = `; A sine wave scrolls across the screen. The heights of the wave at 16 columns are in the table (the .byte line at the
; end), which the program reads with LDT: TAX points X at an entry, LDT puts that byte in the accumulator.
c = 0             ; the column being drawn
p = 1             ; the phase: how far the wave has moved

        LDI 0
        STA p
frame:  LDI 0
        STA c
col:    LDA c           ; the old pixel of this column: the entry before the current one
        ADD p
        ADDI 15
        ANDI 15
        TAX
        LDT             ; its height
        SHL
        SHL
        SHL
        SHL             ; height * 16
        ADD c           ; + column = the screen position
        OUT PIXEL_OFF
        LDA c           ; the new pixel
        ADD p
        ANDI 15
        TAX
        LDT
        SHL
        SHL
        SHL
        SHL
        ADD c
        OUT PIXEL_ON
        LDA c
        ADDI 1
        STA c
        CMPI 16
        JNZ col
        LDA p
        ADDI 1
        ANDI 15
        STA p
        JMP frame

wave:   .byte 8, 10, 12, 14, 14, 14, 12, 10, 8, 5, 3, 1, 0, 1, 3, 5
`

/**
 * Langton's ant: a tiny machine on the LCD that reads the pixel under it, flips it, turns and steps. It needs to read the
 * screen back (OUT PIXEL_AT, IN PIXEL), so it keeps nothing but its own position and heading.
 */
export const ANT_SOURCE = `; Langton's ant. The ant stands on a pixel of the 16x16 screen (the edges wrap round). It reads the pixel under it:
;   dark: turn right, light the pixel, step forward      lit: turn left, darken the pixel, step forward
; Out of these two rules comes a messy pattern and, after a few hundred steps, a diagonal road. The ant needs no memory of
; where it has been: the screen is its memory (OUT PIXEL_AT chooses a pixel and IN PIXEL tells whether it is lit).
pos = 0           ; the ant's pixel: y * 16 + x
dir = 1           ; 0 up, 1 right, 2 down, 3 left
t = 2

        LDI 0x88
        STA pos
        LDI 0
        STA dir
step:   LDA pos
        OUT PIXEL_AT
        IN PIXEL
        CMPI 0
        JNZ lit
        LDA dir         ; dark: turn right, light it
        ADDI 1
        ANDI 3
        STA dir
        LDA pos
        OUT PIXEL_ON
        JMP move
lit:    LDA dir         ; lit: turn left, darken it
        ADDI 3
        ANDI 3
        STA dir
        LDA pos
        OUT PIXEL_OFF
move:   LDA dir
        CMPI 0
        JZ up
        CMPI 1
        JZ right
        CMPI 2
        JZ down
left:   LDA pos         ; x - 1, wrapping inside the row
        ANDI 15
        SUBI 1
        ANDI 15
        STA t
        LDA pos
        ANDI 0xF0
        ADD t
        STA pos
        JMP step
right:  LDA pos
        ANDI 15
        ADDI 1
        ANDI 15
        STA t
        LDA pos
        ANDI 0xF0
        ADD t
        STA pos
        JMP step
up:     LDA pos         ; one row up; the byte wraps round by itself
        SUBI 16
        STA pos
        JMP step
down:   LDA pos
        ADDI 16
        STA pos
        JMP step
`

export const PROGRAMS: Program[] = [
  {
    id: 'computer',
    name: '8-bit computer (runs Fibonacci)',
    source: FIBONACCI_SOURCE,
    hz: 4,
    devices: ['number'],
    probes: true,
    note: 'A complete 8-bit computer. The clock steps the program counter (PC) through the program in the ROM. The control ROMs decode each instruction (select one: its rows are listed by name and by the signals they switch on), and the adders, logic unit, RAM and accumulator carry it out. OUT NUMBER sends the accumulator to the decimal display at the right. Click the Program ROM to read or edit its assembly (the SKASM… button explains the language). ◀ Back steps back one clock edge, and it pauses by itself at HALT. New to this? Try the Beginner example first.',
  },
  {
    id: 'computer-lcd',
    name: 'Computer + LCD: bouncing ball',
    source: BALL_SOURCE,
    hz: 64,
    devices: ['lcd'],
    note: 'The 8-bit computer with an LCD. Its program keeps the ball’s position as one byte (row × 16 + column) and adds a step of +1 or −1 for sideways and ±16 for up and down. OUT PIXEL_ON lights the pixel at that position and OUT PIXEL_OFF darkens it. SHL moves the column into the high nibble so CMPI can test for an edge, and JZ turns the ball round. Click the Program ROM to read the assembly.',
  },
  {
    id: 'computer-sound',
    name: 'Computer + speaker: siren',
    source: SIREN_SOURCE,
    hz: 1024,
    devices: ['speaker'],
    octaves: 4,
    note: 'The 8-bit computer with a speaker. OUT SPEAKER flips a flip-flop that drives the speaker, so the program makes a note by sending it over and over with a short pause (a countdown loop) between: the shorter the pause, the higher the note. The siren glides up and down. Press Run and click the page once to allow sound; the speaker’s “Octaves up” setting lifts the notes into the audible range, because this computer is slow.',
  },
  {
    id: 'computer-calc',
    name: 'Computer + keypad: calculator',
    source: CALC_SOURCE,
    hz: 512,
    devices: ['console', 'keypad'],
    keypad: 'calc',
    note: 'The 8-bit computer with a calculator keypad and a display. Click keys to type a sum of whole numbers up to 255, such as 23 + 10, then = (E means too big or divided by zero; C clears). The keypad sends each key as a number; IN KEY reads it, OUT KEY_ACK says it has been read, OUT CHAR prints a character. A digit does cur × 10 + digit with shifts; × and ÷ are repeated addition and subtraction; the answer is turned into digits by subtracting hundreds and tens.',
  },
  {
    id: 'computer-tictactoe',
    name: 'Computer + LCD + keypad: tic-tac-toe',
    source: TICTACTOE_SOURCE,
    hz: 512,
    devices: ['lcd', 'console', 'keypad'],
    note: 'Tic-tac-toe for two players, X first. The nine keys 0 1 2 / 4 5 6 / 8 9 A of the keypad are the nine cells of the board on the LCD; the other keys do nothing. Each player’s marks are three bytes in RAM, one per row, with a bit per column, and after every move the two sets swap so the same code serves both players. A row is won when a byte is 7, a column when the three bytes share a bit, a diagonal when the bits line up after shifting. The result is printed on the text console. Press Reset to play again.',
  },
  {
    id: 'computer-pong',
    name: 'Computer + LCD + gamepad: pong',
    source: PONG_SOURCE,
    hz: 512,
    devices: ['lcd', 'number', 'gamepad'],
    note: 'Pong against a wall. Hold up or down on the gamepad (click it, or use the arrow keys while it runs) to move your paddle, the three pixels on the left edge; return the ball to score. The ball is one byte, row × 16 + column, moved by sideways and up/down steps like the bouncing ball. The program tests the column to find the wall, the paddle and a miss (ball in column 0: HALT), and every return shortens the pause between frames. IN PAD reads which buttons are held right now, so the paddle moves one row per frame for as long as you hold the button.',
  },
  {
    id: 'computer-snake',
    name: 'Computer + LCD + gamepad: snake',
    source: SNAKE_SOURCE,
    hz: 512,
    devices: ['lcd', 'number', 'console', 'gamepad'],
    note: 'Snake. Steer with the direction pad (click it, or use the arrow keys or W A S D while it runs) and eat the food to grow to length 8 (shown on the decimal display). The walls are the lit edge of the screen; hit one, or yourself, and the game halts with “Game over” on the console. The body is eight RAM bytes, each a screen position; every frame each takes its neighbour’s value, the new head goes in the first and the old tail pixel goes out (unless you just ate). RAM cannot be addressed by a variable, so the program jumps to different code for each length. Reset to play again.',
  },
  {
    id: 'computer-sieve',
    name: 'Computer + console: prime sieve (index register)',
    source: SIEVE_SOURCE,
    hz: 4096,
    devices: ['console'],
    note: 'The sieve of Eratosthenes: it prints the primes below 240. A flag for every number is kept in the 256-byte RAM, and the program reaches them with the index register X: TAX points X at a flag, LDX reads it and STX writes it. Without X an instruction can only name one of the first 16 bytes. It needs a few thousand instructions, so it runs at 4 kHz. Click the Data RAM to watch the flags fill in.',
  },
  {
    id: 'computer-sine',
    name: 'Computer + LCD: a scrolling sine wave (table ROM)',
    source: SINE_SOURCE,
    hz: 2048,
    devices: ['lcd'],
    note: 'A sine wave scrolls across the LCD. The height of the wave at each of the 16 columns is a byte in a table: the .byte line at the end of the program fills a second ROM output, and LDT reads the byte at the index register X. Without a table the program would need an instruction for every number. Open the Program ROM to see the table under the listing.',
  },
  {
    id: 'computer-ant',
    name: 'Computer + LCD: Langton\'s ant (reads the screen)',
    source: ANT_SOURCE,
    hz: 4096,
    devices: ['lcd'],
    note: 'Langton’s ant: on a dark pixel it turns right and lights it, on a lit pixel it turns left and darkens it, then steps forward (the edges wrap round). The program has no map of where it has been, because the screen is its memory: OUT PIXEL_AT chooses a pixel and IN PIXEL reads whether it is lit. Run it fast and watch the pattern turn messy, then build a diagonal road.',
  },
  {
    id: 'computer-raycaster',
    name: 'Computer + LCD + gamepad: a 3D raycaster',
    source: RAYCASTER_SOURCE,
    hz: 4096,
    devices: ['lcd', 'gamepad'],
    note: 'A first-person view of an 8×8 maze, drawn by a raycaster: one ray per screen column, marched through the map until it hits a wall; the distance sets the height and shade of the wall bar. The picture is redrawn from left to right and takes a second or two. Each tap of left or right turns you 17°, up and down walk half a cell (arrow keys work too); taps made while it draws are remembered and used when it is done. The map and tables are in the table ROM.',
  },
]

export function buildComputer2(p: Program): Circuit {
  const { b } = computer2Builder({ source: p.source, hz: p.hz, devices: p.devices, octaves: p.octaves, keypad: p.keypad, probes: p.probes })
  return b.build(0)
}
