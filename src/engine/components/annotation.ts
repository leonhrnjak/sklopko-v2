import type { ComponentDef, ParamDef, Params } from '../types'

/** Notes and frames explain a circuit. They have no pins and no effect on the simulation. */

const COLORS = ['yellow', 'blue', 'green', 'pink', 'grey']

const colorParam: ParamDef = {
  key: 'color',
  label: 'Colour',
  kind: 'select',
  default: 'yellow',
  options: COLORS.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) })),
}

/** Pixels per character and per line of note text (the symbol draws 12px monospace). */
export const NOTE_CHAR_W = 7.4
export const NOTE_LINE_H = 16
export const NOTE_PAD = 10

/**
 * Break `text` into lines of at most `cols` characters: at the line breaks you typed, then at spaces. A word longer
 * than a line is cut. Blank lines are kept.
 */
export function wrapText(text: string, cols: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (!para.trim()) {
      out.push('')
      continue
    }
    let line = ''
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (word.length > cols) {
        if (line) out.push(line)
        out.push(word.slice(0, cols))
        word = word.slice(cols)
        line = ''
      }
      if (!line) line = word
      else if (line.length + 1 + word.length <= cols) line += ` ${word}`
      else {
        out.push(line)
        line = word
      }
    }
    out.push(line)
  }
  return out
}

const snap10 = (n: number) => Math.ceil(n / 10) * 10

/** Size of a note: wide enough for `cols` characters, tall enough for its wrapped lines, on the 10px grid. */
export function noteSize(p: Params) {
  const cols = Math.max(8, Number(p.cols))
  const lines = wrapText(String(p.text), cols).length
  return { w: snap10(cols * NOTE_CHAR_W + 2 * NOTE_PAD), h: Math.max(40, snap10(lines * NOTE_LINE_H + 2 * NOTE_PAD)) }
}

export const annotation: ComponentDef[] = [
  {
    type: 'note',
    name: 'Note',
    category: 'annotation',
    description:
      'A text note on the canvas, to explain what a circuit does. It has no pins and no effect on the simulation. ' +
      'The text wraps at the width you choose; Enter starts a new line.',
    params: [
      { key: 'text', label: 'Text', kind: 'text', default: 'Note', maxLength: 600 },
      { key: 'cols', label: 'Width (characters per line)', kind: 'number', min: 8, max: 60, default: 28 },
      colorParam,
    ],
    layout: (p) => ({ ...noteSize(p), pins: [] }),
    evaluate() {},
  },
  {
    type: 'frame',
    name: 'Frame',
    category: 'annotation',
    description:
      'A titled frame to group parts visually, drawn behind everything else. Drag its title bar or border to move it ' +
      'together with everything inside; drag the corner handle to resize it. It has no pins and no effect on the ' +
      'simulation.',
    params: [
      {
        key: 'title',
        label: 'Title',
        kind: 'text',
        default: 'Frame',
        maxLength: 40,
        multiline: false,
        hint: 'At most 40 characters.',
      },
      { key: 'w', label: 'Width', kind: 'number', min: 60, max: 16000, step: 10, default: 300 },
      { key: 'h', label: 'Height', kind: 'number', min: 40, max: 10000, step: 10, default: 200 },
      { ...colorParam, default: 'blue' },
    ],
    layout: (p) => ({ w: Math.round(Number(p.w) / 10) * 10, h: Math.round(Number(p.h) / 10) * 10, pins: [] }),
    evaluate() {},
  },
]
