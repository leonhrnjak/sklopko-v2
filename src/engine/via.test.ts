import { describe, expect, it } from 'vitest'
import { viaPartInit, type ViaPartState } from './components/via'
import { getDef } from './testdata/oracle/registry'
import { X, Z, paramDefaults, type V } from './types'

const def = getDef('via6522')
const layout = def.layout(paramDefaults(def))
const inNames = layout.pins.filter((p) => p.dir === 'in').map((p) => p.name)
const outNames = layout.pins.filter((p) => p.dir === 'out').map((p) => p.name)

const ORB = 0, ORA = 1, DDRB = 2, DDRA = 3, T1CL = 4, T1CH = 5, ACR = 11, IFR = 13, IER = 14

/** A VIA wired like on a board: pins are set by name, and a bus cycle is Φ2 low, then high. */
function chip() {
  const inst = { ins: [] as V[], outs: outNames.map(() => X) as V[], state: viaPartInit() as ViaPartState, params: paramDefaults(def) }
  const defaults = (n: string): number => (n === 'RESB' || n === 'RWB' || n === 'CS2B' ? 1 : n.startsWith('PAIN') || n.startsWith('PBIN') || n.startsWith('CA') || n.startsWith('CB') ? X : 0)
  let held: Record<string, number> = {}
  const set = (given: Record<string, number>) => {
    held = { ...held, ...given }
    inst.ins = inNames.map((n) => (held[n] ?? defaults(n)) as V)
    def.evaluate(inst)
  }
  const out = (prefix: string) => outNames.filter((n) => n.startsWith(prefix) && /\d$/.test(n)).map((n) => inst.outs[outNames.indexOf(n)])
  const value = () => out('D').reduce<number>((a, v, i) => a | ((v as number) << i), 0)
  /** One cycle of the CPU talking to the chip. Returns what D shows. */
  const cycle = (rs: number, rw: 'read' | 'write', data = 0, extra: Record<string, number> = {}) => {
    const pins: Record<string, number> = { CS1: 1, CS2B: 0, RS0: rs & 1, RS1: (rs >> 1) & 1, RS2: (rs >> 2) & 1, RS3: (rs >> 3) & 1, RWB: rw === 'read' ? 1 : 0, ...extra }
    for (let i = 0; i < 8; i++) pins[`DI${i}`] = (data >> i) & 1
    set({ ...pins, PHI2: 0 })
    set({ ...pins, PHI2: 1 })
    const v = value()
    set({ PHI2: 0, CS1: 0, CS2B: 1, RWB: 1 }) // the CPU lets go
    return v
  }
  set({})
  return { inst, set, cycle, st: inst.state, out, irq: () => inst.outs[outNames.indexOf('IRQB')], value }
}

