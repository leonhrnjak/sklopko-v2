import { CircuitBuilder } from './builder'
import { note } from './annotate'
import type { Circuit, PinRef } from './circuit'
import { PROGRAMS, computer2Builder } from './computer2'
import { collapseSelection } from './ic'
import { isLabel } from './labels'
import { RECV, SEND } from '../engine/netlabels'
import { routeWires } from '../routing/router'

/** Half adder from an XOR and an AND: inputs A and B, outputs S and C. */
function halfAdderBody(): Circuit {
  const b = new CircuitBuilder()
  const a = b.add('switch', 0, 0, { label: 'A' })
  const bb = b.add('switch', 0, 80, { label: 'B' })
  const x = b.add('xor', 140, 0)
  const n = b.add('and', 140, 80)
  const s = b.add('led', 280, 0, { label: 'S' })
  const c = b.add('led', 280, 80, { label: 'C' })
  b.wire(`${a}.Q`, `${x}.A`)
  b.wire(`${bb}.Q`, `${x}.B`)
  b.wire(`${a}.Q`, `${n}.A`)
  b.wire(`${bb}.Q`, `${n}.B`)
  b.wire(`${x}.Y`, `${s}.A`)
  b.wire(`${n}.Y`, `${c}.A`)
  return b.build()
}

/** Full adder from two half adders and an OR: inputs A, B and Ci, outputs S and Co. */
function fullAdderBody(ics: Circuit['ics']): Circuit {
  const b = new CircuitBuilder()
  b.c.ics = ics
  const a = b.add('switch', 0, 0, { label: 'A' })
  const bb = b.add('switch', 0, 80, { label: 'B' })
  const ci = b.add('switch', 0, 200, { label: 'Ci' })
  const h1 = b.ic('half-adder', 160, 0)
  const h2 = b.ic('half-adder', 400, 60)
  const or = b.add('or', 620, 120)
  const s = b.add('led', 620, 0, { label: 'S' })
  const co = b.add('led', 760, 120, { label: 'Co' })
  b.wire(`${a}.Q`, `${h1}.A`)
  b.wire(`${bb}.Q`, `${h1}.B`)
  b.wire(`${h1}.S`, `${h2}.A`)
  b.wire(`${ci}.Q`, `${h2}.B`)
  b.wire(`${h2}.S`, `${s}.A`)
  b.wire(`${h1}.C`, `${or}.A`)
  b.wire(`${h2}.C`, `${or}.B`)
  b.wire(`${or}.Y`, `${co}.A`)
  return b.build()
}

/** Four full adders in a row: inputs A0–A3, B0–B3 and Ci, outputs S0–S3 and Co. */
function adder4Body(ics: Circuit['ics']): Circuit {
  const b = new CircuitBuilder()
  b.c.ics = ics
  const carryIn = b.add('switch', 0, 0, { label: 'Ci' })
  let carry = `${carryIn}.Q`
  for (let i = 0; i < 4; i++) {
    const a = b.add('switch', 120 + i * 220, -200, { label: `A${i}` })
    const bb = b.add('switch', 120 + i * 220, -120, { label: `B${i}` })
    const fa = b.ic('full-adder', 120 + i * 220, 0)
    const s = b.add('led', 120 + i * 220, 220, { label: `S${i}` })
    b.wire(`${a}.Q`, `${fa}.A`)
    b.wire(`${bb}.Q`, `${fa}.B`)
    b.wire(carry, `${fa}.Ci`)
    b.wire(`${fa}.S`, `${s}.A`)
    carry = `${fa}.Co`
  }
  const co = b.add('led', 1000, 0, { label: 'Co' })
  b.wire(carry, `${co}.A`)
  return b.build()
}

