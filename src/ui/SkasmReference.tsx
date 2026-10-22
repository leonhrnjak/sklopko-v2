import { useEffect } from 'react'
import { closeReference, setReferenceTab, useReference, type ReferenceTab } from '../app/reference'
import { showToast } from '../app/store'
import { PORTS, SKASM, SKASM_ALIASES, SKASM_OPS, type ArgKind, type Op, type OpCategory } from '../engine/isa'
import { SKASM_EXAMPLES } from '../model/skasm-examples'

const TABS: [ReferenceTab, string][] = [
  ['start', 'Getting started'],
  ['instructions', 'Instructions'],
  ['ports', 'Ports'],
  ['examples', 'Examples'],
]

const CATEGORIES: OpCategory[] = ['Load and store', 'Arithmetic', 'Logic', 'Shifts', 'Jumps', 'Input and output', 'Control']

/** How an operand is written in the table: n is a value, a an address, t a jump target, p a port. */
const OPERAND: Record<ArgKind, string> = { none: '', imm: 'n', addr: 'a', target: 't', port: 'p' }
const OPERAND_HELP: Record<ArgKind, string> = {
  none: 'no operand',
  imm: 'a number from 0 to 255, or −128 to −1 (written in two’s complement)',
  addr: 'a RAM address from 0 to 15',
  target: 'a label, or an instruction number from 0 to 255',
  port: 'a port number from 0 to 15, or a port name',
}

const flagsText = (flags: string) =>
  flags === '' ? 'none' : flags === 'C Z' ? 'sets C and Z' : flags === 'Z, C = 0' ? 'sets Z, clears C' : flags

const opcodeText = (op: Op) => op.code.toString(16).toUpperCase() + (op.sub === undefined ? '' : `.${op.sub.toString(16).toUpperCase()}`)

function Start() {
  return (
    <div className="ref-text">
      <p>
        <b>SKASM</b> is the assembly language of every Sklopko computer. You write a program as text, one instruction per
        line, and the ROM turns it into the numbers the computer reads. Click a ROM’s <i>Program</i> box and start typing:
        mistakes are listed as you type, and the program is loaded into the computer when you click outside the box.
      </p>

      <p className="ref-note">
        <b>New to this?</b> Open <b>Examples → Beginner: a tiny computer</b>. It is the smallest computer that runs a program, with
        a note for each step: the ROM that holds the program, the PC that steps through it, the RAM and the adder.
      </p>

      <h3>How to write a program</h3>
      <ol>
        <li>
          Open one of the computers from <b>Examples</b>, or place a <b>ROM</b> (Memory) and choose <b>Contents are → A
          program in SKASM</b> in the inspector on the right.
        </li>
        <li>Type or paste the program. Read the result in the <b>listing</b> below it: address, word and instruction.</li>
        <li>
          Press <b>Run</b>. <b>◀ Back</b> and <b>Clock step</b> go through the program one instruction at a time; the PC
          display and the listing show which instruction is running.
        </li>
        <li>
          <b>Open…</b> and <b>Save…</b> in the ROM inspector read and write a program as a <code>.asm</code> file.
        </li>
      </ol>

      <h3>The machine</h3>
      <ul>
        <li>
          <b>ACC</b>, the accumulator: one 8-bit number (0–255). Almost every instruction works on it.
        </li>
        <li>
          <b>RAM</b>: 16 bytes, numbered 0 to 15. <code>STA a</code> stores ACC there, <code>LDA a</code> loads it back.
        </li>
        <li>
          <b>Flags</b>: <b>C</b> (carry) and <b>Z</b> (zero). Arithmetic sets them. After an addition, C = 1 means the sum
          did not fit in 8 bits. After a subtraction or comparison, C = 1 means it <i>borrowed</i>: the number taken away
          was bigger. Z = 1 means the result was 0. Jumps look at them.
        </li>
        <li>
          <b>The program</b>: up to 256 instructions, numbered from 0. The <b>PC</b> (program counter) is the number of the
          instruction running now. The computer runs one instruction per clock cycle and goes on to the next, unless it
          jumps.
        </li>
        <li>
          <b>Ports</b>: connections to devices (a display, a console, a screen, a speaker, a keypad). <code>OUT</code> sends
          ACC to one and <code>IN</code> reads one. See the Ports tab.
        </li>
      </ul>

      <h3>Writing instructions</h3>
      <pre className="ref-code">{`; a comment runs to the end of the line (// works too)
SIZE = 8            ; a named constant
        LDI SIZE    ; an instruction and its operand
loop:   SUBI 1      ; a label names the address of the next instruction
        JNZ loop    ; ... and a jump can go there
        HALT`}</pre>
      <ul>
        <li>
          <b>One instruction per line</b>, in capitals or not. An instruction has at most one operand.
        </li>
        <li>
          <b>Numbers</b> can be written <code>42</code>, <code>0x2A</code> or <code>$2A</code> (hex), or{' '}
          <code>0b101010</code> (binary). A negative number such as <code>LDI -1</code> loads 255 (two’s complement).
        </li>
        <li>
          <b>Labels</b> end with a colon and may stand alone on a line. A label can be used before it is defined.
        </li>
        <li>
          <b>Constants</b> are <code>NAME = value</code>. Names use letters, digits and underscores, and cannot start with a
          digit, be an instruction, or be a port name.
        </li>
        <li>
          <b><code>.word value</code></b> puts a raw number in the ROM, for data. The listing shows any word that is not an
          instruction this way.
        </li>
        <li>
          <b>Short forms</b>: {Object.entries(SKASM_ALIASES).map(([name, a], i) => (
            <span key={name}>
              {i ? ', ' : ''}
              <code>{name}</code> (<code>{a.op} {a.arg}</code>)
            </span>
          ))}. They are replaced by the instruction they stand for.
        </li>
        <li>
          <b>Errors</b> name the line. While a program has errors, the circuit keeps running the last version that
          assembled.
        </li>
      </ul>
    </div>
  )
}

