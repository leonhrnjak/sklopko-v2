import { SK82, assemble, toHexWords } from '../engine/isa'
import { CircuitBuilder } from './builder'
import { boundsRect, type Circuit } from './circuit'

/**
 * The second 8-bit computer (instruction set `SK82`): the first one's datapath with a four-bit opcode, jump if zero,
 * immediate arithmetic, shifts, a 32-instruction program ROM, and three devices on the top RAM addresses: a text
 * console (`STA 15`), a pixel screen (`STA 14` lights a pixel, `STA 13` darkens it) and a keypad (`LDA 15`).
 */

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

export const COUNT_SOURCE = `; Count: print the digits 0 to 9 on the console.
; Address 15 is the console: STA 15 prints the accumulator as a character (ASCII).
CON = 15

        LDI 48          ; the character '0'
loop:   STA CON         ; print it
        ADDI 1          ; the next character
        CMPI 58         ; one past '9'? (compare only: the accumulator stays)
        JZ done
        JMP loop
done:   LDI 10          ; a new line
        STA CON
        HALT
`

export const TABLE_SOURCE = `; The 7 times table, printed as 07 14 21 ... 63 on the console.
; The product is kept as two decimal digits: RAM[2] tens and RAM[1] ones, so no division is needed.
CON = 15
left = 0          ; how many numbers are still to print
ones = 1
tens = 2

        LDI 9
        STA left
        LDI 0
        STA ones
        STA tens
next:   LDA ones
        ADDI 7          ; ones + 7
        CMPI 10         ; 10 or more? (carry is clear when it is)
        JNC wrap
        STA ones
        JMP show
wrap:   SUBI 10         ; carry into the tens
        STA ones
        LDA tens
        ADDI 1
        STA tens
show:   LDA tens
        ADDI 48         ; digit to character
        STA CON
        LDA ones
        ADDI 48
        STA CON
        LDI 32          ; a space
        STA CON
        LDA left
        SUBI 1
        STA left
        JZ end          ; the zero flag is from SUBI
        JMP next
end:    HALT
`

export const BOUNCE_SOURCE = `; A pixel bounces along the middle row of the screen.
; Address 14 lights the pixel at (x = low nibble, y = high nibble) of the accumulator, address 13 darkens it.
; The pixel is kept as one byte: y = 7 in the high nibble, x in the low one.
ON = 14
OFF = 13
pixel = 0
step = 1          ; +1 or -1
next = 2

        LDI 0x70
        STA pixel
        LDI 1
        STA step
        LDA pixel
        STA ON
loop:   LDA pixel
        ADD step        ; the next position
        STA next
        STA ON          ; light it before darkening the old one, so there is always a pixel
        LDA pixel
        STA OFF
        LDA next
        STA pixel
        CMPI 0x7F       ; at the right edge?
        JZ goleft
        CMPI 0x70       ; at the left edge?
        JZ goright
        JMP loop
goleft: LDI -1
        STA step
        JMP loop
goright: LDI 1
        STA step
        JMP loop
`

export const KEYS_SOURCE = `; Echo: print the hexadecimal digit of each key pressed on the keypad.
; LDA 15 reads the keypad: the key in bits 0-3 and bit 4 set while a key is held down.
CON = 15
code = 0

wait:   LDA CON
        SHR
        SHR
        SHR
        SHR             ; bit 4 is now bit 0: 1 while a key is held
        ADDI 0          ; sets the zero flag
        JZ wait
        LDA CON
        SUBI 16         ; drop the "held" bit: the key, 0-15
        STA code
        CMPI 10
        JNC letter      ; 10 or more: A-F
        ADDI 48
        JMP print
letter: ADDI 55         ; 'A' is 65
print:  STA CON
release: LDA CON
        SHR
        SHR
        SHR
        SHR
        ADDI 0
        JZ wait         ; the key has been let go
        JMP release
`

export const programWords = (source: string) => {
  const r = assemble(SK82, source, 32)
  if (r.errors.length) throw new Error(`Program does not assemble: ${r.errors.map((e) => `${e.line}: ${e.message}`).join('; ')}`)
  return toHexWords(r.words, SK82.bits)
}

