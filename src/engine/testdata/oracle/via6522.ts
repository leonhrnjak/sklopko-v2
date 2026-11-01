/**
 * The register model of a 6522 versatile interface adapter (the WDC 65C22 on Ben Eater's breadboard): two 8-bit ports, two 16-bit
 * timers, four handshake pins and the interrupt flags. No pins and no simulator, so that the `via6522` part and the tests drive it the
 * same way: `viaRead` and `viaWrite` for a bus cycle, `viaClock` once per Φ2 cycle, `viaEdges` whenever an input pin may have changed.
 *
 * Registers, picked by RS3–RS0:
 *
 *     0 ORB / IRB    port B                         8 T2C-L   timer 2 counter, low (read clears its flag)
 *     1 ORA / IRA    port A (with handshake)        9 T2C-H   timer 2 counter, high (write starts it)
 *     2 DDRB         direction of port B            10 SR     shift register (stored, not shifted)
 *     3 DDRA         direction of port A            11 ACR    auxiliary control
 *     4 T1C-L        timer 1 counter, low           12 PCR    peripheral control
 *     5 T1C-H        timer 1 counter, high          13 IFR    interrupt flags
 *     6 T1L-L        timer 1 latch, low             14 IER    interrupt enable
 *     7 T1L-H        timer 1 latch, high            15 ORA / IRA, without handshake
 *
 * Interrupt flags (IFR) and enable bits (IER): 0 CA2, 1 CA1, 2 SR, 3 CB2, 4 CB1, 5 T2, 6 T1; IFR bit 7 reads 1 while an enabled flag is set.
 *
 * Not modelled: the shift register (SR is a byte of storage and its flag never sets), the finer timing of the handshake modes (CA2 and CB2
 * in the handshake and pulse output modes act at the first Φ2 cycle after the access, not at its falling edge), and the analogue side.
 */

export const T1 = 0x40
export const T2 = 0x20
export const CB1 = 0x10
export const CB2 = 0x08
export const SR = 0x04
export const CA1 = 0x02
export const CA2 = 0x01

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

/** What RESB low does: every register but the timers and the shift register is cleared, so the ports are inputs and nothing interrupts. */
export function viaReset(st: ViaState) {
  st.orb = st.ora = st.ddrb = st.ddra = 0
  st.acr = st.pcr = st.ifr = st.ier = 0
  st.t1armed = st.t2armed = st.t1reload = false
  st.pb7 = 1
  st.ca2out = st.cb2out = 1
  st.ca2pulse = st.cb2pulse = false
}

/** The levels on the pins the chip reads: the two ports (a bit is -1 where nothing drives it is not told here: the part passes numbers). */
export interface ViaPins {
  /** The eight pins of port A and of port B, as a number. */
  pa: number
  pb: number
}

/** The interrupt line is low while this is true. */
export const viaIrq = (st: ViaState) => (st.ifr & st.ier & 0x7f) !== 0

/** Which bits of port A and of port B the chip drives, and to what (the other pins are not driven: Z). PB7 is the timer's while ACR bit 7 is set. */
export function viaPortOut(st: ViaState): { pa: number; paOe: number; pb: number; pbOe: number } {
  let pbOe = st.ddrb
  let pb = st.orb
  if (st.acr & 0x80) {
    pbOe |= 0x80
    pb = (pb & 0x7f) | (st.pb7 << 7)
  }
  return { pa: st.ora, paOe: st.ddra, pb, pbOe }
}

/** The CA2 / CB2 output mode: PCR bits 3–1 and 7–5. 0–3 are inputs, 4 handshake, 5 pulse, 6 low, 7 high. */
const modeA = (st: ViaState) => (st.pcr >> 1) & 7
const modeB = (st: ViaState) => (st.pcr >> 5) & 7
export const ca2IsOutput = (st: ViaState) => modeA(st) >= 4
export const cb2IsOutput = (st: ViaState) => modeB(st) >= 4
/** An input mode with the "independent" interrupt: the flag is not cleared by reading or writing the port. */
const independentA = (st: ViaState) => modeA(st) === 1 || modeA(st) === 3
const independentB = (st: ViaState) => modeB(st) === 1 || modeB(st) === 3

