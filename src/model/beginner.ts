import { SKASM, assemble, toHexWords } from '../engine/isa'
import { BEGINNER_CONTROL_TEXT, BEGINNER_ROWS, BEGINNER_SIGNALS } from '../engine/signal-presets'
import { assembleSignals, parseRows, parseSignals } from '../engine/signals'
import { frameAround, note } from './annotate'
import { CircuitBuilder } from './builder'
import { boundsRect, type Circuit } from './circuit'

/**
 * The beginner computer: the smallest machine that really runs a program from a ROM. It is meant to be read: few parts, a
 * name on each, and a note for each of the three steps (fetch, decode, execute). Its numbers are 4 bits (0 to 15) and it
 * knows seven of SKASM's instructions, with the same encodings as every other computer: LDI, LDA, STA, ADD, SUB, JMP and HALT.
 */

export const BEGINNER_SOURCE = `; Add 3 and 4, and keep the answer in RAM.
        LDI 3        ; ACC = 3
        STA 0        ; RAM[0] = 3
        LDI 4        ; ACC = 4
        ADD 0        ; ACC = ACC + RAM[0] = 7: the adder does this
        STA 1        ; RAM[1] = 7
        HALT         ; stop
`

/**
 * The control ROM: one row per opcode (the 4 bits at the top of an instruction's low byte). What the 8 bits are, and what each
 * instruction switches on, is written in words in `engine/signal-presets.ts` (`BEGINNER_SIGNALS`, `BEGINNER_CONTROL_TEXT`); the
 * words are assembled from that here.
 */
const beginnerControl = (): string => {
  const { layout } = parseSignals(BEGINNER_SIGNALS)
  const r = assembleSignals(layout, parseRows(BEGINNER_ROWS).rows, BEGINNER_CONTROL_TEXT, 16, 8)
  if (r.errors.length) throw new Error(`The control ROM does not assemble: ${r.errors.map((e) => `${e.line}: ${e.message}`).join('; ')}`)
  return toHexWords(r.words, 8)
}
export const BEGINNER_CONTROL = beginnerControl()

/** The program as the ROM's 16 words. */
export const beginnerWords = (source: string): string => {
  const r = assemble(SKASM, source, 16)
  if (r.errors.length) throw new Error(`Program does not assemble: ${r.errors.map((e) => `${e.line}: ${e.message}`).join('; ')}`)
  return toHexWords(r.words, SKASM.bits)
}

const Q = ['QA', 'QB', 'QC', 'QD']
const NIB = ['A', 'B', 'C', 'D']

