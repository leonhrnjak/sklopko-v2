import { describe, expect, it } from 'vitest'
import { SKASM, assemble } from '../engine/isa'
import { newMachine, step, type Machine } from '../engine/skasm-ref'
import { ROM_WORDS, SNAKE_SOURCE } from './computer2'

const asm = assemble(SKASM, SNAKE_SOURCE, ROM_WORDS)
const [S0, DIR, LEN, FOOD] = [0, 8, 9, 10]
const UP = 1
const LEFT = 4
const RIGHT = 6
const DOWN = 9

const isWall = (p: number) => (p & 15) === 0 || (p & 15) === 15 || p >> 4 === 0 || p >> 4 === 15

interface Game {
  m: Machine
  screen: Set<number>
  text: string
  numbers: number[]
  frames: number
}

/**
 * Run the program on the reference interpreter. `choose` is asked for a key whenever the program reads the keypad with nothing
 * pending; `onFrame` runs each time the program starts a frame; `setup` can change RAM and the screen before it starts (the
 * program's own start-up code has run by then if `skipInit` is false).
 */
function play(opts: {
  steps: number
  choose?: (m: Machine) => number | null
  onFrame?: (g: Game) => void
  setup?: (g: Game) => void
}) {
  const m = newMachine()
  const g: Game = { m, screen: new Set(), text: '', numbers: [], frames: 0 }
  let pending = -1
  const ports = {
    out(port: number, v: number) {
      if (port === 0) g.numbers.push(v)
      else if (port === 1) g.text += String.fromCharCode(v)
      else if (port === 2) g.screen.add(v)
      else if (port === 3) g.screen.delete(v)
      else if (port === 5) pending = -1
    },
    in(port: number) {
      if (port !== 5) return 0
      if (pending < 0 && opts.choose) {
        const k = opts.choose(m)
        if (k !== null) pending = k
      }
      return pending < 0 ? 0 : pending | 16
    },
  }
  let setupDone = !opts.setup
  for (let i = 0; i < opts.steps && !m.halted; i++) {
    if (m.pc === asm.symbols.frame) {
      if (!setupDone) {
        opts.setup!(g)
        setupDone = true
      }
      opts.onFrame?.(g)
      g.frames++
    }
    step(m, asm.words, ports)
  }
  return g
}

const snakeCells = (m: Machine) => m.ram.slice(S0, S0 + m.ram[LEN])
const xy = (p: number) => [p & 15, p >> 4]

/** A player that steers towards the food, along x first and then along y, never straight back. */
const greedy = (m: Machine) => {
  const [hx, hy] = xy(m.ram[S0])
  const [fx, fy] = xy(m.ram[FOOD])
  const d = m.ram[DIR]
  if (hx < fx && d !== 255) return RIGHT
  if (hx > fx && d !== 1) return LEFT
  if (hy < fy && d !== 240) return DOWN
  if (hy > fy && d !== 16) return UP
  return null
}

