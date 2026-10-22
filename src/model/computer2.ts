import { SK82, assemble, toHexWords } from '../engine/isa'
import { CircuitBuilder } from './builder'
import { boundsRect, type Circuit } from './circuit'

/**
 * The second 8-bit computer (instruction set `SK82`): the first one's datapath with a four-bit opcode, jump if zero,
 * immediate arithmetic, shifts and a 256-instruction program ROM. It has the devices an example asks for, on the
 * top RAM addresses, and only those:
 *
 *   lcd      the pixel screen: `STA 14` lights the pixel at (low nibble, high nibble) of the accumulator, `STA 13` darkens it
 *   speaker  `STA 14` flips it
 *   console  `STA 15` prints the accumulator as a character
 *   keypad   `LDA 15` reads it (the key in bits 0–3, bit 4 set while a press is waiting); `STA 14` says it has been read
 */

export const ROM_WORDS = 256

// ---- Control ROM -------------------------------------------------------------------------------

/**
 * One word per opcode. Bits: 0 accumulator load, 1–3 accumulator source (0 constant, 1 adder, 2 RAM or keypad, 3 shifted
 * left, 4 shifted right), 4 RAM write, 5 flags load, 6 jump, 7 jump if no carry, 8 jump if zero, 9 halt, 10 subtract,
 * 11 the adder's second operand is the constant instead of RAM.
 */
export const CONTROL2_WORDS = [
  0x0001, // 0 LDI
  0x0005, // 1 LDA
  0x0010, // 2 STA
  0x0040, // 3 JMP
  0x0023, // 4 ADD
  0x0423, // 5 SUB
  0x0080, // 6 JNC
  0x0200, // 7 HALT
  0x0100, // 8 JZ
  0x0823, // 9 ADDI
  0x0c20, // 10 CMPI: flags only
  0x0007, // 11 SHL
  0x0009, // 12 SHR
  0x0c23, // 13 SUBI
  0x0000,
  0x0000,
]
export const CONTROL2 = CONTROL2_WORDS.map((w) => w.toString(16).toUpperCase().padStart(4, '0')).join(' ')

// ---- Programs ----------------------------------------------------------------------------------

/** A ball bounces round the LCD: both directions turn round at the edges. */
export const BALL_SOURCE = `; A ball bounces round the 16x16 screen.
; Address 14 lights the pixel at (x = low nibble, y = high nibble) of the accumulator, address 13 darkens it.
; The position is one byte, y*16 + x, so moving right is +1 and moving down is +16.
ON = 14
OFF = 13
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
        STA ON
move:   LDA pos
        ADD sx
        ADD sy
        STA next
        STA ON          ; light the new pixel before darkening the old one
        LDA pos
        STA OFF
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
export const SIREN_SOURCE = `; A siren. STA 14 flips the speaker; a note is the speaker flipped 16 times with a pause
; between flips, and the shorter the pause, the higher the note. The notes glide up, then down.
SPK = 14
wait = 0          ; the pause: counted down in the loop below
dir = 1           ; added to the pause after each note: -1 higher, +1 lower
left = 2          ; flips left in this note

        LDI 12
        STA wait        ; start low
        LDI -1
        STA dir
note:   LDI 16
        STA left
flip:   STA SPK         ; flip the speaker
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
; Address 15 is the display (STA prints a character) and the keypad (LDA reads it).
; STA 14 tells the keypad that the key has been read.
CON = 15
KEYPAD = 15
ACK = 14
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
main:   LDA KEYPAD
        SHR
        SHR
        SHR
        SHR             ; bit 4 of the keypad word is 1 when a key is waiting
        ADDI 0
        JZ main
        LDA KEYPAD
        SUBI 16         ; the key, 0-15
        STA key
        STA ACK
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
        STA CON
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
        STA CON
        LDI 1
        STA op
        JMP setop
minus:  LDI 45          ; '-'
        STA CON
        LDI 2
        STA op
        JMP setop
times:  LDI 120         ; 'x'
        STA CON
        LDI 3
        STA op
        JMP setop
