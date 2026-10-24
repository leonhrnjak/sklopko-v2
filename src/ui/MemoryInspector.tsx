import { useEffect, useMemo, useRef, useState } from 'react'
import { useCompSignature } from '../app/hooks'
import { downloadText, openTextFile } from '../app/files'
import { openReference } from '../app/reference'
import { sim } from '../app/sim'
import { pokeWord, setParams, showToast, useStore } from '../app/store'
import type { ConsoleState } from '../engine/components/devices'
import { HEX_WORDS, parseWords } from '../engine/components/memory'
import { fillLut, lutInputNames, lutOutputNames } from '../logic/lut'
import { getDef } from '../engine/registry'
import { ISAS, assemble, disassemble, getIsa, toHexBytes, toHexWords, type AsmResult, type Isa } from '../engine/isa'
import { SIGNAL_PRESETS } from '../engine/signal-presets'
import { describeWord, parseRows, parseSignals, type SignalLayout, type TextError } from '../engine/signals'
import { toNum, type Params } from '../engine/types'
import type { Comp } from '../model/circuit'
import { TextParam } from './TextParam'

const hexOf = (n: number, digits: number) => n.toString(16).toUpperCase().padStart(digits, '0')

/** The part as it is now. */
const currentComp = (id: string): Comp | undefined => useStore.getState().circuit.comps[id]

/** Parameters of the part as they are now (event handlers must not use the props of an earlier render). */
const currentParams = (id: string): Params => useStore.getState().circuit.comps[id]?.params ?? {}

// ---- ROM ---------------------------------------------------------------------------------------

/** Pick how a ROM's contents are written. A program starts from what the ROM holds now. */
function chooseIsa(comp: Comp, id: string) {
  const isa = getIsa(id)
  if (!isa) return setParams(comp.id, { isa: 'none' })
  const p = comp.params
  const patch: Params = { isa: id }
  if (Number(p.dbits) !== isa.bits) patch.dbits = isa.bits
  const dataDef = getDef('rom').params!.find((d) => d.key === 'data')!
  if (!String(p.source) && String(p.data) !== dataDef.default) {
    const words = parseWords(String(p.data), 2 ** Number(p.abits), isa.bits)
    const used = words.reduce((n, w, i) => (w ? i + 1 : n), 0)
    patch.source = words.slice(0, used).map((w) => disassemble(isa, w)).join('\n')
  }
  setParams(comp.id, patch)
}

/** What a program that assembled changes in the ROM: its words, and its table (turned on if the program has one). */
function assembled(isa: Isa, source: string, r: AsmResult, comp: Comp): Params {
  const patch: Params = { source, data: toHexWords(r.words, isa.bits) }
  const tdata = toHexBytes(r.table)
  if (comp.params.table === 'on' || tdata) {
    patch.table = 'on'
    patch.tdata = tdata
  }
  return patch
}

/** Source of a program, checked as you type and applied when you click away (one undo step). */
function ProgramEditor({ comp, isa, words }: { comp: Comp; isa: Isa; words: number }) {
  const saved = String(comp.params.source)
  const [draft, setDraft] = useState(saved)
  const latest = useRef({ draft, saved })
  useEffect(() => {
    latest.current = { draft, saved }
  })
  const result = useMemo(() => assemble(isa, draft, words), [isa, draft, words])
  const commit = () => {
    const { draft: d, saved: s } = latest.current
    if (d === s) return
    latest.current.saved = d // the remount that follows must not apply it a second time
    const r = assemble(isa, d, words)
    // With errors the source is kept, but the circuit keeps running the last program that assembled.
    setParams(comp.id, r.errors.length ? { source: d } : assembled(isa, d, r, comp))
  }
  // Apply a pending edit when the inspector goes away (another part gets selected).
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => commit, [])
  const count = result.lineOf.length
  return (
    <div className="field">
      <span>Program ({isa.name})</span>
      <textarea
        className={`mono asm${result.errors.length ? ' invalid' : ''}`}
        aria-label="Program source"
        rows={Math.min(24, Math.max(10, draft.split('\n').length + 1))}
        spellCheck={false}
        wrap="off"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && (e.target as HTMLTextAreaElement).blur()}
      />
      {result.errors.length > 0 ? (
        <ul className="asm-errors" aria-label="Errors">
          {result.errors.map((e, i) => (
            <li key={i}>
              <b>Line {e.line}:</b> {e.message}
            </li>
          ))}
          <li className="note">The circuit keeps running the last program that assembled.</li>
        </ul>
      ) : (
        <small>
          {count} of {words} instructions.{draft !== saved ? ' Applies when you click outside the box (or press Ctrl+Enter).' : ''}
        </small>
      )}
    </div>
  )
}

