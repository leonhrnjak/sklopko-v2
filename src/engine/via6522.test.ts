import { describe, expect, it } from 'vitest'
import { CA1, CA2, CB1, CB2, T1, T2, viaClock, viaEdges, viaInit, viaIrq, viaPortOut, viaRead, viaReset, viaWrite, type ViaState } from './testdata/oracle/via6522'

const ORB = 0, ORA = 1, DDRB = 2, DDRA = 3, T1CL = 4, T1CH = 5, T1LL = 6, T1LH = 7, T2CL = 8, T2CH = 9, ACR = 11, PCR = 12, IFR = 13, IER = 14, ORA_NH = 15
const pins = { pa: 0, pb: 0 }
const clocks = (st: ViaState, n: number, pb6 = 1) => {
  for (let i = 0; i < n; i++) viaClock(st, pb6)
}

describe('the ports', () => {
  it('drive their pins from the output register where the direction register says output, and let go of the others', () => {
    const st = viaInit()
    viaWrite(st, ORA, 0xa5)
    expect(viaPortOut(st).paOe).toBe(0) // after a reset every pin is an input
    viaWrite(st, DDRA, 0x0f)
    expect(viaPortOut(st)).toMatchObject({ pa: 0xa5, paOe: 0x0f })
    viaWrite(st, DDRB, 0xff)
    viaWrite(st, ORB, 0x3c)
    expect(viaPortOut(st)).toMatchObject({ pb: 0x3c, pbOe: 0xff })
    expect(viaRead(st, DDRA, pins)).toBe(0x0f)
    expect(viaRead(st, DDRB, pins)).toBe(0xff)
  })

  it('read port B as its output register for the output bits and the pins for the others, and port A as the pins', () => {
    const st = viaInit()
    viaWrite(st, DDRB, 0xf0)
    viaWrite(st, ORB, 0xa0)
    expect(viaRead(st, ORB, { pa: 0, pb: 0x05 })).toBe(0xa5) // the low nibble is read from the pins, the high one from ORB
    viaWrite(st, DDRA, 0xff)
    viaWrite(st, ORA, 0x11)
    expect(viaRead(st, ORA, { pa: 0x77, pb: 0 })).toBe(0x77) // port A shows the pins
    expect(viaRead(st, ORA_NH, { pa: 0x78, pb: 0 })).toBe(0x78)
  })
})

describe('timer 1', () => {
  it('one-shot: loaded by writing the high byte, it sets its flag N + 1 cycles later, once, and reading the low byte clears it', () => {
    const st = viaInit()
    viaWrite(st, T1CL, 5)
    viaWrite(st, T1CH, 0)
    clocks(st, 5)
    expect(st.ifr & T1).toBe(0)
    clocks(st, 1)
    expect(st.ifr & T1).toBe(T1)
    expect(viaRead(st, T1CL, pins)).toBe(0xff) // it went on counting, past 0: $FFFF
    expect(st.ifr & T1).toBe(0)
    clocks(st, 0x10000)
    expect(st.ifr & T1).toBe(0) // a one-shot does not come round again
  })

  it('free-running: every N + 2 cycles, from the latch', () => {
    const st = viaInit()
    viaWrite(st, ACR, 0x40)
    viaWrite(st, T1CL, 5)
    viaWrite(st, T1CH, 0)
    const at: number[] = []
    for (let n = 1; n <= 30; n++) {
      viaClock(st, 1)
      if (st.ifr & T1) {
        at.push(n)
        viaRead(st, T1CL, pins)
      }
    }
    expect(at).toEqual([6, 13, 20, 27])
  })

  it('writing the high byte of the latch changes the next reload and clears the flag; writing the high byte of the counter restarts', () => {
    const st = viaInit()
    viaWrite(st, ACR, 0x40)
    viaWrite(st, T1LL, 2)
    viaWrite(st, T1LH, 0)
    viaWrite(st, T1CH, 0)
    clocks(st, 3)
    expect(st.ifr & T1).toBe(T1)
    viaWrite(st, T1LH, 0) // clears the flag
    expect(st.ifr & T1).toBe(0)
    expect(viaRead(st, T1LL, pins)).toBe(2)
    expect(viaRead(st, T1LH, pins)).toBe(0)
  })

  it('puts a pulse (one-shot) or a square wave (free-running) on PB7 when ACR bit 7 is set, and PB7 is then an output', () => {
    const st = viaInit()
    viaWrite(st, ACR, 0x80)
    viaWrite(st, T1CL, 3)
    viaWrite(st, T1CH, 0)
    expect(viaPortOut(st)).toMatchObject({ pbOe: 0x80, pb: 0x00 }) // low from the write
    clocks(st, 4)
    expect(viaPortOut(st).pb).toBe(0x80) // and high at the timeout
    const free = viaInit()
    viaWrite(free, ACR, 0xc0)
    viaWrite(free, T1CL, 1)
    viaWrite(free, T1CH, 0)
    const levels: number[] = []
    for (let n = 0; n < 12; n++) {
      viaClock(free, 1)
      levels.push(viaPortOut(free).pb >> 7)
    }
    expect(new Set(levels)).toEqual(new Set([0, 1]))
    // It toggles every N + 2 = 3 cycles.
    const changes = levels.map((v, i) => (i && v !== levels[i - 1] ? i : -1)).filter((i) => i >= 0)
    expect(changes.map((v, i) => (i ? v - changes[i - 1] : 3))).toEqual(changes.map(() => 3))
  })
})

