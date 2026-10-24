import { describe, expect, it } from 'vitest'
import { SKASM, assemble } from '../engine/isa'
import { newMachine, step as referenceStep } from '../engine/skasm-ref'
import { Simulator } from '../engine/simulator'
import { simComps } from './circuit'
import { BEGINNER_CONTROL, BEGINNER_SOURCE, beginnerBuilder, beginnerComputer, beginnerWords } from './beginner'
import { EXAMPLES } from './examples'
import { BEGINNER_ROWS, BEGINNER_SIGNALS, SIGNAL_PRESETS, presetParams } from '../engine/signal-presets'
import { describeWord, parseRows, parseSignals } from '../engine/signals'

/** The circuit, without routing the wires (the simulator does not need them), running a program. */
function machine(source: string) {
  const { b, keys } = beginnerBuilder(source)
  const sim = new Simulator()
  sim.load({ comps: simComps(b.c), wires: Object.values(b.c.wires).map(({ from, to }) => ({ from, to })) })
  sim.settle()
  const nibble = (id: string, pins: string[]) => pins.reduce((n, pin, i) => n | (sim.pinValue(keys[id] ?? id, pin) << i), 0)
  const cycle = () => {
    sim.stepClock()
    sim.stepClock()
  }
  return {
    sim,
    cycle,
    run(n: number) {
      for (let i = 0; i < n; i++) cycle()
    },
    pc: () => nibble('pc', ['Q0', 'Q1', 'Q2', 'Q3']),
    acc: () => nibble('acc', ['QA', 'QB', 'QC', 'QD']),
    carry: () => sim.pinValue(keys.flag, 'QA'),
    halted: () => sim.pinValue(keys.halted, 'A'),
    ram: () => Array.from(sim.state(keys.ram).mem as ArrayLike<number>),
  }
}

