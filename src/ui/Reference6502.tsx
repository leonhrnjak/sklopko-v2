import { useEffect } from 'react'
import { closeReference, setReferenceChip, setReferenceTab, useReference, type Chip6502, type Reference6502Tab } from '../app/reference'
import { showToast } from '../app/store'
import { CHANGES_65C02, MNEMONICS_6502, MNEMONICS_65C02, type Category6502 } from '../engine/mnemonics6502'
import { BY_OPCODE_6502, MODE_BYTES, OPCODES_6502, type Mode6502, type Opcode6502 } from '../engine/opcodes6502'
import { DOCUMENTED_65C02, OPCODES_65C02 } from '../engine/opcodes65c02'

const TABS: [Reference6502Tab, string][] = [
  ['start', 'Getting started'],
  ['instructions', 'Instructions'],
  ['modes', 'Addressing modes'],
  ['map', 'Opcode map'],
]

const CATEGORIES: Category6502[] = ['Load and store', 'Arithmetic', 'Logic', 'Shifts', 'Compare', 'Increment and decrement', 'Transfers', 'Stack', 'Flags', 'Jumps and branches', 'Control']

const hex = (n: number, digits = 2) => n.toString(16).toUpperCase().padStart(digits, '0')

/** How an operand in each addressing mode is written (n is a one-byte value or address, nn a two-byte address), what it means. */
const MODES: Record<Mode6502, { written: string; example: string; meaning: string }> = {
  imp: { written: '(nothing)', example: 'INX', meaning: 'The instruction says all there is to say.' },
  acc: { written: 'A, or nothing', example: 'ASL A', meaning: 'Works on the accumulator.' },
  imm: { written: '#n', example: 'LDA #$10', meaning: 'The constant n itself.' },
  zp: { written: 'n', example: 'LDA $10', meaning: 'The byte at address n in the first 256 bytes of memory (the zero page). Shorter and quicker than an absolute address.' },
  zpx: { written: 'n,X', example: 'LDA $10,X', meaning: 'The byte at n + X, wrapping around inside the zero page.' },
  zpy: { written: 'n,Y', example: 'LDX $10,Y', meaning: 'The byte at n + Y, wrapping around inside the zero page.' },
  abs: { written: 'nn', example: 'LDA $1234', meaning: 'The byte at the 16-bit address nn.' },
  abx: { written: 'nn,X', example: 'LDA $1234,X', meaning: 'The byte at nn + X. A read takes one cycle more when this crosses into the next page of 256 bytes.' },
  aby: { written: 'nn,Y', example: 'LDA $1234,Y', meaning: 'The byte at nn + Y (and one cycle more on a read that crosses a page).' },
  ind: { written: '(nn)', example: 'JMP ($FFFC)', meaning: 'The address stored at nn and nn + 1. Only JMP has it. On the NMOS 6502, JMP ($12FF) reads its high byte from $1200, not $1300.' },
  izx: { written: '(n,X)', example: 'LDA ($20,X)', meaning: 'The address stored in the zero page at n + X: a table of pointers, indexed by X.' },
  izy: { written: '(n),Y', example: 'LDA ($20),Y', meaning: 'The address stored in the zero page at n, plus Y: a pointer to a buffer, indexed by Y.' },
  izp: { written: '(n)', example: 'LDA ($20)', meaning: 'The address stored in the zero page at n (65C02 only).' },
  iax: { written: '(nn,X)', example: 'JMP ($1234,X)', meaning: 'The address stored at nn + X (65C02 only; only JMP has it).' },
  zpr: { written: 'n,label', example: 'BBR0 $10,loop', meaning: 'A zero-page address to test, then a branch (65C02 only: BBR and BBS).' },
  rel: { written: 'label', example: 'BNE loop', meaning: 'A branch: the target must be within 128 bytes back or 127 ahead. The program holds the distance from the next instruction.' },
}

