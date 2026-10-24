import { numbered, withBus } from './bus'
import { showsTable } from './components/memory'
import type { ComponentDef, Params, PinGroup } from './types'

/**
 * The existing parts that have a bus mode (a `bus` param, off in old files), and the bus pins it draws: one group per
 * run of numbered pins. The scalar pins stay as they were (the simulator and the saved files know only those), so a part in
 * bus mode behaves exactly like the same part wired bit by bit.
 *
 * A group is named differently from every scalar pin of the part (`D` for `D0..D7`; `IN` where `A..D` are taken).
 */
const MODES: Record<string, { groups(p: Params): PinGroup[]; keepsHeight?(p: Params): boolean }> = {
  hexin: { groups: () => [{ name: 'Q', dir: 'out', pins: ['A', 'B', 'C', 'D'] }] },
  hexdisp: { groups: () => [{ name: 'IN', dir: 'in', pins: ['A', 'B', 'C', 'D'] }], keepsHeight: () => true },
  bar: { groups: (p) => [numbered('I', 'in', 'I', Number(p.n))] },
  breakpoint: { groups: (p) => (Number(p.width) > 1 ? [numbered('A', 'in', 'A', Number(p.width))] : []) },
  register: {
    groups: () => [
      { name: 'IN', dir: 'in', pins: ['A', 'B', 'C', 'D'] },
      { name: 'Q', dir: 'out', pins: ['QA', 'QB', 'QC', 'QD'] },
    ],
  },
  counterld: { groups: () => [numbered('D', 'in', 'D', 4), numbered('Q', 'out', 'Q', 4)] },
  add4: { groups: () => [numbered('A', 'in', 'A', 4), numbered('B', 'in', 'B', 4), numbered('S', 'out', 'S', 4)] },
  sub4: { groups: () => [numbered('A', 'in', 'A', 4), numbered('B', 'in', 'B', 4), numbered('D', 'out', 'D', 4)] },
  addsub4: { groups: () => [numbered('A', 'in', 'A', 4), numbered('B', 'in', 'B', 4), numbered('S', 'out', 'S', 4)] },
  cmp4: { groups: () => [numbered('A', 'in', 'A', 4), numbered('B', 'in', 'B', 4)] },
  alu: {
    groups: () => [numbered('A', 'in', 'A', 4), numbered('B', 'in', 'B', 4), numbered('F', 'out', 'F', 4), numbered('S', 'in', 'S', 3)],
  },
  bcdadd: { groups: () => [numbered('A', 'in', 'A', 4), numbered('B', 'in', 'B', 4), numbered('S', 'out', 'S', 4)] },
  bin2bcd: { groups: () => [numbered('B', 'in', 'B', 4), numbered('O', 'out', 'O', 4)] },
  mux: { groups: (p) => (Number(p.n) > 2 ? [numbered('S', 'in', 'S', Math.log2(Number(p.n)))] : []) },
  rom: {
    groups: (p) => [
      numbered('A', 'in', 'A', Number(p.abits)),
      numbered('D', 'out', 'D', Number(p.dbits)),
      ...(p.table === 'on' ? [numbered('TA', 'in', 'TA', 8), numbered('TD', 'out', 'TD', 8)] : []),
    ],
    keepsHeight: (p) => showsTable(2 ** Number(p.abits)),
  },
  ram: {
    groups: (p) => [numbered('D', 'in', 'D', Number(p.dbits)), numbered('A', 'in', 'A', Number(p.abits) || 4), numbered('Q', 'out', 'Q', Number(p.dbits))],
    keepsHeight: (p) => showsTable(2 ** (Number(p.abits) || 4)),
  },
  cpu6502: { groups: () => [numbered('DI', 'in', 'DI', 8), numbered('A', 'out', 'A', 16), numbered('D', 'out', 'D', 8)] },
  console: { groups: () => [numbered('D', 'in', 'D', 8)], keepsHeight: () => true },
  framebuffer: {
    groups: (p) => [
      numbered('X', 'in', 'X', 4),
      numbered('Y', 'in', 'Y', 4),
      ...(Number(p.colors) === 4 ? [numbered('D', 'in', 'D', 2)] : []),
      ...(p.read === 'on' ? [numbered('RX', 'in', 'RX', 4), numbered('RY', 'in', 'RY', 4), ...(Number(p.colors) === 4 ? [numbered('Q', 'out', 'Q', 2)] : [])] : []),
    ],
    keepsHeight: () => true,
  },
}

/** Give every part in the table its bus mode. */
export const withBusModes = (defs: ComponentDef[]): ComponentDef[] =>
  defs.map((d) => (MODES[d.type] ? withBus(d, MODES[d.type].groups, MODES[d.type].keepsHeight) : d))
