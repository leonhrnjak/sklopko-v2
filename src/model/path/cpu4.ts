import { SKASM, toHexWords } from '../../engine/isa'
import { getDef } from '../../engine/registry'
import { BEGINNER_CONTROL_TEXT, BEGINNER_ROWS, BEGINNER_SIGNALS } from '../../engine/signal-presets'
import { assembleSignals, parseRows, parseSignals } from '../../engine/signals'
import { legacyDefaults } from '../../engine/types'
import { BEGINNER_SOURCE, beginnerWords } from '../beginner'
import { CircuitBuilder } from '../builder'
import { boundsRect, type Circuit } from '../circuit'

/**
 * The computer the learner builds in chapter 9, by stage: the same machine as the beginner computer (`model/beginner.ts`), with the same
 * labels, a little more of it at each stage. A stage is what a step of the project ends with: it is the step's solution, and the start
 * of the next step when the learner skipped this one.
 *
 *   0  a clock and a Program ROM holding a program
 *   1  fetch: a program counter (PC) that counts, and addresses the Program ROM
 *   2  decode: the Control ROM, which has the LDI row, and an LED for LOAD_ACC
 *   3  execute LDI: the accumulator (ACC), loaded with the number in the instruction when LOAD_ACC
 *   4  RAM, and a multiplexer in front of the ACC to choose its source (ACC_SRC): the rows STA and LDA
 *   5  the adder, the XORs that flip RAM's bits for SUB, and the carry flag: the rows ADD and SUB
 *   6  jumps and HALT: the PC loads the address in the instruction (JUMP), and stops (HALT)
 */

/** The program in the Program ROM at the start: add 3 and 4. */
export const CPU_PROGRAM = BEGINNER_SOURCE

const NIB = ['A', 'B', 'C', 'D']
const ACC_Q = ['QA', 'QB', 'QC', 'QD']

/** The control ROM's words for a text such as `LDI: LOAD_ACC ACC_SRC=NUM` (rows not listed are 0). */
export function controlWords(text: string): string {
  const { layout } = parseSignals(BEGINNER_SIGNALS)
  const r = assembleSignals(layout, parseRows(BEGINNER_ROWS).rows, text, 16, 8)
  if (r.errors.length) throw new Error(`The control ROM does not assemble: ${r.errors.map((e) => `${e.line}: ${e.message}`).join('; ')}`)
  return toHexWords(r.words, 8)
}

/** A Control ROM part's params: named signals and rows, and these words. */
export const controlParams = (text = '') => ({ abits: 4, dbits: 8, data: controlWords(text), signals: BEGINNER_SIGNALS, rows: BEGINNER_ROWS })

/** The Program ROM's params, holding this program. */
export const programParams = (source: string) => ({ abits: 4, dbits: 16, isa: SKASM.id, source, data: beginnerWords(source) })

/** The Control ROM as the learner is given it in step 9.3: named signals and rows, every row empty. */
export function giveControlRom(c: Circuit) {
  c.comps['control-rom'] = { id: 'control-rom', type: 'rom', x: 860, y: 0, rot: 0, flip: false, params: { ...legacyDefaults(getDef('rom')), ...controlParams() }, label: 'Control ROM' }
}

/** What the Control ROM has in its rows at each stage, in the text form: the instructions the computer knows so far. */
export function controlTextFor(stage: number): string {
  const rows = BEGINNER_CONTROL_TEXT.split('\n').filter(Boolean)
  const upTo = (names: string[]) => rows.filter((r) => names.includes(r.split(':')[0])).join('\n')
  if (stage >= 6) return BEGINNER_CONTROL_TEXT
  if (stage === 5) return upTo(['LDI', 'LDA', 'STA', 'ADD', 'SUB'])
  if (stage === 4) return upTo(['LDI', 'LDA', 'STA'])
  return upTo(['LDI'])
}

