import { useEffect } from 'react'
import { closeReference, setReferenceTab, useReference, type ReferenceBasicTab } from '../app/reference'
import { useStore } from '../app/store'
import { BASIC_ENTRIES, BASIC_ERRORS, type BasicEntry } from '../model/basic-reference'
import { BasicPrograms } from './BasicPrograms'

const TABS: [ReferenceBasicTab, string][] = [
  ['start', 'Getting started'],
  ['statements', 'Statements'],
  ['functions', 'Functions and operators'],
  ['programs', 'Programs to type in'],
]

function Table({ entries, example = true }: { entries: BasicEntry[]; example?: boolean }) {
  return (
    <div className="ref-table-wrap">
      <table className="ref-table">
        <thead>
          <tr>
            <th>Word</th>
            <th>Written</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.word} id={`basic-${e.word}`}>
              <td>
                <code>{e.word}</code>
              </td>
              <td>
                <code>{e.syntax}</code>
              </td>
              <td>
                {e.text}
                {example && e.try && (
                  <div>
                    <code>{e.try}</code> prints <code>{e.shows?.trim() === '' ? '(nothing)' : e.shows?.trim()}</code>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Start() {
  return (
    <div className="ref-text">
      <p>
        The BASIC computer runs <b>Microsoft BASIC</b> version 1.1 (1978), the BASIC of the Apple II, the Commodore PET and Ben Eater’s breadboard computer. It
        comes from Microsoft’s own source, which Microsoft released under the MIT licence, and runs as a program in the computer’s ROM.
      </p>
      <h3>Typing</h3>
      <ul>
        <li>
          Open the example <b>BASIC computer</b>, click the terminal’s screen and type. A line that starts with a number is stored in the program (the same number
          again replaces it; a number alone deletes the line); any other line runs at once. <code>RUN</code> runs the program, <code>LIST</code> shows it, <code>NEW</code> throws it away.
        </li>
        <li>
          Everything is in <b>capitals</b>: the terminal turns what you type into capitals (its <b>Capitals</b> setting), because BASIC knows its words only in capitals. There is
          no lower case, and no graphics, sound, disk or tape.
        </li>
        <li>
          <b>Backspace</b> deletes the last character; <b>@</b> (or a line that goes wrong) throws the whole line away; <b>Control+C</b> (or Escape, or the inspector’s
          <b> Break</b> button) stops a running program and says <code>BREAK IN</code> the line. <code>CONT</code> goes on.
        </li>
        <li>
          A line may have up to 72 characters. The screen is 40 columns wide: a longer line wraps as you type.
        </li>
        <li>
          Statements can follow each other on a line, separated by a colon: <code>10 FOR I=1 TO 3:PRINT I:NEXT I</code>. <code>?</code> is short for <code>PRINT</code>.
        </li>
      </ul>
      <h3>Numbers, strings and variables</h3>
      <ul>
        <li>
          Numbers are floating point with about nine digits. A variable name is a letter and perhaps a letter or digit (<code>A</code>, <code>X1</code>, <code>AB</code>:
          only the first two characters count); a name ending in <code>$</code> holds a string (<code>A$</code>), up to 255 characters. Arrays are written <code>A(5)</code>.
        </li>
        <li>
          Comparisons give <code>-1</code> for true and <code>0</code> for false. Without a <code>LET</code> you may still write <code>A=5</code>.
        </li>
      </ul>
      <h3>Memory and speed</h3>
      <ul>
        <li>
          The RAM is <code>$0000–$3FFF</code>, 16 KB: BASIC’s variables and stack, then your program and its variables (15,615 bytes are free at the start). The terminal’s
          registers are at <code>$5000–$5003</code>, and the ROM at <code>$8000–$FFFF</code>. <code>PEEK</code> and <code>POKE</code> reach every address; <code>PEEK(20481)</code> is the terminal’s status.
        </li>
        <li>
          BASIC does its arithmetic in software, a few instructions at a time: an empty loop of 1,000 turns takes about a million clock cycles, and printing one number about thirty thousand. In the browser that is seconds, so
          programs that print as they go are the ones to try; the last tab has four.
        </li>
        <li>
          The switch on the board, <b>Ask the start-up questions</b>, makes BASIC ask <code>MEMORY SIZE?</code> and <code>TERMINAL WIDTH?</code> after a Reset: press Enter for both.
          <b> Reset</b> is a cold start: the program is gone.
        </li>
      </ul>
      <h3>Error messages</h3>
      <p>
        An error prints as <code>?XX ERROR</code> (and <code>IN line</code> when it came from a program), then <code>OK</code>.
      </p>
      <div className="ref-table-wrap">
        <table className="ref-table">
          <tbody>
            {BASIC_ERRORS.map(([code, text]) => (
              <tr key={code}>
                <td>
                  <code>{code}</code>
                </td>
                <td>{text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Where it comes from</h3>
      <p>
        Microsoft BASIC for 6502 Microprocessor, version 1.1, copyright Microsoft 1976–1978, from{' '}
        <a href="https://github.com/microsoft/BASIC-M6502" target="_blank" rel="noreferrer">
          github.com/microsoft/BASIC-M6502
        </a>
        , released by Microsoft under the MIT licence (the notice is in the repository, in <code>LICENSE-BASIC</code>). This project translates that source and adds the code that talks to the terminal.
      </p>
    </div>
  )
}

export function ReferenceBasic() {
  const open = useReference((s) => s.open && s.language === 'basic')
  const tab = useReference((s) => s.tab as ReferenceBasicTab)
  const terminal = useStore((s) => Object.values(s.circuit.comps).find((c) => c.type === 'acia6551')?.id)
  const hasLcd = useStore((s) => Object.values(s.circuit.comps).some((c) => c.type === 'hd44780'))
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeReference()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open])
  if (!open) return null
  const statements = BASIC_ENTRIES.filter((e) => e.kind === 'statement' || e.kind === 'word')
  const functions = BASIC_ENTRIES.filter((e) => e.kind === 'function' || e.kind === 'operator')
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && closeReference()}>
      <div className="modal ref" role="dialog" aria-modal="true" aria-label="BASIC reference">
        <header className="modal-head">
          <strong>BASIC reference</strong>
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
          {tab === 'start' ? (
            <Start />
          ) : tab === 'statements' ? (
            <Table entries={statements} />
          ) : tab === 'functions' ? (
            <Table entries={functions} />
          ) : (
            <div className="ref-text">
              <p>
                {terminal ? 'Each program can be copied, or typed in on this circuit’s terminal as if from the keyboard (the last line starts it).' : 'Copy a program, open the BASIC computer example, click its terminal and paste.'}{' '}
                Stop a program with Control+C.
              </p>
              <BasicPrograms terminalId={terminal} hasLcd={hasLcd} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