/** The parts and wires, and the id of each named part. */
export function beginnerBuilder(source = BEGINNER_SOURCE, hz = 1) {
  const b = new CircuitBuilder()
  const keys: Record<string, string> = {}
  const cols: Record<number, number> = {}
  /** Add a part at the next free spot of a column (an x position), remembering it under `key`. */
  const part = (col: number, key: string, type: string, opts: Parameters<CircuitBuilder['add']>[3] = {}, gap = 40) => {
    const y = (cols[col] ??= 0)
    const id = b.add(type, col, y, opts)
    cols[col] = y + boundsRect(b.c.comps[id]).h + gap + (opts.label ? 20 : 0)
    return (keys[key] = id)
  }
  // Wires that fan out to many places are sent by name instead: a Send label and Receive labels with the same name are one
  // wire. They are placed last, when every part is in place (a label that has no room becomes a plain wire).
  const links: { from: string; to: string; name?: string }[] = []
  const wire = (from: string, to: string, name?: string) => links.push({ from, to, name })

  const FETCH = 0
  const ROM = 400
  const DECODE = 860
  const RAM = 1360
  const XOR = 1700
  const ADDER = 1900
  const MUX = 2180
  const ACC = 2480

  // 1. Fetch
  const clk = part(FETCH, 'clk', 'clock', { params: { hz }, label: 'Clock' })
  const pc = part(FETCH, 'pc', 'counterld', { label: 'PC: the next instruction' })
  const pcDisp = part(FETCH, 'pcDisp', 'hexdisp', { label: 'PC' })
  const prog = part(ROM, 'prog', 'rom', { params: { abits: 4, dbits: 16, isa: SKASM.id, source, data: beginnerWords(source) }, label: 'Program ROM' })
  for (let i = 0; i < 4; i++) {
    wire(`${pc}.Q${i}`, `${prog}.A${i}`)
    wire(`${pc}.Q${i}`, `${pcDisp}.${NIB[i]}`)
    wire(`${prog}.D${i}`, `${pc}.D${i}`, `ADDR${i}`) // a jump loads the address from the instruction
  }
  wire(`${clk}.Q`, `${pc}.CLK`)

  // 2. Decode
  const ctl = part(DECODE, 'ctl', 'rom', { params: { abits: 4, dbits: 8, data: BEGINNER_CONTROL, signals: BEGINNER_SIGNALS, rows: BEGINNER_ROWS }, label: 'Control ROM' })
  for (let i = 0; i < 4; i++) wire(`${prog}.D${4 + i}`, `${ctl}.A${i}`) // the opcode
  const nhalt = part(DECODE, 'nhalt', 'not', { label: 'not halted' })
  wire(`${ctl}.D6`, `${nhalt}.A`)
  wire(`${nhalt}.Y`, `${pc}.EN`)
  wire(`${ctl}.D5`, `${pc}.LD`, 'JUMP')
  const halted = part(DECODE, 'halted', 'led', { label: 'Halted', params: { color: 'red' } })
  wire(`${ctl}.D6`, `${halted}.A`)
  const stop = part(DECODE, 'stop', 'breakpoint', { label: 'Pause at HALT', params: { value: 1 } })
  wire(`${ctl}.D6`, `${stop}.A`)

  // 3. Execute
  const ram = part(RAM, 'ram', 'ram', { params: { dbits: 4 }, label: 'RAM: data' })
  const acc = part(ACC, 'acc', 'register', { label: 'ACC: the accumulator' })
  const accDisp = part(ACC, 'accDisp', 'hexdisp', { label: 'ACC' })
  const adder = part(ADDER, 'adder', 'add4', { label: 'Adder' })
  // The carry is remembered in a flag: 1 after an ADD that went over 15, or a SUB that went below 0 (it "borrowed"), as in SKASM.
  const carryX = part(ADDER, 'carryX', 'xor', { label: 'carry xor SUB' }, 30)
  const flag = part(ADDER, 'flag', 'register', { label: 'Carry flag' })
  const zero = part(ADDER, 'zero', 'const', { params: { value: 0 } }, 30) // the register's three unused inputs
  const carry = part(ADDER, 'carry', 'led', { label: 'Carry', params: { color: 'yellow' } })
  wire(`${clk}.Q`, `${ram}.CLK`)
  wire(`${clk}.Q`, `${acc}.CLK`)
  wire(`${ctl}.D3`, `${ram}.WE`, 'WRITE_RAM')
  wire(`${ctl}.D0`, `${acc}.LD`, 'LOAD_ACC')
  wire(`${ctl}.D4`, `${adder}.Ci`, 'SUBTRACT') // subtracting adds 1
  wire(`${adder}.Co`, `${carryX}.A`)
  wire(`${ctl}.D4`, `${carryX}.B`, 'SUBTRACT')
  wire(`${carryX}.Y`, `${flag}.A`)
  for (const pin of ['B', 'C', 'D']) wire(`${zero}.Q`, `${flag}.${pin}`)
  wire(`${ctl}.D7`, `${flag}.LD`, 'SAVE_CARRY')
  wire(`${clk}.Q`, `${flag}.CLK`)
  wire(`${flag}.QA`, `${carry}.A`)
  for (let i = 0; i < 4; i++) {
    wire(`${prog}.D${i}`, `${ram}.A${i}`, `ADDR${i}`) // the address in the instruction
    wire(`${acc}.${Q[i]}`, `${ram}.D${i}`)
    wire(`${acc}.${Q[i]}`, `${adder}.A${i}`)
    wire(`${acc}.${Q[i]}`, `${accDisp}.${NIB[i]}`)
    const x = part(XOR, `xor${i}`, 'xor', { label: `flip bit ${i} for SUB` }, 30)
    wire(`${ram}.Q${i}`, `${x}.A`)
    wire(`${ctl}.D4`, `${x}.B`, 'SUBTRACT')
    wire(`${x}.Y`, `${adder}.B${i}`)
    // What the accumulator loads: the number in the instruction (LDI), the adder's answer (ADD, SUB) or a RAM word (LDA).
    const m = part(MUX, `mux${i}`, 'mux', { params: { n: 4 }, label: `ACC input, bit ${i}` }, 50)
    wire(`${prog}.D${8 + i}`, `${m}.I0`, `NUM${i}`)
    wire(`${adder}.S${i}`, `${m}.I1`)
    wire(`${ram}.Q${i}`, `${m}.I2`)
    wire(`${ctl}.D1`, `${m}.S0`, 'ACC_SRC0')
    wire(`${ctl}.D2`, `${m}.S1`, 'ACC_SRC1')
    wire(`${m}.Y`, `${acc}.${NIB[i]}`)
  }

  const sent = new Map<string, boolean>()
  const received = new Map<string, string>()
  const unlabelled: typeof links = []
  for (const l of links) {
    if (!l.name) {
      b.wire(l.from, l.to)
      continue
    }
    if (!sent.has(l.name)) sent.set(l.name, b.tap(l.from, l.name) !== undefined)
    const label = sent.get(l.name) ? b.tag(l.to, l.name) : undefined
    if (label) received.set(l.name, received.get(l.name) ?? label)
    else unlabelled.push(l)
  }
  // A pin with no room for its own Receive label branches off one that is already there, so a name is never also a wire from its source.
  for (const l of unlabelled) b.wire(received.has(l.name!) ? `${received.get(l.name!)}.Y` : l.from, l.to)
  return { b, keys }
}

