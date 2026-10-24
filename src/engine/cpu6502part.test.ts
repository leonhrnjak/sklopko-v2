import { describe, expect, it } from 'vitest'
import type { CpuState } from './components/cpu'
import { getDef } from './registry'
import { Simulator, type SimCircuit } from './simulator'
import { Z, paramDefaults, toNum, type Params } from './types'
import { viewLayoutOf } from './viewlayout'

/** Tiny builder: `wire('a.Q', 'b.A')` connects output Q of a to input A of b. */
function build(comps: Record<string, string | [string, Params]>, wires: [string, string][]): SimCircuit {
  return {
    comps: Object.entries(comps).map(([id, t]) => {
      const [type, params] = typeof t === 'string' ? [t, {}] : t
      return { id, type, params: { ...paramDefaults(getDef(type)), ...params } }
    }),
    wires: wires.map(([f, t]) => {
      const [fc, fp] = f.split('.')
      const [tc, tp] = t.split('.')
      return { from: { comp: fc, pin: fp }, to: { comp: tc, pin: tp } }
    }),
  }
}

/** A 256-byte ROM image as hex text, with `bytes` from 0 and `vectors` at their addresses (low 8 bits). */
function image(bytes: number[], vectors: Record<number, number> = {}) {
  const m = new Array<number>(256).fill(0)
  bytes.forEach((b, i) => (m[i] = b))
  // $FFFC → rom[0xFC] (reset), $FFFE → rom[0xFE] (IRQ), $FFFA → rom[0xFA] (NMI): all the CPU sees of a 256-byte ROM.
  for (const [a, target] of Object.entries(vectors)) {
    m[+a & 255] = target & 255
    m[(+a & 255) + 1] = target >> 8
  }
  return m.map((b) => b.toString(16).padStart(2, '0')).join(' ')
}

interface Options {
  cpu?: Params
  rom?: string
  /** Pins driven by a switch (so a test can change them); others are left open (pulled high). */
  switches?: string[]
  dataFromRom?: boolean
}

/** A 6502 with a clock, and (unless `dataFromRom` is false) a 256-byte ROM wired to the low address bits and to DI. */
function rig(o: Options = {}) {
  const comps: Record<string, string | [string, Params]> = {
    clk: ['clock', { hz: 100 }],
    cpu: ['cpu6502', { bus: false, ...o.cpu }],
  }
  const wires: [string, string][] = [['clk.Q', 'cpu.PHI2']]
  for (const pin of o.switches ?? []) {
    comps[`sw${pin}`] = ['switch', { on: true }]
    wires.push([`sw${pin}.Q`, `cpu.${pin}`])
  }
  if (o.dataFromRom !== false) {
    comps.rom = ['rom', { abits: 8, dbits: 8, data: o.rom ?? image(new Array(256).fill(0xea)) }]
    for (let i = 0; i < 8; i++) {
      wires.push([`cpu.A${i}`, `rom.A${i}`])
      wires.push([`rom.D${i}`, `cpu.DI${i}`])
    }
  }
  const sim = new Simulator()
  sim.load(build(comps, wires))
  sim.settle()
  const cycle = () => {
    sim.stepClock()
    sim.stepClock()
  }
  const state = () => sim.state('cpu') as CpuState
  const bits = (prefix: string, n: number) => toNum(Array.from({ length: n }, (_, i) => sim.pinValue('cpu', `${prefix}${i}`)), 0, n)
  const set = (pin: string, on: boolean) => {
    sim.setParams(`sw${pin}`, { on })
    sim.settle()
  }
  return { sim, cycle, state, bits, set }
}

