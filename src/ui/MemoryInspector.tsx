import { useEffect, useMemo, useRef, useState } from 'react'
import { useCompSignature } from '../app/hooks'
import { downloadText, openTextFile } from '../app/files'
import { openReference } from '../app/reference'
import { sim } from '../app/sim'
import { pokeWord, setParams, showToast, useStore } from '../app/store'
import type { ConsoleState } from '../engine/components/devices'
import { HEX_WORDS, parseWords } from '../engine/components/memory'
import { getDef } from '../engine/registry'
import { ISAS, assemble, disassemble, getIsa, toHexWords, type Isa } from '../engine/isa'
import { toNum, type Params } from '../engine/types'
import type { Comp } from '../model/circuit'
import { TextParam } from './TextParam'

const hexOf = (n: number, digits: number) => n.toString(16).toUpperCase().padStart(digits, '0')

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
    setParams(comp.id, r.errors.length ? { source: d } : { source: d, data: toHexWords(r.words, isa.bits) })
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

/** All words of a ROM: address, value and (for a program) the instruction, with the one being read right now marked. */
function Listing({ comp, isa, values, digits }: { comp: Comp; isa?: Isa; values: number[]; digits: number }) {
  useCompSignature(comp.id, true)
  const addr = toNum(sim.inputValues(comp.id), 0, Number(comp.params.abits))
  const addrDigits = Math.max(1, (values.length - 1).toString(16).length)
  return (
    <div className="listing" role="table" aria-label="Listing">
      {values.map((w, i) => (
        <div key={i} className={`row-listing${i === addr ? ' current' : ''}`} role="row" aria-current={i === addr ? 'true' : undefined}>
          <span className="addr">{hexOf(i, addrDigits)}</span>
          <span className="word">{hexOf(w, digits)}</span>
          <span className="text">{isa ? disassemble(isa, w) : ''}</span>
        </div>
      ))}
    </div>
  )
}

export function RomSection({ comp }: { comp: Comp }) {
  const p = comp.params
  const isa = getIsa(String(p.isa))
  const words = 2 ** Number(p.abits)
  const bits = Number(p.dbits)
  const values = parseWords(String(p.data), words, bits)
  const dataDef = getDef('rom').params!.find((d) => d.key === 'data')!

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
      setParams(comp.id, r.errors.length ? { source: file.text } : { source: file.text, data: toHexWords(r.words, isa.bits) })
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
      <Listing comp={comp} isa={isa && bits === isa.bits ? isa : undefined} values={values} digits={Math.ceil(bits / 4)} />
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
