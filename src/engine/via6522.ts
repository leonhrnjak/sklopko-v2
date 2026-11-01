

export interface ViaState {
  orb: number
  ora: number
  ddrb: number
  ddra: number
  /** Timer 1: the counter, the 16-bit latch, and whether it will set its flag at the next underflow (one-shot: once). */
  t1c: number
  t1l: number
  t1armed: boolean
  /** The next clock reloads the counter from the latch (a free-running timer after an underflow). */
  t1reload: boolean
  /** The level timer 1 puts on PB7 when ACR bit 7 is set. */
  pb7: number
  /** Timer 2: the counter, the low latch byte, and whether it will set its flag. */
  t2c: number
  t2l: number
  t2armed: boolean
  sr: number
  acr: number
  pcr: number
  /** Flags, bits 0–6. */
  ifr: number
  ier: number
  /** The levels the control inputs had when they were last looked at (-1: not yet), for finding edges. */
  ca1: number
  cb1: number
  ca2: number
  cb2: number
  pb6: number
  /** The levels the chip drives on CA2 and CB2 when they are outputs. */
  ca2out: number
  cb2out: number
  /** A pulse-mode CA2 or CB2 waiting to go back high. */
  ca2pulse: boolean
  cb2pulse: boolean
  /** The input latches (ACR bits 0 and 1): what the port pins showed at the active edge of CA1 and CB1. */
  ira: number
  irb: number
}

export function viaInit(): ViaState {
  return {
    orb: 0, ora: 0, ddrb: 0, ddra: 0,
    t1c: 0xffff, t1l: 0xffff, t1armed: false, t1reload: false, pb7: 1,
    t2c: 0xffff, t2l: 0xff, t2armed: false,
    sr: 0, acr: 0, pcr: 0, ifr: 0, ier: 0,
    ca1: -1, cb1: -1, ca2: -1, cb2: -1, pb6: -1,
    ca2out: 1, cb2out: 1, ca2pulse: false, cb2pulse: false,
    ira: 0, irb: 0,
  }
}

/** The interrupt line is low while this is true. */
export const viaIrq = (st: ViaState) => (st.ifr & st.ier & 0x7f) !== 0