/** The reference computer at this stage (0 to 6). */
export function cpuStage(stage: number): Circuit {
  const b = new CircuitBuilder()
  const cols: Record<number, number> = {}
  const part = (col: number, type: string, opts: Parameters<CircuitBuilder['add']>[3] = {}, gap = 40) => {
    const y = (cols[col] ??= 0)
    const id = b.add(type, col, y, opts)
    cols[col] = y + boundsRect(b.c.comps[id]).h + gap + (opts.label ? 20 : 0)
    return id
  }
  // Wires that fan out to many places are sent by name (a Send label and Receive labels with the same name are one wire), as in the beginner computer.
  const links: { from: string; to: string; name?: string }[] = []
  const wire = (from: string, to: string, name?: string) => links.push({ from, to, name })

  const FETCH = 0
  const ROM = 400
  const DECODE = 860
  const RAM = 1360
  const XOR = 1700
  const ADDER = 1900
  const MUX = 2180
  const ACC = stage >= 4 ? 2480 : 1360

  const clk = part(FETCH, 'clock', { params: { hz: 1 }, label: 'Clock' })
  const prog = part(ROM, 'rom', { params: programParams(CPU_PROGRAM), label: 'Program ROM' })
  let pc = ''
  let ctl = ''
  if (stage >= 1) {
    pc = part(FETCH, 'counterld', { label: 'PC' })
    const disp = part(FETCH, 'hexdisp', { label: 'PC display' })
    wire(`${clk}.Q`, `${pc}.CLK`)
    for (let i = 0; i < 4; i++) {
      wire(`${pc}.Q${i}`, `${prog}.A${i}`)
      wire(`${pc}.Q${i}`, `${disp}.${NIB[i]}`)
    }
  }
  if (stage >= 2) {
    ctl = part(DECODE, 'rom', { params: controlParams(controlTextFor(stage)), label: 'Control ROM' })
    for (let i = 0; i < 4; i++) wire(`${prog}.D${4 + i}`, `${ctl}.A${i}`) // the opcode
    if (stage < 6) {
      const led = part(DECODE, 'led', { label: 'LOAD_ACC', params: { color: 'green' } })
      wire(`${ctl}.D0`, `${led}.A`)
    }
  }
  if (stage >= 6) {
    const led = part(DECODE, 'led', { label: 'LOAD_ACC', params: { color: 'green' } })
    wire(`${ctl}.D0`, `${led}.A`)
    const nhalt = part(DECODE, 'not', { label: 'not halted' })
    const halted = part(DECODE, 'led', { label: 'Halted', params: { color: 'red' } })
    wire(`${ctl}.D6`, `${nhalt}.A`)
    wire(`${nhalt}.Y`, `${pc}.EN`)
    wire(`${ctl}.D5`, `${pc}.LD`, 'JUMP')
    wire(`${ctl}.D6`, `${halted}.A`)
    for (let i = 0; i < 4; i++) wire(`${prog}.D${i}`, `${pc}.D${i}`, `ADDR${i}`) // a jump loads the address from the instruction
  }
  let acc = ''
  if (stage >= 3) {
    acc = part(ACC, 'register', { label: 'ACC' })
    const disp = part(ACC, 'hexdisp', { label: 'ACC display' })
    wire(`${clk}.Q`, `${acc}.CLK`)
    wire(`${ctl}.D0`, `${acc}.LD`)
    for (let i = 0; i < 4; i++) wire(`${acc}.${ACC_Q[i]}`, `${disp}.${NIB[i]}`)
    if (stage < 4) for (let i = 0; i < 4; i++) wire(`${prog}.D${8 + i}`, `${acc}.${NIB[i]}`) // the number in the instruction
  }
  let ram = ''
  if (stage >= 4) {
    ram = part(RAM, 'ram', { params: { dbits: 4 }, label: 'RAM' })
    wire(`${clk}.Q`, `${ram}.CLK`)
    wire(`${ctl}.D3`, `${ram}.WE`, 'WRITE_RAM')
    for (let i = 0; i < 4; i++) {
      wire(`${prog}.D${i}`, `${ram}.A${i}`, `ADDR${i}`) // the address in the instruction
      wire(`${acc}.${ACC_Q[i]}`, `${ram}.D${i}`)
    }
  }
  let adder = ''
  if (stage >= 5) {
    adder = part(ADDER, 'add4', { label: 'Adder' })
    // The carry is remembered in a flag: 1 after an ADD that went over 15, or a SUB that went below 0 (it "borrowed"), as in SKASM.
    const carryX = part(ADDER, 'xor', { label: 'carry xor SUB' }, 30)
    const flag = part(ADDER, 'register', { label: 'Carry flag' })
    const zero = part(ADDER, 'const', { params: { value: 0 } }, 30) // the register's three unused inputs
    const carry = part(ADDER, 'led', { label: 'Carry', params: { color: 'yellow' } })
    wire(`${ctl}.D4`, `${adder}.Ci`, 'SUBTRACT') // subtracting adds 1
    wire(`${adder}.Co`, `${carryX}.A`)
    wire(`${ctl}.D4`, `${carryX}.B`, 'SUBTRACT')
    wire(`${carryX}.Y`, `${flag}.A`)
    for (const pin of ['B', 'C', 'D']) wire(`${zero}.Q`, `${flag}.${pin}`)
    wire(`${ctl}.D7`, `${flag}.LD`, 'SAVE_CARRY')
    wire(`${clk}.Q`, `${flag}.CLK`)
    wire(`${flag}.QA`, `${carry}.A`)
  }
  if (stage >= 4) {
    for (let i = 0; i < 4; i++) {
      // What the accumulator loads: the number in the instruction (LDI), the adder's answer (ADD, SUB) or a RAM word (LDA).
      const m = part(MUX, 'mux', { params: { n: 4 }, label: `ACC input, bit ${i}` }, 50)
      wire(`${prog}.D${8 + i}`, `${m}.I0`, `NUM${i}`)
      wire(`${ram}.Q${i}`, `${m}.I2`)
      wire(`${ctl}.D1`, `${m}.S0`, 'ACC_SRC0')
      wire(`${ctl}.D2`, `${m}.S1`, 'ACC_SRC1')
      wire(`${m}.Y`, `${acc}.${NIB[i]}`)
      if (stage >= 5) {
        const x = part(XOR, 'xor', { label: `flip bit ${i} for SUB` }, 30)
        wire(`${acc}.${ACC_Q[i]}`, `${adder}.A${i}`)
        wire(`${ram}.Q${i}`, `${x}.A`)
        wire(`${ctl}.D4`, `${x}.B`, 'SUBTRACT')
        wire(`${x}.Y`, `${adder}.B${i}`)
        wire(`${adder}.S${i}`, `${m}.I1`)
      }
    }
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
  for (const l of unlabelled) b.wire(received.has(l.name!) ? `${received.get(l.name!)}.Y` : l.from, l.to)
  return b.build()
}