/** A 4-bit adder built of ICs inside ICs: a half adder in a full adder in a 4-bit adder, which is placed once with switches and LEDs. */
export function icAdder(): Circuit {
  const b = new CircuitBuilder()
  b.defineIC('Half adder', halfAdderBody())
  b.defineIC('Full adder', fullAdderBody(b.c.ics))
  b.defineIC('4-bit adder', adder4Body(b.c.ics))
  const adder = b.ic('4-bit-adder', 300, 40)
  const ins: [string, number][] = [['A', 0], ['B', 1]]
  // Eight switches and a carry-in on the left, five LEDs on the right: each wired to the pin of the same name.
  let y = 0
  for (const [name] of ins)
    for (let i = 0; i < 4; i++) {
      const s = b.add('switch', 0, y, { label: `${name}${i}`, params: { on: name === 'A' ? i % 2 === 0 : i === 1 } })
      b.wire(`${s}.Q`, `${adder}.${name}${i}`)
      y += 50
    }
  const ci = b.add('switch', 0, y, { label: 'Ci' })
  b.wire(`${ci}.Q`, `${adder}.Ci`)
  for (let i = 0; i < 4; i++) {
    const l = b.add('led', 640, 40 + i * 50, { label: `S${i}`, params: { color: 'green' } })
    b.wire(`${adder}.S${i}`, `${l}.A`)
  }
  const co = b.add('led', 640, 40 + 4 * 50, { label: 'Co', params: { color: 'yellow' } })
  b.wire(`${adder}.Co`, `${co}.A`)
  note(
    b,
    0,
    -330,
    'The middle block is an IC: a part made from a circuit. Inside it are four full adders, and inside each of those two half adders, which are ICs too. Select the block and press Edit IC (or double-click it) to look inside; the breadcrumb over the canvas shows where you are and Back leads out. Change a half adder and every copy of it, in all four full adders, changes with it. Set A and B with the switches (A0 is the least significant bit) and read the sum on the LEDs.',
    52,
  )
  return b.build()
}

// ---- The computer as blocks ------------------------------------------------------------------------

/** The columns of `computer2Builder` (x of the parts in them) that make up each block. */
const BLOCKS: { name: string; columns: number[] }[] = [
  { name: 'Fetch', columns: [0] },
  { name: 'Program ROM', columns: [380] },
  { name: 'Instruction fields', columns: [760] },
  { name: 'Control', columns: [1080, 1440] },
  { name: 'Data memory', columns: [1740] },
  { name: 'ALU', columns: [2060, 2400, 2760, 3100] },
  { name: 'Accumulator', columns: [3440, 3780, 4120] },
]

/** Parts that stay outside the blocks, where they can be seen: the clock, probes, LEDs, the breakpoint and the decimal display. */
const OUTSIDE = new Set(['clock', 'probe', 'led', 'breakpoint'])

/**
 * Replace each pair of net labels that now join two blocks' pins (a Send label fed by one block, a Receive label feeding another)
 * by a wire between the pins. A name with more than one Receive label becomes one wire for each.
 */
function joinLabels(c: Circuit) {
  const feeds = new Map<string, PinRef>() // Send label → what feeds it
  const outs = new Map<string, PinRef[]>() // Receive label → what it feeds
  for (const w of Object.values(c.wires)) {
    if (c.comps[w.to.comp]?.type === SEND) feeds.set(w.to.comp, w.from)
    if (c.comps[w.from.comp]?.type === RECV) outs.set(w.from.comp, [...(outs.get(w.from.comp) ?? []), w.to])
  }
  const isPart = (ref: PinRef) => !!c.comps[ref.comp] && !isLabel(c.comps[ref.comp].type)
  const sends = new Map<string, string>() // name → Send label (one that is fed)
  for (const k of Object.values(c.comps)) if (k.type === SEND && k.params.name && feeds.has(k.id) && isPart(feeds.get(k.id)!) && !sends.has(String(k.params.name))) sends.set(String(k.params.name), k.id)
  const doomed = new Set<string>()
  let n = 0
  for (const k of Object.values(c.comps)) {
    if (k.type !== RECV || !k.params.name) continue
    const send = sends.get(String(k.params.name))
    const targets = outs.get(k.id) ?? []
    if (!send || !targets.length || !targets.every(isPart)) continue
    for (const to of targets) {
      const id = `join${++n}`
      c.wires[id] = { id, from: feeds.get(send)!, to, path: [] }
    }
    doomed.add(k.id)
    doomed.add(send)
  }
  // A Send label whose Receive labels all went has nothing left to do.
  for (const id of doomed) delete c.comps[id]
  for (const w of Object.values(c.wires)) if (doomed.has(w.from.comp) || doomed.has(w.to.comp)) delete c.wires[w.id]
}

