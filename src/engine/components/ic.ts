import { box } from '../layouts'
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
    params: [text('ic', 'IC'), text('name', 'Name'), text('ins', 'Inputs'), text('outs', 'Outputs')],
    title: (p) => String(p.name || 'IC'),
    layout: (p) => box({ left: pinSpecs(icInputs(p), 'in'), right: pinSpecs(icOutputs(p), 'out') }),
    groups: (p) => [...groups(icInputs(p), 'in'), ...groups(icOutputs(p), 'out')],
    // Never simulated (see above); a part of this type that is left over reads X.
    evaluate(inst) {
      inst.outs.fill(X)
    },
  },
]
