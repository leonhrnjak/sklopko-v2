import { box, gateLayout, type GateShape } from '../layouts'
import { X, type ComponentDef, type Params, type PinGroup } from '../types'

/**
 * A custom IC placed in a circuit. Its definition lives in the document (`Circuit.ics`), but its pins are copied into the
 * instance's params, so the layout needs nothing but the params, like any other part. The part is never simulated:
 * `expandICs` (model/ic.ts) replaces it with the parts of its definition before the circuit is flattened.
 */
export interface IcPin {
  name: string
  /** 1 for a single wire; more for a bus pin. */
  bits: number
}

/** The widest bus pin an IC can have. */
export const IC_MAX_BITS = 32

/** `A:1,B:4`: the pins as they are kept in a param. */
export const encodePins = (pins: IcPin[]) => pins.map((p) => `${p.name}:${p.bits}`).join(',')

/** The pins of an `encodePins` string; what does not read as `name:bits` is left out. */
export function parsePins(text: unknown): IcPin[] {
  const pins: IcPin[] = []
  for (const part of String(text ?? '').split(',')) {
    const m = /^([A-Za-z0-9_]+):(\d+)$/.exec(part)
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= IC_MAX_BITS) pins.push({ name: m[1], bits: Number(m[2]) })
  }
  return pins
}

/** The scalar pins of an IC pin: itself, or `NAME[0]` … for a bus (so a name can never be another pin's). */
export const scalarNames = (p: IcPin) => (p.bits === 1 ? [p.name] : Array.from({ length: p.bits }, (_, i) => `${p.name}[${i}]`))

export const icInputs = (p: Params) => parsePins(p.ins)
export const icOutputs = (p: Params) => parsePins(p.outs)

/** The gates an IC can be drawn as: a chip that behaves as one (a learner's AND, say) looks like the gate, not like a box. */
export const IC_SYMBOLS = ['not', 'buf', 'and', 'or', 'nand', 'nor', 'xor', 'xnor'] as const
export type IcSymbol = (typeof IC_SYMBOLS)[number]
export const isIcSymbol = (v: unknown): v is IcSymbol => IC_SYMBOLS.includes(v as IcSymbol)

const SHAPES: Record<IcSymbol, [GateShape, boolean]> = {
  not: ['buf', true],
  buf: ['buf', false],
  and: ['and', false],
  nand: ['and', true],
  or: ['or', false],
  nor: ['or', true],
  xor: ['xor', false],
  xnor: ['xor', true],
}

/**
 * The symbol an IC is drawn with, or null for a box: `symbol` names one, and the pins fit it: single wires, one output, and one
 * input for a NOT or buffer, two to eight for the others (the gates' own limits).
 */
export function symbolOf(symbol: unknown, ins: IcPin[], outs: IcPin[]): IcSymbol | null {
  if (!isIcSymbol(symbol) || outs.length !== 1 || [...ins, ...outs].some((p) => p.bits !== 1)) return null
  const single = SHAPES[symbol][0] === 'buf'
  return (single ? ins.length === 1 : ins.length >= 2 && ins.length <= 8) ? symbol : null
}

const pinSpecs = (pins: IcPin[], dir: 'in' | 'out') => pins.flatMap((pin) => scalarNames(pin).map((name) => ({ name, label: pin.bits > 1 ? name : pin.name, dir })))

const groups = (pins: IcPin[], dir: 'in' | 'out'): PinGroup[] => pins.filter((p) => p.bits > 1).map((p) => ({ name: p.name, dir, pins: scalarNames(p) }))

const text = (key: string, label: string) =>
  ({ key, label, kind: 'text', default: '', maxLength: 1000, multiline: false, structural: true }) as const

export const ic: ComponentDef[] = [
  {
    type: 'ic',
    name: 'Custom IC',
    category: 'ic',
    description: 'A block made from a circuit of your own: it has the inputs and outputs of the circuit it was made from.',
    params: [text('ic', 'IC'), text('name', 'Name'), text('ins', 'Inputs'), text('outs', 'Outputs'), text('symbol', 'Symbol')],
    title: (p) => String(p.name || 'IC'),
    layout: (p) => {
      const ins = icInputs(p)
      const outs = icOutputs(p)
      const symbol = symbolOf(p.symbol, ins, outs)
      if (symbol) {
        // The gate's own shape and size, with the IC's pin names.
        const [shape, inverted] = SHAPES[symbol]
        const l = gateLayout(ins.length, shape, inverted)
        const names = [...ins, ...outs].map((q) => q.name)
        return { ...l, pins: l.pins.map((pin, i) => ({ ...pin, name: names[i] })) }
      }
      const left = pinSpecs(ins, 'in')
      const right = pinSpecs(outs, 'out')
      // The body is as small as the pin labels and a short title allow; a longer name widens it, and one input and one output make it 40 tall.
      const widest = (list: typeof left) => Math.max(0, ...list.map((s) => s.label.length * 6))
      const title = String(p.name || 'IC').length * 7
      const w = Math.max(60, Math.ceil((widest(left) + widest(right) + Math.max(36, title + 12)) / 20) * 20)
      return box({ w, left, right, minRows: 1 })
    },
    groups: (p) => [...groups(icInputs(p), 'in'), ...groups(icOutputs(p), 'out')],
    // Never simulated (see above); a part of this type that is left over reads X.
    evaluate(inst) {
      inst.outs.fill(X)
    },
  },
]
