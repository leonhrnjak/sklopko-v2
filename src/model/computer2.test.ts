import { describe, expect, it } from 'vitest'
import { SK82, assemble } from '../engine/isa'
import { speakerPitch, type ConsoleState, type FramebufferState, type SpeakerState } from '../engine/components/devices'
import { Simulator } from '../engine/simulator'
import { BALL_SOURCE, CALC_SOURCE, PROGRAMS, ROM_WORDS, SIREN_SOURCE, buildComputer2, programWords, type Device } from './computer2'
import type { Circuit } from './circuit'

const NIB = ['QA', 'QB', 'QC', 'QD']
const bases = new Map<string, Circuit>()

/** The computer with some devices running a program. Routing the wires takes seconds, so each kind is built once and only the program is swapped. */
function machine(source: string, devices: Device[] = ['console', 'keypad']) {
  const key = devices.join('+')
  let base = bases.get(key)
  if (!base) bases.set(key, (base = buildComputer2({ id: 'test', name: 'test', source: 'HALT', hz: 16, devices, note: '' })))
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
  const m = {
    c,
    sim,
    id,
    cycle,
    run(n: number) {
      for (let i = 0; i < n; i++) cycle()
    },
    pc: () => reg('PC low', ['Q0', 'Q1', 'Q2', 'Q3']) | (reg('PC high', ['Q0', 'Q1', 'Q2']) << 4),
    acc: () => reg('ACC low') | (reg('ACC high') << 4),
    carry: () => sim.pinValue(id('Flags'), 'QA'),
    zero: () => sim.pinValue(id('Flags'), 'QB'),
    halted: () => sim.pinValue(id('Halted'), 'A'),
    ram: () => sim.state(id('Data RAM')).mem as number[],
    text: () => (sim.state(id('LCD text display')) as ConsoleState).lines.join('\n'),
    pixels: () => {
      const px = (sim.state(id('LCD')) as FramebufferState).px
      return px.map((v, i) => (v ? [i % 16, Math.floor(i / 16)] : null)).filter(Boolean) as number[][]
    },
    /** Press a key and let go again, a few cycles later (a sticky keypad remembers it). */
    press(key: number) {
      sim.setState(id('Keypad'), { pressed: true, key })
      sim.settle()
      m.run(2)
      sim.setState(id('Keypad'), { pressed: false })
      sim.settle()
    },
  }
  return m
}

describe('computer 2: programs', () => {
  it('all assemble for SK82 and fit in the ROM', () => {
    for (const p of PROGRAMS) {
      const r = assemble(SK82, p.source, ROM_WORDS)
      expect(r.errors, p.id).toEqual([])
      expect(r.lineOf.length, p.id).toBeLessThanOrEqual(ROM_WORDS)
    }
    expect(programWords('HALT').split(' ')).toHaveLength(ROM_WORDS)
  })

  it('have unique ids, and each connects what it needs (and nothing it does not use)', () => {
    expect(new Set(PROGRAMS.map((p) => p.id)).size).toBe(PROGRAMS.length)
    for (const p of PROGRAMS) {
      const used = (d: string) => p.source.includes(d === 'lcd' ? 'ON = 14' : d === 'speaker' ? 'SPK = 14' : d === 'console' ? 'CON = 15' : 'KEYPAD = 15')
      for (const d of ['lcd', 'speaker', 'console', 'keypad'] as const) expect(p.devices.includes(d), `${p.id}: ${d}`).toBe(used(d))
    }
  })
})