divide: LDI 47          ; '/'
        STA CON
        LDI 4
        STA op
setop:  LDA cur         ; the number typed so far is the first number
        STA a
        LDI 0
        STA cur
        JMP main

equals: LDI 61          ; '='
        STA CON
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
        STA CON
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
        STA CON
        JMP tens        ; after hundreds the tens digit is printed even if it is 0
nohund: LDA u
        CMPI 0
        JZ ones
tens:   LDA u
        ADDI 48
        STA CON
ones:   LDA t
        ADDI 48
        STA CON
        LDI 10          ; new line
        STA CON
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
        STA CON
        LDI 10
        STA CON
        JMP reset
clear:  LDI 10
        STA CON
        JMP reset
`

export const programWords = (source: string) => {
  const r = assemble(SK82, source, ROM_WORDS)
  if (r.errors.length) throw new Error(`Program does not assemble: ${r.errors.map((e) => `${e.line}: ${e.message}`).join('; ')}`)
  return toHexWords(r.words, SK82.bits)
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
  /** What is connected. The speaker and the LCD both use address 14, so not both. */
  devices: Device[]
  /** Octaves the speaker plays up (a slow circuit makes notes too low to hear). */
  octaves?: number
  /** The keypad's keys. */
  keypad?: 'hex' | 'calc'
}

/** The computer, and the id of each named part. Parts are stacked in columns, left to right in the order data flows. */
export function computer2Builder(o: Computer2Options) {
  const has = (d: Device) => o.devices.includes(d)
  if (has('lcd') && has('speaker')) throw new Error('The LCD and the speaker both use address 14')
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
  const wire = (from: string, to: string) => b.wire(from, to)
  const wireBits = (from: string, fromPins: string[], to: string, toPins: string[]) => fromPins.forEach((p, i) => b.wire(`${from}.${p}`, `${to}.${toPins[i]}`))

  // Columns, left to right.
  const FETCH = 0
  const ROM = 380
  const CTL = 780
  const DECODE = 1140
  const MEM = 1420
  const BSEL = 1700
  const XOR = 1960
  const ADD = 2140
  const INMUX = 2400
  const ACCMUX_LO = 2680
  const ACCMUX_HI = 2960
  const ACC = 3260
  const DEVICES = 3560

  // ---- Fetch: program counter (8 bits: two counters) and the program ROM ----------------------------
  const clk = part(FETCH, 'clk', 'clock', { params: { hz: o.hz }, label: 'Clock' })
  const pcLo = part(FETCH, 'pcLo', 'counterld', { label: 'PC low' })
  const pcHi = part(FETCH, 'pcHi', 'counterld', { label: 'PC high' })
  const zero = part(FETCH, 'zero0', 'const', { params: { value: 0 } })
  const prog = part(ROM, 'prog', 'rom', { params: { abits: 8, dbits: 16, isa: SK82.id, source: o.source, data: programWords(o.source) }, label: 'Program' })
  wireBits(pcLo, bits('Q', 4), prog, bits('A', 4))
  for (let i = 0; i < 4; i++) wire(`${pcHi}.Q${i}`, `${prog}.A${4 + i}`)
  wire(`${clk}.Q`, `${pcLo}.CLK`)
  wire(`${clk}.Q`, `${pcHi}.CLK`)
  // The high counter counts when the low one wraps round, and loads the upper bits of a jump target (bits 8–11 of the word).
  wire(`${pcLo}.CO`, `${pcHi}.EN`)
  for (let i = 0; i < 4; i++) wire(`${prog}.D${8 + i}`, `${pcHi}.D${i}`)
  wireBits(prog, bits('D', 4), pcLo, bits('D', 4))

  // ---- Decode: the control ROM, addressed by the opcode (bits 4–7) ----------------------------------------
  const ctl = part(CTL, 'ctl', 'rom', { params: { abits: 4, dbits: 16, data: CONTROL2 }, label: 'Control' })
  for (let i = 0; i < 4; i++) wire(`${prog}.D${4 + i}`, `${ctl}.A${i}`)
  const flags = part(ACC, 'flags', 'register', { label: 'Flags' })

  // The program counter loads a jump target when the instruction jumps, or JNC with the carry clear, or JZ with the zero flag.
  const ncarry = part(CTL, 'ncarry', 'not', { label: 'no carry' }, 20)
  const jnc = part(CTL, 'jnc', 'and', { label: 'JNC and no carry' }, 20)
  const jz = part(CTL, 'jz', 'and', { label: 'JZ and zero' }, 20)
  const take = part(CTL, 'take', 'or', { params: { inputs: 3 }, label: 'load PC' }, 20)
  const nhalt = part(CTL, 'nhalt', 'not', { label: 'not halted' }, 20)
  wire(`${flags}.QA`, `${ncarry}.A`)
  wire(`${ctl}.D7`, `${jnc}.A`)
  wire(`${ncarry}.Y`, `${jnc}.B`)
  wire(`${ctl}.D8`, `${jz}.A`)
  wire(`${flags}.QB`, `${jz}.B`)
  wire(`${ctl}.D6`, `${take}.A`)
  wire(`${jnc}.Y`, `${take}.B`)
  wire(`${jz}.Y`, `${take}.C`)
  for (const pc of [pcLo, pcHi]) wire(`${take}.Y`, `${pc}.LD`)
  wire(`${ctl}.D9`, `${nhalt}.A`)
  wire(`${nhalt}.Y`, `${pcLo}.EN`)
  const halted = part(FETCH, 'halted', 'led', { label: 'Halted', params: { color: 'red' } })
  wire(`${ctl}.D9`, `${halted}.A`)
  const stop = part(FETCH, 'stop', 'breakpoint', { label: 'Pause at HALT', params: { value: 1 } })
  wire(`${ctl}.D9`, `${stop}.A`)

  // ---- Which device is addressed: only the decoding the devices need --------------------------------
  const a = (i: number) => `${prog}.D${i}`
  const gates: Record<string, string> = {}
  const not = (key: string, label: string, from: string) =>
    (gates[key] ??= (() => {
      const g = part(DECODE, key, 'not', { label }, 20)
      wire(from, `${g}.A`)
      return `${g}.Y`
    })())
  /** The output of an AND that is 1 when the address field is `n` (13, 14 or 15). */
  const select = (n: 13 | 14 | 15) => {
    const key = `sel${n}`
    if (gates[key]) return gates[key]
    const pins = [0, 1, 2, 3].map((i) => ((n >> i) & 1 ? a(i) : not(`na${i}`, `not A${i}`, a(i))))
    const g = part(DECODE, key, 'and', { params: { inputs: 4 }, label: `address ${n}` }, 20)
    pins.forEach((p, i) => wire(p, `${g}.${String.fromCharCode(65 + i)}`))
    return (gates[key] = `${g}.Y`)
  }
  /** 1 for the cycle in which the program writes to address `n`. */
  const writeTo = (n: 13 | 14 | 15, label: string) => {
    const g = part(DECODE, `we${n}`, 'and', { label }, 20)
    wire(`${ctl}.D4`, `${g}.A`)
    wire(select(n), `${g}.B`)
    return `${g}.Y`
  }

  // ---- Execute: RAM, adder/subtractor, accumulator ---------------------------------------------------
  const ram = part(MEM, 'ram', 'ram', { params: { dbits: 8 }, label: 'Data RAM' })
  const accLo = part(ACC, 'accLo', 'register', { label: 'ACC low' })
  const accHi = part(ACC, 'accHi', 'register', { label: 'ACC high' })
  wireBits(prog, bits('D', 4), ram, bits('A', 4))
  wire(`${ctl}.D4`, `${ram}.WE`)
  wire(`${clk}.Q`, `${ram}.CLK`)
  Q.forEach((q, i) => {
    wire(`${accLo}.${q}`, `${ram}.D${i}`)
    wire(`${accHi}.${q}`, `${ram}.D${i + 4}`)
  })

  // The second operand: RAM, or the constant of the instruction (ADDI, SUBI, CMPI), then inverted for subtraction.
  const addLo = part(ADD, 'addLo', 'add4', { label: 'Adder low' })
  const addHi = part(ADD, 'addHi', 'add4', { label: 'Adder high' })
  wireBits(accLo, Q, addLo, bits('A', 4))
  wireBits(accHi, Q, addHi, bits('A', 4))
  for (let bit = 0; bit < 8; bit++) {
    const adder = bit < 4 ? addLo : addHi
    const m = part(BSEL, `bsel${bit}`, 'mux', { params: { n: 2 }, label: `operand B, bit ${bit}` }, 20)
    wire(`${ram}.Q${bit}`, `${m}.I0`)
    wire(`${prog}.D${8 + bit}`, `${m}.I1`)
    wire(`${ctl}.D11`, `${m}.S0`)
    const x = part(XOR, `x${bit}`, 'xor', { label: `B xor SUB, bit ${bit}` }, 20)
    wire(`${m}.Y`, `${x}.A`)
    wire(`${ctl}.D10`, `${x}.B`)
    wire(`${x}.Y`, `${adder}.B${bit % 4}`)
  }
  wire(`${ctl}.D10`, `${addLo}.Ci`)
  wire(`${addLo}.Co`, `${addHi}.Ci`)

  // With a keypad, address 15 reads it instead of RAM: RAM or keypad, bit by bit.
  const memOrIn: string[] = []
  const keypad = has('keypad') ? part(INMUX, 'keypad', 'keypad', { label: 'Keypad', params: { sticky: true, layout: o.keypad ?? 'hex' } }) : undefined
  for (let bit = 0; bit < 8; bit++) {
    if (!keypad) {
      memOrIn.push(`${ram}.Q${bit}`)
      continue
    }
    const m = part(INMUX, `in${bit}`, 'mux', { params: { n: 2 }, label: `RAM or keypad, bit ${bit}` }, 20)
    wire(`${ram}.Q${bit}`, `${m}.I0`)
    wire(bit < 4 ? `${keypad}.K${bit}` : bit === 4 ? `${keypad}.P` : `${zero}.Q`, `${m}.I1`)
    wire(select(15), `${m}.S0`)
    memOrIn.push(`${m}.Y`)
  }

  // What the accumulator loads, bit by bit: constant, adder, RAM/keypad, shifted left, shifted right.
  const accBit = (bit: number) => `${bit < 4 ? accLo : accHi}.${Q[bit % 4]}`
  for (let bit = 0; bit < 8; bit++) {
    const lo = bit < 4
    const m = part(lo ? ACCMUX_LO : ACCMUX_HI, `amux${bit}`, 'mux', { params: { n: 8 }, label: `ACC input, bit ${bit}` }, 20)
    wire(`${prog}.D${8 + bit}`, `${m}.I0`)
    wire(`${lo ? addLo : addHi}.S${bit % 4}`, `${m}.I1`)
    wire(memOrIn[bit], `${m}.I2`)
    wire(bit === 0 ? `${zero}.Q` : accBit(bit - 1), `${m}.I3`)
    wire(bit === 7 ? `${zero}.Q` : accBit(bit + 1), `${m}.I4`)
    ;['S0', 'S1', 'S2'].forEach((s, i) => wire(`${ctl}.D${1 + i}`, `${m}.${s}`))
    wire(`${m}.Y`, `${lo ? accLo : accHi}.${NIB[bit % 4]}`)
  }
  for (const acc of [accLo, accHi]) {
    wire(`${ctl}.D0`, `${acc}.LD`)
    wire(`${clk}.Q`, `${acc}.CLK`)
  }

  // ---- Flags: carry (for SUB it means "borrowed") and zero -----------------------------------------------
  const cx = part(ADD, 'cx', 'xor', { label: 'carry xor SUB' })
  wire(`${addHi}.Co`, `${cx}.A`)
  wire(`${ctl}.D10`, `${cx}.B`)
  const zeroGate = part(ADD, 'zeroGate', 'nor', { params: { inputs: 8 }, label: 'result is zero' })
  ;[addLo, addHi].forEach((add, n) => bits('S', 4).forEach((s, i) => wire(`${add}.${s}`, `${zeroGate}.${String.fromCharCode(65 + i + n * 4)}`)))
  wire(`${cx}.Y`, `${flags}.A`)
  wire(`${zeroGate}.Y`, `${flags}.B`)
  wire(`${zero}.Q`, `${flags}.C`)
  wire(`${zero}.Q`, `${flags}.D`)
  wire(`${ctl}.D5`, `${flags}.LD`)
  wire(`${clk}.Q`, `${flags}.CLK`)

  // ---- The devices ---------------------------------------------------------------------------------
  if (has('console')) {
    const con = part(DEVICES, 'console', 'console', { label: 'LCD text display' })
    wire(writeTo(15, 'write to console'), `${con}.WE`)
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
    wire(select(14), `${screen}.D`)
    const fbSel = part(DECODE, 'fbSel', 'or', { label: 'address 13 or 14' }, 20)
    wire(select(14), `${fbSel}.A`)
    wire(select(13), `${fbSel}.B`)
    const fbWe = part(DECODE, 'fbWe', 'and', { label: 'write to screen' }, 20)
    wire(`${ctl}.D4`, `${fbWe}.A`)
    wire(`${fbSel}.Y`, `${fbWe}.B`)
    wire(`${fbWe}.Y`, `${screen}.WE`)
    wire(`${clk}.Q`, `${screen}.CLK`)
  }
  if (has('speaker') || keypad) {
    const we14 = writeTo(14, 'write to address 14')
    // A write to address 14 flips the speaker's T flip-flop, or tells the keypad its key has been read.
    if (has('speaker')) {
      const toggle = part(DEVICES, 'toggle', 'tff', { label: 'Speaker flip-flop' })
      wire(we14, `${toggle}.T`)
      wire(`${clk}.Q`, `${toggle}.CLK`)
      const spk = part(DEVICES, 'speaker', 'speaker', { label: 'Speaker', params: { octaves: o.octaves ?? 0 } })
      wire(`${toggle}.Q`, `${spk}.A`)
    }
    if (keypad) wire(we14, `${keypad}.RST`)
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
    name: 'Computer 2 + LCD: bouncing ball',
    source: BALL_SOURCE,
    hz: 64,
    devices: ['lcd'],
    note: 'The second 8-bit computer with an LCD. Its program keeps the ball’s position as one byte (row × 16 + column) and adds a step of +1 or −1 for sideways and ±16 for up and down. A write to RAM address 14 lights the pixel at that position, address 13 darkens it. SHL moves the column into the high nibble so CMPI can test for an edge, and JZ turns the ball round. Click the Program ROM to read the assembly.',
  },
  {
    id: 'computer-sound',
    name: 'Computer 2 + speaker: siren',
    source: SIREN_SOURCE,
    hz: 1024,
    devices: ['speaker'],
    octaves: 4,
    note: 'The second 8-bit computer with a speaker. A write to RAM address 14 flips a flip-flop that drives the speaker, so the program makes a note by writing over and over with a short pause (a countdown loop) between: the shorter the pause, the higher the note. The siren glides up and down. Press Run and click the page once to allow sound; the speaker’s “Octaves up” setting lifts the notes into the audible range, because this computer is slow.',
  },
  {
    id: 'computer-calc',
    name: 'Computer 2 + keypad: calculator',
    source: CALC_SOURCE,
    hz: 512,
    devices: ['console', 'keypad'],
    keypad: 'calc',
    note: 'The second 8-bit computer with a calculator keypad and a display. Click keys to type a sum of whole numbers up to 255, such as 23 + 10, then = (E means too big or divided by zero; C clears). The keypad sends each key as a number; LDA 15 reads it, STA 14 says it has been read, STA 15 prints a character. A digit does cur × 10 + digit with shifts; × and ÷ are repeated addition and subtraction; the answer is turned into digits by subtracting hundreds and tens.',
  },
]

export function buildComputer2(p: Program): Circuit {
  const { b } = computer2Builder({ source: p.source, hz: p.hz, devices: p.devices, octaves: p.octaves, keypad: p.keypad })
  return b.build(0)
}
