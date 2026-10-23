import { describe, expect, it } from 'vitest'
import { SKASM, SKASM_OPS, assemble, type Op } from '../engine/isa'
import { newMachine, step as referenceStep } from '../engine/skasm-ref'
import { speakerPitch, type ConsoleState, type FramebufferState, type SpeakerState } from '../engine/components/devices'
import { Simulator } from '../engine/simulator'
import { BALL_SOURCE, CALC_SOURCE, CONTROL_1, CONTROL_2, PROGRAMS, ROM_WORDS, SIREN_SOURCE, buildComputer2, controlWords, programWords, type Device } from './computer2'
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
  const comps = Object.values(base.comps).map((k) => (k.label === 'Program' ? { ...k, params: { ...k.params, source, data } } : k))
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
      const used = (d: string) => p.source.includes(d === 'lcd' ? 'PIXEL_ON' : d === 'speaker' ? 'SPEAKER' : d === 'console' ? 'CHAR' : d === 'number' ? 'NUMBER' : 'KEY')
      for (const d of ['lcd', 'speaker', 'console', 'keypad', 'number'] as const) expect(p.devices.includes(d), `${p.id}: ${d}`).toBe(used(d))
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

  describe('the calculator', () => {
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
      m.sim.setParams(prog, { ...base, source, data: programWords(source) } as never)
      m.sim.reset()
      m.sim.settle()
      return m
    },
  }
})()

/** Run a program on the circuit and on the reference machine, a cycle at a time; every cycle they must agree on everything. */
function agree(source: string, cycles: number): string | null {
  const m = rig.load(source)
  const words = assemble(SKASM, source, ROM_WORDS).words
  const ref = newMachine()
  for (let i = 0; i < cycles; i++) {
    m.cycle()
    referenceStep(ref, words)
    const got = { pc: m.pc(), acc: m.acc(), c: m.carry(), z: m.zero(), ram: m.ram().slice(0, 16).join(',') }
    const want = { pc: ref.pc, acc: ref.acc, c: ref.c, z: ref.z, ram: ref.ram.join(',') }
    if (JSON.stringify(got) !== JSON.stringify(want)) return `cycle ${i + 1}: circuit ${JSON.stringify(got)}, reference ${JSON.stringify(want)}`
  }
  return null
}

describe('computer: the control ROMs', () => {
  it('have a row for every instruction (and nothing for the rest), as 256-word ROMs', () => {
    const { rom1, rom2 } = controlWords()
    expect(CONTROL_1.split(' ')).toHaveLength(256)
    expect(CONTROL_2.split(' ')).toHaveLength(256)
    const used = new Set(Object.values(SKASM_OPS).map((o) => o.code | ((o.sub ?? 0) << 4)))
    for (let i = 0; i < 256; i++) if (!used.has(i)) expect([rom1[i], rom2[i]], `row ${i}`).toEqual([0, 0])
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
      m.sim.setParams(prog, { ...base, source, data: programWords(source) } as never)
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
