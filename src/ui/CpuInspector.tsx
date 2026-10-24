import { useEffect, useState } from 'react'
import { sim } from '../app/sim'
import { setRunning } from '../app/store'
import type { CpuState } from '../engine/components/cpu'
import { PROG_INTERRUPT, PROG_RESET, PROG_WAIT, type Cpu6502 } from '../engine/cpu6502'
import { BY_OPCODE_6502 } from '../engine/opcodes6502'
import { BY_OPCODE_65C02 } from '../engine/opcodes65c02'
import type { Comp } from '../model/circuit'

const hex = (n: number, digits: number) => n.toString(16).toUpperCase().padStart(digits, '0')

/** The names of the addressing modes, for the line that says what the CPU is doing. */
const MODE_NAMES: Record<string, string> = {
  imp: '',
  acc: 'A',
  imm: 'immediate',
  zp: 'zero page',
  zpx: 'zero page,X',
  zpy: 'zero page,Y',
  abs: 'absolute',
  abx: 'absolute,X',
  aby: 'absolute,Y',
  ind: 'indirect',
  izx: '(zero page,X)',
  izy: '(zero page),Y',
  rel: 'relative',
  izp: '(zero page)',
  iax: '(absolute,X)',
  zpr: 'zero page, relative',
}

/** The state of the CPU now, refreshed while the simulation runs (a clock cycle need not change any pin the canvas draws). */
function useCpu(id: string): CpuState | undefined {
  const read = () => {
    const st = sim.state(id) as CpuState | undefined
    return st ? { ...st, cpu: { ...st.cpu } } : undefined
  }
  const [state, setState] = useState(read)
  useEffect(() => {
    const refresh = () => setState(read())
    refresh()
    const timer = window.setInterval(refresh, 100)
    const off = sim.subscribe(refresh)
    return () => {
      window.clearInterval(timer)
      off()
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  return state
}

/** What the CPU is in the middle of, in words. */
function doing(c: Cpu6502): string {
  if (c.prog === PROG_WAIT) return c.wait === 2 ? 'Stopped (STP): only a reset starts it again' : 'Waiting for an interrupt (WAI)'
  if (c.prog < 0) return `Fetching the next instruction from $${hex(c.pc, 4)}`
  if (c.prog === PROG_RESET) return `Reset sequence, cycle ${c.t + 1} of 7`
  if (c.prog === PROG_INTERRUPT) return `Interrupt sequence, cycle ${c.t + 2} of 7`
  const o = c.cmos ? BY_OPCODE_65C02[c.op] : BY_OPCODE_6502[c.op]
  if (!o) return `Opcode $${hex(c.op, 2)}, which the part treats as a NOP`
  const mode = MODE_NAMES[o.mode]
  return `${o.mnemonic}${mode ? ` ${mode}` : ''} ($${hex(c.op, 2)}), cycle ${c.t + 2} of ${o.cycles}${o.kind === 'read' && o.pageCross ? '+' : ''}`
}

/** Run the clock until `done` holds (at most `max` edges), then show where the circuit got to. */
function stepUntil(done: () => boolean, max = 400) {
  setRunning(false)
  for (let i = 0; i < max && !done(); i++) sim.stepClock()
  sim.publish()
}

/** The registers and flags of a 6502 part, what it is doing, and ways to step it. */
export function CpuSection({ comp }: { comp: Comp }) {
  const st = useCpu(comp.id)
  if (!st) return null
  const c = st.cpu
  const live = () => sim.state(comp.id) as CpuState | undefined
  const flags: [string, number][] = [['N', 128], ['V', 64], ['D', 8], ['I', 4], ['Z', 2], ['C', 1]]
  const status = !st.started
    ? 'Not started: pull RES low and then high.'
    : st.held
      ? 'Held in reset (RES is low).'
      : st.waiting
        ? 'Waiting: the data bus (DI) is unknown.'
        : st.stalled
          ? 'Stopped by RDY.'
          : doing(c)
  const stepCycle = () => {
    const before = live()?.cpu.cycles
    stepUntil(() => live()?.cpu.cycles !== before)
  }
  const stepInstruction = () => {
    const before = live()?.cpu.cycles
    stepUntil(() => {
      const now = live()
      return !!now && now.cpu.cycles !== before && now.cpu.prog < 0 && now.cpu.sync
    })
  }
  const reg = (name: string, value: string, title?: string) => (
    <div className="ram-word" title={title}>
      <span className="addr">{name}</span>
      <span className="cpu-val">{value}</span>
    </div>
  )
  return (
    <div className="field">
      <span>Registers</span>
      <div className="ram-grid cpu-regs" role="group" aria-label="CPU registers">
        {reg('A', hex(c.a, 2), 'Accumulator')}
        {reg('X', hex(c.x, 2), 'Index register X')}
        {reg('Y', hex(c.y, 2), 'Index register Y')}
        {reg('SP', hex(c.sp, 2), 'Stack pointer: the stack is page 1, $0100–$01FF')}
        {reg('PC', hex(c.pc, 4), 'Program counter: the address of the next byte to fetch')}
        {reg('Cycles', String(c.cycles), 'Clock cycles since power-up or Reset')}
      </div>
      <div className="cpu-flags" role="group" aria-label="Flags">
        {flags.map(([name, mask]) => (
          <span key={name} className={`cpu-flag${c.p & mask ? ' on' : ''}`} title={FLAG_NAMES[name]}>
            {name}
          </span>
        ))}
      </div>
      <small aria-live="polite" data-testid="cpu-doing">
        {status}
      </small>
      <div className="row">
        <button onClick={stepCycle} title="Run the clock until the CPU has finished one cycle (pauses the simulation)">
          Step one cycle
        </button>
        <button onClick={stepInstruction} title="Run the clock until the CPU is about to fetch the next instruction (pauses the simulation)">
          Step one instruction
        </button>
      </div>
    </div>
  )
}

const FLAG_NAMES: Record<string, string> = {
  N: 'Negative: bit 7 of the last result',
  V: 'Overflow: a signed add or subtract went out of range',
  D: 'Decimal mode: ADC and SBC work on two BCD digits',
  I: 'Interrupt disable: IRQ is ignored while it is 1',
  Z: 'Zero: the last result was 0',
  C: 'Carry: ADC carried out; after a subtract or compare, 1 means no borrow',
}
