import { SKASM, SKASM_OPS, assemble, toHexWords } from '../engine/isa'
import { CircuitBuilder } from './builder'
import { boundsRect, type Circuit } from './circuit'

/**
 * The computer that runs SKASM (see `engine/isa.ts`). It has the devices an example asks for, and only those, reached with
 * `OUT` and `IN` through the ports every computer shares:
 *
 *   console   `OUT CHAR` prints the accumulator as a character
 *   lcd       `OUT PIXEL_ON` lights the pixel at (low nibble, high nibble) of the accumulator, `OUT PIXEL_OFF` darkens it
 *   speaker   `OUT SPEAKER` flips it
 *   keypad    `IN KEY` reads it (the key in bits 0–3, bit 4 set while a press is waiting); `OUT KEY_ACK` says it has been read
 */

export const ROM_WORDS = 256

// ---- Control ROMs ------------------------------------------------------------------------------

/**
 * Two ROMs turn an instruction into control signals. Both are addressed by 8 bits: the opcode (bits 4–7 of the word)
 * and the sub-opcode (the instruction's bits 0–3 for opcode 14, bits 12–15 for opcode 15, otherwise 0).
 *
 * Control ROM 1, bit by bit:
 *   0 load the accumulator            1–3 where it comes from: 0 the constant, 1 the ALU (adder or logic), 2 RAM, 3 shifted
 *   4 write RAM                       left, 4 shifted right, 5 a port
 *   5 load the flags                  6 jump          7 jump if no carry       8 jump if zero         9 halt
 *   10 subtract                       11 the second operand is the constant instead of RAM
 *   12 the ALU result is logic, not the adder's      13–14 which logic: 0 AND, 1 OR, 2 XOR
 *   15 the adder takes the carry flag in (ADC, SBC)
 * Control ROM 2: 0 jump if not zero, 1 jump if carry, 2 write to a port.
 */
const LOAD = 1
const SRC = { CONST: 0, ALU: 1, RAM: 2, SHL: 3, SHR: 4, PORT: 5 }
const src = (s: number) => s << 1
const RAM_WRITE = 1 << 4
const FLAGS = 1 << 5
const JUMP = 1 << 6
const JNC = 1 << 7
const JZ = 1 << 8
const HALT = 1 << 9
const SUBTRACT = 1 << 10
const CONST_B = 1 << 11
const LOGIC = 1 << 12
const logic = (op: 0 | 1 | 2) => LOGIC | (op << 13)
const CARRY_IN = 1 << 15
const JNZ2 = 1
const JC2 = 2
const PORT_WRITE = 4

const ARITH = LOAD | src(SRC.ALU) | FLAGS

/** The control bits of every instruction: [control ROM 1, control ROM 2]. */
const CONTROL: Record<string, [number, number]> = {
  LDI: [LOAD | src(SRC.CONST), 0],
  LDA: [LOAD | src(SRC.RAM), 0],
  STA: [RAM_WRITE, 0],
  JMP: [JUMP, 0],
  ADD: [ARITH, 0],
  SUB: [ARITH | SUBTRACT, 0],
  JNC: [JNC, 0],
  HALT: [HALT, 0],
  JZ: [JZ, 0],
  ADDI: [ARITH | CONST_B, 0],
  CMPI: [FLAGS | SUBTRACT | CONST_B, 0],
  SHL: [LOAD | src(SRC.SHL), 0],
  SHR: [LOAD | src(SRC.SHR), 0],
  SUBI: [ARITH | SUBTRACT | CONST_B, 0],
  ANDI: [ARITH | CONST_B | logic(0), 0],
  ORI: [ARITH | CONST_B | logic(1), 0],
  XORI: [ARITH | CONST_B | logic(2), 0],
  OUT: [0, PORT_WRITE],
  IN: [LOAD | src(SRC.PORT), 0],
  JNZ: [0, JNZ2],
  JC: [0, JC2],
  CMP: [FLAGS | SUBTRACT, 0],
  AND: [ARITH | logic(0), 0],
  OR: [ARITH | logic(1), 0],
  XOR: [ARITH | logic(2), 0],
  ADC: [ARITH | CARRY_IN, 0],
  SBC: [ARITH | SUBTRACT | CARRY_IN, 0],
  NOP: [0, 0],
}

