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
  cpu6502: ['BE'], // (the 65C02 lets go of its buses while BE is low)
  acia6551: [],
  via6522: ['RESB'],
  console: [],
}
/** Keep state and also answer their inputs at once: latches (level-sensitive), memories (a read follows the address), devices with registers. */
const MIXED = 'srlatch dlatch ram hd44780 matrix keypad gamepad speaker framebuffer'
/** No inputs: their outputs come from the part's own settings or state, which change from outside (a click, the clock running). */
const SOURCE = 'switch button clock const hexin busin'
/** Look at the settled values after each edge (`sample`) and put nothing on any net. */
const SINK = 'probe breakpoint'

const TABLE = new Map<string, NonNullable<ComponentDef['timing']>>()
for (const [names, timing] of [[COMB, 'comb'], [MIXED, 'mixed'], [SOURCE, 'source'], [SINK, 'sink']] as const)
  for (const n of names.split(' ')) TABLE.set(n, timing)

/** Give every part in the table its timing class (and a registered part its immediate inputs). */
export const withTiming = (defs: ComponentDef[]): ComponentDef[] =>
  defs.map((d) =>
    REGISTERED[d.type] ? { ...d, timing: 'registered', immediateIns: REGISTERED[d.type] } : TABLE.has(d.type) ? { ...d, timing: TABLE.get(d.type) } : d,
  )
