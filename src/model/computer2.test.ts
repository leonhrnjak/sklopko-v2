import { describe, expect, it } from 'vitest'
import { SKASM, SKASM_OPS, assemble, type Op } from '../engine/isa'
import { newMachine, step as referenceStep } from '../engine/skasm-ref'
import { speakerPitch, type ConsoleState, type FramebufferState, type SpeakerState } from '../engine/components/devices'
import { Simulator } from '../engine/simulator'
import { BALL_SOURCE, CALC_SOURCE, TICTACTOE_SOURCE, PONG_SOURCE, SNAKE_SOURCE, SIEVE_SOURCE, SINE_SOURCE, ANT_SOURCE, CONTROL_1, CONTROL_2, CONTROL_3, PROGRAMS, ROM_WORDS, SIREN_SOURCE, buildComputer2, controlWords, programTable, programWords, type Device } from './computer2'
import type { Circuit } from './circuit'
import { EXAMPLES } from './examples'
import { flatten } from './buses'

const BYTE = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `Q${i}`)
const bases = new Map<string, Circuit>()

/** The computer with some devices running a program. Routing the wires takes seconds, so each kind is built once and only the program is swapped. */
function machine(source: string, devices: Device[] = ['console', 'keypad']) {
  const key = devices.join('+')
  let base = bases.get(key)
  if (!base) bases.set(key, (base = buildComputer2({ id: 'test', name: 'test', source: 'HALT', hz: 16, devices, note: '' })))
  const data = programWords(source)
  const comps = Object.values(base.comps).map((k) => (k.label === 'Program' ? { ...k, params: { ...k.params, source, data, tdata: programTable(source) } } : k))
  const c: Circuit = { ...base, comps: Object.fromEntries(comps.map((k) => [k.id, k])) }
  const sim = new Simulator()
  sim.load(flatten(c))
  sim.settle()
  const id = (label: string) => Object.values(c.comps).find((k) => k.label === label)!.id
  const reg = (label: string, pins = BYTE) => pins.reduce((n, pin, i) => n | (sim.pinValue(id(label), pin) << i), 0)
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
    pc: () => reg('PC'),
    acc: () => reg('ACC'),
    x: () => reg('X'),
    sp: () => reg('Stack pointer', ['Q0', 'Q1', 'Q2', 'Q3']),
    stack: () => sim.state(id('Return stack')).mem as number[],
    carry: () => sim.pinValue(id('Flags'), 'Q0'),
    zero: () => sim.pinValue(id('Flags'), 'Q1'),
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
  it('all assemble in SKASM and fit in the ROM', () => {
    for (const p of PROGRAMS) {
      const r = assemble(SKASM, p.source, ROM_WORDS)
      expect(r.errors, p.id).toEqual([])
      expect(r.lineOf.length, p.id).toBeLessThanOrEqual(ROM_WORDS)
    }
    expect(programWords('HALT').split(' ')).toHaveLength(ROM_WORDS)
  })

  it('have unique ids, and each connects what it needs (and nothing it does not use)', () => {
    expect(new Set(PROGRAMS.map((p) => p.id)).size).toBe(PROGRAMS.length)
    for (const p of PROGRAMS) {
      const used = (d: string) =>
        p.source.includes(d === 'lcd' ? 'PIXEL_ON' : d === 'speaker' ? 'SPEAKER' : d === 'console' ? 'CHAR' : d === 'number' ? 'NUMBER' : d === 'gamepad' ? 'IN PAD' : 'IN KEY')
      for (const d of ['lcd', 'speaker', 'console', 'keypad', 'gamepad', 'number'] as const) expect(p.devices.includes(d), `${p.id}: ${d}`).toBe(used(d))
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

  it('JMP, JNC and JZ jump to targets up to 255', () => {
    expect(run('JMP 5', 1).pc).toBe(5)
    expect(run('JMP 31', 1).pc).toBe(31)
    expect(run('JMP 100', 1).pc).toBe(100)
    expect(run('JMP 127', 1).pc).toBe(127)
    expect(run('JMP 255', 1).pc).toBe(255)
    expect(run('JMP 200', 1).pc).toBe(200)
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

  it('OUT CHAR prints the accumulator as a character', () => {
    expect(run('LDI 72\nOUT CHAR\nLDI 105\nOUT CHAR', 4).m.text()).toBe('Hi')
    expect(run('LDI 65\nOUT CHAR\nLDI 10\nOUT CHAR\nLDI 66\nOUT CHAR', 6).m.text()).toBe('A\nB')
    expect(run('LDI 72\nOUT 12', 2).m.text()).toBe('') // other ports reach nothing here
    expect(run('LDI 72\nSTA 15\nSTA 1', 3).m.text()).toBe('') // RAM addresses are not ports
  })

  it('IN KEY reads the keypad (key in bits 0-3, bit 4 while a press is waiting) and OUT KEY_ACK says it has been read', () => {
    const m = machine('IN KEY\nSTA 0\nOUT KEY_ACK\nIN KEY\nSTA 1\nLDA 0')
    m.press(11)
    m.run(8)
    expect(m.ram()[0]).toBe(0x10 | 11)
    expect(m.ram()[1]).toBe(11) // read after the acknowledgement: the last key stays, nothing is waiting
  })
})

describe('computer 2: the other devices', () => {
  it('OUT PIXEL_ON lights the pixel at (low nibble, high nibble) and OUT PIXEL_OFF darkens it', () => {
    const run = (source: string, cycles: number) => {
      const m = machine(source, ['lcd'])
      m.run(cycles)
      return m.pixels()
    }
    expect(run('LDI 0x52\nOUT PIXEL_ON', 2)).toEqual([[2, 5]])
    expect(run('LDI 0x52\nOUT PIXEL_ON\nOUT PIXEL_OFF', 3)).toEqual([])
    expect(run('LDI 0x52\nOUT 12', 2)).toEqual([])
    expect(run('LDI 0x52\nSTA 14\nSTA 13', 3)).toEqual([]) // RAM addresses 13 and 14 are only memory now
  })

  it('OUT SPEAKER flips the speaker, and a repeating program makes a tone', () => {
    const m = machine('OUT SPEAKER\nOUT SPEAKER\nOUT SPEAKER', ['speaker'])
    const level = () => m.sim.pinValue(m.id('Speaker flip-flop'), 'Q')
    expect(level()).toBe(0)
    m.cycle()
    expect(level()).toBe(1)
    m.cycle()
    expect(level()).toBe(0)
    m.cycle()
    expect(level()).toBe(1)
    // A loop of N instructions flipping once makes a flip every N cycles; the speaker hears it as a pitch.
    const loop = machine('l: OUT SPEAKER\nSHL\nSHL\nJMP l', ['speaker'])
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

  // Each sum runs thousands of cycles of the whole computer, which takes a few seconds on a slow CI runner.
  describe('the calculator', { timeout: 30000 }, () => {
    const PLUS = 10
    const MINUS = 11
    const TIMES = 12
    const DIVIDE = 13
    const EQUALS = 14
    const CLEAR = 15
    /** Type a sum like "23+10=" (digits as themselves, + - * / = c), giving the program time after each key. */
    const type = (keys: string) => {
      const m = machine(CALC_SOURCE)
      const code: Record<string, number> = { '+': PLUS, '-': MINUS, '*': TIMES, '/': DIVIDE, '=': EQUALS, c: CLEAR }
      for (const ch of keys) {
        m.press(code[ch] ?? Number(ch))
        m.run(ch === '=' ? 2500 : 40)
      }
      return m.text()
    }

    it('adds numbers of any length up to 255', () => {
      expect(type('23+10=')).toBe('23+10=33\n')
      expect(type('3+4=')).toBe('3+4=7\n')
      expect(type('99+99=')).toBe('99+99=198\n')
      expect(type('200+55=')).toBe('200+55=255\n')
      expect(type('100+5=')).toBe('100+5=105\n') // a zero tens digit after hundreds is printed
    }, 30000) // about 3 s on a laptop, so the default 5 s is too tight for a busy CI runner

    it('subtracts, with a minus sign for a negative answer', () => {
      expect(type('50-8=')).toBe('50-8=42\n')
      expect(type('9-5=')).toBe('9-5=4\n')
      expect(type('2-26=')).toBe('2-26=-24\n')
      expect(type('120-120=')).toBe('120-120=0\n')
    })

    it('multiplies', () => {
      expect(type('12*12=')).toBe('12*12=144\n'.replace('*', 'x'))
      expect(type('15*17=')).toBe('15x17=255\n')
      expect(type('6*0=')).toBe('6x0=0\n')
    })

    it('divides, dropping the remainder', () => {
      expect(type('100/7=')).toBe('100/7=14\n')
      expect(type('9/3=')).toBe('9/3=3\n')
      expect(type('5/9=')).toBe('5/9=0\n')
      expect(type('250/50=')).toBe('250/50=5\n')
    })

    it('shows E for an answer that is too big and for dividing by zero', () => {
      expect(type('200+100=')).toBe('200+100=E\n')
      expect(type('15*18=')).toBe('15x18=E\n')
      expect(type('7/0=')).toBe('7/0=E\n')
    })

    it('does not take a number past 255, and a longer sum works after clearing', () => {
      expect(type('2556=')).toBe('255=255\n') // the 6 would make 2556: ignored
      expect(type('260=')).toBe('26=26\n') // 260 does not fit: the 0 is ignored
      expect(type('7*c2+2=')).toBe('7x\n2+2=4\n')
    })

    it('does one sum after another', () => {
      expect(type('1+2=4*5=')).toBe('1+2=3\n4x5=20\n')
    })

    it('reads a key held down only once, and ignores keys that are not used', () => {
      const m = machine(CALC_SOURCE)
      m.sim.setState(m.id('Keypad'), { pressed: true, tapped: true, key: 5 })
      m.sim.settle()
      m.run(600) // held down for a long time
      m.sim.setState(m.id('Keypad'), { pressed: false })
      m.sim.settle()
      m.run(50)
      expect(m.text()).toBe('5')
    })
  })
})

describe('computer 2: the examples as built', () => {
  it('the calculator example has a calculator keypad, sitting right above its display', () => {
    const c = EXAMPLES.find((e) => e.id === 'computer-calc')!.build()
    const keypad = Object.values(c.comps).find((k) => k.type === 'keypad')!
    const display = Object.values(c.comps).find((k) => k.type === 'console')!
    expect(keypad.params).toMatchObject({ layout: 'calc', sticky: true })
    expect(keypad.x).toBe(display.x) // the same column
    expect(Math.abs(display.y - keypad.y)).toBeLessThan(400)
  }, 30000)
})

// ---- The circuit against the reference interpreter ----------------------------------------------------------

/** A computer with every device, built once; a program is swapped in and the machine power-cycled. */
const rig = (() => {
  let made: { m: ReturnType<typeof machine>; prog: string; base: Record<string, unknown> } | null = null
  return {
    load(source: string) {
      if (!made) {
        const m = machine('HALT', ['console', 'lcd', 'speaker', 'keypad'])
        const prog = m.id('Program')
        made = { m, prog, base: m.c.comps[prog].params }
      }
      const { m, prog, base } = made
      m.sim.setParams(prog, { ...base, source, data: programWords(source), tdata: programTable(source) } as never)
      m.sim.reset()
      m.sim.settle()
      return m
    },
  }
})()

/** Run a program on the circuit and on the reference machine, a cycle at a time; every cycle they must agree on everything. */
function agree(source: string, cycles: number): string | null {
  const m = rig.load(source)
  const asm = assemble(SKASM, source, ROM_WORDS)
  const words = asm.words
  const ref = newMachine()
  ref.table = [...asm.table, ...new Array<number>(256 - asm.table.length).fill(0)]
  // The screen of the rig, as the reference sees it: lit pixels, and the one that IN PIXEL reads.
  const lit = new Set<number>()
  let at = 0
  const screen = {
    out(port: number, v: number) {
      if (port === 2) lit.add(v)
      else if (port === 3) lit.delete(v)
      else if (port === 7) at = v
    },
    in: (port: number) => (port === 2 && lit.has(at) ? 1 : 0),
  }
  for (let i = 0; i < cycles; i++) {
    m.cycle()
    referenceStep(ref, words, screen)
    const got = { pc: m.pc(), acc: m.acc(), x: m.x(), c: m.carry(), z: m.zero(), ram: m.ram().join(','), sp: m.sp(), stack: m.stack().join(',') }
    const want = { pc: ref.pc, acc: ref.acc, x: ref.x, c: ref.c, z: ref.z, ram: ref.ram.join(','), sp: ref.sp, stack: ref.stack.join(',') }
    if (JSON.stringify(got) !== JSON.stringify(want)) return `cycle ${i + 1}: circuit ${JSON.stringify(got)}, reference ${JSON.stringify(want)}`
  }
  return null
}

describe('computer: the control ROMs', () => {
  it('have a row for every instruction (and nothing for the rest), as 256-word ROMs', () => {
    const { rom1, rom2, rom3 } = controlWords()
    expect(CONTROL_1.split(' ')).toHaveLength(256)
    expect(CONTROL_2.split(' ')).toHaveLength(256)
    expect(CONTROL_3.split(' ')).toHaveLength(256)
    const used = new Set(Object.values(SKASM_OPS).map((o) => o.code | ((o.sub ?? 0) << 4)))
    for (let i = 0; i < 256; i++) if (!used.has(i)) expect([rom1[i], rom2[i], rom3[i]], `row ${i}`).toEqual([0, 0, 0])
  })

  it('keep the control words of the original instructions exactly as they were', () => {
    const { rom1 } = controlWords()
    expect(rom1.slice(0, 14)).toEqual([0x0001, 0x0005, 0x0010, 0x0040, 0x0023, 0x0423, 0x0080, 0x0200, 0x0100, 0x0823, 0x0c20, 0x0007, 0x0009, 0x0c23])
  })
})

describe('computer: every instruction does what the reference interpreter says', () => {
  const values = [0, 1, 0x7f, 0x80, 0xff, 0xa5]
  /** Set the carry flag to 1 or 0 (and zero accordingly) before the instruction under test. */
  const carry = ['LDI 255\nADDI 1\n', 'LDI 1\nADDI 1\n']
  const cyclesOf = (src: string) => src.split('\n').filter((l) => l.trim()).length + 1

  const arith = (names: string[], build: (name: string, a: number, b: number) => string) => {
    for (const name of names)
      it(`${name}, over operand pairs and both carry flags`, () => {
        for (const pre of carry)
          for (const a of values)
            for (const b of values) {
              const src = pre + build(name, a, b)
              expect(agree(src, cyclesOf(src)), src).toBeNull()
            }
      })
  }
  arith(['ADD', 'SUB', 'ADC', 'SBC', 'CMP', 'AND', 'OR', 'XOR'], (name, a, b) => `LDI ${b}\nSTA 3\nLDI ${a}\n${name} 3`)
  arith(['ADDI', 'SUBI', 'CMPI', 'ANDI', 'ORI', 'XORI'], (name, a, b) => `LDI ${a}\n${name} ${b}`)
  arith(['SHL', 'SHR'], (name, a) => `LDI ${a}\n${name}`)
  arith(['INC', 'DEC', 'CLR', 'NOT'], (name, a) => `LDI ${a}\n${name}`)

  for (const jump of ['JMP', 'JZ', 'JNZ', 'JC', 'JNC'])
    it(`${jump} goes where the flags say (and a target past 15 works)`, () => {
      for (const pre of carry)
        for (const a of [0, 1, 255])
          for (const b of [0, 1, 255]) {
            const src = `${pre}LDI ${a}\nADDI ${b}\n${jump} 70\nLDI 9`
            expect(agree(src, cyclesOf(src)), src).toBeNull()
          }
    })

  it('LDI, LDA, STA, NOP, HALT, and RAM words 11 to 15 are ordinary memory', () => {
    for (const src of ['LDI 200\nSTA 15\nLDI 1\nLDA 15', 'LDI 7\nSTA 11\nSTA 12\nSTA 13\nSTA 14\nSTA 15\nLDA 13', 'NOP\nNOP\nLDI 1\nHALT\nLDI 2', 'LDI 5\nHALT'])
      expect(agree(src, 8), src).toBeNull()
  })

  it('OUT and IN, for every port, change nothing but the accumulator (IN reads 0 with nothing pressed)', () => {
    for (let port = 0; port < 16; port++) {
      const src = `LDI 0x35\nOUT ${port}\nADDI 1\nIN ${port}\nLDI 3\nIN ${port}`
      expect(agree(src, 7), src).toBeNull()
    }
  })
})

describe('computer: random programs run the same on the circuit and the reference interpreter', () => {
  /** A small seeded random generator, so a failure can be repeated. */
  const random = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const MNEMONICS = Object.entries(SKASM_OPS)
  const operand = (op: Op, rnd: () => number, length: number) =>
    op.arg === 'none' ? '' : ' ' + (op.arg === 'imm' ? Math.floor(rnd() * 256) : op.arg === 'target' ? Math.floor(rnd() * length) : Math.floor(rnd() * 16))

  for (let seed = 1; seed <= 25; seed++)
    it(`seed ${seed}`, () => {
      const rnd = random(seed)
      const length = 24
      const lines = Array.from({ length }, () => {
        const [name, op] = MNEMONICS[Math.floor(rnd() * MNEMONICS.length)]
        return name + operand(op, rnd, length)
      })
      const src = lines.join('\n')
      expect(agree(src, 120), src).toBeNull()
    })
})

describe('computer: the decimal display (OUT NUMBER)', () => {
  /** A computer with only the decimal display, built once; programs are swapped in. */
  const numbers = (() => {
    let made: { m: ReturnType<typeof machine>; prog: string; base: Record<string, unknown> } | null = null
    return (source: string) => {
      if (!made) {
        const m = machine('HALT', ['number'])
        const prog = m.id('Program')
        made = { m, prog, base: m.c.comps[prog].params }
      }
      const { m, prog, base } = made
      m.sim.setParams(prog, { ...base, source, data: programWords(source), tdata: programTable(source) } as never)
      m.sim.reset()
      m.sim.settle()
      const reg = (label: string, pins: string[]) => pins.reduce((n, p, i) => n | (m.sim.pinValue(m.id(label), p) << i), 0)
      return {
        m,
        output: () => reg('Output', [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `Q${i}`)),
        decimal: () => ['Hundreds', 'Tens', 'Ones'].reduce((n, label) => n * 10 + reg(label, ['S0', 'S1', 'S2', 'S3']), 0),
      }
    }
  })()

  it('OUT NUMBER loads the output register, and only OUT NUMBER does', () => {
    const a = numbers('LDI 0xA5\nOUT NUMBER')
    a.m.run(2)
    expect(a.output()).toBe(0xa5)
    const b = numbers('LDI 0xA5\nOUT 1\nOUT 2\nSTA 0\nSTA 15')
    b.m.run(5)
    expect(b.output()).toBe(0) // other ports, and RAM addresses, leave it alone
    const c = numbers('LDI 10\nOUT NUMBER\nLDI 3\nLDA 15')
    c.m.run(4)
    expect([c.output(), c.m.acc()]).toEqual([10, 0]) // LDA 15 reads the RAM word, not the port
  })

  it('the decimal display shows every value the output register can hold', () => {
    for (let n = 0; n < 256; n++) {
      const r = numbers(`LDI ${n}\nOUT NUMBER`)
      r.m.run(2)
      expect([r.output(), r.decimal()], `${n}`).toEqual([n, n])
    }
  })
})

describe('computer 2: tic-tac-toe on the circuit', () => {
  it('plays a game to a win: the same screen and text as the reference interpreter', () => {
    const keys = [0, 4, 1, 5, 2] // X takes the top row, O the middle row's first two cells
    const m = machine(TICTACTOE_SOURCE, ['console', 'lcd', 'keypad'])
    m.run(2000) // the grid
    for (const k of keys) {
      m.press(k)
      m.run(400)
    }
    const ref = newMachine()
    const px = new Set<number>()
    let text = ''
    const prog = assemble(SKASM, TICTACTOE_SOURCE, ROM_WORDS).words
    const queue = [...keys]
    let pending = -1
    for (let i = 0; i < 60000 && !ref.halted; i++) {
      referenceStep(ref, prog, {
        out(port, v) {
          if (port === 1) text += String.fromCharCode(v)
          else if (port === 2) px.add(v)
          else if (port === 5) pending = -1
        },
        in(port) {
          if (port !== 5) return 0
          if (pending < 0 && queue.length) pending = queue.shift()!
          return pending < 0 ? 0 : pending | 16
        },
      })
    }
    expect(text).toBe('X wins')
    expect(m.text()).toBe('X wins')
    expect(m.halted()).toBe(1)
    expect(new Set(m.pixels().map(([x, y]) => y * 16 + x))).toEqual(px)
  }, 60000)
})

describe('computer 2: pong on the circuit', () => {
  it('draws the same screen as the reference interpreter after the same number of instructions', () => {
    const m = machine(PONG_SOURCE, ['number', 'lcd', 'gamepad'])
    const ref = newMachine()
    const px = new Set<number>()
    const prog = assemble(SKASM, PONG_SOURCE, ROM_WORDS).words
    const ports = {
      out(port: number, v: number) {
        if (port === 2) px.add(v)
        else if (port === 3) px.delete(v)
      },
    }
    let ran = 0
    for (const n of [40, 300, 900]) {
      m.run(n - ran)
      for (; ran < n; ran++) referenceStep(ref, prog, ports)
      expect(new Set(m.pixels().map(([x, y]) => y * 16 + x)), `after ${n} instructions`).toEqual(px)
    }
  }, 60000)
})

describe('computer 2: snake on the circuit', () => {
  it('draws the same screen as the reference interpreter, and ends with Game over at the wall', () => {
    const m = machine(SNAKE_SOURCE, ['number', 'console', 'lcd', 'gamepad'])
    const ref = newMachine()
    const px = new Set<number>()
    let text = ''
    const prog = assemble(SKASM, SNAKE_SOURCE, ROM_WORDS).words
    const ports = {
      out(port: number, v: number) {
        if (port === 1) text += String.fromCharCode(v)
        else if (port === 2) px.add(v)
        else if (port === 3) px.delete(v)
      },
    }
    let ran = 0
    for (const n of [300, 700, 1500]) {
      m.run(n - ran)
      for (; ran < n; ran++) referenceStep(ref, prog, ports)
      expect(new Set(m.pixels().map(([x, y]) => y * 16 + x)), `after ${n} instructions`).toEqual(px)
    }
    m.run(4000)
    for (; ran < 5500; ran++) referenceStep(ref, prog, ports)
    expect(text).toBe('Game over')
    expect(m.text()).toBe('Game over')
    expect(m.halted()).toBe(1)
  }, 60000)
})

describe('computer 2: the gamepad', () => {
  it('IN PAD reads the buttons held right now, one bit each, and 0 when nothing is held', () => {
    const m = machine('IN PAD\nHALT', ['gamepad'])
    const pad = m.id('Gamepad')
    const read = (keys: number) => {
      m.sim.reset()
      m.sim.setState(pad, { keys })
      m.sim.settle()
      m.run(6)
      return m.acc()
    }
    expect(read(0)).toBe(0)
    expect(read(1)).toBe(1)
    expect(read(2 | 8)).toBe(10)
    expect(read(63)).toBe(63)
    expect(read(16 | 32 | 4)).toBe(52)
  })

  it('a computer without a gamepad reads 0 from IN PAD, and one with only a keypad still reads its keys', () => {
    const m = machine('IN PAD\nHALT', ['keypad'])
    m.run(6)
    expect(m.acc()).toBe(0)
    const k = machine('IN KEY\nHALT', ['keypad', 'gamepad'])
    k.sim.setState(k.id('Gamepad'), { keys: 63 })
    k.press(5)
    k.run(6)
    expect(k.acc() & 16).toBe(16) // a press waits
    expect(k.acc() & 15).toBe(5)
  })
})

describe('computer: the index register X and the 256-byte RAM', () => {
  const cyclesOf = (src: string) => src.split('\n').filter((l) => l.trim()).length + 1
  const programs = [
    'LDXI 7\nTXA',
    'LDI 9\nTAX\nLDI 0\nTXA',
    'LDXI 255\nINX\nTXA', // wraps to 0, sets zero
    'LDXI 0\nDEX\nTXA', // wraps to 255
    'LDXI 5\nINX\nINX\nDEX\nTXA',
    'LDI 255\nADDI 1\nLDXI 2\nINX', // INX clears the carry the addition set
    'LDI 255\nADDI 1\nLDXI 1\nDEX', // and DEX sets zero
    'LDI 255\nADDI 1\nLDI 9\nTAX\nTXA', // TAX and TXA leave the flags alone
    'LDI 5\nADDI 255\nLDXI 3\nLDI 0', // LDXI too
    'LDI 77\nLDXI 200\nSTX\nLDI 1\nLDX', // a byte far past the first 16
    'LDI 5\nSTA 3\nLDXI 3\nLDX', // X reaches the same bytes as an address
    'LDI 9\nLDXI 3\nSTX\nLDA 3', // and the other way round
    'LDI 11\nLDXI 20\nSTX\nLDI 22\nINX\nSTX\nLDXI 20\nLDX\nLDXI 21\nLDX',
    'LDI 1\nLDXI 255\nSTX\nINX\nSTX\nLDXI 255\nLDX', // the last byte and the first
  ]
  for (const src of programs)
    it(src.replace(/\n/g, '; '), () => {
      expect(agree(src, cyclesOf(src)), src).toBeNull()
    })

  it('a loop can fill ten bytes far from the variables', () => {
    // RAM[100 + i] = i for i = 0..9.
    const src = `LDXI 100\nLDI 0\nfill: STX\nINX\nADDI 1\nCMPI 10\nJNZ fill\nHALT`
    const words = assemble(SKASM, src, ROM_WORDS).words
    const ref = newMachine()
    for (let i = 0; i < 400 && !ref.halted; i++) referenceStep(ref, words)
    expect(ref.halted).toBe(true)
    expect(ref.ram.slice(100, 110)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
})

describe('computer: the sieve', () => {
  const primes = (below: number) => Array.from({ length: below }, (_, n) => n).filter((n) => n > 1 && Array.from({ length: Math.floor(Math.sqrt(n)) - 1 }, (_, i) => i + 2).every((d) => n % d !== 0))

  it('prints the primes below 240, on the reference interpreter', () => {
    const words = assemble(SKASM, SIEVE_SOURCE, ROM_WORDS).words
    const ref = newMachine()
    let text = ''
    for (let i = 0; i < 200000 && !ref.halted; i++) referenceStep(ref, words, { out: (p, v) => void (p === 1 && (text += String.fromCharCode(v))) })
    expect(ref.halted).toBe(true)
    expect(text).toBe(primes(240).join(' ') + ' ')
  })

  it('the circuit prints the same start, in the same number of cycles', () => {
    const m = machine(SIEVE_SOURCE, ['console'])
    m.run(6000)
    const words = assemble(SKASM, SIEVE_SOURCE, ROM_WORDS).words
    const ref = newMachine()
    let text = ''
    for (let i = 0; i < 6000; i++) referenceStep(ref, words, { out: (p, v) => void (p === 1 && (text += String.fromCharCode(v))) })
    expect(text.length).toBeGreaterThan(10)
    expect(m.text().replace(/\n/g, '')).toBe(text)
  }, 60000)
})

describe('computer: CALL and RET', () => {
  const cyclesOf = (src: string) => src.split('\n').filter((l) => l.trim()).length + 1
  const programs: Record<string, string> = {
    'a call and its return': 'LDI 1\nCALL f\nADDI 10\nHALT\nf: ADDI 5\nRET',
    'two calls of the same routine': 'LDI 1\nCALL f\nCALL f\nHALT\nf: ADDI 5\nRET',
    'calls inside calls': 'CALL a\nHALT\na: LDI 1\nCALL b\nADDI 100\nRET\nb: ADDI 2\nCALL c\nRET\nc: ADDI 4\nRET',
    'a call in a loop': 'LDI 3\nSTA 0\nloop: CALL down\nJNZ loop\nHALT\ndown: LDA 0\nSUBI 1\nSTA 0\nRET',
    'a RET with nothing to return to': 'LDI 7\nRET\nLDI 1',
    'a call that is never returned from': 'CALL f\nHALT\nf: LDI 4\nCALL g\ng: ADDI 1\nHALT',
    'a call to the next instruction': 'CALL next\nnext: LDI 3\nRET',
    'the flags survive CALL and RET': 'LDI 255\nADDI 1\nCALL f\nHALT\nf: RET',
  }
  for (const [name, src] of Object.entries(programs))
    it(name, () => {
      expect(agree(src, cyclesOf(src) + 14), src).toBeNull()
    })

  it('17 calls deep wrap round the 16-entry stack, the same on the circuit and the interpreter', () => {
    const src = 'CALL a\nHALT\na: CALL a'
    expect(agree(src, 40), src).toBeNull()
  })

  it('the reference interpreter returns to the right place through nested calls', () => {
    const src = 'LDI 0\nCALL a\nADDI 1\nHALT\na: ADDI 10\nCALL b\nADDI 20\nRET\nb: ADDI 100\nRET'
    const ref = newMachine()
    const words = assemble(SKASM, src, ROM_WORDS).words
    for (let i = 0; i < 20 && !ref.halted; i++) referenceStep(ref, words)
    expect(ref.halted).toBe(true)
    expect(ref.acc).toBe(131)
    expect(ref.sp).toBe(0)
  })
})

describe('computer: the table ROM (.byte and LDT)', () => {
  const cyclesOf = (src: string) => src.split('\n').filter((l) => l.trim() && !l.trim().startsWith('.byte') && !/^\w+:\s*\.byte/.test(l.trim())).length + 1
  const programs: Record<string, string> = {
    'the first byte': 'LDXI 0\nLDT\nHALT\n.byte 17, 34, 51',
    'a byte in the middle': 'LDXI 2\nLDT\nHALT\n.byte 17, 34, 51',
    'a loop sums the table': 'LDXI 0\nLDI 0\nl: STA 0\nLDT\nADD 0\nINX\nCMPI 100\nJNC end\nJMP l\nend: HALT\n.byte 1, 2, 3, 4',
    'bytes past the end read 0': 'LDXI 200\nLDI 9\nLDT',
    'a label names a place in the table': 'LDXI second\nLDT\nHALT\nfirst: .byte 5, 6\nsecond: .byte 7, 8',
    'negative bytes and names': 'K = 40\nLDXI 1\nLDT\nLDXI 2\nLDT\nHALT\n.byte K, -1, 0xFF',
    'LDT leaves the flags alone': 'LDI 255\nADDI 1\nLDXI 1\nLDT\nHALT\n.byte 0, 0, 0',
  }
  for (const [name, src] of Object.entries(programs))
    it(name, () => {
      expect(agree(src, cyclesOf(src) + 12), src).toBeNull()
    })

  it('prints a text from the table, one byte at a time', () => {
    const src = `        LDXI 0
next:   LDT
        CMPI 0
        JZ done
        OUT CHAR
        INX
        JMP next
done:   HALT
        .byte 72, 101, 108, 108, 111, 0`
    const asm = assemble(SKASM, src, ROM_WORDS)
    expect(asm.errors).toEqual([])
    const ref = newMachine()
    ref.table = [...asm.table, ...new Array<number>(256 - asm.table.length).fill(0)]
    let text = ''
    for (let i = 0; i < 100 && !ref.halted; i++) referenceStep(ref, asm.words, { out: (p, v) => void (p === 1 && (text += String.fromCharCode(v))) })
    expect(text).toBe('Hello')
    const m = machine(src, ['console'])
    m.run(60)
    expect(m.text()).toBe('Hello')
  })
})

describe('computer: the sine wave', () => {
  /** The lit pixels of a screen as column -> row, for a screen with one pixel per column. */
  const columns = (px: Set<number>) => [...px].map((v) => [v & 15, v >> 4]).sort((a, b) => a[0] - b[0])

  it('shows the table as a wave that moves one column a frame, on the reference interpreter', () => {
    const asm = assemble(SKASM, SINE_SOURCE, ROM_WORDS)
    expect(asm.errors).toEqual([])
    expect(asm.table).toHaveLength(16)
    // It is a sine: within a pixel of 7.5 + 7 sin(2πx/16) everywhere.
    asm.table.forEach((h, x) => expect(Math.abs(h - (7.5 + 7 * Math.sin((2 * Math.PI * x) / 16)))).toBeLessThanOrEqual(0.5))
    const ref = newMachine()
    ref.table = [...asm.table, ...new Array<number>(240).fill(0)]
    const px = new Set<number>()
    let frames = 0
    for (let i = 0; i < 20000 && frames < 40; i++) {
      if (ref.pc === asm.symbols.frame) {
        frames++
        if (frames > 1) {
          // Every column has exactly one lit pixel, at the height of the wave moved by the phase.
          const phase = ref.ram[1]
          expect(columns(px), `frame ${frames}`).toEqual(Array.from({ length: 16 }, (_, c) => [c, asm.table[(c + phase + 15) & 15]]))
        }
      }
      referenceStep(ref, asm.words, { out: (p, v) => void (p === 2 ? px.add(v) : p === 3 && px.delete(v)) })
    }
    expect(frames).toBe(40)
  })

  it('the circuit draws the same screen as the reference interpreter', () => {
    const m = machine(SINE_SOURCE, ['lcd'])
    const asm = assemble(SKASM, SINE_SOURCE, ROM_WORDS)
    const ref = newMachine()
    ref.table = [...asm.table, ...new Array<number>(240).fill(0)]
    const px = new Set<number>()
    let ran = 0
    for (const n of [200, 900, 1500]) {
      m.run(n - ran)
      for (; ran < n; ran++) referenceStep(ref, asm.words, { out: (p, v) => void (p === 2 ? px.add(v) : p === 3 && px.delete(v)) })
      expect(new Set(m.pixels().map(([x, y]) => y * 16 + x))).toEqual(px)
    }
  }, 60000)
})

describe('computer: reading the screen back (OUT PIXEL_AT, IN PIXEL)', () => {
  const cyclesOf = (src: string) => src.split('\n').filter((l) => l.trim()).length + 1
  const programs: Record<string, string> = {
    'a lit pixel reads 1': 'LDI 0x35\nOUT PIXEL_ON\nOUT PIXEL_AT\nIN PIXEL',
    'a dark pixel reads 0': 'LDI 0x35\nOUT PIXEL_AT\nIN PIXEL',
    'a pixel darkened again reads 0': 'LDI 0x35\nOUT PIXEL_ON\nOUT PIXEL_OFF\nOUT PIXEL_AT\nIN PIXEL',
    'only the chosen pixel is read': 'LDI 0x35\nOUT PIXEL_ON\nLDI 0x36\nOUT PIXEL_AT\nIN PIXEL',
    'the first and the last pixel': 'LDI 0\nOUT PIXEL_ON\nLDI 255\nOUT PIXEL_ON\nLDI 0\nOUT PIXEL_AT\nIN PIXEL\nSTA 0\nLDI 255\nOUT PIXEL_AT\nIN PIXEL\nADD 0',
    'choosing a pixel does not light it': 'LDI 0x77\nOUT PIXEL_AT\nIN PIXEL\nOUT PIXEL_ON\nIN PIXEL',
  }
  for (const [name, src] of Object.entries(programs))
    it(name, () => {
      expect(agree(src, cyclesOf(src) + 4), src).toBeNull()
    })

  it('a program can test the pixel under it: it follows a line until it ends', () => {
    // Light 10, 11, 12 on row 0; walk from 0 to the first dark pixel by reading.
    const src = 'LDI 10\nOUT PIXEL_ON\nLDI 11\nOUT PIXEL_ON\nLDI 12\nOUT PIXEL_ON\nLDI 10\nSTA 0\nloop: LDA 0\nOUT PIXEL_AT\nIN PIXEL\nCMPI 0\nJZ end\nLDA 0\nADDI 1\nSTA 0\nJMP loop\nend: HALT'
    const m = machine(src, ['lcd'])
    m.run(200)
    expect(m.halted()).toBe(1)
    expect(m.ram()[0]).toBe(13)
  })
})

describe("computer: Langton's ant", () => {
  /** The ant in plain TypeScript, to compare with: steps of the same rules on the same 16x16 torus. */
  const antAfter = (steps: number) => {
    const lit = new Set<number>()
    let x = 8
    let y = 8
    let dir = 0
    for (let i = 0; i < steps; i++) {
      const p = y * 16 + x
      if (lit.has(p)) {
        dir = (dir + 3) & 3
        lit.delete(p)
      } else {
        dir = (dir + 1) & 3
        lit.add(p)
      }
      if (dir === 0) y = (y - 1) & 15
      else if (dir === 1) x = (x + 1) & 15
      else if (dir === 2) y = (y + 1) & 15
      else x = (x - 1) & 15
    }
    return { lit, x, y, dir }
  }

  it('follows the rules: after 1, 11, 100 and 3000 steps the screen and the ant are as in plain TypeScript', () => {
    const asm = assemble(SKASM, ANT_SOURCE, ROM_WORDS)
    expect(asm.errors).toEqual([])
    const ref = newMachine()
    const lit = new Set<number>()
    let at = 0
    const ports = {
      out(port: number, v: number) {
        if (port === 2) lit.add(v)
        else if (port === 3) lit.delete(v)
        else if (port === 7) at = v
      },
      in: (port: number) => (port === 2 && lit.has(at) ? 1 : 0),
    }
    let steps = 0
    for (let i = 0; i < 200000 && steps <= 3000; i++) {
      if (ref.pc === asm.symbols.step) {
        if ([1, 11, 100, 3000].includes(steps)) {
          const want = antAfter(steps)
          expect([...lit].sort((a, b) => a - b), `after ${steps} steps`).toEqual([...want.lit].sort((a, b) => a - b))
          expect([ref.ram[0], ref.ram[1]]).toEqual([want.y * 16 + want.x, want.dir])
        }
        steps++
      }
      referenceStep(ref, asm.words, ports)
    }
    expect(steps).toBeGreaterThan(3000)
  })

  it('the circuit draws the same ant as the interpreter', () => {
    const m = machine(ANT_SOURCE, ['lcd'])
    const asm = assemble(SKASM, ANT_SOURCE, ROM_WORDS)
    const ref = newMachine()
    const lit = new Set<number>()
    let at = 0
    const ports = {
      out(port: number, v: number) {
        if (port === 2) lit.add(v)
        else if (port === 3) lit.delete(v)
        else if (port === 7) at = v
      },
      in: (port: number) => (port === 2 && lit.has(at) ? 1 : 0),
    }
    let ran = 0
    for (const n of [100, 700, 2500]) {
      m.run(n - ran)
      for (; ran < n; ran++) referenceStep(ref, asm.words, ports)
      expect(new Set(m.pixels().map(([x, y]) => y * 16 + x)), `after ${n} instructions`).toEqual(lit)
    }
  }, 60000)
})