describe('computer 2: instructions', () => {
  /** Run a few instructions, then read the accumulator and flags. */
  const run = (source: string, cycles: number) => {
    const m = machine(source)
    m.run(cycles)
    return { acc: m.acc(), carry: m.carry(), zero: m.zero(), pc: m.pc(), ram: m.ram(), m }
  }

  it('LDI, LDA, STA, ADD and SUB work on 8-bit values like the first computer', () => {
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
    expect(run('LDI 0x0F\nADDI 1', 2).acc).toBe(0x10)
    expect(run('LDI 10\nSUBI 3', 2)).toMatchObject({ acc: 7, carry: 0, zero: 0 })
    expect(run('LDI 3\nSUBI 10', 2)).toMatchObject({ acc: 249, carry: 1 })
    expect(run('LDI 9\nSUBI 9', 2)).toMatchObject({ acc: 0, carry: 0, zero: 1 })
    expect(run('LDI 5\nADDI -1', 2).acc).toBe(4)
  })

  it('CMPI sets the flags and leaves the accumulator alone', () => {
    expect(run('LDI 58\nCMPI 58', 2)).toMatchObject({ acc: 58, zero: 1, carry: 0 })
    expect(run('LDI 57\nCMPI 58', 2)).toMatchObject({ acc: 57, zero: 0, carry: 1 })
    expect(run('LDI 60\nCMPI 58', 2)).toMatchObject({ acc: 60, zero: 0, carry: 0 })
  })

  it('SHL and SHR shift the accumulator, filling with 0', () => {
    expect(run('LDI 0x35\nSHL', 2).acc).toBe(0x6a)
    expect(run('LDI 0xC1\nSHL', 2).acc).toBe(0x82)
    expect(run('LDI 0x35\nSHR', 2).acc).toBe(0x1a)
    expect(run('LDI 0x81\nSHR', 2).acc).toBe(0x40)
    expect(run('LDI 1\nSHL\nSHL\nSHL\nSHL\nSHL\nSHL\nSHL', 8).acc).toBe(0x80)
    expect(run('LDI 0x80\nSHR\nSHR\nSHR\nSHR\nSHR\nSHR\nSHR\nSHR', 9).acc).toBe(0)
  })

  it('JMP, JNC and JZ jump to targets up to 127', () => {
    expect(run('JMP 5', 1).pc).toBe(5)
    expect(run('JMP 31', 1).pc).toBe(31)
    expect(run('JMP 100', 1).pc).toBe(100)
    expect(run('JMP 127', 1).pc).toBe(127)
    expect(run('LDI 1\nADDI 1\nJNC 20', 3).pc).toBe(20)
    expect(run('LDI 255\nADDI 1\nJNC 20', 3).pc).toBe(3)
    expect(run('LDI 3\nCMPI 3\nJZ 70', 3).pc).toBe(70)
    expect(run('LDI 3\nCMPI 4\nJZ 70', 3).pc).toBe(3)
  })

  it('the program counter counts on past 15 and 63 through the whole ROM', () => {
    const nops = Array.from({ length: 100 }, () => 'SHL').join('\n')
    const r = run(`${nops}\nLDI 42`, 101)
    expect(r.pc).toBe(101)
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
    expect(run('LDI 72\nSTA 12', 2).m.text()).toBe('') // other addresses write only to RAM
  })

  it('LDA 15 reads the keypad (key in bits 0-3, bit 4 while a press is waiting) and STA 14 says it has been read', () => {
    const m = machine('LDA 15\nSTA 0\nSTA 14\nLDA 15\nSTA 1\nLDA 0')
    m.press(11)
    m.run(8)
    expect(m.ram()[0]).toBe(0x10 | 11)
    expect(m.ram()[1]).toBe(11) // read after the acknowledgement: the last key stays, nothing is waiting
  })
})

describe('computer 2: the other devices', () => {
  it('STA 14 lights the pixel at (low nibble, high nibble) and STA 13 darkens it', () => {
    const run = (source: string, cycles: number) => {
      const m = machine(source, ['lcd'])
      m.run(cycles)
      return m.pixels()
    }
    expect(run('LDI 0x52\nSTA 14', 2)).toEqual([[2, 5]])
    expect(run('LDI 0x52\nSTA 14\nSTA 13', 3)).toEqual([])
    expect(run('LDI 0x52\nSTA 12', 2)).toEqual([])
  })

  it('STA 14 flips the speaker, and a repeating program makes a tone', () => {
    const m = machine('STA 14\nSTA 14\nSTA 14', ['speaker'])
    const level = () => m.sim.pinValue(m.id('Speaker flip-flop'), 'Q')
    expect(level()).toBe(0)
    m.cycle()
    expect(level()).toBe(1)
    m.cycle()
    expect(level()).toBe(0)
    m.cycle()
    expect(level()).toBe(1)
    // A loop of N instructions flipping once makes a flip every N cycles; the speaker hears it as a pitch.
    const loop = machine('l: STA 14\nSHL\nSHL\nJMP l', ['speaker'])
    for (let i = 0; i < 80; i++) loop.cycle()
    const st = loop.sim.state(loop.id('Speaker')) as SpeakerState
    expect(speakerPitch(st.edges, loop.sim.time)).toBeGreaterThan(0)
    expect(st.edges.length).toBeGreaterThanOrEqual(3)
  })
})

