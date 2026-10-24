/**
 * The names a control ROM gives its data pins, read from its signal list (see `signals.ts` for the syntax). This is the small
 * part of the signal reader that the ROM's layout needs, so it lives in the code that loads at startup; the full reader, with its
 * error messages, is only loaded with the inspector. It accepts exactly the lists `parseSignals` accepts without errors, and gives
 * no names for any other (`signals.test.ts` checks that they agree).
 */
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/

/**
 * One label per data pin: a one-bit signal's name, `NAME0`, `NAME1`… for a field, nothing (the pin keeps `D13`) for a bit no signal
 * covers. Empty when the list has any error.
 */
export function pinLabels(text: string, bits: number): (string | undefined)[] {
  const labels: (string | undefined)[] = new Array(bits).fill(undefined)
  const seen = new Map<string, number>() // signal name -> width
  const whens: string[] = []
  let at = 0
  for (const raw of text.split(/\r?\n/)) {
    const src = raw.replace(/(?:;|\/\/).*$/, '').trim()
    if (!src) continue
    const [head, ...rest] = src.split(/\s*=\s*/)
    const [name, ...extra] = head.split(/\s+/)
    const width = extra.length ? Number(extra[0]) : 1
    if (rest.length > 1 || extra.length > 1 || !Number.isInteger(width) || !/^\d+$/.test(extra[0] ?? '1') || width < 1 || width > 16) return []
    if (name === '_') {
      if (rest.length) return []
      at += width
      continue
    }
    if (!NAME.test(name) || seen.has(name)) return []
    if (rest.length) {
      const [values, cond, ...more] = rest[0].split(/\s+if\s+/)
      const list = values.trim() ? values.trim().split(/\s+/) : []
      if (more.length || list.length > 2 ** width || list.some((v, i) => !NAME.test(v) || list.indexOf(v) !== i)) return []
      if (cond !== undefined) whens.push(cond.trim())
    }
    seen.set(name, width)
    for (let k = 0; k < width && at + k < bits; k++) labels[at + k] = width === 1 ? name : `${name}${k}`
    at += width
  }
  return whens.every((w) => seen.get(w) === 1) ? labels : []
}
