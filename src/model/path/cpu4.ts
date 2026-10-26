import { SKASM, toHexWords } from '../../engine/isa'
import { getDef } from '../../engine/registry'
import { BEGINNER_ROWS, BEGINNER_SIGNALS } from '../../engine/signal-presets'
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

/** The reference computer at this stage (0 to 3). */
export function cpuStage(stage: number): Circuit {
  const b = new CircuitBuilder()
  const cols: Record<number, number> = {}
  const part = (col: number, type: string, opts: Parameters<CircuitBuilder['add']>[3] = {}, gap = 40) => {
    const y = (cols[col] ??= 0)
    const id = b.add(type, col, y, opts)
    cols[col] = y + boundsRect(b.c.comps[id]).h + gap + (opts.label ? 20 : 0)
    return id
  }
  const FETCH = 0
  const ROM = 400
  const DECODE = 860
  const ACC = 1360

  const clk = part(FETCH, 'clock', { params: { hz: 1 }, label: 'Clock' })
  const prog = part(ROM, 'rom', { params: programParams(CPU_PROGRAM), label: 'Program ROM' })
  if (stage >= 1) {
    const pc = part(FETCH, 'counterld', { label: 'PC' })
    const disp = part(FETCH, 'hexdisp', { label: 'PC display' })
    b.wire(`${clk}.Q`, `${pc}.CLK`)
    for (let i = 0; i < 4; i++) {
      b.wire(`${pc}.Q${i}`, `${prog}.A${i}`)
      b.wire(`${pc}.Q${i}`, `${disp}.${NIB[i]}`)
    }
  }
  let ctl: string | undefined
  if (stage >= 2) {
    ctl = part(DECODE, 'rom', { params: controlParams('LDI: LOAD_ACC ACC_SRC=NUM'), label: 'Control ROM' })
    const led = part(DECODE, 'led', { label: 'LOAD_ACC', params: { color: 'green' } })
    for (let i = 0; i < 4; i++) b.wire(`${prog}.D${4 + i}`, `${ctl}.A${i}`) // the opcode
    b.wire(`${ctl}.D0`, `${led}.A`)
  }
  if (stage >= 3) {
    const acc = part(ACC, 'register', { label: 'ACC' })
    const disp = part(ACC, 'hexdisp', { label: 'ACC display' })
    b.wire(`${clk}.Q`, `${acc}.CLK`)
    b.wire(`${ctl}.D0`, `${acc}.LD`)
    for (let i = 0; i < 4; i++) {
      b.wire(`${prog}.D${8 + i}`, `${acc}.${NIB[i]}`) // the number in the instruction
      b.wire(`${acc}.${ACC_Q[i]}`, `${disp}.${NIB[i]}`)
    }
  }
  return b.build()
}
