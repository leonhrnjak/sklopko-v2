/**
 * The control signals of a ROM word, by name. A control ROM holds one word per instruction, and each bit (or small group of
 * bits) of it switches something on: load the accumulator, write RAM, subtract, jump. This file reads the description of
 * those bits and the names of the rows, and turns a word into text (and back), the way `isa.ts` does for instructions. The
 * ROM inspector's listing and row editor are built on it; the simulation never looks at it (the ROM's `data` is all it runs).
 *
 * A layout is text, one signal per line, **lowest bit first**:
 *
 *     LOAD_ACC                              a signal of one bit
 *     SRC 3 = CONST ALU RAM SHL if LOAD_ACC a field of 3 bits whose values 0, 1, 2… have names; with `if`, it is
 *                                           shown while that signal is on, even when it is 0 (CONST)
 *     DELAY 2                               a field shown as a number
 *     _ 3                                   three bits that nothing uses
 *     ; a comment (also // a comment)
 *
 * The names of the rows are text too, one per line: a hex address and a name (`1E ORI`).
 */

import { parseNumber } from './isa'

export interface Signal {
  name: string
  /** The lowest bit it occupies (0 is the ROM's `D0`). */
  from: number
  width: number
  /** Names of the values 0, 1, 2… of a field (empty for a plain signal or a number). */
  values: string[]
  /** A field that is shown while this one-bit signal is on, even when the field is 0. */
  when?: string
}

export interface SignalLayout {
  signals: Signal[]
  /** Bits the layout covers, used or skipped. */
  bits: number
}

export interface TextError {
  /** 1-based line. */
  line: number
  message: string
}

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/

/** The text of a line without its comment, trimmed. */
const stripComment = (raw: string) => raw.replace(/(?:;|\/\/).*$/, '').trim()

/** Read a layout. Collects every error instead of stopping at the first; a line with an error is left out. */
export function parseSignals(text: string): { layout: SignalLayout; errors: TextError[] } {
  const errors: TextError[] = []
  const signals: Signal[] = []
  const whens: { signal: Signal; line: number }[] = []
  let bits = 0
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    const err = (message: string) => errors.push({ line, message })
    const src = stripComment(raw)
    if (!src) return
    const [head, ...rest] = src.split(/\s*=\s*/)
    if (rest.length > 1) return err('There is more than one “=” on this line.')
    const [name, ...widthTokens] = head.split(/\s+/)
    if (widthTokens.length > 1) return err(`“${head}”: expected a name and a width, like “SRC 3”.`)
    let width = 1
    if (widthTokens.length) {
      width = Number(widthTokens[0])
      if (!/^\d+$/.test(widthTokens[0]) || width < 1 || width > 16) return err(`“${widthTokens[0]}” is not a width from 1 to 16 bits.`)
    }
    if (name !== '_' && !NAME.test(name)) return err(`“${name}” is not a valid name (letters, digits and underscores, starting with a letter).`)
    if (name === '_') {
      if (rest.length) return err('Skipped bits (“_”) have no values.')
      bits += width
      return
    }
    if (signals.some((s) => s.name === name)) return err(`“${name}” is already defined.`)
    const signal: Signal = { name, from: bits, width, values: [] }
    if (rest.length) {
      const [valueText, condition, ...extra] = rest[0].split(/\s+if\s+/)
      if (extra.length) return err('There is more than one “if” on this line.')
      const values = valueText.trim() ? valueText.trim().split(/\s+/) : []
      const bad = values.find((v) => !NAME.test(v))
      if (bad !== undefined) return err(`“${bad}” is not a valid name for a value.`)
      const dup = values.find((v, k) => values.indexOf(v) !== k)
      if (dup !== undefined) return err(`The value “${dup}” is listed twice.`)
      if (values.length > 2 ** width) return err(`${name} has ${width} bit${width === 1 ? '' : 's'}, which hold ${2 ** width} values, but ${values.length} are named.`)
      signal.values = values
      if (condition !== undefined) {
        signal.when = condition.trim()
        whens.push({ signal, line })
      }
    }
    signals.push(signal)
    bits += width
  })
  // The signal named after `if` must exist and be a single bit.
  for (const { signal, line } of whens) {
    const w = signals.find((s) => s.name === signal.when)
    if (!w) {
      errors.push({ line, message: `${signal.name}: “if ${signal.when}”, but there is no signal ${signal.when}.` })
      delete signal.when
    } else if (w.width !== 1) {
      errors.push({ line, message: `${signal.name}: “if ${signal.when}” needs a signal of one bit.` })
      delete signal.when
    }
  }
  errors.sort((a, b) => a.line - b.line)
  return { layout: { signals, bits }, errors }
}

export interface RowNames {
  /** The name of each address that has one. */
  names: Record<number, string>
  /** The address of each name. */
  addresses: Record<string, number>
}

