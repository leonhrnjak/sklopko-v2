import { useEffect, useState } from 'react'
import { closeReference, setReferenceTab, useReference, type ReferenceTab } from '../app/reference'
import { showToast } from '../app/store'
import { PORTS, SKASM, SKASM_ALIASES, SKASM_OPS, assemble, wordFields, type ArgKind, type Op, type OpCategory, type WordField } from '../engine/isa'
import { SKASM_EXAMPLES } from '../model/skasm-examples'

const TABS: [ReferenceTab, string][] = [
  ['start', 'Getting started'],
  ['format', 'Instruction format'],
  ['instructions', 'Instructions'],
  ['ports', 'Ports'],
  ['examples', 'Examples'],
]

const CATEGORIES: OpCategory[] = ['Load and store', 'Index register', 'Arithmetic', 'Logic', 'Shifts', 'Jumps', 'Input and output', 'Control']

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
        <li>
          Type or paste the program. Read the result in the <b>listing</b> below it: address, word and instruction. The{' '}
          <b>Instruction format</b> tab shows how a line becomes that word and what each ROM pin does.
        </li>
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
          <b>RAM</b>: 256 bytes. <code>STA a</code> stores ACC in one of the first 16 (the address is part of the instruction), <code>LDA a</code> loads it back. The index register <b>X</b> reaches all 256: <code>TAX</code> puts a number in it, then <code>LDX</code> and <code>STX</code> read and write the byte it points to, so a program can walk through a table.
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
          <b>Ports</b>: connections to devices (a display, a console, a screen, a speaker, a keypad, a gamepad). <code>OUT</code> sends
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

/** Which colour a field of an instruction word gets. */
const fieldClass = (f: WordField) => (f.name === 'opcode' ? 'f-op' : f.name === 'sub-opcode' ? 'f-sub' : f.name === 'constant' ? 'f-const' : 'f-operand')

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0')

