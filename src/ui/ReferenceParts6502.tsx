import { useEffect, useMemo, useState } from 'react'
import { closeReference, setReferenceTab, useReference, type ReferenceParts6502Tab } from '../app/reference'
import { useStore } from '../app/store'
import { MICRO_OPCODES, microRows, type Row } from '../engine/micro6502'
import { BY_OPCODE_6502 } from '../engine/opcodes6502'
import { Micro6502Diagram } from './Micro6502Diagram'
import { focusFrame } from './canvas/viewport'

const TABS: [ReferenceParts6502Tab, string][] = [
  ['machine', 'The machine'],
  ['cycles', 'One instruction'],
]

type Cls = 'seq' | 'regs' | 'alu' | 'addr' | 'mem'

/** The seven blocks of the diagram: the circuit's sections, in the order of the diagram's numbers; `frame` is how their frame is titled. */
const SECTIONS: { cls: Cls; kind: string; name: string; frame: string; blurb: string }[] = [
  { cls: 'seq', kind: 'sequencing', name: 'Sequencer', frame: 'SEQUENCER', blurb: 'The board’s clock ticks once per bus cycle. T counts the cycles of the running instruction (0 is the fetch of its opcode) and IR holds the opcode. T, IR and a reset flag address the microcode. Reset runs a seven-cycle sequence that ends by reading the vector at $FFFC into PC.' },
  { cls: 'seq', kind: 'sequencing', name: 'Microcode', frame: 'MICROCODE', blurb: 'Four ROMs, addressed by the reset flag, the opcode and T: one row for each cycle of each instruction. Every output bit is a control signal with a name, such as LD_A (load A), ASEL (where the address comes from) or OP (what the ALU does).' },
  { cls: 'seq', kind: 'sequencing', name: 'Control', frame: 'CONTROL', blurb: 'The microcode words taken apart into single named wires, and the few decisions the microcode cannot make by itself: a branch that is not taken ends early, a branch that does not cross a page ends a cycle sooner, and so does an indexed read that did not carry.' },
  { cls: 'regs', kind: 'state', name: 'Registers', frame: 'REGISTERS', blurb: 'The programmer’s registers A, X, Y and SP, the program counter in two halves, the flags, and three temporaries (TL, TH, DL) for addresses and values in flight. All of them load the ALU’s result R at the end of a cycle in which their load signal is on.' },
  { cls: 'alu', kind: 'arithmetic', name: 'ALU and flags', frame: 'ALU', blurb: 'R = what the ALU does to its A and B inputs. A is a register chosen by AIN; B is the data bus, TL, TH, DL or a constant chosen by BIN. The adder, the logic gates and the shifter share those inputs, and OP picks which result is R. N, Z, C and V are worked out from R and the carry.' },
  { cls: 'addr', kind: 'addressing', name: 'Address bus and pins', frame: 'ADDRESS BUS', blurb: 'One multiplexer, chosen by ASEL, decides the address of every cycle: PC when fetching, TH:TL when an address has been built, page 1 with SP for the stack, page 0 with TL for zero page, or one of the vectors at $FFFC to $FFFF. This section also holds the CPU’s pins: ADDRESS, R, RWB and SYNC out, DI, PHI2 and RES in.' },
  { cls: 'mem', kind: 'the board', name: 'Memory and devices', frame: 'MEMORY', blurb: 'Not part of the CPU: the board it runs on. The clock and the Reset button, RAM, ROM and a device (a row of LEDs, or on the BASIC board a serial terminal), told apart by address lines A14 and A15. What the CPU reads comes back as DI; a write puts R on the data bus.' },
]

/** Which block a control signal belongs to. */
function blockOf(name: string): number {
  if (['FETCH', 'END', 'BRANCH', 'NOCROSS', 'END_RESET', 'XEND'].includes(name)) return 2
  if (name === 'ASEL') return 5
  if (name === 'WRITE') return 6
  if (['AIN', 'BIN', 'INVB', 'CIN', 'OP', 'NZ', 'UPD_C', 'C_SRC', 'V', 'BIT', 'PAGEFIX', 'XOP', 'CLV', 'CLRI', 'SETI', 'SETD', 'CLRD', 'LD_P'].includes(name)) return 4
  return 3
}

const SYM: Record<string, string> = { ADD: '+', AND: 'AND', OR: 'OR', EOR: 'EOR', ASL: 'ASL', LSR: 'LSR', ROL: 'ROL', ROR: 'ROR' }
const WHERE: Record<string, string> = { PC: 'PC', ADDR: 'TH:TL', STACK: 'the stack (page 1, SP)', ZEROPAGE: 'zero page (TL)', VEC_LO: '$FFFC', VEC_HI: '$FFFD', VEC_IRQ_LO: '$FFFE', VEC_IRQ_HI: '$FFFF' }