describe('the 6502 part', () => {
  it('RDY low holds a read cycle, and the CPU carries on when it goes high', () => {
    const r = rig({ switches: ['RDY'] })
    for (let i = 0; i < 12; i++) r.cycle()
    const before = r.state().cpu.cycles
    expect(before).toBeGreaterThan(8)
    r.set('RDY', false)
    for (let i = 0; i < 10; i++) r.cycle()
    // It may finish a write cycle before it stops, but this program (NOPs) only reads: it stops at once.
    expect(r.state().cpu.cycles).toBeLessThanOrEqual(before + 1)
    const held = r.state().cpu.cycles
    for (let i = 0; i < 5; i++) r.cycle()
    expect(r.state().cpu.cycles).toBe(held)
    expect(r.state().stalled).toBe(true)
    r.set('RDY', true)
    for (let i = 0; i < 5; i++) r.cycle()
    expect(r.state().cpu.cycles).toBe(held + 5)
  })

  it('with a tri-state data bus the data pins float while it reads and carry the byte while it writes', () => {
    // LDA #$A5; STA $10; JMP $0000
    const r = rig({ cpu: { tristate: true }, rom: image([0xa9, 0xa5, 0x85, 0x10, 0x4c, 0x00, 0x00]) })
    const seen: { rw: number; d0: number; data: number }[] = []
    for (let i = 0; i < 20; i++) {
      seen.push({ rw: r.sim.pinValue('cpu', 'RWB'), d0: r.sim.pinValue('cpu', 'D0'), data: r.bits('D', 8) })
      r.cycle()
    }
    expect(seen.filter((s) => s.rw === 1).every((s) => s.d0 === Z)).toBe(true)
    const writes = seen.filter((s) => s.rw === 0)
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.every((s) => s.data === 0xa5)).toBe(true)
  })

  it('without the tri-state option the data pins always drive', () => {
    const r = rig()
    for (let i = 0; i < 4; i++) {
      expect(r.sim.pinValue('cpu', 'D0')).not.toBe(Z)
      r.cycle()
    }
  })

  it('waits while the data it reads is unknown, instead of running on a guess', () => {
    const r = rig({ dataFromRom: false })
    for (let i = 0; i < 6; i++) r.cycle()
    expect(r.state().waiting).toBe(true)
    expect(r.state().cpu.cycles).toBe(0)
  })

  it('without the power-up reset its pins are unknown until RES is pulled low and released', () => {
    const r = rig({ cpu: { powerOn: false }, switches: ['RESB'] })
    for (let i = 0; i < 3; i++) r.cycle()
    expect(r.sim.pinValue('cpu', 'SYNC')).toBe(2) // X
    r.set('RESB', false)
    r.cycle()
    expect(r.state().held).toBe(true)
    r.set('RESB', true)
    for (let i = 0; i < 7; i++) r.cycle()
    expect(r.sim.pinValue('cpu', 'SYNC')).toBe(1)
  })

  it('takes an IRQ (a level, active low) once I is clear, and an NMI (an edge) at any time', () => {
    // 0000: CLI; 0001: JMP $0001 (wait here).  IRQ handler at 0020: INX; RTI.  NMI handler at 0030: INY; RTI.
    const bytes = new Array(0x40).fill(0xea)
    bytes.splice(0, 4, 0x58, 0x4c, 0x01, 0x00)
    bytes.splice(0x20, 2, 0xe8, 0x40)
    bytes.splice(0x30, 2, 0xc8, 0x40)
    const r = rig({ switches: ['IRQB', 'NMIB'], rom: image(bytes, { 0xfffc: 0, 0xfffe: 0x20, 0xfffa: 0x30 }) })
    for (let i = 0; i < 20; i++) r.cycle()
    expect(r.state().cpu.x).toBe(0) // both lines idle (high)
    r.set('IRQB', false)
    for (let i = 0; i < 30; i++) r.cycle()
    expect(r.state().cpu.x).toBeGreaterThan(1) // a level: held low, it is taken again each time RTI returns (I clears)
    r.set('IRQB', true)
    const y = r.state().cpu.y
    r.set('NMIB', false)
    for (let i = 0; i < 30; i++) r.cycle()
    expect(r.state().cpu.y).toBe(y + 1) // an edge: once, though the line stays low
  })
})

describe('the 65C02 chip', () => {
  const cmos = { chip: 'cmos' }

  it('has the pins BE, VPB and MLB, which the NMOS chip does not', () => {
    const pins = (p: Params) => viewLayoutOf('cpu6502', { ...paramDefaults(getDef('cpu6502')), bus: false, ...p }).pins.map((x) => x.name)
    expect(pins(cmos)).toEqual(expect.arrayContaining(['BE', 'VPB', 'MLB']))
    expect(pins({})).not.toEqual(expect.arrayContaining(['BE']))
    expect(pins({})).not.toEqual(expect.arrayContaining(['VPB']))
  })

  it('pulls VPB low in the two cycles that read the reset vector', () => {
    const r = rig({ cpu: cmos })
    const seen: string[] = []
    for (let i = 0; i < 12; i++) {
      if (r.sim.pinValue('cpu', 'VPB') === 0) seen.push(`$${r.bits('A', 8).toString(16)}`)
      r.cycle()
    }
    expect(seen).toEqual(['$fc', '$fd'])
  })

  it('pulls MLB low during the three cycles of a read-modify-write instruction, and only then', () => {
    // INC $50; NOP; NOP...  (reads of the zero page come from the ROM, which has $EA there)
    const r = rig({ cpu: cmos, rom: image([0xe6, 0x50]) })
    const locked: number[] = []
    for (let i = 0; i < 20; i++) {
      locked.push(r.sim.pinValue('cpu', 'MLB'))
      r.cycle()
    }
    const first = locked.indexOf(0)
    expect(locked.slice(first, first + 3)).toEqual([0, 0, 0])
    expect(locked.filter((v) => v === 0)).toHaveLength(3)
  })

  it('lets go of the address bus, the data bus and R/W while BE is low', () => {
    const r = rig({ cpu: cmos, switches: ['BE'] })
    for (let i = 0; i < 12; i++) r.cycle()
    expect(r.sim.pinValue('cpu', 'A0')).not.toBe(Z)
    r.set('BE', false)
    for (const pin of ['A0', 'A7', 'A15', 'D0', 'D7', 'RWB']) expect(r.sim.pinValue('cpu', pin), pin).toBe(Z)
    r.set('BE', true)
    expect(r.sim.pinValue('cpu', 'RWB')).not.toBe(Z)
  })

  it('runs the new instructions in a circuit: INC A and BRA', () => {
    // LDA #$7F; INC A; TAX; BRA +1; INX (skipped); NOP... : X is $80
    const r = rig({ cpu: cmos, rom: image([0xa9, 0x7f, 0x1a, 0xaa, 0x80, 0x01, 0xe8]) })
    for (let i = 0; i < 30; i++) r.cycle()
    expect(r.state().cpu.x).toBe(0x80)
  })
})