/**
 * The 8-bit computer (the Fibonacci example) as blocks: fetch, program ROM, instruction fields, control, data memory, ALU and
 * accumulator, each an IC made by collapsing the parts of its columns, joined by wires. The clock, probes, LEDs and the decimal
 * display stay outside. It is built from the same builder as the full computer, so the two behave alike.
 */
export function computerBlocks(): Circuit {
  const p = PROGRAMS.find((x) => x.id === 'computer')!
  const { b } = computer2Builder({ source: p.source, hz: p.hz, devices: p.devices, probes: p.probes })
  const c = b.build(0)
  const blockOf = new Map<number, string>()
  for (const blk of BLOCKS) for (const col of blk.columns) blockOf.set(col, blk.name)
  // Every part belongs to the block of its column; a net label belongs to the part it is wired to.
  const groups = new Map<string, string[]>()
  const owner = new Map<string, string>()
  for (const k of Object.values(c.comps)) {
    const blk = blockOf.get(k.x)
    if (blk && !OUTSIDE.has(k.type) && !isLabel(k.type)) owner.set(k.id, blk)
  }
  for (const w of Object.values(c.wires)) {
    const label = isLabel(c.comps[w.from.comp]?.type ?? '') ? w.from.comp : isLabel(c.comps[w.to.comp]?.type ?? '') ? w.to.comp : undefined
    const other = label === w.from.comp ? w.to.comp : w.from.comp
    if (label && !owner.has(label) && owner.has(other)) owner.set(label, owner.get(other)!)
  }
  for (const [id, blk] of owner) groups.set(blk, [...(groups.get(blk) ?? []), id])
  let n = 0
  const makeId = (prefix: string) => `${prefix}-b${++n}`
  for (const blk of BLOCKS) {
    const ids = groups.get(blk.name)
    if (ids?.length) collapseSelection(c, ids, blk.name, makeId)
  }
  joinLabels(c)

  // Lay it out: the blocks in a row, in the order the data flows, the clock and probes before them, the LEDs below, and the decimal
  // display (which was far to the right, past the devices) after them.
  const gap = 450
  const at = new Map(BLOCKS.map((blk, i) => [blk.name, i * gap]))
  for (const k of Object.values(c.comps)) {
    if (k.type === 'ic') Object.assign(k, { x: at.get(String(k.params.name)) ?? k.x, y: 0 })
    else if (k.x >= 4830) k.x -= 4830 - (BLOCKS.length * gap + 100)
  }
  const stay = (type: string) => Object.values(c.comps).filter((k) => k.type === type)
  stay('clock').forEach((k, i) => Object.assign(k, { x: -320, y: i * 100 }))
  stay('probe').forEach((k, i) => Object.assign(k, { x: -320, y: 200 + i * 80 }))
  stay('breakpoint').forEach((k) => Object.assign(k, { x: 200, y: 900 }))
  for (const k of stay('led')) Object.assign(k, { x: k.label === 'Halted' ? 0 : (BLOCKS.length - 1) * gap + (k.label === 'Carry' ? 0 : 120), y: 900 })
  const paths = routeWires(c, Object.keys(c.wires), 0)
  for (const [id, path] of Object.entries(paths)) c.wires[id].path = path
  note(
    b, // b.c is c: the circuit built above
    0,
    -330,
    'The 8-bit computer from the Computers group, drawn as blocks. Each box is an IC made from the parts of one column of the full circuit: Fetch (the program counter), the Program ROM, the Instruction fields, Control (which turns an instruction into signals), Data memory, the ALU and the Accumulator. Select a block and press Edit IC (or double-click it) to see the circuit inside. The decimal display and the LEDs are outside the blocks so they stay visible. Run it: it counts through the Fibonacci numbers.',
    60,
  )
  return c
}