const bit = (n: number, b: number) => (n >> b) & 1

/** The flags a read or write of a port register clears, and the handshake output it starts. */
function touchA(st: ViaState) {
  st.ifr &= ~CA1
  if (!independentA(st)) st.ifr &= ~CA2
  const m = modeA(st)
  if (m === 4) st.ca2out = 0 // handshake: low until the next active edge of CA1
  else if (m === 5) {
    st.ca2out = 0 // pulse: low for one cycle
    st.ca2pulse = true
  }
}
function touchB(st: ViaState) {
  st.ifr &= ~CB1
  if (!independentB(st)) st.ifr &= ~CB2
  const m = modeB(st)
  if (m === 4) st.cb2out = 0
  else if (m === 5) {
    st.cb2out = 0
    st.cb2pulse = true
  }
}

/** A read of register `rs` (0–15), with its side effects. `pins` is what port A and port B show now. */
export function viaRead(st: ViaState, rs: number, pins: ViaPins): number {
  switch (rs & 15) {
    case 0: {
      touchB(st)
      // Port B reads its output register for the pins that are outputs, and the pins (or their latch) for the others.
      const input = st.acr & 2 ? st.irb : pins.pb
      let v = (st.orb & st.ddrb) | (input & ~st.ddrb & 0xff)
      if (st.acr & 0x80) v = (v & 0x7f) | (st.pb7 << 7)
      return v
    }
    case 1:
    case 15: {
      if ((rs & 15) === 1) touchA(st)
      return st.acr & 1 ? st.ira : pins.pa
    }
    case 2:
      return st.ddrb
    case 3:
      return st.ddra
    case 4:
      st.ifr &= ~T1
      return st.t1c & 0xff
    case 5:
      return st.t1c >> 8
    case 6:
      return st.t1l & 0xff
    case 7:
      return st.t1l >> 8
    case 8:
      st.ifr &= ~T2
      return st.t2c & 0xff
    case 9:
      return st.t2c >> 8
    case 10:
      return st.sr
    case 11:
      return st.acr
    case 12:
      return st.pcr
    case 13:
      return (st.ifr & 0x7f) | (viaIrq(st) ? 0x80 : 0)
    default:
      return st.ier | 0x80
  }
}

/** A write of `value` to register `rs`. */
export function viaWrite(st: ViaState, rs: number, value: number) {
  const v = value & 0xff
  switch (rs & 15) {
    case 0:
      st.orb = v
      touchB(st)
      break
    case 1:
      st.ora = v
      touchA(st)
      break
    case 15:
      st.ora = v
      break
    case 2:
      st.ddrb = v
      break
    case 3:
      st.ddra = v
      break
    case 4:
    case 6:
      st.t1l = (st.t1l & 0xff00) | v
      break
    case 5:
      // Writing the high byte loads the latch, copies the latch to the counter, clears the flag and starts the timer.
      st.t1l = (st.t1l & 0xff) | (v << 8)
      st.t1c = st.t1l
      st.ifr &= ~T1
      st.t1armed = true
      st.t1reload = false
      if (st.acr & 0x80) st.pb7 = 0
      break
    case 7:
      st.t1l = (st.t1l & 0xff) | (v << 8)
      st.ifr &= ~T1
      break
    case 8:
      st.t2l = v
      break
    case 9:
      st.t2c = (v << 8) | st.t2l
      st.ifr &= ~T2
      st.t2armed = true
      break
    case 10:
      st.sr = v
      break
    case 11:
      st.acr = v
      break
    case 12:
      st.pcr = v
      // An output mode that is a fixed level takes it at once.
      if (modeA(st) === 6) st.ca2out = 0
      else if (modeA(st) === 7) st.ca2out = 1
      if (modeB(st) === 6) st.cb2out = 0
      else if (modeB(st) === 7) st.cb2out = 1
      break
    case 13:
      st.ifr &= ~(v & 0x7f) // a 1 clears the flag
      break
    default:
      // Bit 7 says whether the other bits are set (1) or cleared (0).
      if (v & 0x80) st.ier |= v & 0x7f
      else st.ier &= ~(v & 0x7f)
  }
}