/** An instruction's operand as the table writes it, for one addressing mode. */
const FORM: Record<Mode6502, string> = { imp: '', acc: ' A', imm: ' #n', zp: ' n', zpx: ' n,X', zpy: ' n,Y', abs: ' nn', abx: ' nn,X', aby: ' nn,Y', ind: ' (nn)', izx: ' (n,X)', izy: ' (n),Y', rel: ' label', izp: ' (n)', iax: ' (nn,X)', zpr: ' n,label' }

/** The cycles of an instruction as written in the tables: 4+ means one more when an indexed read crosses a page; a branch is 2+. */
const cyclesText = (o: Opcode6502) => `${o.cycles}${o.pageCross || o.mode === 'rel' ? '+' : ''}`

/** The opcodes of a chip, and which of them the NMOS chip has too. */
const opcodesOf = (chip: Chip6502) => (chip === 'cmos' ? OPCODES_65C02 : OPCODES_6502)
/** The instruction an opcode belongs to: `RMB3` is one of `RMBn`. */
const familyOf = (mnemonic: string) => mnemonic.replace(/^(RMB|SMB|BBR|BBS)\d$/, '$1n')

const FLAG_NAMES: Record<string, string> = { N: 'N', V: 'V', Z: 'Z', C: 'C', I: 'I', D: 'D' }
const flagsText = (flags: string) => (flags === '' ? 'none' : flags === 'all' ? 'all' : flags.split(' ').map((f) => FLAG_NAMES[f] ?? f).join(' '))

const EXAMPLE = `.org $F000          ; the ROM starts at $F000
LEDS = $4000        ; a named constant

start:  LDA #$01    ; one bit set
show:   STA LEDS    ; show it on the LEDs
        ASL A       ; shift it left
        BNE show    ; not zero yet: show the next position
        JMP start   ; the bit fell off the end: begin again

.org $FFFC          ; the reset vector: where the CPU starts
.word start`

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(
    () => showToast('Copied. Paste it into a ROM’s Program box.'),
    () => showToast('Could not copy; select the text and copy it yourself.'),
  )
}

