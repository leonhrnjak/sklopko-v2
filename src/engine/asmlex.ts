/**
 * The parts of reading assembly text that every assembler here shares (SKASM in `isa.ts`, the 6502 in `asm6502.ts`): numbers,
 * names, comments, and the `NAME = value` and `label:` forms of a line.
 */

export interface AsmError {
  /** 1-based source line. */
  line: number
  message: string
}

export const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/** A number written in decimal, 0x… / $… hex or 0b… binary (with an optional minus sign), or null. */
export function parseNumber(token: string): number | null {
  const m = /^(-?)(?:0x([0-9a-f]+)|\$([0-9a-f]+)|0b([01]+)|([0-9]+))$/i.exec(token)
  if (!m) return null
  const [, sign, hex1, hex2, bin, dec] = m
  const n = hex1 !== undefined ? parseInt(hex1, 16) : hex2 !== undefined ? parseInt(hex2, 16) : bin !== undefined ? parseInt(bin, 2) : parseInt(dec, 10)
  return sign ? -n : n
}

/** A line without its comment (`;` or `//` to the end of the line, unless inside a quoted string or character), trimmed. */
export function stripComment(raw: string): string {
  let quote = ''
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === ';' || (c === '/' && raw[i + 1] === '/')) return raw.slice(0, i).trim()
  }
  return raw.trim()
}

/** `NAME = value`: the name and the text of the value, or null. */
export function matchConstant(text: string): { name: string; value: string } | null {
  const m = /^([^\s=:]+)\s*=\s*(.*)$/.exec(text)
  return m ? { name: m[1], value: m[2].trim() } : null
}

/** `label: rest`: the label and what follows it on the line (maybe nothing), or null. */
export function matchLabel(text: string): { name: string; rest: string } | null {
  const m = /^([^\s:]+)\s*:\s*(.*)$/.exec(text)
  return m ? { name: m[1], rest: m[2] } : null
}