// ---- The circuit -------------------------------------------------------------------------------

const NIB = ['A', 'B', 'C', 'D']
const Q = ['QA', 'QB', 'QC', 'QD']
const bits = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

export interface Computer2Options {
  source: string
  /** Clock rate in Hz. */
  hz: number
}

/** The computer, and the id of each named part. Parts are stacked in columns, left to right in the order data flows. */
export function computer2Builder(o: Computer2Options) {
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

  // ---- Fetch: program counter (5 bits: two counters) and the program ROM ----------------------------
  const clk = part(FETCH, 'clk', 'clock', { params: { hz: o.hz }, label: 'Clock' })
  const pcLo = part(FETCH, 'pcLo', 'counterld', { label: 'PC low' })
  const pcHi = part(FETCH, 'pcHi', 'counterld', { label: 'PC high' })
  const zero = part(FETCH, 'zero0', 'const', { params: { value: 0 } })
  const prog = part(ROM, 'prog', 'rom', { params: { abits: 5, dbits: 16, isa: SK82.id, source: o.source, data: programWords(o.source) }, label: 'Program' })
  wireBits(pcLo, bits('Q', 4), prog, bits('A', 4))
  wire(`${pcHi}.Q0`, `${prog}.A4`)
  wire(`${clk}.Q`, `${pcLo}.CLK`)
  wire(`${clk}.Q`, `${pcHi}.CLK`)
  // The high counter counts when the low one wraps round, and loads bit 4 of a jump target (bit 8 of the word).
  wire(`${pcLo}.CO`, `${pcHi}.EN`)
  wire(`${prog}.D8`, `${pcHi}.D0`)
  for (const i of [1, 2, 3]) wire(`${zero}.Q`, `${pcHi}.D${i}`)
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

  // ---- Devices on addresses 13, 14 and 15 ------------------------------------------------------------
  const a = (i: number) => `${prog}.D${i}`
  const na0 = part(DECODE, 'na0', 'not', { label: 'not A0' }, 20)
  const na1 = part(DECODE, 'na1', 'not', { label: 'not A1' }, 20)
  wire(a(0), `${na0}.A`)
  wire(a(1), `${na1}.A`)
  const sel = (key: string, label: string, pins: string[]) => {
    const g = part(DECODE, key, 'and', { params: { inputs: 4 }, label }, 20)
    pins.forEach((p, i) => wire(p, `${g}.${String.fromCharCode(65 + i)}`))
    return g
  }
  const sel15 = sel('sel15', 'address 15', [a(0), a(1), a(2), a(3)])
  const sel14 = sel('sel14', 'address 14', [`${na0}.Y`, a(1), a(2), a(3)])
  const sel13 = sel('sel13', 'address 13', [a(0), `${na1}.Y`, a(2), a(3)])
  const conWe = part(DECODE, 'conWe', 'and', { label: 'write to console' }, 20)
  wire(`${ctl}.D4`, `${conWe}.A`)
  wire(`${sel15}.Y`, `${conWe}.B`)
  const fbSel = part(DECODE, 'fbSel', 'or', { label: 'address 13 or 14' }, 20)
  wire(`${sel14}.Y`, `${fbSel}.A`)
  wire(`${sel13}.Y`, `${fbSel}.B`)
  const fbWe = part(DECODE, 'fbWe', 'and', { label: 'write to screen' }, 20)
  wire(`${ctl}.D4`, `${fbWe}.A`)
  wire(`${fbSel}.Y`, `${fbWe}.B`)

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

  // The keypad is read through address 15: RAM or keypad, bit by bit.
  const keypad = part(INMUX, 'keypad', 'keypad', { label: 'Keypad' })
  const inbit = (bit: number) => (bit < 4 ? `${keypad}.K${bit}` : bit === 4 ? `${keypad}.P` : `${zero}.Q`)
  const memOrIn: string[] = []
  for (let bit = 0; bit < 8; bit++) {
    const m = part(INMUX, `in${bit}`, 'mux', { params: { n: 2 }, label: `RAM or keypad, bit ${bit}` }, 20)
    wire(`${ram}.Q${bit}`, `${m}.I0`)
    wire(inbit(bit), `${m}.I1`)
    wire(`${sel15}.Y`, `${m}.S0`)
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
  const con = part(DEVICES, 'console', 'console', { label: 'Console' })
  wire(`${conWe}.Y`, `${con}.WE`)
  wire(`${clk}.Q`, `${con}.CLK`)
  const screen = part(DEVICES, 'screen', 'framebuffer', { params: { colors: 2 }, label: 'Screen' })
  for (let i = 0; i < 4; i++) {
    wire(`${accLo}.${Q[i]}`, `${screen}.X${i}`)
    wire(`${accHi}.${Q[i]}`, `${screen}.Y${i}`)
  }
  wire(`${sel14}.Y`, `${screen}.D`)
  wire(`${fbWe}.Y`, `${screen}.WE`)
  wire(`${clk}.Q`, `${screen}.CLK`)
  for (let i = 0; i < 4; i++) {
    wire(`${accLo}.${Q[i]}`, `${con}.D${i}`)
    wire(`${accHi}.${Q[i]}`, `${con}.D${i + 4}`)
  }

  // ---- Readouts ------------------------------------------------------------------------------------
  const hexOf = (col: number, key: string, from: string, pins: string[], label?: string) => {
    const d = part(col, key, 'hexdisp', label ? { label } : {})
    wireBits(from, pins, d, NIB)
  }
  hexOf(FETCH, 'pcLoDisp', pcLo, Q.map((_, i) => `Q${i}`), 'PC')
  hexOf(ACC, 'accHiDisp', accHi, Q, 'ACC')
  hexOf(ACC, 'accLoDisp', accLo, Q)
  const carry = part(ACC, 'carry', 'led', { label: 'Carry', params: { color: 'yellow' } })
  const zflag = part(ACC, 'zflag', 'led', { label: 'Zero', params: { color: 'red' } })
  wire(`${flags}.QA`, `${carry}.A`)
  wire(`${flags}.QB`, `${zflag}.A`)
  return { b, keys }
}

/** A program on the computer: a title for the note, and the speed it looks best at. */
export interface Program {
  id: string
  name: string
  source: string
  hz: number
  note: string
}

export const PROGRAMS: Program[] = [
  {
    id: 'computer2',
    name: '8-bit computer 2: bouncing pixel',
    source: BOUNCE_SOURCE,
    hz: 32,
    note: 'The second computer. A pixel bounces along the middle row of the screen: the program adds +1 or −1 to its position and turns round at the edges (JZ). Writing to RAM address 14 lights a pixel, address 13 darkens one; 15 is the console. Click the Program ROM to read or change the assembly.',
  },
  {
    id: 'computer2-count',
    name: '8-bit computer 2: counting on the console',
    source: COUNT_SOURCE,
    hz: 16,
    note: 'Prints 0123456789 on the console. STA 15 sends the accumulator to the console as an ASCII character; ADDI adds a constant and CMPI compares with one (JZ then jumps if they are equal). Select the console to read its text.',
  },
  {
    id: 'computer2-table',
    name: '8-bit computer 2: multiplication table',
    source: TABLE_SOURCE,
    hz: 64,
    note: 'Prints the 7 times table. The product is kept as two decimal digits, so no division is needed: add 7 to the ones, and when it reaches 10 subtract 10 and add 1 to the tens (the carry flag tells). Change the 7 in the program for another table.',
  },
  {
    id: 'computer2-keys',
    name: '8-bit computer 2: keypad echo',
    source: KEYS_SOURCE,
    hz: 64,
    note: 'Press keys on the keypad (click and hold) and their digits appear on the console. LDA 15 reads the keypad: the key in bits 0–3 and bit 4 set while one is held. The program shifts bit 4 down with SHR to test it.',
  },
]

export function buildComputer2(p: Program): Circuit {
  const { b } = computer2Builder({ source: p.source, hz: p.hz })
  return b.build(0)
}
