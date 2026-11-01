import { describe, expect, it } from 'vitest'
import { aciaType } from './testdata/oracle/acia'
import { terminalInit, type TerminalState } from './components/terminal'
import { getDef } from './testdata/oracle/registry'
import { X, paramDefaults, type V } from './types'

const def = getDef('acia6551')
const layout = def.layout(paramDefaults(def))
const inNames = layout.pins.filter((p) => p.dir === 'in').map((p) => p.name)
const outNames = layout.pins.filter((p) => p.dir === 'out').map((p) => p.name)

/** The registers, as RS1 RS0. */
const DATA = 0
const STATUS = 1
const COMMAND = 2

/** A terminal chip wired like on a board: the pins are set by name, and a bus cycle is Φ2 low, then high. */
function chip() {
  const inst = { ins: [] as V[], outs: outNames.map(() => X) as V[], state: terminalInit() as TerminalState, params: paramDefaults(def) }
  const set = (given: Record<string, number>): V[] => {
    inst.ins = inNames.map((n) => (given[n] ?? (n === 'RESB' ? 1 : n === 'RWB' ? 1 : n === 'CS1B' ? 1 : 0)) as V)
    def.evaluate(inst)
    return [...inst.outs]
  }
  const value = () => outNames.slice(0, 8).reduce((a, _, i) => a | (inst.outs[i] << i), 0)
  /** One cycle of the CPU talking to the chip: the pins steady while Φ2 is low, the chip works at the rising edge. Returns what D shows. */
  const cycle = (rs: number, rw: 'read' | 'write', data = 0, extra: Record<string, number> = {}) => {
    const pins: Record<string, number> = { CS0: 1, CS1B: 0, RS0: rs & 1, RS1: rs >> 1, RWB: rw === 'read' ? 1 : 0, ...extra }
    for (let i = 0; i < 8; i++) pins[`DI${i}`] = (data >> i) & 1
    set({ ...pins, PHI2: 0 })
    set({ ...pins, PHI2: 1 })
    return value()
  }
  const irq = () => inst.outs[outNames.indexOf('IRQB')]
  return { inst, set, cycle, value, irq, st: inst.state }
}