/** The two control ROMs as arrays of words, indexed by opcode + 16 × sub-opcode. */
export function controlWords(): { rom1: number[]; rom2: number[] } {
  const rom1 = new Array<number>(256).fill(0)
  const rom2 = new Array<number>(256).fill(0)
  for (const [name, op] of Object.entries(SKASM_OPS)) {
    const bits = CONTROL[name]
    if (!bits) throw new Error(`The control ROM has no row for ${name}`)
    const at = op.code | ((op.sub ?? 0) << 4)
    rom1[at] = bits[0]
    rom2[at] = bits[1]
  }
  return { rom1, rom2 }
}

const hexRom = (words: number[], digits: number) => words.map((w) => w.toString(16).toUpperCase().padStart(digits, '0')).join(' ')
export const CONTROL_1 = hexRom(controlWords().rom1, 4)
export const CONTROL_2 = hexRom(controlWords().rom2, 2)

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

export const programWords = (source: string) => {
  const r = assemble(SKASM, source, ROM_WORDS)
  if (r.errors.length) throw new Error(`Program does not assemble: ${r.errors.map((e) => `${e.line}: ${e.message}`).join('; ')}`)
  return toHexWords(r.words, SKASM.bits)
}

// ---- The circuit -------------------------------------------------------------------------------

const NIB = ['A', 'B', 'C', 'D']
const Q = ['QA', 'QB', 'QC', 'QD']
const bits = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

export type Device = 'lcd' | 'speaker' | 'console' | 'keypad'

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
}