function Start({ chip }: { chip: Chip6502 }) {
  return (
    <div className="ref-text">
      <p>
        The <b>MOS 6502</b> is the processor of the Apple II, the Commodore 64 and the NES. Its programs are bytes in memory: an{' '}
        <b>opcode</b> (the instruction and how it finds its data) and up to two bytes of <b>operand</b>. <b>6502 assembly</b> is those
        bytes written as text. A ROM turns the text into the bytes while you type, and the CPU part runs them.
      </p>

      <h3>How to write a program</h3>
      <ol>
        <li>
          Open the <b>6502</b> example <b>A real 6502 CPU on a board</b> and select its ROM, or place a <b>ROM</b> (Memory) with 8 data bits.
        </li>
        <li>
          In the ROM’s inspector choose <b>Contents are → A program in 6502 assembly</b> and type the program. Mistakes are listed with their
          line as you type; the program is loaded when you click outside the box. The <b>listing</b> below shows the address, bytes and
          instruction of each line.
        </li>
        <li>
          The CPU starts at the address stored in <code>$FFFC</code> and <code>$FFFD</code> (low byte first), so a program ends with{' '}
          <code>.org $FFFC</code> and <code>.word start</code>.
        </li>
      </ol>
      <pre className="ref-code">{EXAMPLE}</pre>
      <button onClick={() => copy(EXAMPLE)}>Copy</button>

      <h3>The chip</h3>
      <ul>
        <li>
          <b>A</b>, the accumulator, and <b>X</b> and <b>Y</b>, the index registers: 8 bits each. <b>SP</b> is the stack pointer (the stack is{' '}
          <code>$0100–$01FF</code>); <b>PC</b> the program counter (16 bits). Memory is 64 KB, addresses <code>$0000–$FFFF</code>.
        </li>
        <li>
          <b>Flags</b> (register P): <b>N</b> negative (bit 7 of the result), <b>V</b> overflow, <b>D</b> decimal mode, <b>I</b> interrupts disabled,{' '}
          <b>Z</b> zero, <b>C</b> carry. Comparing is subtracting without keeping the answer; <code>SEC</code> before <code>SBC</code> and <code>CLC</code>{' '}
          before <code>ADC</code> start a subtraction or addition with no carry in.
        </li>
        <li>
          Every instruction takes 2 to 7 clock cycles, and on each cycle the CPU reads or writes one byte. The Instructions tab gives the
          cycles of each.
        </li>
      </ul>

      {chip === 'cmos' && (
        <>
          <h3>The 65C02</h3>
          <p>
            The WDC 65C02 is the chip that breadboard builders use today. It runs the same programs as the 6502, with a few fixes and many additions (marked <b>65C02</b> in the
            Instructions tab). Choose it with the part’s <b>Chip</b> setting, and write the ROM’s program as <b>A program in 65C02 assembly</b>.
          </p>
          <ul>
            <li>
              <b>New instructions</b>: <code>BRA</code> (branch always), <code>STZ</code> (store zero), <code>PHX</code>, <code>PHY</code>, <code>PLX</code>, <code>PLY</code>,{' '}
              <code>INC A</code> and <code>DEC A</code>, <code>TSB</code> and <code>TRB</code> (set and clear bits with A), <code>RMBn</code> and <code>SMBn</code> (clear and set a bit of a
              zero-page byte), <code>BBRn</code> and <code>BBSn</code> (branch on a bit), <code>WAI</code> and <code>STP</code>.
            </li>
            <li>
              <b>New forms</b>: <code>LDA ($10)</code> (and the other seven that have <code>(n),Y</code>), <code>BIT #$80</code>, <code>BIT $10,X</code>, <code>JMP ($1234,X)</code>.
            </li>
            <li>
              <b>Fixes</b>: <code>JMP ($12FF)</code> reads the high byte from <code>$1300</code>, not <code>$1200</code>; decimal mode sets N and Z from the result; BRK and interrupts clear
              D; every opcode does something defined (a NOP at worst).
            </li>
            <li>
              <b>Pins</b>: <code>BE</code> (bus enable), <code>VP</code> (vector pull) and <code>ML</code> (memory lock) in addition.
            </li>
          </ul>
        </>
      )}

      <h3>Writing a program</h3>
      <ul>
        <li>
          <b>One instruction per line</b>, in capitals or not: <code>LDA #$01</code>, <code>STA $4000,X</code>, <code>LDA ($20),Y</code>. A comment runs from{' '}
          <code>;</code> (or <code>//</code>) to the end of the line.
        </li>
        <li>
          <b>Numbers</b>: <code>42</code>, <code>$2A</code> or <code>0x2A</code> (hex), <code>0b101010</code> (binary), <code>'A'</code> (a character). A{' '}
          <b>name</b> is a label (<code>loop:</code>) or a constant (<code>SIZE = 8</code>); a label can be used before it is defined.
        </li>
        <li>
          <b>Expressions</b> add and subtract: <code>table+1</code>, <code>end-start</code>. <code>*</code> is the address of the line. <code>&lt;</code> in front takes the low byte
          of the result and <code>&gt;</code> the high byte: <code>LDA #&lt;start</code>, <code>LDX #&gt;start</code>.
        </li>
        <li>
          <b>Zero page or absolute</b>: an address known to be below 256 (a number, or a name defined above the line) is written in the shorter
          zero-page form. A name defined further down is taken as a full 16-bit address.
        </li>
        <li>
          <code>.org address</code> (or <code>*= address</code>) says where the next byte goes. The <b>first</b> one is the address of the ROM’s first byte:
          a ROM at <code>$F000</code> begins with <code>.org $F000</code>. Without one, the program starts at 0.
        </li>
        <li>
          <code>.byte 1, $FF, 'x', "text"</code> places bytes (a string is one byte per character; <code>\n</code> and <code>\0</code> work). <code>.word nn, …</code> places 16-bit
          values, low byte first. <code>.res n</code> leaves n bytes of zeros.
        </li>
        <li>
          <b>Branches</b> (<code>BNE</code>, <code>BCC</code>…) take the label to go to; the assembler works out the distance and reports a target that is too far.
          <code>JMP</code> and <code>JSR</code> reach anywhere.
        </li>
        <li>
          <b>Errors</b> name the line. While a program has errors, the circuit keeps running the last version that assembled.
        </li>
      </ul>
    </div>
  )
}

/** The instruction table, one table for each group of instructions. */
function Instructions({ chip }: { chip: Chip6502 }) {
  const opcodes = opcodesOf(chip)
  const cmos = chip === 'cmos'
  const mnemonics: Record<string, { category: Category6502; summary: string; flags: string }> = cmos ? { ...MNEMONICS_6502, ...MNEMONICS_65C02 } : MNEMONICS_6502
  /** The forms of an instruction (all of a bit instruction's eight are shown as one: its first). */
  const forms = (m: string) => opcodes.filter((o) => (m.endsWith('n') ? o.bit === 0 && familyOf(o.mnemonic) === m : o.mnemonic === m))
  const isNew = (o: Opcode6502) => cmos && !BY_OPCODE_6502[o.opcode]
  const nmosCycles = (o: Opcode6502) => (cmos ? BY_OPCODE_6502[o.opcode]?.cycles : undefined)
  return (
    <div className="ref-text">
      <p>
        All {opcodes.length} documented opcodes of the {cmos ? '65C02 (the 65C02 does not have the undocumented ones: every other opcode is a NOP of 1 to 3 bytes)' : '6502'}. A form shows how it is written, its opcode in hex, its length in bytes and its
        clock cycles. <b>+</b> after the cycles: one more cycle when an indexed read crosses a page boundary; a branch takes one more when taken, and
        another if it lands on a different page. {cmos ? 'A cycle count that differs from the NMOS 6502’s is followed by what it was there.' : 'Opcodes that are not in the table do nothing useful: the CPU treats them as a 2-cycle NOP.'}
      </p>
      {CATEGORIES.map((category) => (
        <section key={category}>
          <h3>{category}</h3>
          <div className="ref-table-wrap">
            <table className="ref-table" aria-label={category}>
              <thead>
                <tr>
                  <th>Instruction</th>
                  <th>What it does</th>
                  <th>Flags</th>
                  <th>Forms: opcode · bytes · cycles</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(mnemonics)
                  .filter(([, info]) => info.category === category)
                  .map(([mnemonic, info]) => (
                    <tr key={mnemonic} id={`op-${mnemonic}`}>
                      <td>
                        <code>{mnemonic}</code>
                        {cmos && mnemonic in MNEMONICS_65C02 && <span className="ref-badge">65C02</span>}
                      </td>
                      <td>
                        {info.summary}
                        {cmos && CHANGES_65C02[mnemonic] && <div className="ref-operand">65C02: {CHANGES_65C02[mnemonic]}</div>}
                      </td>
                      <td>{flagsText(info.flags)}</td>
                      <td>
                        {forms(mnemonic).map((o) => (
                          <div key={o.opcode} className="ref-form">
                            <code>
                              {mnemonic.endsWith('n') ? mnemonic : o.mnemonic}
                              {FORM[o.mode]}
                            </code>{' '}
                            <span className="ref-operand">
                              {mnemonic.endsWith('n') ? `${hex(o.opcode)} + ${hex(16)} × n` : hex(o.opcode)} · {o.bytes} · {cyclesText(o)}
                              {nmosCycles(o) !== undefined && nmosCycles(o) !== o.cycles ? ` (was ${nmosCycles(o)})` : ''}
                            </span>
                            {isNew(o) && !(mnemonic in MNEMONICS_65C02) && <span className="ref-badge">65C02</span>}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}

function Modes({ chip }: { chip: Chip6502 }) {
  const used = (mode: Mode6502) => opcodesOf(chip).filter((o) => o.mode === mode).length
  return (
    <div className="ref-text">
      <p>
        An <b>addressing mode</b> is how an instruction finds the byte it works on. The same instruction (<code>LDA</code>) has up to eight of them, each with its
        own opcode. In the operand column <code>n</code> is a one-byte number and <code>nn</code> a two-byte one.
      </p>
      <div className="ref-table-wrap">
        <table className="ref-table" aria-label="Addressing modes">
          <thead>
            <tr>
              <th>Mode</th>
              <th>Written</th>
              <th>Example</th>
              <th>Bytes</th>
              <th>Opcodes</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(MODES) as Mode6502[]).filter((mode) => used(mode) > 0).map((mode) => (
              <tr key={mode}>
                <td>
                  <b>{mode}</b>
                </td>
                <td>
                  <code>{MODES[mode].written}</code>
                </td>
                <td>
                  <code>{MODES[mode].example}</code>
                </td>
                <td>{MODE_BYTES[mode]}</td>
                <td>{used(mode)}</td>
                <td>{MODES[mode].meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** The 16 × 16 table of opcodes: the high digit down the side, the low digit across the top. */
function OpcodeMap({ chip }: { chip: Chip6502 }) {
  const digits = Array.from({ length: 16 }, (_, i) => i)
  const table = chip === 'cmos' ? DOCUMENTED_65C02 : BY_OPCODE_6502
  return (
    <div className="ref-text">
      <p>
        Opcodes by value: the high hex digit down the side, the low digit across the top. Empty cells are not documented{chip === 'cmos' ? ' (they are NOPs on the 65C02); the instructions the 65C02 added are shaded' : ''}. Hover a cell for its mode,
        length and cycles.
      </p>
      <div className="ref-table-wrap">
        <table className="ref-table ref-map" aria-label="Opcode map">
          <thead>
            <tr>
              <th />
              {digits.map((c) => (
                <th key={c}>{c.toString(16).toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {digits.map((r) => (
              <tr key={r}>
                <th>{r.toString(16).toUpperCase()}</th>
                {digits.map((c) => {
                  const o = table[r * 16 + c]
                  return (
                    <td key={c} className={chip === 'cmos' && o && !BY_OPCODE_6502[o.opcode] ? 'ref-new' : undefined} title={o ? `${hex(o.opcode)}: ${o.mnemonic}${FORM[o.mode]}, ${o.bytes} byte${o.bytes === 1 ? '' : 's'}, ${cyclesText(o)} cycles` : `${hex(r * 16 + c)}: not documented`}>
                      {o ? o.mnemonic : ''}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** The language reference for 6502 assembly, generated from the opcode table the CPU runs. */
export function Reference6502() {
  const open = useReference((s) => s.open && s.language === '6502')
  const tab = useReference((s) => s.tab as Reference6502Tab)
  const chip = useReference((s) => s.chip)
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeReference()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open])
  if (!open) return null
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && closeReference()}>
      <div className="modal ref" role="dialog" aria-modal="true" aria-label="6502 assembly reference">
        <header className="modal-head">
          <strong>6502 reference</strong>
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
        <div className="modal-body">
          <div className="seg ref-chip" role="group" aria-label="Chip">
            {(['nmos', 'cmos'] as const).map((c) => (
              <button key={c} aria-pressed={chip === c} className={chip === c ? 'active' : ''} onClick={() => setReferenceChip(c)}>
                {c === 'nmos' ? 'MOS 6502' : 'WDC 65C02'}
              </button>
            ))}
          </div>
          {tab === 'start' ? <Start chip={chip} /> : tab === 'instructions' ? <Instructions chip={chip} /> : tab === 'modes' ? <Modes chip={chip} /> : <OpcodeMap chip={chip} />}
        </div>
      </div>
    </div>
  )
}
