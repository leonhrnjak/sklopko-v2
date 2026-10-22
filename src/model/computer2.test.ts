import { describe, expect, it } from 'vitest'
import { SK82, assemble } from '../engine/isa'
import type { ConsoleState, FramebufferState } from '../engine/components/devices'
import { Simulator } from '../engine/simulator'
import { BOUNCE_SOURCE, COUNT_SOURCE, KEYS_SOURCE, PROGRAMS, TABLE_SOURCE, buildComputer2, programWords } from './computer2'
import type { Circuit } from './circuit'

const NIB = ['QA', 'QB', 'QC', 'QD']
let baseCircuit: Circuit | undefined

/** The computer running a program, with helpers to look at it. */
function machine(source: string, hz = 16) {
  // Routing the wires takes seconds, so the circuit is built once and only the program is swapped.
  const base = (baseCircuit ??= buildComputer2({ id: 'test', name: 'test', source: COUNT_SOURCE, hz, note: '' }))
  const data = programWords(source)
  const comps = Object.values(base.comps).map((k) => (k.label === 'Program' ? { ...k, params: { ...k.params, source, data } } : k))
  const c: Circuit = { ...base, comps: Object.fromEntries(comps.map((k) => [k.id, k])) }
  const sim = new Simulator()
  sim.load({ comps, wires: Object.values(c.wires) })
  sim.settle()
  const id = (label: string) => Object.values(c.comps).find((k) => k.label === label)!.id
  const reg = (label: string, pins = NIB) => pins.reduce((n, pin, i) => n | (sim.pinValue(id(label), pin) << i), 0)
  const cycle = () => {
    sim.stepClock()
    sim.stepClock()
  }
  return {
    c,
    sim,
    id,
    cycle,
    run(n: number) {
      for (let i = 0; i < n; i++) cycle()
    },
    pc: () => reg('PC low', ['Q0', 'Q1', 'Q2', 'Q3']) | (sim.pinValue(id('PC high'), 'Q0') << 4),
    acc: () => reg('ACC low') | (reg('ACC high') << 4),
    carry: () => sim.pinValue(id('Flags'), 'QA'),
    zero: () => sim.pinValue(id('Flags'), 'QB'),
    halted: () => sim.pinValue(id('Halted'), 'A'),
    ram: () => sim.state(id('Data RAM')).mem as number[],
    text: () => (sim.state(id('Console')) as ConsoleState).lines.join('\n'),
    pixels: () => {
      const px = (sim.state(id('Screen')) as FramebufferState).px
      return px.map((v, i) => (v ? [i % 16, Math.floor(i / 16)] : null)).filter(Boolean) as number[][]
    },
  }
}

/** Run until the machine halts (or `limit` cycles); the number of cycles it took. */
function runToHalt(m: ReturnType<typeof machine>, limit = 2000) {
  let n = 0
  while (!m.halted() && n < limit) {
    m.cycle()
    n++
  }
  return n
}

describe('computer 2: programs', () => {
  it('all assemble for SK82 and fit in 32 words', () => {
    for (const p of PROGRAMS) {
      const r = assemble(SK82, p.source, 32)
      expect(r.errors, p.id).toEqual([])
      expect(r.lineOf.length, p.id).toBeLessThanOrEqual(32)
    }
    expect(programWords(COUNT_SOURCE).split(' ')).toHaveLength(32)
  })

  it('have unique ids, which are example slugs', () => {
    expect(new Set(PROGRAMS.map((p) => p.id)).size).toBe(PROGRAMS.length)
    for (const p of PROGRAMS) expect(p.id).toMatch(/^computer2/)
  })
})

