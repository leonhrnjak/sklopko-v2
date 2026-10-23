import { describe, expect, it } from 'vitest'
import { SKASM, assemble } from '../engine/isa'
import { newMachine, step } from '../engine/skasm-ref'
import { ROM_WORDS, TICTACTOE_SOURCE } from './computer2'

const asm = assemble(SKASM, TICTACTOE_SOURCE, ROM_WORDS)
const key = (r: number, c: number) => r * 4 + c

/** Play the keys, one at a time, on the reference interpreter with a pixel screen and a text console. */
function play(keys: number[]) {
  const m = newMachine()
  const px = new Set<number>()
  let text = ''
  const queue = [...keys]
  let pending = -1
  const ports = {
    out(port: number, v: number) {
      if (port === 1) text += String.fromCharCode(v)
      else if (port === 2) px.add(v)
      else if (port === 3) px.delete(v)
      else if (port === 5) pending = -1
    },
    in(port: number) {
      if (port !== 5) return 0
      if (pending < 0 && queue.length) pending = queue.shift()!
      return pending < 0 ? 0 : pending | 16
    },
  }
  for (let i = 0; i < 100000 && !m.halted; i++) {
    step(m, asm.words, ports)
    if (!queue.length && pending < 0 && m.pc === asm.symbols.wait && i > 2000) break
  }
  return { px, text, m }
}

const at = (x: number, y: number) => y * 16 + x
/** The pixels of a mark in cell (r, c): an X is the two diagonals of a 4x4 square, an O a ring without corners. */
const mark = (kind: 'X' | 'O', r: number, c: number) => {
  const x0 = 1 + 5 * c
  const y0 = 1 + 5 * r
  const cells =
    kind === 'X'
      ? [[0, 0], [1, 1], [2, 2], [3, 3], [3, 0], [2, 1], [1, 2], [0, 3]]
      : [[1, 0], [2, 0], [0, 1], [3, 1], [0, 2], [3, 2], [1, 3], [2, 3]]
  return cells.map(([x, y]) => at(x0 + x, y0 + y))
}
const grid = () => {
  const out: number[] = []
  for (let i = 0; i < 16; i++) out.push(at(5, i), at(10, i), at(i, 5), at(i, 10))
  return out
}
const screen = (...marks: number[][]) => new Set([...grid(), ...marks.flat()])

describe('tic-tac-toe program', () => {
  it('assembles and fits in the ROM', () => {
    expect(asm.errors).toEqual([])
    expect(asm.lineOf.length).toBeLessThanOrEqual(ROM_WORDS)
  })

  it('draws the grid and nothing else, and waits', () => {
    const g = play([])
    expect(g.px).toEqual(screen())
    expect(g.text).toBe('')
  })

  it('draws an X for the first player and an O for the second, in the cell of the key', () => {
    const g = play([key(0, 0), key(1, 2), key(2, 1)])
    expect(g.px).toEqual(screen(mark('X', 0, 0), mark('O', 1, 2), mark('X', 2, 1)))
  })

  it('ignores a taken cell (the same player tries again) and keys that are not cells', () => {
    const g = play([key(1, 1), key(1, 1), 3, 7, 11, 12, 15, key(0, 2)])
    expect(g.px).toEqual(screen(mark('X', 1, 1), mark('O', 0, 2)))
  })

  const wins: [string, number[][], string][] = [
    ['a row', [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]], 'X wins'],
    ['the middle row', [[1, 0], [0, 0], [1, 1], [0, 1], [1, 2]], 'X wins'],
    ['the bottom row', [[2, 0], [0, 0], [2, 1], [0, 1], [2, 2]], 'X wins'],
    ['a column', [[0, 1], [0, 0], [1, 1], [0, 2], [2, 1]], 'X wins'],
    ['the left column', [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]], 'X wins'],
    ['the right column', [[0, 2], [0, 0], [1, 2], [1, 1], [2, 2]], 'X wins'],
    ['the diagonal from the top left', [[0, 0], [0, 1], [1, 1], [0, 2], [2, 2]], 'X wins'],
    ['the other diagonal', [[0, 2], [0, 0], [1, 1], [0, 1], [2, 0]], 'X wins'],
    ['a win for O', [[0, 0], [1, 0], [0, 1], [1, 1], [2, 2], [1, 2]], 'O wins'],
    ['a win for O on a diagonal', [[0, 1], [0, 0], [0, 2], [1, 1], [2, 1], [2, 2]], 'O wins'],
  ]
  for (const [name, moves, result] of wins)
    it(`announces ${result} for ${name}, and halts`, () => {
      const g = play(moves.map(([r, c]) => key(r, c)))
      expect(g.text).toBe(result)
      expect(g.m.halted).toBe(true)
    })

  it('does not call three in a row that is not a line a win', () => {
    // X: (0,1) (1,2) (2,0): no line. O answers in the corners.
    const g = play([key(0, 1), key(0, 0), key(1, 2), key(1, 1), key(2, 0)])
    expect(g.text).toBe('')
    expect(g.m.halted).toBe(false)
  })

  it('a full board with no line is a draw', () => {
    const g = play([[0, 0], [0, 1], [0, 2], [1, 1], [1, 0], [1, 2], [2, 1], [2, 0], [2, 2]].map(([r, c]) => key(r, c)))
    expect(g.text).toBe('Draw')
    expect(g.m.halted).toBe(true)
  })

  it('a win on the last move is a win, not a draw', () => {
    // X ends with the top row on move 9? X plays 5 times: cells 0,1,... arranged so the 9th move completes the diagonal.
    const moves = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [2, 0], [1, 2], [2, 1], [2, 2]]
    const g = play(moves.map(([r, c]) => key(r, c)))
    expect(g.text).toBe('X wins') // (0,0) (1,1) (2,2)
  })
})