describe('beginner computer', () => {
  it('runs its program: 3 + 4 = 7 in the ACC and in RAM, then stops', () => {
    const m = machine(BEGINNER_SOURCE)
    m.run(6)
    expect(m.acc()).toBe(7)
    expect(m.ram().slice(0, 2)).toEqual([3, 7])
    expect(m.halted()).toBe(1)
    expect(m.pc()).toBe(5) // stays on HALT
    m.run(5)
    expect(m.pc()).toBe(5)
    expect(m.acc()).toBe(7)
  })

  it('goes through the program one instruction per clock cycle', () => {
    const m = machine(BEGINNER_SOURCE)
    const seen: string[] = []
    for (let i = 0; i < 6; i++) {
      seen.push(`${m.pc()}:${m.acc()}`)
      m.cycle()
    }
    expect(seen).toEqual(['0:0', '1:3', '2:3', '3:4', '4:7', '5:7'])
  })

  it('ADD overflows past 15 into the carry, SUB wraps round below 0', () => {
    const add = machine('LDI 9\nSTA 0\nLDI 12\nADD 0')
    add.run(4)
    expect([add.acc(), add.carry()]).toEqual([5, 1]) // 21 = 16 + 5
    const sub = machine('LDI 5\nSTA 0\nLDI 3\nSUB 0')
    sub.run(4)
    expect(sub.acc()).toBe(14) // 3 - 5 = -2, which is 14 in 4 bits
    expect(sub.carry()).toBe(1) // it borrowed
    const exact = machine('LDI 5\nSTA 0\nLDI 9\nSUB 0')
    exact.run(4)
    expect([exact.acc(), exact.carry()]).toEqual([4, 0])
    const kept = machine('LDI 9\nSTA 0\nLDI 12\nADD 0\nLDI 1\nSTA 1')
    kept.run(6)
    expect(kept.carry()).toBe(1) // LDI and STA leave the flag alone
  })

  it('JMP loops back, and the program counter wraps after 15', () => {
    const loop = machine('LDI 1\nloop: ADD 0\nSTA 0\nJMP loop')
    loop.run(1)
    loop.run(3 * 4)
    expect(loop.pc()).toBeGreaterThanOrEqual(1)
    const wrap = machine(Array.from({ length: 16 }, () => 'LDI 2').join('\n'))
    wrap.run(16)
    expect(wrap.pc()).toBe(0)
  })

  it('a number in an instruction is its low 4 bits, and instructions it does not have do nothing', () => {
    const m = machine('LDI 0x1F\nADDI 5\nJZ 0\nSHL')
    m.run(1)
    expect(m.acc()).toBe(15)
    m.run(3)
    expect(m.acc()).toBe(15) // ADDI, JZ and SHL are not built in
    expect(m.pc()).toBe(4)
  })

  it('the control ROM has a row for each of its seven instructions and nothing else', () => {
    const words = BEGINNER_CONTROL.split(' ')
    expect(words).toHaveLength(16)
    expect(words.map((w, i) => (w === '00' ? null : i)).filter((i) => i !== null)).toEqual([0, 1, 2, 3, 4, 5, 7])
    expect(words.slice(4, 6)).toEqual(['83', '93']) // ADD and SUB also remember the carry
  })

  it('the control ROM names its bits and its rows, and says what each instruction does', () => {
    const { layout, errors } = parseSignals(BEGINNER_SIGNALS)
    const rows = parseRows(BEGINNER_ROWS)
    expect([errors, rows.errors]).toEqual([[], []])
    expect(layout.bits).toBe(8)
    const words = BEGINNER_CONTROL.split(' ').map((w) => parseInt(w, 16))
    const say = (name: string) => describeWord(layout, words[rows.rows.addresses[name]])
    expect(Object.keys(rows.rows.addresses)).toEqual(['LDI', 'LDA', 'STA', 'JMP', 'ADD', 'SUB', 'HALT'])
    expect(['LDI', 'LDA', 'STA', 'JMP', 'ADD', 'SUB', 'HALT'].map(say)).toEqual([
      'LOAD_ACC, ACC_SRC=NUM',
      'LOAD_ACC, ACC_SRC=RAM',
      'WRITE_RAM',
      'JUMP',
      'LOAD_ACC, ACC_SRC=ADDER, SAVE_CARRY',
      'LOAD_ACC, ACC_SRC=ADDER, SUBTRACT, SAVE_CARRY',
      'HALT',
    ])
  })

  it('the ready-made Beginner control ROM is the one the computer builds with', () => {
    expect(presetParams(SIGNAL_PRESETS.find((x) => x.id === 'beginner')!).data).toBe(BEGINNER_CONTROL)
  })

  it('the names are on the bits the circuit wires up: each signal leaves the control ROM from its pin', () => {
    const { b, keys } = beginnerBuilder()
    const { layout } = parseSignals(BEGINNER_SIGNALS)
    const bit = (name: string) => layout.signals.find((s) => s.name === name)!.from
    const sent = new Map<string, number>()
    for (const w of Object.values(b.c.wires)) {
      const to = b.c.comps[w.to.comp]
      if (w.from.comp === keys.ctl && to.type === 'netsend') sent.set(String(to.params.name), Number(w.from.pin.slice(1)))
    }
    expect(Object.fromEntries(sent)).toMatchObject({
      LOAD_ACC: bit('LOAD_ACC'),
      ACC_SRC0: bit('ACC_SRC'),
      ACC_SRC1: bit('ACC_SRC') + 1,
      WRITE_RAM: bit('WRITE_RAM'),
      SUBTRACT: bit('SUBTRACT'),
      JUMP: bit('JUMP'),
      SAVE_CARRY: bit('SAVE_CARRY'),
    })
    expect(bit('HALT')).toBe(6) // wired to the halt LED, the breakpoint and the PC's enable
  })

  it('its words are the same SKASM words as on every other computer', () => {
    const r = assemble(SKASM, BEGINNER_SOURCE, 16)
    expect(r.errors).toEqual([])
    expect(beginnerWords(BEGINNER_SOURCE).split(' ').slice(0, 6)).toEqual(['0300', '0020', '0400', '0040', '0021', '0070'].map((w, i) => (i === 1 ? '0020' : w)).map((w, i) => (i === 4 ? '0021' : w)))
    expect(() => beginnerWords('MULTIPLY 3')).toThrow(/does not assemble/)
  })
})

