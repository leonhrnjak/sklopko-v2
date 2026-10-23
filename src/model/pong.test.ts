import { describe, expect, it } from 'vitest'
import { SKASM, assemble } from '../engine/isa'
import { newMachine, step } from '../engine/skasm-ref'
import { ROM_WORDS, PONG_SOURCE } from './computer2'

const asm = assemble(SKASM, PONG_SOURCE, ROM_WORDS)
const UP = 1 // gamepad bits: up 1, down 2
const DOWN = 2

/**
 * Run Pong on the reference interpreter with a screen. `player` is asked which gamepad buttons are held (as a bit mask, or null
 * for none) every time the program reads the gamepad; it sees the paddle's top row and the ball's position.
 */
function play(steps: number, player: (s: { paddle: number; ball: [number, number] | null }) => number | null = () => null) {
  const m = newMachine()
  const screen = new Set<number>()
  const ball: { last: [number, number] | null } = { last: null }
  const trail: [number, number][] = []
  const scores: number[] = []
  const paddleTop = () => {
    for (let y = 0; y < 16; y++) if (screen.has(y * 16)) return y
    return -1
  }
  const ports = {
    out(port: number, v: number) {
      if (port === 2) {
        screen.add(v)
        if ((v & 15) !== 0) {
          ball.last = [v & 15, v >> 4]
          trail.push(ball.last)
        }
      } else if (port === 3) screen.delete(v)
      else if (port === 0) scores.push(v)
    },
    in(port: number) {
      return port === 6 ? (player({ paddle: paddleTop(), ball: ball.last }) ?? 0) : 0
    },
  }
  let ran = 0
  for (; ran < steps && !m.halted; ran++) step(m, asm.words, ports)
  return { m, screen, trail, scores, paddleTop }
}

/** A player that moves the paddle so that its middle row follows the ball's row. */
const follower = ({ paddle, ball }: { paddle: number; ball: [number, number] | null }) => {
  if (!ball) return null
  const middle = paddle + 1
  return ball[1] < middle ? UP : ball[1] > middle ? DOWN : null
}

describe('pong program', () => {
  it('assembles and fits in the ROM', () => {
    expect(asm.errors).toEqual([])
    expect(asm.lineOf.length).toBeLessThanOrEqual(ROM_WORDS)
  })

  it('starts with the paddle at rows 6 to 8, the ball in the middle and the score at 0', () => {
    const g = play(60)
    expect([...g.screen].filter((p) => (p & 15) === 0).sort((a, b) => a - b)).toEqual([96, 112, 128])
    expect(g.scores).toEqual([0])
    expect(g.trail[0]).toEqual([8, 3])
  })

  it('the ball stays on the screen, between column 1 and 15 until it is missed, and turns round at the top, bottom and right wall', () => {
    const g = play(20000, follower)
    expect(g.m.halted).toBe(false)
    const xs = g.trail.map(([x]) => x)
    const ys = g.trail.map(([, y]) => y)
    expect(Math.min(...xs)).toBe(1)
    expect(Math.max(...xs)).toBe(15)
    expect(Math.min(...ys)).toBe(0)
    expect(Math.max(...ys)).toBe(15)
  })

  it('counts every return, and speeds up', () => {
    const g = play(60000, follower)
    expect(g.m.halted).toBe(false)
    expect(g.scores.length).toBeGreaterThan(10)
    expect(g.scores.slice(0, 6)).toEqual([0, 1, 2, 3, 4, 5])
    const frames = (steps: number) => play(steps, follower).trail.length
    // more ball moves per 10000 instructions late in the game than at the start
    const early = frames(10000)
    const late = frames(70000) - frames(60000)
    expect(late).toBeGreaterThan(early)
  })

  it('a missed ball ends the game in column 0', () => {
    const g = play(20000) // nobody moves the paddle
    expect(g.m.halted).toBe(true)
    expect(g.m.ram[0] & 15).toBe(0) // the ball is in column 0
  })

  it('holding up moves the paddle up and holding down moves it down, one row a frame, and it stops at the edges', () => {
    // The pad is read once a frame (about 70 instructions), and the ball is not missed for the first 20 frames or so.
    const presses = (key: number, n: number) => {
      let left = n
      return () => (left-- > 0 ? key : null)
    }
    expect(play(120, presses(UP, 1)).paddleTop()).toBe(5)
    expect(play(900, presses(UP, 10)).paddleTop()).toBe(0)
    expect(play(120, presses(DOWN, 1)).paddleTop()).toBe(7)
    expect(play(900, presses(DOWN, 10)).paddleTop()).toBe(13)
    const g = play(900, presses(DOWN, 10))
    expect([...g.screen].filter((p) => (p & 15) === 0)).toHaveLength(3)
  })

  it('the A and B buttons do nothing, and up and down together cancel to up (the program checks up first)', () => {
    expect(play(400, () => 16 | 32).paddleTop()).toBe(6)
    let n = 2
    expect(play(400, () => (n-- > 0 ? UP | DOWN : null)).paddleTop()).toBe(4)
  })
})