/** One instruction word as 16 bits, D15 on the left, each field in its own colour, and what each field holds. */
function WordBreakdown({ word }: { word: number }) {
  const info = wordFields(SKASM, word)
  const owner = (bit: number) => info?.fields.find((f) => bit >= f.from && bit <= f.to)
  const ones = Array.from({ length: 16 }, (_, i) => 15 - i).filter((b) => (word >> b) & 1)
  return (
    <div className="fmt-word" data-testid="fmt-word">
      <div className="fmt-bits" role="img" aria-label={`The 16 bits of the word ${hex4(word)}`}>
        {Array.from({ length: 16 }, (_, i) => 15 - i).map((bit) => {
          const f = owner(bit)
          return (
            <div key={bit} className={`fmt-bit${f ? ` ${fieldClass(f)}` : ' unused'}`} title={f ? `D${bit}: ${f.name}` : `D${bit}: not used`}>
              <small>D{bit}</small>
              <span>{(word >> bit) & 1}</span>
            </div>
          )
        })}
      </div>
      {info ? (
        <ul className="fmt-fields">
          {info.fields.map((f) => (
            <li key={f.name}>
              <span className={`fmt-swatch ${fieldClass(f)}`} />
              <b>{f.from === f.to ? `D${f.from}` : `D${f.from}–D${f.to}`}</b> {f.name} = <code>{f.value}</code>
              {f.name === 'opcode' && (
                <>
                  {' '}
                  (<code>{info.mnemonic}</code>
                  {f.value >= 14 ? ', with the sub-opcode picking the instruction' : ''})
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ref-note">This word is not an instruction, so nothing runs it.</p>
      )}
      <p className="fmt-pins">
        The ROM’s pins that are 1: {ones.length ? ones.map((b) => <code key={b}>D{b}</code>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ' ', el] : [el]), []) : 'none'}. Bits that belong to no field are 0 and ignored.
      </p>
    </div>
  )
}

function Format() {
  const [text, setText] = useState('LDI 3')
  const line = text.split('\n')[0]
  const result = line.trim() ? assemble(SKASM, line, 1) : null
  const word = result && !result.errors.length ? result.words[0] : null
  const program = ['LDI 3', 'STA 0', 'HALT']
  const words = assemble(SKASM, program.join('\n'), 3).words
  return (
    <div className="ref-text">
      <p>
        A program becomes numbers in two steps. First the <b>assembler</b> (software, in the ROM’s inspector, while you type) turns each line of SKASM
        into one 16-bit number, and the ROM stores those numbers as hex words: <code>0300 0020 0070</code>. Then the <b>circuit</b> reads them: the
        program counter puts an address on the ROM’s address pins <code>A0–A7</code>, and the ROM shows the word stored there on its data pins{' '}
        <code>D0–D15</code> (<code>D0</code> is the lowest bit). The ROM does not know what the bits mean. They mean what the wires from each pin do.
      </p>

      <h3>Try an instruction</h3>
      <label className="field">
        <span>One line of SKASM</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          aria-label="An instruction to break down"
          className={`mono${result?.errors.length ? ' invalid' : ''}`}
        />
      </label>
      {result?.errors.length ? <p className="field-error">{result.errors[0].message}</p> : null}
      {word !== null && (
        <>
          <p>
            It assembles to the word <b data-testid="fmt-hex">{hex4(word)}</b>:
          </p>
          <WordBreakdown word={word} />
        </>
      )}

      <h3>What each data pin means</h3>
      <div className="ref-table-wrap">
        <table className="ref-table">
          <thead>
            <tr>
              <th>ROM pins</th>
              <th>The instruction keeps there</th>
              <th>The circuit sends it to</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>D0–D3</code>
              </td>
              <td>a RAM address, a port number, or the low half of a jump target</td>
              <td>the RAM’s address pins, the port decoding, the program counter’s load inputs</td>
            </tr>
            <tr>
              <td>
                <code>D4–D7</code>
              </td>
              <td>
                the <b>opcode</b>: which instruction it is
              </td>
              <td>the control ROM’s address, and the detectors for opcodes 14 and 15</td>
            </tr>
            <tr>
              <td>
                <code>D8–D15</code>
              </td>
              <td>
                the <b>constant</b> (<code>LDI 200</code>, <code>ANDI 0x0F</code>…); <code>D8–D11</code> also hold the high half of a jump target
              </td>
              <td>the operand mux, the accumulator’s input mux, the program counter’s high load inputs</td>
            </tr>
            <tr>
              <td>
                <code>D12–D15</code>
              </td>
              <td>
                for opcode 15 only (<code>OUT</code>, <code>IN</code>, <code>JNZ</code>, <code>AND</code>…): the <b>sub-opcode</b>
              </td>
              <td>the sub-opcode gates, then the control ROM</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        The same pins feed several places at once. The <b>control ROM</b> decides which of them matters: it looks at the opcode and switches the right
        data path on. For opcode 14 the sub-opcode is in <code>D0–D3</code> (the constant takes the top half); for opcode 15 it is in{' '}
        <code>D12–D15</code>.
      </p>

      <h3>A program, word by word</h3>
      <div className="ref-table-wrap">
        <table className="ref-table">
          <thead>
            <tr>
              <th>Address</th>
              <th>SKASM</th>
              <th>Word</th>
              <th>Bits</th>
            </tr>
          </thead>
          <tbody>
            {program.map((line, i) => (
              <tr key={line}>
                <td>{i}</td>
                <td>
                  <code>{line}</code>
                </td>
                <td>
                  <code>{hex4(words[i])}</code>
                </td>
                <td>
                  <code>{words[i].toString(2).padStart(16, '0').replace(/(.{4})(?=.)/g, '$1 ')}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>One clock cycle for <code>LDI 3</code>:</p>
      <ol>
        <li>The program counter is 0, so the ROM shows <code>0300</code>: <code>D8</code> and <code>D9</code> are 1.</li>
        <li>
          <code>D4–D7</code> = 0 reach the control ROM. Its row 0 says: load the accumulator, from the instruction’s constant.
        </li>
        <li>
          The accumulator’s input mux picks the constant, <code>D8–D15</code> = 3, and the accumulator takes it at the clock edge. The program counter moves on to address 1.
        </li>
      </ol>
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
  const open = useReference((s) => s.open && s.language === 'skasm')
  const tab = useReference((s) => s.tab as ReferenceTab)
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
        <div className="modal-body">{tab === 'start' ? <Start /> : tab === 'format' ? <Format /> : tab === 'instructions' ? <Instructions /> : tab === 'ports' ? <Ports /> : <Examples />}</div>
      </div>
    </div>
  )
}