describe('beginner computer: random programs against the reference interpreter (numbers masked to 4 bits)', () => {
  const random = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let seed = 1; seed <= 15; seed++)
    it(`seed ${seed}`, () => {
      const rnd = random(seed)
      const lines = Array.from({ length: 16 }, () => {
        const pick = ['LDI', 'LDA', 'STA', 'ADD', 'SUB', 'JMP', 'HALT'][Math.floor(rnd() * 7)]
        if (pick === 'HALT') return rnd() < 0.7 ? 'LDI 1' : 'HALT'
        return `${pick} ${pick === 'LDI' ? Math.floor(rnd() * 16) : Math.floor(rnd() * 16)}`
      })
      const source = lines.join('\n')
      const words = assemble(SKASM, source, 16).words
      const program = Array.from({ length: 256 }, (_, i) => words[i & 15]) // the 4-bit counter wraps round
      const m = machine(source)
      const ref = newMachine()
      for (let i = 0; i < 80; i++) {
        m.cycle()
        referenceStep(ref, program)
        ref.acc &= 15
        ref.ram = ref.ram.map((v) => v & 15)
        const got = `${m.pc()} ${m.acc()} ${m.ram().join(',')}`
        const want = `${ref.pc & 15} ${ref.acc} ${ref.ram.slice(0, 16).join(',')}`
        expect(got, `${source}\ncycle ${i + 1}`).toBe(want)
      }
    })
})

describe('beginner computer: the example', () => {
  const c = beginnerComputer()
  const byLabel = (label: string) => Object.values(c.comps).find((k) => k.label === label)
  it('is in the examples list, near the top', () => {
    expect(EXAMPLES.findIndex((e) => e.id === 'beginner')).toBeLessThan(3)
  })
  it('names its parts, and has a frame and a note for each of the three steps', () => {
    for (const label of ['Program ROM', 'Control ROM', 'RAM: data', 'Adder', 'ACC: the accumulator', 'PC: the next instruction', 'Clock'])
      expect(byLabel(label), label).toBeDefined()
    const frames = Object.values(c.comps).filter((k) => k.type === 'frame').map((k) => String(k.params.title))
    expect(frames.map((t) => t.slice(0, 2))).toEqual(['1.', '2.', '3.'])
    const notes = Object.values(c.comps).filter((k) => k.type === 'note').map((k) => String(k.params.text))
    expect(notes).toHaveLength(4)
    expect(notes.some((t) => t.startsWith('1. FETCH'))).toBe(true)
    expect(notes.some((t) => t.startsWith('2. DECODE'))).toBe(true)
    expect(notes.some((t) => t.startsWith('3. EXECUTE'))).toBe(true)
  })
  it('is small enough to read: under 50 parts apart from notes, frames and labels', () => {
    const parts = Object.values(c.comps).filter((k) => !['note', 'frame', 'netsend', 'netrecv'].includes(k.type))
    expect(parts.length).toBeLessThan(50)
  })
  it('sends its control signals by name, so they do not run across the whole circuit', () => {
    const sends = Object.values(c.comps).filter((k) => k.type === 'netsend').map((k) => String(k.params.name))
    for (const name of ['LOAD_ACC', 'WRITE_RAM', 'SUBTRACT', 'SAVE_CARRY', 'JUMP', 'ACC_SRC0', 'ACC_SRC1']) expect(sends, name).toContain(name)
  })
  it('holds its program in a ROM that SKASM can edit', () => {
    expect(byLabel('Program ROM')!.params).toMatchObject({ isa: 'skasm', abits: 4, dbits: 16, source: BEGINNER_SOURCE })
  })
})