/** The computer, and the id of each named part. Parts are stacked in columns, left to right in the order data flows. */
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
  // The buses that reach many parts (the control bits, the clock, the accumulator, the constant in the instruction) are sent
  // by name: a Send label at the source and a Receive label at each destination are one wire. Labels are placed last, when
  // every part is in place; a label that has no room is replaced by an ordinary wire.
  const links: { from: string; to: string }[] = []
  const netNames = new Map<string, string>()
  const wire = (from: string, to: string) => {
    links.push({ from, to })
  }
  const named = (pin: string, name: string) => netNames.set(pin, name)
  const wireBits = (from: string, fromPins: string[], to: string, toPins: string[]) => fromPins.forEach((p, i) => wire(`${from}.${p}`, `${to}.${toPins[i]}`))

  // Columns, left to right.
  const FETCH = 0
  const ROM = 380
  const CTL = 780
  const DECODE = 1140
  const MEM = 1420
  const BSEL = 1700
  const XOR = 1960
  const ADD = 2140
  const LOGIC_UNIT = 2400
  const RESULT = 2700
  const INMUX = 2960
  const ACCMUX_LO = 3240
  const ACCMUX_HI = 3520
  const ACC = 3820
  const DEVICES = 4120

  // ---- Fetch: program counter (8 bits: two counters) and the program ROM ----------------------------
  const clk = part(FETCH, 'clk', 'clock', { params: { hz: o.hz }, label: 'Clock' })
  const pcLo = part(FETCH, 'pcLo', 'counterld', { label: 'PC low' })
  const pcHi = part(FETCH, 'pcHi', 'counterld', { label: 'PC high' })
  const zero = part(FETCH, 'zero0', 'const', { params: { value: 0 } })
  const prog = part(ROM, 'prog', 'rom', { params: { abits: 8, dbits: 16, isa: SKASM.id, source: o.source, data: programWords(o.source) }, label: 'Program' })
  named(`${clk}.Q`, 'CLK')
  named(`${zero}.Q`, 'GND')
  for (let i = 0; i < 4; i++) {
    named(`${prog}.D${i}`, `ADDR${i}`) // the address field: a RAM address, a port, or the low bits of a jump target
    named(`${prog}.D${4 + i}`, `OP${i}`)
  }
  for (let i = 8; i < 16; i++) named(`${prog}.D${i}`, `NUM${i - 8}`) // the constant of the instruction
  wireBits(pcLo, bits('Q', 4), prog, bits('A', 4))
  for (let i = 0; i < 4; i++) wire(`${pcHi}.Q${i}`, `${prog}.A${4 + i}`)
  wire(`${clk}.Q`, `${pcLo}.CLK`)
  wire(`${clk}.Q`, `${pcHi}.CLK`)
  // The high counter counts when the low one wraps round, and loads the upper bits of a jump target (bits 8–11 of the word).
  wire(`${pcLo}.CO`, `${pcHi}.EN`)
  for (let i = 0; i < 4; i++) wire(`${prog}.D${8 + i}`, `${pcHi}.D${i}`)
  wireBits(prog, bits('D', 4), pcLo, bits('D', 4))

  // ---- Decode: two control ROMs, addressed by the opcode and the sub-opcode ----------------------------
  const d = (i: number) => `${prog}.D${i}` // bit i of the instruction word
  const gate = (col: number, key: string, type: string, label: string, ins: string[], inputs = ins.length) => {
    const g = part(col, key, type, { ...(type === 'not' || inputs === 2 ? {} : { params: { inputs } }), label }, 20)
    ins.forEach((from, i) => wire(from, `${g}.${String.fromCharCode(65 + i)}`))
    return g
  }
  // Opcodes 14 and 15 are extension groups: their sub-opcode is in bits 0–3 (14) or bits 12–15 (15). For every other
  // opcode the sub-opcode is 0.
  const nd4 = gate(CTL, 'nd4', 'not', 'not bit 4', [d(4)])
  const op14 = gate(CTL, 'op14', 'and', 'opcode 14: immediate extension', [`${nd4}.Y`, d(5), d(6), d(7)])
  const op15 = gate(CTL, 'op15', 'and', 'opcode 15: address extension', [d(4), d(5), d(6), d(7)])
  const ctl = part(CTL, 'ctl', 'rom', { params: { abits: 8, dbits: 16, data: CONTROL_1 }, label: 'Control' })
  const ctl2 = part(CTL, 'ctl2', 'rom', { params: { abits: 8, dbits: 8, data: CONTROL_2 }, label: 'Control 2' })
  for (let i = 0; i < 4; i++) {
    wire(d(4 + i), `${ctl}.A${i}`)
    wire(d(4 + i), `${ctl2}.A${i}`)
    const s14 = gate(CTL, `sub14_${i}`, 'and', `sub-opcode bit ${i} from bit ${i}`, [`${op14}.Y`, d(i)])
    const s15 = gate(CTL, `sub15_${i}`, 'and', `sub-opcode bit ${i} from bit ${12 + i}`, [`${op15}.Y`, d(12 + i)])
    const sub = gate(CTL, `sub${i}`, 'or', `sub-opcode bit ${i}`, [`${s14}.Y`, `${s15}.Y`])
    wire(`${sub}.Y`, `${ctl}.A${4 + i}`)
    wire(`${sub}.Y`, `${ctl2}.A${4 + i}`)
  }
  const flags = part(ACC, 'flags', 'register', { label: 'Flags' })
  ;['LOAD_ACC', 'SRC0', 'SRC1', 'SRC2', 'WRITE_RAM', 'SAVE_FLAGS', 'JUMP', '', '', '', 'SUBTRACT', 'B_IS_NUM', 'LOGIC', 'LOGIC_OP0', 'LOGIC_OP1'].forEach((name, i) => name && named(`${ctl}.D${i}`, name))
  named(`${flags}.QA`, 'CARRY')
  named(`${flags}.QB`, 'ZERO')

  // The program counter loads a jump target when the instruction jumps, or when its condition holds: JNC with the carry
  // clear, JC with it set, JZ with the zero flag, JNZ without it.
  const ncarry = gate(CTL, 'ncarry', 'not', 'no carry', [`${flags}.QA`])
  const nzero = gate(CTL, 'nzero', 'not', 'not zero', [`${flags}.QB`])
  const jnc = gate(CTL, 'jnc', 'and', 'JNC and no carry', [`${ctl}.D7`, `${ncarry}.Y`])
  const jc = gate(CTL, 'jc', 'and', 'JC and carry', [`${ctl2}.D1`, `${flags}.QA`])
  const jz = gate(CTL, 'jz', 'and', 'JZ and zero', [`${ctl}.D8`, `${flags}.QB`])
  const jnz = gate(CTL, 'jnz', 'and', 'JNZ and not zero', [`${ctl2}.D0`, `${nzero}.Y`])
  const take = gate(CTL, 'take', 'or', 'load PC', [`${ctl}.D6`, `${jnc}.Y`, `${jc}.Y`, `${jz}.Y`, `${jnz}.Y`])
  for (const pc of [pcLo, pcHi]) wire(`${take}.Y`, `${pc}.LD`)
  const nhalt = gate(CTL, 'nhalt', 'not', 'not halted', [`${ctl}.D9`])
  wire(`${nhalt}.Y`, `${pcLo}.EN`)
  const halted = part(FETCH, 'halted', 'led', { label: 'Halted', params: { color: 'red' } })
  wire(`${ctl}.D9`, `${halted}.A`)
  const stop = part(FETCH, 'stop', 'breakpoint', { label: 'Pause at HALT', params: { value: 1 } })
  wire(`${ctl}.D9`, `${stop}.A`)

  // ---- Which port is addressed: only the decoding the devices need ----------------------------------------
  // The port number of OUT and IN is the address field (bits 0–3).
  const gates: Record<string, string> = {}
  const not = (key: string, label: string, from: string) =>
    (gates[key] ??= (() => {
      const g = part(DECODE, key, 'not', { label }, 20)
      wire(from, `${g}.A`)
      return `${g}.Y`
    })())
  /** The output of an AND that is 1 when the port number is `n`. */
  const select = (n: number) => {
    const key = `sel${n}`
    if (gates[key]) return gates[key]
    const pins = [0, 1, 2, 3].map((i) => ((n >> i) & 1 ? d(i) : not(`na${i}`, `not bit ${i}`, d(i))))
    const g = part(DECODE, key, 'and', { params: { inputs: 4 }, label: `port ${n}` }, 20)
    pins.forEach((p, i) => wire(p, `${g}.${String.fromCharCode(65 + i)}`))
    return (gates[key] = `${g}.Y`)
  }
  /** 1 for the cycle in which the program does `OUT` to port `n`. */
  const writeTo = (n: number, label: string) => {
    const g = part(DECODE, `we${n}`, 'and', { label }, 20)
    wire(`${ctl2}.D2`, `${g}.A`)
    wire(select(n), `${g}.B`)
    return `${g}.Y`
  }

  // ---- Execute: RAM, adder/subtractor, logic, accumulator ----------------------------------------------
  const ram = part(MEM, 'ram', 'ram', { params: { dbits: 8 }, label: 'Data RAM' })
  const accLo = part(ACC, 'accLo', 'register', { label: 'ACC low' })
  const accHi = part(ACC, 'accHi', 'register', { label: 'ACC high' })
  const accBit = (bit: number) => `${bit < 4 ? accLo : accHi}.${Q[bit % 4]}`
  for (let bit = 0; bit < 8; bit++) named(accBit(bit), `ACC${bit}`)
  wireBits(prog, bits('D', 4), ram, bits('A', 4))
  wire(`${ctl}.D4`, `${ram}.WE`)
  wire(`${clk}.Q`, `${ram}.CLK`)
  Q.forEach((q, i) => {
    wire(`${accLo}.${q}`, `${ram}.D${i}`)
    wire(`${accHi}.${q}`, `${ram}.D${i + 4}`)
  })

  // The second operand: RAM, or the constant of the instruction (ADDI, SUBI, CMPI, ANDI...), then inverted for subtraction.
  const addLo = part(ADD, 'addLo', 'add4', { label: 'Adder low' })
  const addHi = part(ADD, 'addHi', 'add4', { label: 'Adder high' })
  wireBits(accLo, Q, addLo, bits('A', 4))
  wireBits(accHi, Q, addHi, bits('A', 4))
  const operandB: string[] = []
  for (let bit = 0; bit < 8; bit++) {
    const adder = bit < 4 ? addLo : addHi
    const m = part(BSEL, `bsel${bit}`, 'mux', { params: { n: 2 }, label: `operand B, bit ${bit}` }, 60)
    wire(`${ram}.Q${bit}`, `${m}.I0`)
    wire(`${prog}.D${8 + bit}`, `${m}.I1`)
    wire(`${ctl}.D11`, `${m}.S0`)
    operandB.push(`${m}.Y`)
    named(`${m}.Y`, `B${bit}`)
    const x = part(XOR, `x${bit}`, 'xor', { label: `B xor SUB, bit ${bit}` }, 20)
    wire(`${m}.Y`, `${x}.A`)
    wire(`${ctl}.D10`, `${x}.B`)
    wire(`${x}.Y`, `${adder}.B${bit % 4}`)
  }
  // The carry in: 0 for ADD, 1 for SUB; ADC and SBC use the carry flag (after a subtraction it is the borrow, so SBC takes its opposite).
  const useCarry = part(ADD, 'useCarry', 'and', { label: 'ADC / SBC and carry' }, 20)
  wire(`${ctl}.D15`, `${useCarry}.A`)
  wire(`${flags}.QA`, `${useCarry}.B`)
  const carryIn = part(ADD, 'carryIn', 'xor', { label: 'carry in: SUB xor flag' }, 20)
  wire(`${ctl}.D10`, `${carryIn}.A`)
  wire(`${useCarry}.Y`, `${carryIn}.B`)
  wire(`${carryIn}.Y`, `${addLo}.Ci`)
  wire(`${addLo}.Co`, `${addHi}.Ci`)

  // The logic unit: AND, OR and XOR of the accumulator and the second operand, one op chosen by control bits 13–14; then,
  // bit by bit, the ALU result is the adder's sum or the logic result (control bit 12).
  const result: string[] = []
  for (let bit = 0; bit < 8; bit++) {
    const ins = [accBit(bit), operandB[bit]]
    const lg = (kind: 'and' | 'or' | 'xor') => {
      const g = part(LOGIC_UNIT, `${kind}${bit}`, kind, {}, 10)
      ins.forEach((from, i) => wire(from, `${g}.${'AB'[i]}`))
      return g
    }
    const gAnd = lg('and')
    const gOr = lg('or')
    const gXor = lg('xor')
    const lm = part(LOGIC_UNIT, `logic${bit}`, 'mux', { params: { n: 4 }, label: `logic result, bit ${bit}` }, 80)
    wire(`${gAnd}.Y`, `${lm}.I0`)
    wire(`${gOr}.Y`, `${lm}.I1`)
    wire(`${gXor}.Y`, `${lm}.I2`)
    wire(`${ctl}.D13`, `${lm}.S0`)
    wire(`${ctl}.D14`, `${lm}.S1`)
    const r = part(RESULT, `result${bit}`, 'mux', { params: { n: 2 }, label: `ALU result, bit ${bit}` }, 80)
    wire(`${(bit < 4 ? addLo : addHi)}.S${bit % 4}`, `${r}.I0`)
    wire(`${lm}.Y`, `${r}.I1`)
    wire(`${ctl}.D12`, `${r}.S0`)
    result.push(`${r}.Y`)
  }

  // ---- The keypad is the one device with an input: IN KEY ------------------------------------------------
  const keypad = has('keypad') ? part(DEVICES, 'keypad', 'keypad', { label: 'Keypad', params: { sticky: true, layout: o.keypad ?? 'hex' } }) : undefined
  /** What IN puts on the bus, per bit: the keypad when port KEY is addressed, otherwise 0. */
  const portIn: string[] = []
  for (let bit = 0; bit < 8; bit++) {
    if (!keypad || bit > 4) {
      portIn.push(`${zero}.Q`)
      continue
    }
    const g = part(INMUX, `in${bit}`, 'and', { label: `KEY, bit ${bit}` }, 20)
    wire(bit < 4 ? `${keypad}.K${bit}` : `${keypad}.P`, `${g}.A`)
    wire(select(5), `${g}.B`)
    portIn.push(`${g}.Y`)
  }

  // What the accumulator loads, bit by bit: the constant, the ALU result, RAM, shifted left, shifted right, or a port.
  for (let bit = 0; bit < 8; bit++) {
    const lo = bit < 4
    const m = part(lo ? ACCMUX_LO : ACCMUX_HI, `amux${bit}`, 'mux', { params: { n: 8 }, label: `ACC input, bit ${bit}` }, 90)
    wire(`${prog}.D${8 + bit}`, `${m}.I0`)
    wire(result[bit], `${m}.I1`)
    wire(`${ram}.Q${bit}`, `${m}.I2`)
    wire(bit === 0 ? `${zero}.Q` : accBit(bit - 1), `${m}.I3`)
    wire(bit === 7 ? `${zero}.Q` : accBit(bit + 1), `${m}.I4`)
    wire(portIn[bit], `${m}.I5`)
    ;['S0', 'S1', 'S2'].forEach((sel, i) => wire(`${ctl}.D${1 + i}`, `${m}.${sel}`))
    wire(`${m}.Y`, `${lo ? accLo : accHi}.${NIB[bit % 4]}`)
  }
  for (const acc of [accLo, accHi]) {
    wire(`${ctl}.D0`, `${acc}.LD`)
    wire(`${clk}.Q`, `${acc}.CLK`)
  }

  // ---- Flags: carry (for SUB it means "borrowed") and zero ---------------------------------------------------
  // A logic instruction clears the carry, and the zero flag looks at the ALU result.
  const cx = part(ADD, 'cx', 'xor', { label: 'carry xor SUB' })
  wire(`${addHi}.Co`, `${cx}.A`)
  wire(`${ctl}.D10`, `${cx}.B`)
  const nlogic = part(ADD, 'nlogic', 'not', { label: 'not a logic instruction' }, 20)
  wire(`${ctl}.D12`, `${nlogic}.A`)
  const carryOut = part(ADD, 'carryOut', 'and', { label: 'carry, 0 for logic' }, 20)
  wire(`${cx}.Y`, `${carryOut}.A`)
  wire(`${nlogic}.Y`, `${carryOut}.B`)
  const zeroGate = part(ADD, 'zeroGate', 'nor', { params: { inputs: 8 }, label: 'result is zero' })
  result.forEach((from, i) => wire(from, `${zeroGate}.${String.fromCharCode(65 + i)}`))
  wire(`${carryOut}.Y`, `${flags}.A`)
  wire(`${zeroGate}.Y`, `${flags}.B`)
  wire(`${zero}.Q`, `${flags}.C`)
  wire(`${zero}.Q`, `${flags}.D`)
  wire(`${ctl}.D5`, `${flags}.LD`)
  wire(`${clk}.Q`, `${flags}.CLK`)

  // ---- The devices ---------------------------------------------------------------------------------
  if (has('console')) {
    const con = part(DEVICES, 'console', 'console', { label: 'LCD text display' })
    wire(writeTo(1, 'OUT CHAR'), `${con}.WE`)
    wire(`${clk}.Q`, `${con}.CLK`)
    for (let i = 0; i < 4; i++) {
      wire(`${accLo}.${Q[i]}`, `${con}.D${i}`)
      wire(`${accHi}.${Q[i]}`, `${con}.D${i + 4}`)
    }
  }
  if (has('lcd')) {
    const screen = part(DEVICES, 'screen', 'framebuffer', { params: { colors: 2 }, label: 'LCD' })
    for (let i = 0; i < 4; i++) {
      wire(`${accLo}.${Q[i]}`, `${screen}.X${i}`)
      wire(`${accHi}.${Q[i]}`, `${screen}.Y${i}`)
    }
    wire(select(2), `${screen}.D`) // PIXEL_ON lights, PIXEL_OFF darkens
    const fbSel = gate(DECODE, 'fbSel', 'or', 'PIXEL_ON or PIXEL_OFF', [select(2), select(3)])
    const fbWe = gate(DECODE, 'fbWe', 'and', 'OUT to the screen', [`${ctl2}.D2`, `${fbSel}.Y`])
    wire(`${fbWe}.Y`, `${screen}.WE`)
    wire(`${clk}.Q`, `${screen}.CLK`)
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
  const hexOf = (col: number, key: string, from: string, pins: string[], label?: string) => {
    const d = part(col, key, 'hexdisp', label ? { label } : {})
    wireBits(from, pins, d, NIB)
  }
  hexOf(FETCH, 'pcLoDisp', pcLo, bits('Q', 4), 'PC')
  hexOf(ACC, 'accHiDisp', accHi, Q, 'ACC')
  hexOf(ACC, 'accLoDisp', accLo, Q)
  const carry = part(ACC, 'carry', 'led', { label: 'Carry', params: { color: 'yellow' } })
  const zflag = part(ACC, 'zflag', 'led', { label: 'Zero', params: { color: 'red' } })
  wire(`${flags}.QA`, `${carry}.A`)
  wire(`${flags}.QB`, `${zflag}.A`)

  const byFrom = new Map<string, string[]>()
  for (const l of links) byFrom.set(l.from, [...(byFrom.get(l.from) ?? []), l.to])
  for (const [from, targets] of byFrom) {
    const name = netNames.get(from)
    const sent = name && targets.length >= 3 ? b.tap(from, name) : undefined
    for (const to of targets) if (!(sent && name && b.tag(to, name))) b.wire(from, to)
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
  note: string
}

export const PROGRAMS: Program[] = [
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
]

export function buildComputer2(p: Program): Circuit {
  const { b } = computer2Builder({ source: p.source, hz: p.hz, devices: p.devices, octaves: p.octaves, keypad: p.keypad })
  return b.build(0)
}