/** The beginner computer as an example: the circuit, framed by its three steps, with a note for each. */
export function beginnerComputer(): Circuit {
  const { b, keys } = beginnerBuilder()
  const ids = (...parts: string[]) => parts.map((k) => keys[k])
  const four = (prefix: string) => [0, 1, 2, 3].map((i) => `${prefix}${i}`)
  frameAround(b, '1. FETCH: PC and Program ROM', ids('clk', 'pc', 'pcDisp', 'prog'), 'blue')
  frameAround(b, '2. DECODE: the Control ROM', ids('ctl', 'nhalt', 'halted', 'stop'), 'yellow')
  frameAround(b, '3. EXECUTE: RAM, adder, accumulator', ids('ram', 'adder', 'carryX', 'flag', 'zero', 'carry', 'acc', 'accDisp', ...four('xor'), ...four('mux')), 'green')
  note(
    b,
    0,
    -470,
    'A complete little computer, small enough to understand. It follows the program in the Program ROM, one instruction per clock tick, in three steps: FETCH the next instruction, DECODE what it means, EXECUTE it. Press Clock step to go one tick at a time and watch the PC, the ACC and the RAM change. Click the Program ROM to read and change the program: it is written in SKASM (the SKASM… button explains it). Numbers go from 0 to 15; it knows LDI, LDA, STA, ADD, SUB, JMP and HALT.',
    60,
  )
  note(
    b,
    0,
    -260,
    '1. FETCH. The PC (program counter) holds a number: which instruction to run next. The ROM is only memory. It cannot calculate, it just shows the row that its address pins point to, and the address is the PC. Every tick the PC counts up by one, so the instructions run in order. (A JMP puts a new number into the PC instead.)',
    44,
    'blue',
  )
  note(
    b,
    860,
    -260,
    '2. DECODE. An instruction is just a number, and its first part is the opcode: which instruction it is. The Control ROM is a second lookup table. Its row for that opcode says which parts to switch on: load the ACC? write the RAM? subtract? jump? stop? Each of these control signals travels by name (LOAD_ACC, WRITE_RAM, SUBTRACT...): labels with the same name are one wire. Click the Control ROM to read its rows by name and signal, and click a row to change what that instruction does (Tools → SKASM → Control signals explains each one).',
    38,
    'yellow',
  )
  note(
    b,
    1360,
    -260,
    '3. EXECUTE. The RAM holds data: 16 places, one number each. The ACC (accumulator) is the number the computer is working on. ADD: the adder adds a RAM word to the ACC. SUB: the XOR gates flip the bits of the RAM word and the adder adds 1 as well, which is subtraction. The multiplexers choose what the ACC takes next: the number in the instruction (LDI), the adder’s answer (ADD, SUB) or a RAM word (LDA). The yellow Carry flag remembers an ADD over 15 or a SUB below 0.',
    60,
    'green',
  )
  // Without routing for the crossings: the wires are few and short.
  return b.build()
}