describe('snake program', () => {
  it('assembles and fits in the ROM', () => {
    expect(asm.errors).toEqual([])
    expect(asm.lineOf.length).toBeLessThanOrEqual(ROM_WORDS)
  })

  it('starts with the walls round the screen, a snake of 3 pointing right, one meal, and the length on the display', () => {
    let seen = false
    play({
      steps: 1000,
      onFrame: (g) => {
        if (g.frames > 0) return // only the very first frame
        seen = true
        expect([...g.screen].filter(isWall)).toHaveLength(60)
        expect([...g.screen].filter((p) => !isWall(p)).sort((a, b) => a - b)).toEqual([...snakeCells(g.m), g.m.ram[FOOD]].sort((a, b) => a - b))
        expect(snakeCells(g.m)).toEqual([136, 135, 134])
        expect(g.numbers).toEqual([3])
        expect(isWall(g.m.ram[FOOD])).toBe(false)
      },
    })
    expect(seen).toBe(true)
  })

  it('moves on every frame and leaves nothing behind: the lit pixels are the walls, the snake and the meal', () => {
    let checked = 0
    play({
      steps: 4000,
      onFrame: (g) => {
        if (g.frames < 2) return
        const lit = [...g.screen].filter((p) => !isWall(p)).sort((a, b) => a - b)
        expect(lit).toEqual([...new Set([...snakeCells(g.m), g.m.ram[FOOD]])].sort((a, b) => a - b))
        checked++
      },
    })
    expect(checked).toBeGreaterThanOrEqual(5) // it hits the wall after seven moves
  })

  it('without a key it runs into the wall: game over', () => {
    const g = play({ steps: 5000 })
    expect(g.m.halted).toBe(true)
    expect(g.text).toBe('Game over')
  })

  it('turns with the keys, and ignores the key that would turn it straight back', () => {
    let sent = false
    const g = play({ steps: 250, choose: () => (sent ? null : ((sent = true), LEFT)) })
    expect(g.m.ram[DIR]).toBe(1) // LEFT was ignored: still moving right
    const keys = [DOWN, LEFT, UP]
    const dirs: number[] = []
    const h = play({ steps: 1200, choose: () => keys.shift() ?? null, onFrame: (gm) => dirs.push(gm.m.ram[DIR]) })
    expect([...new Set(dirs)]).toEqual([1, 16, 255, 240])
    expect(h.m.halted).toBe(false)
  })

  it('eating makes it one longer, the display follows, and the pause gets shorter', () => {
    const g = play({ steps: 6000, choose: greedy })
    expect(g.numbers.slice(0, 3)).toEqual([3, 4, 5])
    expect(g.m.ram[13]).toBeLessThan(24)
  })

  it('every frame while it eats keeps the invariant: lit pixels = walls + snake + meal, and the length never shrinks', () => {
    let last = 3
    play({
      steps: 6000,
      choose: greedy,
      onFrame: (g) => {
        if (g.frames < 2) return
        const lit = [...g.screen].filter((p) => !isWall(p))
        const want = new Set([...snakeCells(g.m), g.m.ram[FOOD]])
        for (const p of want) expect(lit).toContain(p)
        expect(g.m.ram[LEN]).toBeGreaterThanOrEqual(last)
        last = g.m.ram[LEN]
        expect(lit.length).toBeLessThanOrEqual(want.size)
      },
    })
    expect(last).toBeGreaterThan(3)
  })

  it('a snake of 3 can circle in a 2x2 square for ever, but a longer one runs into itself', () => {
    const circle = (when: (m: Machine) => boolean) => {
      const turns = [DOWN, LEFT, UP, RIGHT]
      let i = 0
      return (m: Machine) => (when(m) ? turns[i++ % 4] : null)
    }
    const short = play({ steps: 6000, choose: circle(() => true) })
    expect(short.m.halted).toBe(false)
    expect(short.text).toBe('')
    // A snake of 5: set it up lying along the row and then circle.
    const long = play({
      steps: 6000,
      choose: circle(() => true),
      setup: (g) => {
        // Body at y = 8, x = 8 down to 4; food out of the way. Lit pixels match.
        g.m.ram[LEN] = 5
        ;[136, 135, 134, 133, 132].forEach((p, i) => (g.m.ram[S0 + i] = p))
        g.screen.add(133)
        g.screen.add(132)
        g.m.ram[FOOD] = 28
      },
    })
    expect(long.m.halted).toBe(true)
    expect(long.text).toBe('Game over')
  })

  it('eating the last meal at length 7 wins', () => {
    const g = play({
      steps: 3000,
      setup: (s) => {
        s.m.ram[LEN] = 7
        ;[136, 135, 134, 133, 132, 131, 130].forEach((p, i) => {
          s.m.ram[S0 + i] = p
          s.screen.add(p)
        })
        s.m.ram[FOOD] = 137 // straight ahead
        s.screen.add(137)
      },
    })
    expect(g.text).toBe('You win')
    expect(g.m.halted).toBe(true)
    expect(g.numbers.at(-1)).toBe(8)
  })

  it('the meal is never on a wall', () => {
    const g = play({ steps: 30000, choose: greedy, onFrame: (s) => expect(isWall(s.m.ram[FOOD])).toBe(false) })
    expect(g.frames).toBeGreaterThan(10)
  })
})