/** Read the names of the rows: one per line, a hex address (`1E` or `0x1E`) and a name. */
export function parseRows(text: string): { rows: RowNames; errors: TextError[] } {
  const errors: TextError[] = []
  const rows: RowNames = { names: {}, addresses: {} }
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    const err = (message: string) => errors.push({ line, message })
    const src = stripComment(raw)
    if (!src) return
    const parts = src.split(/\s+/)
    if (parts.length !== 2) return err('Expected an address and a name, like “1E ORI”.')
    const [address, name] = parts
    if (!/^(?:0x)?[0-9a-f]+$/i.test(address)) return err(`“${address}” is not a hexadecimal address.`)
    if (!NAME.test(name)) return err(`“${name}” is not a valid name (letters, digits and underscores, starting with a letter).`)
    const at = parseInt(address.replace(/^0x/i, ''), 16)
    if (Object.hasOwn(rows.names, at)) return err(`Address ${address} is named twice.`)
    if (Object.hasOwn(rows.addresses, name)) return err(`“${name}” is already the name of another row.`)
    rows.names[at] = name
    rows.addresses[name] = at
  })
  return { rows, errors }
}

/**
 * How a splitter that takes a word of `bits` bits apart gives each signal its own output: the widths of its outputs, lowest
 * bits first (bits that no signal covers get outputs of their own), and the number of the output of each signal.
 */
export function splitPlan(layout: SignalLayout, bits: number): { widths: number[]; output: Record<string, number> } {
  const widths: number[] = []
  const output: Record<string, number> = {}
  let at = 0
  for (const s of [...layout.signals].sort((a, b) => a.from - b.from)) {
    if (s.from > at) widths.push(s.from - at)
    output[s.name] = widths.length
    widths.push(s.width)
    at = s.from + s.width
  }
  if (at < bits) widths.push(bits - at)
  return { widths, output }
}

const maskOf = (width: number) => 2 ** width - 1

/** The value of a signal in a word. */
export const signalValue = (s: Signal, word: number): number => Math.floor(word / 2 ** s.from) & maskOf(s.width)

/** The word with the signal set to `value` (the other bits stay as they are). */
export function withSignal(s: Signal, word: number, value: number): number {
  const v = value & maskOf(s.width)
  return (word & ~(maskOf(s.width) << s.from)) | (v << s.from)
}

/** What a value of a signal is called: its name from the list, or its number. */
export const valueName = (s: Signal, value: number): string => s.values[value] ?? String(value)

/** One thing a word switches on: `LOAD_ACC`, `SRC=ALU`, or a bit no signal describes (`bit 13`). */
export interface SignalPart {
  name: string
  value: number
  /** As written in the listing and in the text form. */
  text: string
}

/**
 * The signals a word switches on, lowest bit first: a one-bit signal that is 1, a field that is not 0 (or whose `if` signal is
 * on), and finally the set bits that no signal covers.
 */
export function signalParts(layout: SignalLayout, word: number): SignalPart[] {
  const parts: SignalPart[] = []
  let covered = 0
  for (const s of layout.signals) {
    covered |= maskOf(s.width) << s.from
    const v = signalValue(s, word)
    if (s.width === 1 && s.values.length === 0) {
      if (v) parts.push({ name: s.name, value: v, text: s.name })
    } else if (v || (s.when !== undefined && signalValue(layout.signals.find((o) => o.name === s.when)!, word))) {
      parts.push({ name: s.name, value: v, text: `${s.name}=${valueName(s, v)}` })
    }
  }
  const extra = word & ~covered
  for (let bit = 0; bit < 32; bit++) if ((extra >>> bit) & 1) parts.push({ name: `bit ${bit}`, value: 1, text: `bit ${bit}` })
  return parts
}

/**
 * What each data pin of a ROM can be called, from the signals: the signal's name for a one-bit signal, the name and the bit
 * (`SRC0`, `SRC1`) for a field, nothing (the pin keeps its own name, `D13`) for a bit no signal covers.
 */
export function pinLabels(layout: SignalLayout, bits: number): (string | undefined)[] {
  const labels: (string | undefined)[] = new Array(bits).fill(undefined)
  for (const s of layout.signals)
    for (let k = 0; k < s.width && s.from + k < bits; k++) labels[s.from + k] = s.width === 1 ? s.name : `${s.name}${k}`
  return labels
}

/** A word as text: `LOAD_ACC, SRC=ALU, SAVE_FLAGS`; empty when it switches nothing on. */
export const describeWord = (layout: SignalLayout, word: number): string => signalParts(layout, word).map((p) => p.text).join(', ')

// ---- The text form ---------------------------------------------------------------------------------