/**
 * The inputs CA1, CA2, CB1, CB2 and PB6 as they are now (0 or 1; -1 for unknown, which is never an edge): set the flags for the edges
 * their modes ask for. Called whenever one of them may have changed, which is not at the clock.
 */
export function viaEdges(st: ViaState, ca1: number, ca2: number, cb1: number, cb2: number, pins: ViaPins) {
  const pcr = st.pcr
  // CA1 and CB1: PCR bit 0 and bit 4 pick the active edge (0 falling, 1 rising).
  if (st.ca1 >= 0 && ca1 >= 0 && st.ca1 !== ca1 && ca1 === bit(pcr, 0)) {
    st.ifr |= CA1
    if (st.acr & 1) st.ira = pins.pa
    if (modeA(st) === 4) st.ca2out = 1 // the handshake ends
  }
  if (st.cb1 >= 0 && cb1 >= 0 && st.cb1 !== cb1 && cb1 === bit(pcr, 4)) {
    st.ifr |= CB1
    if (st.acr & 2) st.irb = pins.pb
    if (modeB(st) === 4) st.cb2out = 1
  }
  // CA2 and CB2 as inputs: PCR bits 3–1 (and 7–5) are 0 and 1 for the falling edge, 2 and 3 for the rising one.
  if (!ca2IsOutput(st) && st.ca2 >= 0 && ca2 >= 0 && st.ca2 !== ca2 && ca2 === (modeA(st) >> 1)) st.ifr |= CA2
  if (!cb2IsOutput(st) && st.cb2 >= 0 && cb2 >= 0 && st.cb2 !== cb2 && cb2 === (modeB(st) >> 1)) st.ifr |= CB2
  st.ca1 = ca1
  st.ca2 = ca2
  st.cb1 = cb1
  st.cb2 = cb2
}

/** One Φ2 cycle for the timers (and the pulse outputs). `pb6` is the level on PB6 (-1 unknown), which timer 2 counts when ACR bit 5 is set. */
export function viaClock(st: ViaState, pb6: number) {
  // Timer 1 counts down every cycle; the cycle after it passes 0 it sets the flag (and, free-running, reloads from the latch).
  if (st.t1reload) {
    st.t1c = st.t1l
    st.t1reload = false
  } else {
    st.t1c = (st.t1c - 1) & 0xffff
    if (st.t1c === 0xffff) {
      const free = (st.acr & 0x40) !== 0
      if (st.t1armed) {
        st.ifr |= T1
        if (st.acr & 0x80) st.pb7 = free ? st.pb7 ^ 1 : 1
        if (!free) st.t1armed = false
      }
      if (free) st.t1reload = true
    }
  }
  // Timer 2 counts cycles, or the falling edges of PB6.
  const counting = (st.acr & 0x20) !== 0 ? st.pb6 === 1 && pb6 === 0 : true
  if (counting) {
    st.t2c = (st.t2c - 1) & 0xffff
    if (st.t2c === 0xffff && st.t2armed) {
      st.ifr |= T2
      st.t2armed = false
    }
  }
  st.pb6 = pb6
  if (st.ca2pulse) {
    st.ca2pulse = false
    st.ca2out = 1
  }
  if (st.cb2pulse) {
    st.cb2pulse = false
    st.cb2out = 1
  }
}
