/** Geometry and parsing shared by the ROM and RAM parts and their symbols. */

export const TABLE_ROW_H = 12
export const TABLE_TOP = 22
const TABLE_MAX_ROWS = 8
/** Larger memories are not drawn as a table in their symbol: it would not fit. Read them in the inspector. */
export const TABLE_MAX_WORDS = 32
export const showsTable = (words: number) => words <= TABLE_MAX_WORDS

/** How a memory's words are laid out in the table drawn inside its symbol (column-major). */
export function tableShape(words: number, digits: number) {
  const rows = Math.min(words, TABLE_MAX_ROWS)
  const cols = Math.ceil(words / rows)
  const cellW = digits * 7 + 6
  return { rows, cols, cellW }
}

/** Body width and minimum pin rows so the table fits inside the box. */
export function tableBox(words: number, digits: number) {
  if (!showsTable(words)) return { w: 100, minRows: 2 }
  const { rows, cols, cellW } = tableShape(words, digits)
  return {
    // Leave 22px each side for the pin labels, and room below the table for the title.
    w: Math.max(100, Math.ceil((cols * cellW + 44) / 20) * 20),
    minRows: Math.ceil((TABLE_TOP + rows * TABLE_ROW_H - 2) / 20),
  }
}

export const HEX_WORDS = /^[0-9a-fA-F\s,]*$/

const cache = new Map<string, number[]>()

/**
 * Words of a ROM from its hex text: groups separated by spaces, commas or line breaks, one word per group.
 * Missing words read as 0 and too-wide values are cut to `bits`.
 */
export function parseWords(text: string, words: number, bits: number): number[] {
  const key = `${words}/${bits}/${text}`
  let r = cache.get(key)
  if (!r) {
    const mask = 2 ** bits - 1
    r = new Array<number>(words).fill(0)
    text
      .split(/[\s,]+/)
      .filter(Boolean)
      .slice(0, words)
      .forEach((tok, i) => {
        const n = parseInt(tok, 16)
        r![i] = Number.isNaN(n) ? 0 : n & mask
      })
    if (cache.size > 64) cache.clear()
    cache.set(key, r)
  }
  return r
}