describe('timer 2', () => {
  it('one-shot: loaded by writing the high byte (the low byte waits in a latch), flag N + 1 cycles later, once', () => {
    const st = viaInit()
    viaWrite(st, T2CL, 0x02)
    viaWrite(st, T2CH, 0x01) // 258
    clocks(st, 258)
    expect(st.ifr & T2).toBe(0)
    clocks(st, 1)
    expect(st.ifr & T2).toBe(T2)
    viaRead(st, T2CL, pins)
    expect(st.ifr & T2).toBe(0)
    clocks(st, 0x10000)
    expect(st.ifr & T2).toBe(0)
  })

  it('counts the falling edges of PB6 instead of cycles when ACR bit 5 is set', () => {
    const st = viaInit()
    viaWrite(st, ACR, 0x20)
    viaWrite(st, T2CL, 2)
    viaWrite(st, T2CH, 0)
    clocks(st, 10, 1) // cycles with PB6 steady: nothing counts
    expect(st.ifr & T2).toBe(0)
    for (let pulse = 0; pulse < 3; pulse++) {
      viaClock(st, 0)
      viaClock(st, 1)
    }
    expect(st.ifr & T2).toBe(T2) // 2, 1, 0 and then past it: the third falling edge
  })
})

describe('the interrupt flags and enables', () => {
  it('IER: bit 7 says whether the written bits are set or cleared, and reads back with bit 7 set', () => {
    const st = viaInit()
    viaWrite(st, IER, 0xc0)
    expect(viaRead(st, IER, pins)).toBe(0xc0)
    viaWrite(st, IER, 0x82)
    expect(viaRead(st, IER, pins)).toBe(0xc2)
    viaWrite(st, IER, 0x40)
    expect(viaRead(st, IER, pins)).toBe(0x82)
  })

  it('IFR: bit 7 is set while an enabled flag is, and writing 1s clears flags', () => {
    const st = viaInit()
    viaWrite(st, T1CL, 0)
    viaWrite(st, T1CH, 0)
    clocks(st, 2)
    expect(viaRead(st, IFR, pins)).toBe(0x40) // set, but not enabled
    expect(viaIrq(st)).toBe(false)
    viaWrite(st, IER, 0xc0)
    expect(viaRead(st, IFR, pins)).toBe(0xc0)
    expect(viaIrq(st)).toBe(true)
    viaWrite(st, IFR, 0x40)
    expect(viaRead(st, IFR, pins)).toBe(0)
    expect(viaIrq(st)).toBe(false)
  })

  it('a reset clears the ports, the enables, the flags and the control registers, and keeps the counters', () => {
    const st = viaInit()
    viaWrite(st, DDRA, 0xff)
    viaWrite(st, ACR, 0xc0)
    viaWrite(st, IER, 0xff)
    viaWrite(st, T1CL, 9)
    viaWrite(st, T1CH, 0)
    clocks(st, 20)
    viaReset(st)
    expect([st.ddra, st.acr, st.ier, st.ifr]).toEqual([0, 0, 0, 0])
    expect(viaPortOut(st)).toMatchObject({ paOe: 0, pbOe: 0 })
    expect(st.t1l).toBe(9)
  })
})