describe('the 6551 terminal part', () => {
  it('has the pins of the chip: Φ2, RES, two selects, two register selects, R/W, eight in, DSR; eight out and IRQ', () => {
    expect(inNames).toEqual(['PHI2', 'RESB', 'CS0', 'CS1B', 'RS0', 'RS1', 'RWB', ...Array.from({ length: 8 }, (_, i) => `DI${i}`), 'DSRB'])
    expect(outNames).toEqual([...Array.from({ length: 8 }, (_, i) => `D${i}`), 'IRQB'])
  })

  it('prints what is written to the data register, at the rising edge of Φ2 and only then', () => {
    const c = chip()
    const pins = { CS0: 1, CS1B: 0, RS0: 0, RS1: 0, RWB: 0, DI0: 1, DI6: 1 } // 'A' = $41
    c.set({ ...pins, PHI2: 0 })
    expect(c.st.lines).toEqual([''])
    c.set({ ...pins, PHI2: 1 })
    c.set({ ...pins, PHI2: 1 }) // held high: still one character
    expect(c.st.lines).toEqual(['A'])
    c.cycle(DATA, 'write', 0x42)
    c.cycle(DATA, 'write', 0x0d)
    c.cycle(DATA, 'write', 0x0a)
    expect(c.st.lines).toEqual(['AB', ''])
  })

  it('reads the status register: the transmitter is always ready, and the DSR pin shows in bit 6', () => {
    const c = chip()
    expect(c.cycle(STATUS, 'read')).toBe(0x10)
    expect(c.cycle(STATUS, 'read', 0, { DSRB: 1 })).toBe(0x50)
  })

  it('keeps what is typed until command bit 0 switches the receiver on, then hands over one character at a time', () => {
    const c = chip()
    aciaType(c.st, 'hi')
    c.cycle(STATUS, 'read')
    expect(c.cycle(STATUS, 'read') & 8).toBe(0) // typed, but the receiver is off
    c.cycle(COMMAND, 'write', 0x03) // receiver on, receive interrupt off
    c.cycle(STATUS, 'read') // (a character arrives at the end of the cycle)
    expect(c.cycle(STATUS, 'read') & 8).toBe(8)
    expect(c.cycle(DATA, 'read')).toBe(0x48) // capitals: 'H'
    expect(c.cycle(STATUS, 'read') & 8).toBe(8) // reading cleared it, and the next one moved in at the same edge: no character is lost
    expect(c.cycle(DATA, 'read')).toBe(0x49)
    expect(c.cycle(STATUS, 'read') & 8).toBe(0) // nothing left
  })

  it('pulls IRQ low when a character arrives with the interrupt on, and lets go when the status is read (which still shows bit 7)', () => {
    const c = chip()
    c.cycle(COMMAND, 'write', 0x01) // receiver on, receive interrupt on
    expect(c.irq()).toBe(1)
    aciaType(c.st, 'x')
    c.cycle(STATUS, 'read') // the character arrives; the status read of this cycle does not see it yet
    expect(c.irq()).toBe(0)
    const status = c.cycle(STATUS, 'read')
    expect(status & 0x80).toBe(0x80) // what the CPU reads still has the bit, although the read cleared it
    expect(c.irq()).toBe(1)
    expect(c.cycle(STATUS, 'read') & 0x80).toBe(0)
  })

  it('does not interrupt with the receive interrupt off', () => {
    const c = chip()
    c.cycle(COMMAND, 'write', 0x03)
    aciaType(c.st, 'x')
    c.cycle(STATUS, 'read')
    expect(c.irq()).toBe(1)
  })

  it('answers only while CS0 = 1 and CS1 = 0, and shows 0 on D otherwise', () => {
    const c = chip()
    c.cycle(COMMAND, 'write', 0x0b)
    expect(c.cycle(COMMAND, 'read')).toBe(0x0b)
    expect(c.cycle(COMMAND, 'read', 0, { CS0: 0 })).toBe(0)
    expect(c.cycle(COMMAND, 'read', 0, { CS1B: 1 })).toBe(0)
    c.cycle(DATA, 'write', 0x5a, { CS0: 0 })
    c.cycle(DATA, 'write', 0x5a, { CS1B: 1 })
    expect(c.st.lines).toEqual([''])
  })

  it('never shows an unknown value, and does nothing when a pin it needs is unknown', () => {
    const c = chip()
    c.cycle(COMMAND, 'write', 0x0b)
    // Unknown data on a write, unknown R/W, an unknown register, an unknown select: nothing happens.
    c.set({ CS0: 1, CS1B: 0, RS0: 0, RS1: 0, RWB: 0, DI0: X, PHI2: 0 })
    c.set({ CS0: 1, CS1B: 0, RS0: 0, RS1: 0, RWB: 0, DI0: X, PHI2: 1 })
    c.set({ CS0: 1, CS1B: 0, RS0: 0, RS1: 0, RWB: X, PHI2: 0 })
    c.set({ CS0: 1, CS1B: 0, RS0: 0, RS1: 0, RWB: X, PHI2: 1 })
    c.set({ CS0: 1, CS1B: 0, RS0: X, RS1: 0, RWB: 0, PHI2: 0 })
    c.set({ CS0: 1, CS1B: 0, RS0: X, RS1: 0, RWB: 0, PHI2: 1 })
    c.set({ CS0: X, CS1B: 0, RS0: 0, RS1: 0, RWB: 0, DI0: 1, PHI2: 0 })
    c.set({ CS0: X, CS1B: 0, RS0: 0, RS1: 0, RWB: 0, DI0: 1, PHI2: 1 })
    expect(c.st.lines).toEqual([''])
    expect(c.inst.outs.includes(X)).toBe(false)
  })

  it('clears the registers while RES is low, and by default the screen and the keyboard buffer too', () => {
    const c = chip()
    c.cycle(COMMAND, 'write', 0x0b)
    c.cycle(DATA, 'write', 0x48)
    c.cycle(DATA, 'write', 0x0d)
    c.cycle(DATA, 'write', 0x0a)
    aciaType(c.st, 'ab')
    c.set({ RESB: 0, PHI2: 0 })
    expect(c.st.command).toBe(0)
    expect(c.st.lines).toEqual([''])
    expect(c.st.col).toBe(0)
    expect(c.st.keys.length - c.st.next).toBe(0)
    const rev = c.st.rev
    c.set({ RESB: 0, PHI2: 1 })
    c.set({ RESB: 0, PHI2: 0 })
    expect(c.st.rev).toBe(rev) // holding the button does not keep changing the screen
    c.cycle(DATA, 'write', 0x48) // and it works again afterwards
    expect(c.st.lines).toEqual(['H'])
  })

  it('keeps the screen and the keyboard buffer in reset when the setting is off', () => {
    const c = chip()
    c.inst.params = { ...c.inst.params, resetClears: false }
    c.cycle(COMMAND, 'write', 0x0b)
    c.cycle(DATA, 'write', 0x48)
    aciaType(c.st, 'ab')
    c.set({ RESB: 0, PHI2: 0 })
    expect(c.st.command).toBe(0)
    expect(c.st.lines).toEqual(['H'])
    expect(c.st.keys.length - c.st.next).toBe(2)
    expect(c.cycle(COMMAND, 'read', 0, { RESB: 0 })).toBe(0) // nothing is read in reset
    expect(c.irq()).toBe(1)
  })

  it('takes a write to the status register as the programmed reset: command bits 0 to 4 clear', () => {
    const c = chip()
    c.cycle(COMMAND, 'write', 0xeb)
    c.cycle(STATUS, 'write', 0)
    expect(c.cycle(COMMAND, 'read')).toBe(0xe0)
  })

  it('keeps the control register, and reads it back', () => {
    const c = chip()
    c.cycle(3, 'write', 0x1f)
    expect(c.cycle(3, 'read')).toBe(0x1f)
  })

  it('is a part with Capitals on by default, a revision that follows the screen, and a copy that a later print does not change', () => {
    expect(paramDefaults(def).capitals).toBe(true)
    const c = chip()
    const rev = def.revision!(c.inst)
    c.cycle(DATA, 'write', 0x41)
    expect(def.revision!(c.inst)).toBeGreaterThan(rev)
    const copy = structuredClone(c.st)
    c.cycle(DATA, 'write', 0x42)
    expect(copy.lines).toEqual(['A'])
  })
})