/**
 * A control ROM as text, one row per line:
 *
 *     LDI:   LOAD_ACC SRC=CONST          the row named LDI switches on LOAD_ACC and sets the field SRC to CONST
 *     NOP:                               a row with nothing switched on
 *     0x1E:  LOAD_ACC bit13              a row by its address (hex, with 0x or $), and a bit that no signal names
 *
 * A one-bit signal is named to switch it on (`LOAD_ACC`, or `LOAD_ACC=0` / `=1`); a field takes `NAME=VALUE`, where the value is
 * one of its names or a number. Rows that are not listed are 0. `;` starts a comment.
 */
export interface SignalsAsm {
  /** The words of the ROM, padded with zeros to its size. */
  words: number[]
  errors: TextError[]
}

const ADDRESS = /^(?:0x|\$)([0-9a-f]+)$/i
const sameName = (a: string, b: string) => a.toUpperCase() === b.toUpperCase()

/** Turn the text form into the words of a ROM of `size` words of `bits` bits. Collects every error instead of stopping at the first. */
export function assembleSignals(layout: SignalLayout, rows: RowNames, text: string, size: number, bits: number): SignalsAsm {
  const errors: TextError[] = []
  const words = new Array<number>(size).fill(0)
  const seen = new Set<number>()
  const names = layout.signals.map((s) => s.name)
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    const err = (message: string) => errors.push({ line, message })
    const src = stripComment(raw)
    if (!src) return
    const colon = src.indexOf(':')
    if (colon < 0) return err('Expected a row and its signals, like “LDI: LOAD_ACC SRC=CONST”.')
    const head = src.slice(0, colon).trim()
    let at: number | undefined
    const hex = ADDRESS.exec(head)
    if (hex) at = parseInt(hex[1], 16)
    else {
      const found = Object.keys(rows.addresses).find((n) => sameName(n, head))
      if (found !== undefined) at = rows.addresses[found]
    }
    if (at === undefined) return err(`Unknown row “${head}”. Name it in the row names, or write its address, like 0x1E.`)
    if (at >= size) return err(`Row ${head} is at address ${at}, but the ROM has only ${size} words.`)
    if (seen.has(at)) return err(`Row ${head} is listed twice.`)
    seen.add(at)
    let word = 0
    const used = new Set<string>()
    for (const item of src.slice(colon + 1).split(/[\s,]+/).filter(Boolean)) {
      const stray = /^bit(\d+)$/i.exec(item)
      if (stray) {
        if (Number(stray[1]) >= bits) err(`${item}: the ROM has only ${bits} data bits.`)
        else word |= 2 ** Number(stray[1])
        continue
      }
      const [name, ...valueParts] = item.split('=')
      const s = layout.signals.find((o) => sameName(o.name, name))
      if (!s) {
        err(`Unknown signal “${name}”.${names.length ? ` The signals are ${names.join(', ')}.` : ''}`)
        continue
      }
      if (used.has(s.name)) {
        err(`${s.name} is written twice in this row.`)
        continue
      }
      used.add(s.name)
      if (valueParts.length > 1) {
        err(`“${item}”: more than one “=”.`)
        continue
      }
      const given = valueParts[0]
      const plain = s.width === 1 && s.values.length === 0
      if (given === undefined) {
        if (!plain) err(`${s.name} is a field and needs a value, like ${s.name}=${s.values[0] ?? 0}.`)
        else word = withSignal(s, word, 1)
        continue
      }
      let value = s.values.findIndex((v) => sameName(v, given))
      if (value < 0) {
        const n = parseNumber(given)
        if (n === null || !Number.isInteger(n)) {
          err(`“${given}” is not a value of ${s.name}${s.values.length ? ` (${s.values.join(', ')})` : ''}.`)
          continue
        }
        value = n
      }
      if (value < 0 || value > maskOf(s.width)) {
        err(`${s.name}=${given}: the value does not fit in ${s.width} bit${s.width === 1 ? '' : 's'} (0 to ${maskOf(s.width)}).`)
        continue
      }
      word = withSignal(s, word, value)
    }
    words[at] = word
  })
  errors.sort((a, b) => a.line - b.line)
  return { words, errors }
}

/**
 * The text form of a ROM's words: a line for every row that has a name or is not 0, in address order. Assembling it gives
 * the same words back.
 */
export function signalsToText(layout: SignalLayout, rows: RowNames, words: number[]): string {
  const lines: { head: string; body: string }[] = []
  words.forEach((w, at) => {
    const name = rows.names[at]
    if (name === undefined && !w) return
    const head = `${name ?? `0x${at.toString(16).toUpperCase().padStart(2, '0')}`}:`
    lines.push({ head, body: signalParts(layout, w).map((p) => p.text.replace(/^bit (\d+)$/, 'bit$1')).join(' ') })
  })
  const width = Math.max(0, ...lines.map((l) => l.head.length)) + 1
  return lines.map((l) => (l.body ? `${l.head.padEnd(width)}${l.body}` : l.head)).join('\n')
}