function Instructions() {
  return (
    <div className="ref-text">
      <p>
        <code>n</code> is a value, <code>a</code> a RAM address (0–15), <code>t</code> a jump target (a label, or an
        instruction number 0–255), <code>p</code> a port. Every instruction takes one clock cycle. “Opcode” is the digit in
        bits 4–7 of the instruction word (<code>E.</code> and <code>F.</code> are two groups with a second digit).
      </p>
      {CATEGORIES.map((category) => {
        const ops = Object.entries(SKASM_OPS).filter(([, o]) => o.category === category)
        const aliases = category === 'Arithmetic' || category === 'Load and store' || category === 'Logic' ? Object.entries(SKASM_ALIASES).filter(([, a]) => SKASM_OPS[a.op].category === category) : []
        if (!ops.length) return null
        return (
          <section key={category}>
            <h3>{category}</h3>
            <div className="ref-table-wrap">
              <table className="ref-table">
                <thead>
                  <tr>
                    <th>Instruction</th>
                    <th>What it does</th>
                    <th>Flags</th>
                    <th>Opcode</th>
                  </tr>
                </thead>
                <tbody>
                  {ops.map(([name, o]) => (
                    <tr key={name} id={`op-${name}`}>
                      <td>
                        <code>
                          {name}
                          {o.arg === 'none' ? '' : ` ${OPERAND[o.arg]}`}
                        </code>
                      </td>
                      <td>
                        {o.summary}
                        {o.arg !== 'none' && <small className="ref-operand"> — {OPERAND[o.arg]}: {OPERAND_HELP[o.arg]}</small>}
                      </td>
                      <td>{flagsText(o.flags)}</td>
                      <td>
                        <code>{opcodeText(o)}</code>
                      </td>
                    </tr>
                  ))}
                  {aliases.map(([name, a]) => (
                    <tr key={name}>
                      <td>
                        <code>{name}</code>
                      </td>
                      <td>{a.summary}</td>
                      <td>{flagsText(SKASM_OPS[a.op].flags)}</td>
                      <td>
                        <small>short form</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}
      <h3>Good to know</h3>
      <ul>
        <li>
          After a jump the next instruction is the one at the target. <code>HALT</code> stops the program counter on itself
          (the simulation can pause there: look for a “Pause at HALT” part).
        </li>
        <li>
          <code>LDI</code>, <code>LDA</code>, <code>STA</code>, the shifts, the jumps, <code>IN</code> and <code>OUT</code> leave
          the flags as they were.
        </li>
        <li>
          Comparing is subtracting without keeping the answer: <code>CMPI 5</code> then <code>JZ</code> jumps if ACC was 5,
          and <code>JNC</code> jumps if ACC was 5 or more.
        </li>
        <li>
          A computer may have only part of SKASM. The Beginner computer knows <code>LDI</code>, <code>LDA</code>, <code>STA</code>,{' '}
          <code>ADD</code>, <code>SUB</code>, <code>JMP</code> and <code>HALT</code>, and numbers from 0 to 15 (the low 4 bits of
          a value). An instruction a computer does not have does nothing.
        </li>
        <li>
          A word that is not an instruction does nothing. A program is {SKASM.bits}-bit words; the ROM must have {SKASM.bits} data
          bits.
        </li>
      </ul>
    </div>
  )
}

function Ports() {
  return (
    <div className="ref-text">
      <p>
        A <b>port</b> is a connection to a device. <code>OUT p</code> sends the accumulator to port <code>p</code>;{' '}
        <code>IN p</code> loads the accumulator from it. Ports are separate from RAM: they never use up a RAM word. A port name
        stands for its number, so <code>OUT CHAR</code> is <code>OUT 1</code>.
      </p>
      <div className="ref-table-wrap">
        <table className="ref-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Port</th>
              <th>Use</th>
              <th>Device</th>
            </tr>
          </thead>
          <tbody>
            {PORTS.map((p) => (
              <tr key={`${p.name}`}>
                <td>
                  <code>{p.name}</code>
                </td>
                <td>{p.number}</td>
                <td>
                  <code>{p.dir === 'out' ? 'OUT' : 'IN'}</code>
                </td>
                <td>{p.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul>
        <li>The same names work on every computer. Which devices a computer has depends on how it is built.</li>
        <li>
          A computer without the device ignores <code>OUT</code>, and <code>IN</code> reads 0.
        </li>
        <li>
          Ports 6 to 15 are free for devices to come.
        </li>
      </ul>
    </div>
  )
}

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(
    () => showToast('Copied. Paste it into a ROM’s Program box.'),
    () => showToast('Could not copy; select the text and copy it yourself.'),
  )
}

function Examples() {
  return (
    <div className="ref-text">
      <p>Small programs to read, copy into a ROM’s Program box, and change.</p>
      {SKASM_EXAMPLES.map((ex) => (
        <section key={ex.id} className="ref-example" id={`example-${ex.id}`}>
          <h3>{ex.title}</h3>
          <p>{ex.note}</p>
          <pre className="ref-code">{ex.text}</pre>
          <button onClick={() => copy(ex.text)}>Copy</button>
        </section>
      ))}
    </div>
  )
}

/** The language reference for SKASM. */
export function SkasmReference() {
  const open = useReference((s) => s.open)
  const tab = useReference((s) => s.tab)
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeReference()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open])
  if (!open) return null
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && closeReference()}>
      <div className="modal ref" role="dialog" aria-modal="true" aria-label="SKASM language reference">
        <header className="modal-head">
          <strong>SKASM reference</strong>
          <div className="seg" role="tablist" aria-label="Reference sections">
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
        <div className="modal-body">{tab === 'start' ? <Start /> : tab === 'instructions' ? <Instructions /> : tab === 'ports' ? <Ports /> : <Examples />}</div>
      </div>
    </div>
  )
}
