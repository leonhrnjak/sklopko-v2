import { describe, expect, it } from 'vitest'
import io from '../../scripts/basic/io.s?raw'
import source from '../../scripts/basic/m6502.asm?raw'
import { buildBasic } from '../../scripts/basic/target'
import { BasicMachine } from './basic-harness'
import { BASIC_PROGRAMS, programText } from './basic-programs'

/**
 * The programs to type in, each run on the bare core and timed in CPU cycles. The app reaches about 170,000 cycles a second in a
 * browser (60,000 is its target), so "a few seconds" is about 500,000 cycles.
 */
const build = buildBasic(source, io)
const boot = () => {
  const m = new BasicMachine(build.rom, build.symbols.INWAIT)
  m.settle()
  return m
}
const program = (id: string) => BASIC_PROGRAMS.find((p) => p.id === id)!
const FEW_SECONDS = 500_000

/** Type a program, start it, and run until `first` says it has printed what a reader waits for, then until `done` (a program that never ends has no `done`). */
function runProgram(m: BasicMachine, id: string, first: () => boolean, done?: () => boolean, max = 8_000_000) {
  const p = program(id)
  m.type(p.lines.join('\n') + '\n')
  m.settle()
  const start = m.cycles
  m.type(p.run + '\n')
  expect(m.runUntil(first, max), `${id} printed nothing`).toBeGreaterThan(0)
  const toFirst = m.cycles - start
  if (done) expect(m.runUntil(done, max), `${id} did not finish`).toBeGreaterThanOrEqual(0)
  return { toFirst, total: m.cycles - start }
}

describe('the programs to type in', () => {
  it('have a line BASIC takes (72 characters at most) and an Enter after every line', () => {
    for (const p of BASIC_PROGRAMS) {
      for (const l of p.lines) expect(l.length, `${p.id}: ${l}`).toBeLessThanOrEqual(72)
      expect(programText(p)).toBe(p.lines.join('\n') + '\n' + p.run + '\n')
      expect(programText(p, false).endsWith('\n')).toBe(true)
    }
  })

  it('maze: the first characters come at once, a row in a few seconds, both kinds of slash', () => {
    const m = boot()
    const { toFirst } = runProgram(m, 'maze', () => (m.screen.match(/[/\\]/g) ?? []).length >= 20)
        expect(toFirst).toBeLessThan(FEW_SECONDS) // 20 characters; a whole row of 40 takes about twice that
    m.run(200_000)
    const row = m.screen.split('RUN\n')[1]
    expect(row).toMatch(/\//)
    expect(row).toMatch(/\\/)
  })

  it('table: the first row in a few seconds, nine rows with the columns lined up on their right edge', () => {
    const m = boot()
    const { toFirst, total } = runProgram(m, 'table', () => / {3}9\n/.test(m.screen.split('RUN\n')[1] ?? ''), () => /81\s+OK\s*$/.test(m.screen))
    expect(total).toBeLessThan(3_000_000) // about 2.4 million cycles: 14 seconds at 170,000 a second
    expect(toFirst).toBeLessThan(FEW_SECONDS)
    const rows = m.screen.split('\n').filter((l) => /^ +\d+( +\d+){8}$/.test(l))
    expect(rows).toHaveLength(9)
    expect(rows[0]).toBe('    1   2   3   4   5   6   7   8   9')
    expect(rows[8]).toBe('    9  18  27  36  45  54  63  72  81')
  }, 60_000)

  it('primes: prints each prime as it finds it, the 25 primes up to 100 and only they', () => {
    const m = boot()
    const { toFirst, total } = runProgram(m, 'primes', () => /2 {2}3 {2}5 {2}7 {2}11/.test(m.screen), () => /97\s+OK\s*$/.test(m.screen))
    expect(total).toBeLessThan(5_500_000) // about 4.7 million cycles: half a minute at 170,000 a second
    expect(toFirst).toBeLessThan(FEW_SECONDS)
    const printed = m.screen.slice(m.screen.indexOf('RUN\n') + 4).replace(/OK\s*$/, '').trim().split(/\s+/).map(Number)
    expect(printed).toEqual([2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97])
  }, 60_000)

  it('guess: asks, says too low or too high, and ends when the guess is right', () => {
    const m = boot()
    const p = program('guess')
    m.type(p.lines.join('\n') + '\n')
    m.settle()
    m.type('RUN\n')
    // Binary search with the answers it gives: 1 to 100 takes at most seven guesses.
    let lo = 1
    let hi = 100
    let guesses = 0
    for (; guesses < 10; guesses++) {
      expect(m.runUntil(() => /YOUR GUESS\? $/.test(m.screen + ' ') || /YOU NEEDED/.test(m.screen), 2_000_000)).toBeGreaterThan(0)
      const g = Math.floor((lo + hi) / 2)
      const seen = m.screen.length
      m.type(`${g}\n`)
      m.settle()
      const reply = m.screen.slice(seen)
      if (/YES! YOU NEEDED/.test(reply)) {
        expect(reply).toContain(`YOU NEEDED ${guesses + 1} GUESSES`)
        return
      }
      if (/TOO LOW/.test(reply)) lo = g + 1
      else if (/TOO HIGH/.test(reply)) hi = g - 1
      else throw new Error('no answer to the guess: ' + reply)
    }
    throw new Error('not found in ten guesses')
  })
})