describe('the control pins', () => {
  const edge = (st: ViaState, ca1: number, ca2 = 1, cb1 = 1, cb2 = 1) => viaEdges(st, ca1, ca2, cb1, cb2, pins)

  it('CA1 sets its flag at the falling edge by default, at the rising edge when PCR bit 0 is set; reading port A clears it', () => {
    const st = viaInit()
    edge(st, 1)
    edge(st, 0)
    expect(st.ifr & CA1).toBe(CA1)
    viaRead(st, ORA, pins)
    expect(st.ifr & CA1).toBe(0)
    viaWrite(st, PCR, 0x01)
    edge(st, 1)
    expect(st.ifr & CA1).toBe(CA1)
    viaRead(st, ORA_NH, pins) // without handshake: the flag stays
    expect(st.ifr & CA1).toBe(CA1)
    edge(st, 0)
    expect(st.ifr & CA1).toBe(CA1)
  })

  it('CB1 and CB2 work the same way for port B', () => {
    const st = viaInit()
    viaWrite(st, PCR, 0x40) // CB2: rising edge input
    edge(st, 1, 1, 1, 0)
    edge(st, 1, 1, 0, 1)
    expect(st.ifr & (CB1 | CB2)).toBe(CB1 | CB2)
    viaRead(st, ORB, pins)
    expect(st.ifr & (CB1 | CB2)).toBe(0)
  })

  it('an unknown level is never an edge', () => {
    const st = viaInit()
    edge(st, -1)
    edge(st, 0)
    edge(st, -1)
    edge(st, 1)
    expect(st.ifr).toBe(0)
  })

  it('CA2 as an independent input is not cleared by reading the port', () => {
    const st = viaInit()
    viaWrite(st, PCR, 0x02) // 001: falling edge, independent
    edge(st, 1, 1)
    edge(st, 1, 0)
    expect(st.ifr & CA2).toBe(CA2)
    viaRead(st, ORA, pins)
    expect(st.ifr & CA2).toBe(CA2)
    viaWrite(st, IFR, CA2)
    expect(st.ifr & CA2).toBe(0)
  })

  it('CA2 outputs: a fixed low or high, a handshake that ends at CA1, and a one-cycle pulse', () => {
    const st = viaInit()
    viaWrite(st, PCR, 0x0c) // 110: low
    expect(st.ca2out).toBe(0)
    viaWrite(st, PCR, 0x0e) // 111: high
    expect(st.ca2out).toBe(1)
    viaWrite(st, PCR, 0x08) // 100: handshake
    viaRead(st, ORA, pins)
    expect(st.ca2out).toBe(0)
    edge(st, 1)
    edge(st, 0) // the active edge of CA1 ends it
    expect(st.ca2out).toBe(1)
    viaWrite(st, PCR, 0x0a) // 101: pulse
    viaWrite(st, ORA, 0)
    expect(st.ca2out).toBe(0)
    clocks(st, 1)
    expect(st.ca2out).toBe(1)
  })

  it('latches port A at the active edge of CA1 when ACR bit 0 is set', () => {
    const st = viaInit()
    viaWrite(st, ACR, 0x01)
    viaEdges(st, 1, 1, 1, 1, { pa: 0x12, pb: 0 })
    viaEdges(st, 0, 1, 1, 1, { pa: 0x34, pb: 0 })
    expect(viaRead(st, ORA, { pa: 0x56, pb: 0 })).toBe(0x34)
  })
})