describe('computer 2: instructions', () => {
  /** Run a few instructions, then read the accumulator and flags. */
  const run = (source: string, cycles: number) => {
    const m = machine(source)
    m.run(cycles)
    return { acc: m.acc(), carry: m.carry(), zero: m.zero(), pc: m.pc(), ram: m.ram(), m }
  }

  it('LDI, LDA, STA and ADD work on 8-bit values like the first computer', () => {
    expect(run('LDI 200', 1).acc).toBe(200)
    expect(run('LDI 0xA5\nSTA 5\nLDI 0\nLDA 5', 4).acc).toBe(0xa5)
    expect(run('LDI 0xA5\nSTA 5', 2).ram[5]).toBe(0xa5)
    expect(run('LDI 100\nSTA 0\nLDI 55\nADD 0', 4)).toMatchObject({ acc: 155, carry: 0, zero: 0 })
    expect(run('LDI 0xFF\nSTA 0\nLDI 1\nADD 0', 4)).toMatchObject({ acc: 0, carry: 1, zero: 1 })
    expect(run('LDI 5\nSTA 0\nLDI 3\nSUB 0', 4)).toMatchObject({ acc: 254, carry: 1, zero: 0 })
    expect(run('LDI 7\nSTA 0\nLDI 7\nSUB 0', 4)).toMatchObject({ acc: 0, carry: 0, zero: 1 })
  })

  it('ADDI and SUBI take their operand from the instruction', () => {
    expect(run('LDI 100\nADDI 55', 2)).toMatchObject({ acc: 155, carry: 0, zero: 0 })
    expect(run('LDI 200\nADDI 100', 2)).toMatchObject({ acc: 44, carry: 1 })
    expect(run('LDI 0x0F\nADDI 1', 2).acc).toBe(0x10) // carry from the low to the high half
    expect(run('LDI 10\nSUBI 3', 2)).toMatchObject({ acc: 7, carry: 0, zero: 0 })
    expect(run('LDI 3\nSUBI 10', 2)).toMatchObject({ acc: 249, carry: 1 }) // borrow
    expect(run('LDI 9\nSUBI 9', 2)).toMatchObject({ acc: 0, carry: 0, zero: 1 })
    expect(run('LDI 5\nADDI -1', 2).acc).toBe(4)
  })

  it('CMPI sets the flags and leaves the accumulator alone', () => {
    expect(run('LDI 58\nCMPI 58', 2)).toMatchObject({ acc: 58, zero: 1, carry: 0 })
    expect(run('LDI 57\nCMPI 58', 2)).toMatchObject({ acc: 57, zero: 0, carry: 1 }) // less: borrow
    expect(run('LDI 60\nCMPI 58', 2)).toMatchObject({ acc: 60, zero: 0, carry: 0 })
  })

  it('SHL and SHR shift the accumulator, filling with 0', () => {
    expect(run('LDI 0x35\nSHL', 2).acc).toBe(0x6a)
    expect(run('LDI 0xC1\nSHL', 2).acc).toBe(0x82) // the top bit falls off
    expect(run('LDI 0x35\nSHR', 2).acc).toBe(0x1a)
    expect(run('LDI 0x81\nSHR', 2).acc).toBe(0x40)
    expect(run('LDI 1\nSHL\nSHL\nSHL\nSHL\nSHL\nSHL\nSHL', 8).acc).toBe(0x80)
    expect(run('LDI 0x80\nSHR\nSHR\nSHR\nSHR\nSHR\nSHR\nSHR\nSHR', 9).acc).toBe(0)
  })

  it('JMP, JNC and JZ jump to targets up to 31', () => {
    expect(run('JMP 5', 1).pc).toBe(5)
    expect(run('JMP 31', 1).pc).toBe(31)
    expect(run('JMP 17', 1).pc).toBe(17)
    expect(run('LDI 1\nADDI 1\nJNC 20', 3).pc).toBe(20) // no carry
    expect(run('LDI 255\nADDI 1\nJNC 20', 3).pc).toBe(3) // carry: falls through
    expect(run('LDI 3\nCMPI 3\nJZ 25', 3).pc).toBe(25)
    expect(run('LDI 3\nCMPI 4\nJZ 25', 3).pc).toBe(3)
    expect(run('LDI 4\nSUBI 4\nJZ 9', 3).pc).toBe(9)
  })

  it('the program counter counts past 15 into the second half of the ROM', () => {
    const nops = Array.from({ length: 20 }, () => 'SHL').join('\n')
    const r = run(`${nops}\nLDI 42`, 21)
    expect(r.pc).toBe(21)
    expect(r.acc).toBe(42)
  })

  it('HALT stops the program counter', () => {
    const r = run('LDI 1\nHALT\nLDI 2', 8)
    expect(r.pc).toBe(1)
    expect(r.acc).toBe(1)
    expect(r.m.halted()).toBe(1)
  })

  it('STA 15 prints the accumulator as a character', () => {
    expect(run('LDI 72\nSTA 15\nLDI 105\nSTA 15', 4).m.text()).toBe('Hi')
    expect(run('LDI 65\nSTA 15\nLDI 10\nSTA 15\nLDI 66\nSTA 15', 6).m.text()).toBe('A\nB')
  })

  it('STA 14 lights the pixel at (low nibble, high nibble) and STA 13 darkens it', () => {
    expect(run('LDI 0x52\nSTA 14', 2).m.pixels()).toEqual([[2, 5]])
    expect(run('LDI 0x52\nSTA 14\nLDI 0xF0\nSTA 14', 4).m.pixels()).toEqual([[0, 15], [2, 5]].sort((a, b) => a[1] * 16 + a[0] - (b[1] * 16 + b[0])))
    expect(run('LDI 0x52\nSTA 14\nSTA 13', 3).m.pixels()).toEqual([])
    // Other addresses write only to RAM.
    expect(run('LDI 0x52\nSTA 12', 2).m.pixels()).toEqual([])
    expect(run('LDI 72\nSTA 12', 2).m.text()).toBe('')
  })

  it('LDA 15 reads the keypad: the key in bits 0-3, and bit 4 while one is held', () => {
    const m = machine('LDA 15\nSTA 0\nLDA 15\nSTA 1\nLDA 0')
    const keypad = m.id('Keypad')
    m.sim.setState(keypad, { pressed: true, key: 11 })
    m.sim.settle() // let the new key reach the pins before the first clock edge
    m.run(2)
    expect(m.ram()[0]).toBe(0x10 | 11)
    m.sim.setState(keypad, { pressed: false })
    m.sim.settle()
    m.run(2)
    expect(m.ram()[1]).toBe(11) // the last key stays, but it is no longer held
  })
})

