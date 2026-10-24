/**
 * The opcodes of the WDC W65C02S, as data like `opcodes6502.ts` (the NMOS table, which this one starts from): the instructions the
 * 65C02 added, the opcodes whose cycles changed, and what the opcodes that nothing uses do (a NOP of one, two or three bytes).
 * The CPU core runs them when it is told it is a 65C02.
 *
 * Added: BRA, PHX, PHY, PLX, PLY, STZ, TSB, TRB, INC A, DEC A, the `(zp)` mode of the eight instructions that have an indirect
 * indexed form, BIT with a constant and with X, `JMP (address,X)`, WAI and STP, and the bit instructions RMB, SMB, BBR and BBS.
 */

import { MODE_BYTES, OPCODES_6502, type Kind6502, type Mode6502, type Opcode6502 } from './opcodes6502'

const make = (opcode: number, mnemonic: string, mode: Mode6502, cycles: number, kind: Kind6502, pageCross = false, bit?: number): Opcode6502 => ({
  opcode,
  mnemonic,
  mode,
  bytes: MODE_BYTES[mode],
  cycles,
  pageCross,
  kind,
  ...(bit === undefined ? {} : { bit }),
})

const added: Opcode6502[] = [
  make(0x04, 'TSB', 'zp', 5, 'rmw'),
  make(0x0c, 'TSB', 'abs', 6, 'rmw'),
  make(0x14, 'TRB', 'zp', 5, 'rmw'),
  make(0x1c, 'TRB', 'abs', 6, 'rmw'),
  make(0x12, 'ORA', 'izp', 5, 'read'),
  make(0x32, 'AND', 'izp', 5, 'read'),
  make(0x52, 'EOR', 'izp', 5, 'read'),
  make(0x72, 'ADC', 'izp', 5, 'read'),
  make(0x92, 'STA', 'izp', 5, 'write'),
  make(0xb2, 'LDA', 'izp', 5, 'read'),
  make(0xd2, 'CMP', 'izp', 5, 'read'),
  make(0xf2, 'SBC', 'izp', 5, 'read'),
  make(0x1a, 'INC', 'acc', 2, 'other'),
  make(0x3a, 'DEC', 'acc', 2, 'other'),
  make(0x34, 'BIT', 'zpx', 4, 'read'),
  make(0x3c, 'BIT', 'abx', 4, 'read', true),
  make(0x89, 'BIT', 'imm', 2, 'read'),
  make(0x5a, 'PHY', 'imp', 3, 'other'),
  make(0x7a, 'PLY', 'imp', 4, 'other'),
  make(0xda, 'PHX', 'imp', 3, 'other'),
  make(0xfa, 'PLX', 'imp', 4, 'other'),
  make(0x64, 'STZ', 'zp', 3, 'write'),
  make(0x74, 'STZ', 'zpx', 4, 'write'),
  make(0x9c, 'STZ', 'abs', 4, 'write'),
  make(0x9e, 'STZ', 'abx', 5, 'write'),
  make(0x7c, 'JMP', 'iax', 6, 'other'),
  make(0x80, 'BRA', 'rel', 3, 'other'),
  make(0xcb, 'WAI', 'imp', 3, 'other'),
  make(0xdb, 'STP', 'imp', 3, 'other'),
  ...Array.from({ length: 8 }, (_, b) => [
    make(0x07 + 16 * b, 'RMB' + b, 'zp', 5, 'rmw', false, b),
    make(0x87 + 16 * b, 'SMB' + b, 'zp', 5, 'rmw', false, b),
    make(0x0f + 16 * b, 'BBR' + b, 'zpr', 5, 'other', false, b),
    make(0x8f + 16 * b, 'BBS' + b, 'zpr', 5, 'other', false, b),
  ]).flat(),
]

/** The opcodes that nothing uses: they read their operand (if they have one) and do nothing else. */
const nops = (): Opcode6502[] => {
  const out: Opcode6502[] = []
  const used = new Set([...OPCODES_6502, ...added].map((o) => o.opcode))
  for (let op = 0; op < 256; op++) {
    if (used.has(op)) continue
    const lo = op & 15
    if (lo === 2) out.push(make(op, 'NOP', 'imm', 2, 'read'))
    else if (lo === 3 || lo === 11) out.push(make(op, 'NOP', 'imp', 1, 'other'))
    else if (op === 0x44) out.push(make(op, 'NOP', 'zp', 3, 'read'))
    else if (lo === 4) out.push(make(op, 'NOP', 'zpx', 4, 'read'))
    else if (lo === 12) out.push(make(op, 'NOP', 'abs', 4, 'read'))
  }
  return out
}

/** What changed in an opcode of the NMOS table: shifts and rotates by X take a cycle less (and one more across a page). */
const changed = (o: Opcode6502): Opcode6502 => {
  if (o.mode === 'abx' && ['ASL', 'LSR', 'ROL', 'ROR'].includes(o.mnemonic)) return { ...o, cycles: 6, pageCross: true }
  if (o.mnemonic === 'JMP' && o.mode === 'ind') return { ...o, cycles: 6 }
  return o
}

/** All the opcodes of the 65C02 that do something, by opcode, and a NOP for each of the rest. */
export const OPCODES_65C02: Opcode6502[] = [...OPCODES_6502.map(changed), ...added]

export const BY_OPCODE_65C02: Opcode6502[] = (() => {
  const t = new Array<Opcode6502 | undefined>(256).fill(undefined)
  for (const o of OPCODES_65C02) t[o.opcode] = o
  for (const o of nops()) t[o.opcode] = o
  return t as Opcode6502[]
})()