describe('computer 2: the programs', () => {
  it('the ball stays on the screen, bouncing off all four edges, with always a pixel lit', () => {
    const m = machine(BALL_SOURCE, ['lcd'])
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i < 2500; i++) {
      m.cycle()
      const px = m.pixels()
      if (i > 12) expect(px.length, `cycle ${i}`).toBeGreaterThanOrEqual(1)
      expect(px.length).toBeLessThanOrEqual(2)
      for (const [x, y] of px) {
        xs.push(x)
        ys.push(y)
      }
    }
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([0, 15, 0, 15])
  }, 60000)

  it('the siren goes up and down: the pause between flips shrinks, then grows', () => {
    const m = machine(SIREN_SOURCE, ['speaker'])
    const q = m.id('Speaker flip-flop')
    const flips: number[] = []
    let last = m.sim.pinValue(q, 'Q')
    for (let i = 0; i < 9000; i++) {
      m.cycle()
      const v = m.sim.pinValue(q, 'Q')
      if (v !== last) flips.push(i)
      last = v
    }
    const gaps = flips.slice(1).map((f, i) => f - flips[i])
    expect(gaps.length).toBeGreaterThan(100)
    // Starts at the lowest note (the longest gap), reaches a highest note, and comes down again.
    expect(Math.max(...gaps.slice(0, 20))).toBeGreaterThanOrEqual(30)
    const shortest = Math.min(...gaps)
    expect(shortest).toBeLessThanOrEqual(13)
    expect(shortest).toBeGreaterThanOrEqual(9)
    const at = gaps.indexOf(shortest)
    expect(at).toBeGreaterThan(20)
    expect(gaps.slice(at + 1).some((g) => g >= 25)).toBe(true)
    // Within a note the gap is the same every time.
    expect(new Set(gaps.slice(0, 14)).size).toBeLessThanOrEqual(2)
  }, 60000)

  describe('the calculator', () => {
    /** Type keys, giving the program time after each to read the key and show it. */
    const type = (keys: number[]) => {
      const m = machine(CALC_SOURCE)
      for (const k of keys) {
        m.press(k)
        m.run(400)
      }
      return m.text()
    }
    const A = 10
    const B = 11
    const C = 12
    const D = 13
    const E = 14

    it('adds', () => {
      expect(type([3, A, 4, D])).toBe('3+4=7\n')
      expect(type([9, A, 9, D])).toBe('9+9=18\n')
    })

    it('subtracts, with a minus sign for a negative answer', () => {
      expect(type([9, B, 5, D])).toBe('9-5=4\n')
      expect(type([2, B, 6, D])).toBe('2-6=-4\n')
      expect(type([5, B, 5, D])).toBe('5-5=0\n')
    })

    it('multiplies', () => {
      expect(type([7, C, 8, D])).toBe('7x8=56\n')
      expect(type([9, C, 9, D])).toBe('9x9=81\n')
      expect(type([6, C, 0, D])).toBe('6x0=0\n')
    })

    it('does one sum after another, and clears', () => {
      expect(type([1, A, 2, D, 4, C, 5, D])).toBe('1+2=3\n4x5=20\n')
      expect(type([7, C, E, 2, A, 2, D])).toBe('7x\n2+2=4\n')
    })

    it('reads a key held down only once, and ignores keys that are not on the calculator', () => {
      const m = machine(CALC_SOURCE)
      m.sim.setState(m.id('Keypad'), { pressed: true, key: 5 })
      m.sim.settle()
      m.run(600) // held down for a long time
      m.sim.setState(m.id('Keypad'), { pressed: false })
      m.sim.settle()
      m.run(50)
      expect(m.text()).toBe('5')
      m.press(15)
      m.run(300)
      expect(m.text()).toBe('5')
    })
  })
})