/** A row of the microcode in words. */
function says(row: Row): string {
  const out: string[] = []
  if (row.FETCH) out.push('Reads the opcode at PC into IR.')
  else if (row.ASEL) out.push(`${row.WRITE ? 'Writes' : 'Reads'} at ${WHERE[String(row.ASEL)] ?? row.ASEL}.`)
  if (row.BIN !== undefined || row.AIN !== undefined || row.OP) {
    const a = row.AIN ?? 'A'
    const b = row.BIN ?? 'ZERO'
    const op = SYM[String(row.OP ?? 'ADD')]
    if (['ASL', 'LSR', 'ROL', 'ROR'].includes(String(row.OP))) out.push(`ALU: ${op} ${a}.`)
    else out.push(`ALU: ${a} ${op} ${row.INVB ? 'NOT ' : ''}${b}${row.CIN === 'FLAG' ? ' + carry' : row.CIN === 'ONE' ? ' + 1' : ''}.`)
  }
  const loads = Object.keys(row).filter((k) => k.startsWith('LD_') && k !== 'LD_CRS').map((k) => k.slice(3))
  if (loads.length) out.push(`Loads ${loads.join(', ')}.`)
  if (row.LD_CRS) out.push('Keeps the carry of the index.')
  if (row.INC_PC) out.push('PC + 1.')
  if (row.NZ) out.push('Sets N and Z.')
  if (row.UPD_C) out.push('Changes the carry flag.')
  if (row.WRITE) out.push('R is on the data bus.')
  if (row.BRANCH) out.push('Ends here if the branch is not taken.')
  if (row.NOCROSS) out.push('Ends here if the branch stays in its page.')
  if (row.XEND) out.push('Ends here if the index did not carry (the work was done in this cycle).')
  if (row.END) out.push('The instruction ends.')
  return out.join(' ')
}

const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')

export function ReferenceParts6502() {
  const open = useReference((s) => s.open && s.language === 'parts6502')
  const tab = useReference((s) => s.tab as ReferenceParts6502Tab)
  const hasCpu = useStore((s) => Object.values(s.circuit.comps).some((c) => c.type === 'frame' && String(c.params.title).startsWith('THE 6502 CPU')))
  const [shown, setShown] = useState(4)
  const [op, setOp] = useState(0xa9)
  const [cycle, setCycle] = useState(0)
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeReference()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open])
  const rows = useMemo(() => microRows(op), [op])
  if (!open) return null
  const sec = SECTIONS[shown]
  const row = rows[Math.min(cycle, rows.length - 1)]
  const lit = new Set(Object.keys(row).map(blockOf))
  lit.add(0)
  lit.add(1)
  const showInCircuit = () => {
    closeReference()
    requestAnimationFrame(() => focusFrame(sec.frame))
  }
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && closeReference()}>
      <div className="modal ref arch" role="dialog" aria-modal="true" aria-label="The 6502 from parts">
        <header className="modal-head">
          <strong>The 6502 from parts</strong>
          <div className="seg" role="tablist" aria-label="Sections">
            {TABS.map(([id, name]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setReferenceTab(id)}>
                {name}
              </button>
            ))}
          </div>
          <button className="modal-close" onClick={closeReference} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <div className="ref-text">
            <p>
              A 6502 made of registers, counters, multiplexers, an adder and four ROMs of microcode: one bus cycle per clock, checked cycle by cycle against the 6502 part. Every block below is a section of the circuit.
              {!hasCpu && ' Open the example 6502 from parts (File → Examples) to see them on the canvas.'}
            </p>
          </div>
          <div className="arch-diagram">
            <Micro6502Diagram shown={shown} lit={tab === 'cycles' ? lit : new Set()} onPick={setShown} />
          </div>
          {tab === 'machine' ? (
            <div className="arch-detail" aria-live="polite">
              <span className={`arch-tag ${sec.cls}`}>{sec.kind}</span>
              <h3>{sec.name}</h3>
              <p>{sec.blurb}</p>
              <button onClick={showInCircuit} disabled={!hasCpu} title={hasCpu ? 'Close this window and zoom the canvas to this section' : 'Open the example 6502 from parts first'}>
                Show in the circuit
              </button>
            </div>
          ) : (
            <div className="arch-cycles">
              <label>
                <b>Instruction </b>
                <select
                  value={op}
                  onChange={(e) => {
                    setOp(Number(e.target.value))
                    setCycle(0)
                  }}
                >
                  {MICRO_OPCODES.map((o) => (
                    <option key={o} value={o}>
                      {BY_OPCODE_6502[o]?.mnemonic} {BY_OPCODE_6502[o]?.mode} (${hex(o)})
                    </option>
                  ))}
                </select>
              </label>{' '}
              <span className="muted">{rows.length} cycles. Pick a cycle to light up the blocks it uses.</span>
              {rows.map((r, t) => (
                <button key={t} className="arch-cycle" aria-pressed={t === cycle} onClick={() => setCycle(t)}>
                  <span className="t">T{t}</span>
                  <span>
                    <span className="says">{says(r)}</span>
                    <span className="arch-sigs">
                      {Object.keys(r).map((k) => (
                        <code key={k} className={SECTIONS[blockOf(k)].cls}>
                          {r[k] === true ? k : `${k}=${r[k]}`}
                        </code>
                      ))}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