describe('computer 2: the programs', () => {
  it('count prints 0123456789 and a newline, then halts', () => {
    const m = machine(COUNT_SOURCE)
    const n = runToHalt(m)
    expect(m.halted()).toBe(1)
    expect(m.text()).toBe('0123456789\n')
    expect(n).toBeLessThan(80)
  })

  it('table prints the 7 times table as two-digit numbers, then halts', () => {
    const m = machine(TABLE_SOURCE)
    runToHalt(m, 1000)
    expect(m.halted()).toBe(1)
    expect(m.text()).toBe('07 14 21 28 35 42 49 56 63 ')
  })

  it('bounce keeps one pixel on the middle row, going out and back', () => {
    const m = machine(BOUNCE_SOURCE)
    const seen: number[] = []
    for (let i = 0; i < 400; i++) {
      m.cycle()
      const px = m.pixels()
      // Between the lighting of the new pixel and the darkening of the old one there are two; never none after the first.
      if (i > 5) expect(px.length, `cycle ${i}`).toBeGreaterThanOrEqual(1)
      expect(px.length).toBeLessThanOrEqual(2)
      for (const [x, y] of px) {
        expect(y).toBe(7)
        seen.push(x)
      }
    }
    expect(Math.min(...seen)).toBe(0)
    expect(Math.max(...seen)).toBe(15)
    // It goes right, turns round at 15, comes back to 0 and turns again: a full lap visits every column twice or more.
    expect(new Set(seen).size).toBe(16)
  }, 60000)

  it('keys echoes the key held down as a hexadecimal digit, once per press', () => {
    const m = machine(KEYS_SOURCE)
    const keypad = m.id('Keypad')
    m.run(10)
    expect(m.text()).toBe('') // nothing pressed yet
    for (const [key, ch] of [[7, '7'], [10, 'A'], [15, 'F'], [0, '0']] as const) {
      m.sim.setState(keypad, { pressed: true, key })
      m.run(14) // held for a while: still printed once
      m.sim.setState(keypad, { pressed: false })
      m.run(14)
      expect(m.text().endsWith(ch), `key ${key}`).toBe(true)
    }
    expect(m.text()).toBe('7AF0')
  }, 60000)
})