/** What a control ROM's row is called and what it switches on, for the listing. */
interface ControlRow {
  name: string
  signals: string
}

/** All words of a ROM: address, value and (for a program) the instruction or (for a control ROM) the row's name and signals, with the one being read right now marked. */
function Listing({ comp, isa, values, digits, control, hideEmpty }: { comp: Comp; isa?: Isa; values: number[]; digits: number; control?: ControlRow[]; hideEmpty?: boolean }) {
  useCompSignature(comp.id, true)
  const addr = toNum(sim.inputValues(comp.id), 0, Number(comp.params.abits))
  const addrDigits = Math.max(1, (values.length - 1).toString(16).length)
  return (
    <div className={`listing${control ? ' control' : ''}`} role="table" aria-label="Listing">
      {values.map((w, i) => {
        const row = control?.[i]
        // A control ROM is mostly empty rows: leave them out when asked, except the one being read.
        if (hideEmpty && row && !row.name && !row.signals && i !== addr) return null
        return (
          <div key={i} className={`row-listing${i === addr ? ' current' : ''}${control ? ' control' : ''}`} role="row" aria-current={i === addr ? 'true' : undefined}>
            <span className="addr">{hexOf(i, addrDigits)}</span>
            <span className="word">{hexOf(w, digits)}</span>
            {row ? (
              <>
                <span className="text">{row.name}</span>
                <span className="signals">{row.signals || (row.name ? 'nothing' : '')}</span>
              </>
            ) : (
              <span className="text">{isa ? disassemble(isa, w) : ''}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The names of a control ROM's bits and rows, as two texts to edit, with the built-in sets to start from. */
function SignalsEditor({ comp, layout, errors }: { comp: Comp; layout: SignalLayout; errors: { signals: TextError[]; rows: TextError[] } }) {
  const p = comp.params
  const bits = Number(p.dbits)
  const presets = SIGNAL_PRESETS.filter((x) => x.abits === Number(p.abits) && x.dbits === bits)
  const named = String(p.signals).trim() !== ''
  const field = (key: 'signals' | 'rows', label: string, rows: number, errs: TextError[]) => (
    <label className="field">
      <span>{label}</span>
      <textarea
        key={`${key}|${String(p[key])}`}
        className={`mono asm${errs.length ? ' invalid' : ''}`}
        aria-label={label}
        rows={rows}
        spellCheck={false}
        wrap="off"
        defaultValue={String(p[key])}
        onBlur={(e) => e.target.value !== String(currentParams(comp.id)[key]) && setParams(comp.id, { [key]: e.target.value })}
      />
      {errs.length > 0 && (
        <ul className="asm-errors" aria-label={`${label}: errors`}>
          {errs.map((e, i) => (
            <li key={i}>
              <b>Line {e.line}:</b> {e.message}
            </li>
          ))}
        </ul>
      )}
    </label>
  )
  return (
    <details className="signals-editor" open={errors.signals.length + errors.rows.length > 0 || undefined}>
      <summary>{named ? 'Names of the bits and rows' : 'Name the bits (for a control ROM)'}</summary>
      {presets.length > 0 && (
        <label className="field">
          <span>Start from</span>
          <select
            aria-label="Names to start from"
            value=""
            onChange={(e) => {
              const x = SIGNAL_PRESETS.find((q) => q.id === e.target.value)
              if (x) setParams(comp.id, { signals: x.signals, rows: x.rows })
              else if (e.target.value === 'none') setParams(comp.id, { signals: '', rows: '' })
            }}
          >
            <option value="">Choose…</option>
            {presets.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
            {named && <option value="none">No names</option>}
          </select>
        </label>
      )}
      {field('signals', 'Signals', Math.min(18, Math.max(5, String(p.signals).split('\n').length + 1)), errors.signals)}
      {layout.bits > bits && (
        <small className="field-error">
          The signals take {layout.bits} bits, and the ROM has {bits} data bits.
        </small>
      )}
      {field('rows', 'Row names', 5, errors.rows)}
      <small>
        One signal per line, lowest bit first: <code>LOAD</code>, <code>SRC 3 = CONST ALU RAM</code> (a field with named values), <code>_ 2</code> (skip 2 bits). A row name is an address and a name: <code>1E ORI</code>.
      </small>
    </details>
  )
}

/** The bytes of a ROM's table, sixteen to a row, with the address at the start of each row. */
function TableDump({ text }: { text: string }) {
  const bytes = parseWords(text, 256, 8)
  const used = bytes.reduce((n, v, i) => (v ? i + 1 : n), 0)
  const rows = Array.from({ length: Math.ceil(used / 16) }, (_, r) => bytes.slice(r * 16, r * 16 + 16))
  return (
    <div className="field">
      <span>Table (read with LDT; filled in by .byte)</span>
      {rows.length ? (
        <pre className="table-dump" aria-label="Table contents">
          {rows.map((row, r) => `${hexOf(r * 16, 2)}: ${row.map((v) => hexOf(v, 2)).join(' ')}`).join('\n')}
        </pre>
      ) : (
        <small>Empty. Add .byte lines to the program.</small>
      )}
    </div>
  )
}

/** The name and the signals of each row of a control ROM. */
function decodeRows(layout: SignalLayout, names: Record<number, string>, values: number[]): ControlRow[] {
  return values.map((w, i) => ({ name: names[i] ?? '', signals: describeWord(layout, w) }))
}

export function RomSection({ comp }: { comp: Comp }) {
  const p = comp.params
  const isa = getIsa(String(p.isa))
  const words = 2 ** Number(p.abits)
  const bits = Number(p.dbits)
  const values = parseWords(String(p.data), words, bits)
  const dataDef = getDef('rom').params!.find((d) => d.key === 'data')!
  // A control ROM has names for its bits and rows: the listing then says what each row switches on.
  const signalsText = String(p.signals)
  const rowsText = String(p.rows)
  const parsedNames = useMemo(() => ({ signals: parseSignals(signalsText), rows: parseRows(rowsText) }), [signalsText, rowsText])
  const control = !isa && signalsText.trim() !== ''
  const dataText = String(p.data)
  const controlRows = useMemo(
    () => (control ? decodeRows(parsedNames.signals.layout, parsedNames.rows.rows.names, parseWords(dataText, words, bits)) : undefined),
    [control, parsedNames, dataText, words, bits],
  )
  const [hideEmpty, setHideEmpty] = useState(true)

  const save = () => {
    const now = currentParams(comp.id)
    if (isa) downloadText('program.asm', String(now.source))
    else downloadText('program.hex', `${String(now.data).trim()}\n`)
  }
  const load = async () => {
    const file = await openTextFile('.asm,.txt,.hex,text/plain')
    if (!file) return
    if (isa) {
      const r = assemble(isa, file.text, words)
      setParams(comp.id, r.errors.length ? { source: file.text } : assembled(isa, file.text, r, currentComp(comp.id) ?? comp))
      showToast(r.errors.length ? `Opened ${file.name}, with ${r.errors.length} error${r.errors.length === 1 ? '' : 's'}.` : `Opened ${file.name}.`)
    } else if (HEX_WORDS.test(file.text)) {
      setParams(comp.id, { data: file.text.trim().replace(/\s+/g, ' ') })
      showToast(`Opened ${file.name}.`)
    } else showToast(`${file.name} is not a list of hexadecimal words.`)
  }

  return (
    <>
      <label className="field">
        <span>Contents are</span>
        <select value={String(p.isa)} onChange={(e) => chooseIsa(comp, e.target.value)}>
          <option value="none">Hex words</option>
          {ISAS.map((i) => (
            <option key={i.id} value={i.id}>
              A program in {i.name}
            </option>
          ))}
        </select>
      </label>
      {isa && bits !== isa.bits ? (
        <div className="field">
          <small className="field-error">
            This instruction set needs {isa.bits} data bits, and the ROM has {bits}.
          </small>
          <button onClick={() => setParams(comp.id, { dbits: isa.bits })}>Set to {isa.bits} bits</button>
        </div>
      ) : isa ? (
        <ProgramEditor key={`${comp.id}|${String(p.source)}`} comp={comp} isa={isa} words={words} />
      ) : (
        <TextParam key={`data|${String(p.data)}`} comp={comp} p={dataDef} />
      )}
      {controlRows && words > 16 && (
        <label className="field check">
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
          <span>Only rows with a name or signals</span>
        </label>
      )}
      <Listing comp={comp} isa={isa && bits === isa.bits ? isa : undefined} values={values} digits={Math.ceil(bits / 4)} control={controlRows} hideEmpty={hideEmpty} />
      {!isa && <SignalsEditor comp={comp} layout={parsedNames.signals.layout} errors={{ signals: parsedNames.signals.errors, rows: parsedNames.rows.errors }} />}
      {p.table === 'on' && <TableDump text={String(p.tdata)} />}
      <div className="row">
        <button onClick={load} title={isa ? 'Replace the program with a .asm file' : 'Replace the contents with a file of hex words'}>
          Open…
        </button>
        <button onClick={save} title={isa ? 'Download the program as a .asm file' : 'Download the contents as a .hex file'}>
          Save…
        </button>
        {isa && (
          <button onClick={() => openReference()} title="The instructions, ports and examples of the assembly language">
            {isa.name} reference…
          </button>
        )}
      </div>
    </>
  )
}

// ---- RAM ---------------------------------------------------------------------------------------

/** The words of a RAM now, refreshed as the simulation changes them (a write need not change any pin). */
function useMemoryWords(id: string): number[] {
  const read = () => [...((sim.state(id)?.mem as number[] | undefined) ?? [])]
  const [words, setWords] = useState(read)
  useEffect(() => {
    const refresh = () => setWords((prev) => {
      const now = read()
      return now.length === prev.length && now.every((v, i) => v === prev[i]) ? prev : now
    })
    refresh()
    const timer = window.setInterval(refresh, 100)
    const off = sim.subscribe(refresh)
    return () => {
      window.clearInterval(timer)
      off()
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  return words
}

export function RamSection({ comp }: { comp: Comp }) {
  const bits = Number(comp.params.dbits)
  const abits = Number(comp.params.abits) || 4
  const digits = bits / 4
  const addrDigits = Math.ceil(abits / 4)
  const running = useStore((s) => s.running)
  const mem = useMemoryWords(comp.id)
  useCompSignature(comp.id, true)
  const addr = toNum(sim.inputValues(comp.id), bits + 2, abits)
  const [editing, setEditing] = useState<number | null>(null)
  const cancelled = useRef(false) // Escape: the blur that follows must not apply the text

  const finish = (i: number, text: string) => {
    setEditing(null)
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    const n = parseInt(text, 16)
    if (/^[0-9a-f]+$/i.test(text) && !Number.isNaN(n)) pokeWord(comp.id, i, n)
  }
  return (
    <div className="field">
      <span>Contents</span>
      <div className="ram-grid" role="grid" aria-label="RAM contents">
        {mem.map((v, i) => (
          <div key={i} className={`ram-word${i === addr ? ' current' : ''}`} role="gridcell">
            <span className="addr">{hexOf(i, addrDigits)}</span>
            {editing === i && !running ? (
              <input
                autoFocus
                aria-label={`Word ${hexOf(i, addrDigits)}`}
                defaultValue={hexOf(v, digits)}
                maxLength={digits}
                spellCheck={false}
                onFocus={(e) => e.target.select()}
                onBlur={(e) => finish(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  else if (e.key === 'Escape') {
                    cancelled.current = true
                    ;(e.target as HTMLInputElement).blur()
                  }
                }}
              />
            ) : (
              <button
                className="val"
                disabled={running}
                title={running ? 'Pause the simulation to edit' : 'Click to change this word'}
                onClick={() => setEditing(i)}
              >
                {hexOf(v, digits)}
              </button>
            )}
          </div>
        ))}
      </div>
      <small>{running ? 'Pause the simulation to edit the words (hex).' : 'Click a word to change it (hex). Reset clears the memory.'}</small>
      <div className="row">
        <button disabled={running} onClick={() => mem.forEach((_, i) => pokeWord(comp.id, i, 0))}>
          Clear all
        </button>
      </div>
    </div>
  )
}

// ---- Lookup table ------------------------------------------------------------------------------

/** The rows of a lookup table, with a clickable cell for every output bit. */
export function LutSection({ comp }: { comp: Comp }) {
  const n = Number(comp.params.inputs)
  const m = Number(comp.params.outputs)
  const rows = 2 ** n
  const words = parseWords(String(comp.params.data), rows, m)
  const digits = Math.ceil(m / 4)
  const names = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i))
  const outNames = m === 1 ? ['Y'] : Array.from({ length: m }, (_, i) => `Y${i}`)
  const write = (next: number[]) => setParams(comp.id, { data: next.map((w) => hexOf(w, digits)).join(' ') })
  const flip = (row: number, bit: number) => write(words.map((w, r) => (r === row ? w ^ (1 << bit) : w)))
  return (
    <div className="field">
      <span>Truth table</span>
      <div className="listing lut-grid">
        <table className="truth" aria-label="Lookup table">
          <thead>
            <tr>
              {names.map((a) => (
                <th key={a} className="in">
                  {a}
                </th>
              ))}
              {outNames.map((y) => (
                <th key={y} className="out">
                  {y}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {words.map((w, row) => (
              <tr key={row}>
                {names.map((a, i) => (
                  <td key={a} className="in">
                    {(row >> (n - 1 - i)) & 1}
                  </td>
                ))}
                {outNames.map((y, o) => {
                  const bit = (w >> o) & 1
                  return (
                    <td key={y} className={`out v${bit}`}>
                      <button className="cellbtn" aria-label={`Row ${row}, ${y}`} onClick={() => flip(row, o)}>
                        {bit}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small>Click a value to flip it. The inputs pick the row (A is the leftmost bit).</small>
      <div className="row">
        <button onClick={() => write(words.map(() => 0))}>All 0</button>
        <button onClick={() => write(words.map(() => 2 ** m - 1))}>All 1</button>
      </div>
      <LutFromExpression key={comp.id} comp={comp} words={words} write={write} />
    </div>
  )
}

/** A box for a boolean expression, and a button that fills the table from it (see `fillLut`). */
function LutFromExpression({ comp, words, write }: { comp: Comp; words: number[]; write: (next: number[]) => void }) {
  const n = Number(comp.params.inputs)
  const m = Number(comp.params.outputs)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const outs = lutOutputNames(m)
  const apply = () => {
    const r = fillLut(text, n, m, words)
    if (r.ok) {
      setError('')
      write(r.words)
    } else setError(r.error)
  }
  return (
    <div className="lut-expr">
      <label className="field">
        <span>Fill from an expression</span>
        <textarea
          aria-label="Expression for the table"
          rows={m > 1 ? 3 : 2}
          spellCheck={false}
          value={text}
          placeholder={m > 1 ? `${outs[0]} = A·B + ¬C\n${outs[1]} = A ⊕ B` : 'A·B + ¬C'}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={error !== ''}
        />
      </label>
      <small>
        Use {lutInputNames(n).join(', ')} as the inputs, written as in the Logic window (· + ¬ ⊕, or &amp; | ! ^).
        {m > 1 ? ` One line for each output: ${outs.join(', ')}; a line you leave out keeps its values.` : ''}
      </small>
      {error && (
        <p className="logic-warning" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button onClick={apply} disabled={!text.trim()}>
          Fill the table
        </button>
      </div>
    </div>
  )
}

// ---- Text console ------------------------------------------------------------------------------

/** Everything the console has printed, and buttons to clear or copy it. */
export function ConsoleSection({ comp }: { comp: Comp }) {
  useCompSignature(comp.id, true)
  const st = sim.state(comp.id) as ConsoleState | undefined
  const text = (st?.lines ?? ['']).join('\n')
  const clear = () => {
    sim.setState(comp.id, { lines: [''], rev: (st?.rev ?? 0) + 1 })
    sim.publish()
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      showToast('Copied the console text.')
    } catch {
      showToast('Could not copy: the browser did not allow it.')
    }
  }
  return (
    <div className="field">
      <span>Text so far</span>
      <pre className="console-view" aria-label="Console text">
        {text || ' '}
      </pre>
      <div className="row">
        <button onClick={clear}>Clear</button>
        <button onClick={copy}>Copy text</button>
      </div>
    </div>
  )
}

/** The contents editor for a ROM, RAM, LUT or console. */
export function MemorySection({ comp }: { comp: Comp }) {
  if (comp.type === 'rom') return <RomSection comp={comp} />
  if (comp.type === 'ram') return <RamSection comp={comp} />
  if (comp.type === 'lut') return <LutSection comp={comp} />
  return <ConsoleSection comp={comp} />
}
