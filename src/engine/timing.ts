import type { ComponentDef } from './types'

/**
 * How each part type's outputs follow its inputs, for the fast engine (see `ComponentDef.timing` and docs/spec-sim-speed-tier2.md).
 * One table here instead of a field in each of the part files; `timing.test.ts` checks every entry against the part itself.
 */
const COMB =
  'and or not nand nor xor xnor buf halfadd fulladd add4 halfsub fullsub sub4 addsub4 cmp4 alu mul bcdadd rom lut mux demux tribuf busjoin ' +
  'busconst busadd bussub busaddsub buscmp busgate busmux decoder encoder bcd7 bcddec bin2bcd gray parity splitter merger netsend netrecv ' +
  'led seg7 hexdisp dicedisp bar busdisp ic note frame'
/**
 * Registered parts, with the inputs that reach their outputs at once (a clear, a preset, an enable that gates a carry out): the engine
 * treats those pins like a combinational part's inputs, and only the clock and the data pins as the point where a loop is cut.
 */
const REGISTERED: Record<string, string[]> = {
  dff: ['R', 'S'],
  jkff: ['R', 'S'],
  tff: ['R', 'S'],
  counter: ['UD', 'R', 'EN'],
  counterld: ['R', 'EN'],
  register: ['CLR'],
  shiftreg: ['CLR'],
  ringcounter: ['R'],
  busreg: ['CLR'],
  busctr: ['R', 'EN'],
  cpu6502: ['BE', 'NMIB'], // (the 65C02 lets go of its buses while BE is low; NMIB is edge-detected at once, so a short pulse between clocks counts)
  acia6551: [],
  via6522: ['RESB'],
  console: [],
  // Memories and devices whose output follows an address or a strobe at once (a read), while writing waits for the clock.
  ram: Array.from({ length: 20 }, (_, i) => `A${i}`),
  framebuffer: ['CLR', ...Array.from({ length: 10 }, (_, i) => `RX${i}`), ...Array.from({ length: 10 }, (_, i) => `RY${i}`)],
  hd44780: ['E', 'RW'],
}
/** Keep state and also answer their inputs at once: latches (level-sensitive), memories (a read follows the address), devices with registers. */
const MIXED = 'srlatch dlatch keypad'
/** No inputs: their outputs come from the part's own settings or state, which change from outside (a click, the clock running). */
const SOURCE = 'switch button clock const hexin busin gamepad'
/** Look at the settled values after each edge (`sample`) and put nothing on any net. */
const SINK = 'probe breakpoint matrix speaker'

/** No outputs, and an `evaluate` that does nothing: drawn from their pins, so a change there needs no evaluation (`ComponentDef.idle`). */
const IDLE = new Set('netsend led seg7 hexdisp dicedisp bar busdisp note frame'.split(' '))

/** Registered parts whose single clock pin only matters on a rising edge, and that keep the last clock level in `state.pc` (`ComponentDef.risingClock`). */
const RISING = new Set('dff jkff tff counter counterld register shiftreg ringcounter busreg busctr'.split(' '))

const TABLE = new Map<string, NonNullable<ComponentDef['timing']>>()
for (const [names, timing] of [[COMB, 'comb'], [MIXED, 'mixed'], [SOURCE, 'source'], [SINK, 'sink']] as const)
  for (const n of names.split(' ')) TABLE.set(n, timing)

/** Give every part in the table its timing class (and a registered part its immediate inputs). */
export const withTiming = (defs: ComponentDef[]): ComponentDef[] =>
  defs.map((d) => {
    const t = REGISTERED[d.type] ? { ...d, timing: 'registered' as const, immediateIns: REGISTERED[d.type] } : TABLE.has(d.type) ? { ...d, timing: TABLE.get(d.type) } : d
    const u = IDLE.has(d.type) ? { ...t, idle: true } : t
    return RISING.has(d.type) ? { ...u, risingClock: true } : u
  })