describe('the 6522 part', () => {
  it('has the pins of the chip: clock, reset, two selects, four register selects, R/W, data, two ports (read and driven) and the control pins', () => {
    expect(inNames.slice(0, 9)).toEqual(['PHI2', 'RESB', 'CS1', 'CS2B', 'RS0', 'RS1', 'RS2', 'RS3', 'RWB'])
    expect(inNames).toContain('PAIN0')
    expect(inNames.slice(-4)).toEqual(['CA1', 'CA2IN', 'CB1', 'CB2IN'])
    expect(outNames).toEqual([...Array.from({ length: 8 }, (_, i) => `D${i}`), ...Array.from({ length: 8 }, (_, i) => `PA${i}`), ...Array.from({ length: 8 }, (_, i) => `PB${i}`), 'CA2', 'CB2', 'IRQB'])
  })

  it('takes a write at the rising edge of Φ2 and only then, and only while it is selected', () => {
    const c = chip()
    const pins = { CS1: 1, CS2B: 0, RS0: 0, RS1: 1, RS2: 0, RS3: 0, RWB: 0, DI0: 1, DI1: 1 } // DDRB = 3
    c.set({ ...pins, PHI2: 0 })
    expect(c.st.ddrb).toBe(0)
    c.set({ ...pins, PHI2: 1 })
    expect(c.st.ddrb).toBe(3)
    c.cycle(DDRB, 'write', 0xff, { CS1: 0 }) // not selected
    expect(c.st.ddrb).toBe(3)
    c.cycle(DDRB, 'write', 0xff, { CS2B: 1 })
    expect(c.st.ddrb).toBe(3)
    c.cycle(DDRB, 'write', 0xff)
    expect(c.st.ddrb).toBe(0xff)
  })

  it('drives the pins of a port that are outputs and lets go (Z) of the others', () => {
    const c = chip()
    expect(c.out('PB').every((v) => v === Z)).toBe(true)
    c.cycle(DDRB, 'write', 0x0f)
    c.cycle(ORB, 'write', 0xa5)
    expect(c.out('PB')).toEqual([1, 0, 1, 0, Z, Z, Z, Z])
    expect(c.out('PA').every((v) => v === Z)).toBe(true)
  })

  it('reads a port as the pins show it for the inputs: what is wired to PAIN, 0 where nothing is', () => {
    const c = chip()
    c.set({ PAIN0: 1, PAIN3: 1, PAIN1: 0, PAIN2: 0, PAIN4: 0, PAIN5: 0, PAIN6: 0, PAIN7: 1 })
    expect(c.cycle(ORA, 'read')).toBe(0x89)
    c.cycle(DDRB, 'write', 0xf0)
    c.cycle(ORB, 'write', 0x50)
    c.set({ PBIN0: 1 })
    expect(c.cycle(ORB, 'read')).toBe(0x51) // the high nibble is ORB, the low one the pins (the rest unconnected: 0)
  })

  it('keeps what a read returned for D until the next edge, and shows 0 while not selected', () => {
    const c = chip()
    c.cycle(DDRA, 'write', 0x3c)
    expect(c.cycle(DDRA, 'read')).toBe(0x3c)
    expect(c.value()).toBe(0x3c) // it stays until the next edge, whatever the CPU does
    expect(c.cycle(DDRA, 'read', 0, { CS1: 0 })).toBe(0) // and at the next edge, not selected, it is 0
  })

  it('raises IRQ when an enabled timer 1 flag sets, and drops it when the flag is cleared by reading the timer', () => {
    const c = chip()
    c.cycle(IER, 'write', 0xc0)
    c.cycle(T1CL, 'write', 3)
    c.cycle(T1CH, 'write', 0)
    expect(c.irq()).toBe(1)
    for (let i = 0; i < 6; i++) c.set({ PHI2: i % 2 ? 0 : 1 }) // a few cycles: each rising edge counts one
    for (let i = 0; i < 8; i++) {
      c.set({ PHI2: 0 })
      c.set({ PHI2: 1 })
    }
    expect(c.irq()).toBe(0)
    expect(c.cycle(IFR, 'read') & 0xc0).toBe(0xc0)
    c.cycle(T1CL, 'read')
    expect(c.irq()).toBe(1)
  })

  it('puts the timer on PB7 when ACR bit 7 is set', () => {
    const c = chip()
    c.cycle(ACR, 'write', 0xc0)
    c.cycle(T1CL, 'write', 2)
    c.cycle(T1CH, 'write', 0)
    expect(c.out('PB')[7]).toBe(0)
    const seen = new Set<V>()
    for (let i = 0; i < 20; i++) {
      c.set({ PHI2: 0 })
      c.set({ PHI2: 1 })
      seen.add(c.out('PB')[7])
    }
    expect(seen).toEqual(new Set([0, 1]))
  })

  it('sees the edges of CA1 at once, not at the clock, and a control pin that is an output drives CA2', () => {
    const c = chip()
    c.set({ CA1: 1, PHI2: 0 })
    c.set({ CA1: 0 })
    expect(c.st.ifr & 2).toBe(2)
    expect(c.inst.outs[outNames.indexOf('CA2')]).toBe(Z)
    c.cycle(12, 'write', 0x0c) // PCR: CA2 low output
    expect(c.inst.outs[outNames.indexOf('CA2')]).toBe(0)
  })

  it('clears its registers while RES is low, and keeps counting its timers', () => {
    const c = chip()
    c.cycle(DDRB, 'write', 0xff)
    c.cycle(IER, 'write', 0xc0)
    c.set({ RESB: 0, PHI2: 0 })
    expect([c.st.ddrb, c.st.ier]).toEqual([0, 0])
    expect(c.out('PB').every((v) => v === Z)).toBe(true)
    expect(c.cycle(DDRB, 'read', 0, { RESB: 0 })).toBe(0) // nothing is read in reset
  })

  it('never shows an unknown on D, and an unknown select, R/W, register or data makes the edge do nothing', () => {
    const c = chip()
    c.set({ CS1: X, CS2B: 0, RS0: 0, RS1: 1, RWB: 0, DI0: 1, PHI2: 0 })
    c.set({ PHI2: 1 })
    expect(c.st.ddrb).toBe(0)
    c.set({ CS1: 1, RS0: X, PHI2: 0 })
    c.set({ PHI2: 1 })
    expect(c.st.ddrb).toBe(0)
    expect(c.inst.outs.slice(0, 8).includes(X)).toBe(false)
  })
})
