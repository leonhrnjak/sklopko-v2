import { getDef } from '../engine/registry'
import { paramDefaults, type Params } from '../engine/types'
import { routeWires } from '../routing/router'
import { emptyCircuit, type Circuit, type Rot } from './circuit'

interface AddOpts {
  params?: Params
  rot?: Rot
  flip?: boolean
  label?: string
}

/** Programmatic circuit construction, used by the examples and tests. */
export class CircuitBuilder {
  c: Circuit = emptyCircuit()
  private n = 0

  add(type: string, x: number, y: number, o: AddOpts = {}): string {
    const id = `${type}${++this.n}`
    this.c.comps[id] = {
      id,
      type,
      x,
      y,
      rot: o.rot ?? 0,
      flip: o.flip ?? false,
      params: { ...paramDefaults(getDef(type)), ...o.params },
      ...(o.label ? { label: o.label } : {}),
    }
    return id
  }

  /** wire('and1.Y', 'led2.A') */
  wire(from: string, to: string): string {
    const [fc, fp] = from.split('.')
    const [tc, tp] = to.split('.')
    const id = `w${++this.n}`
    this.c.wires[id] = { id, from: { comp: fc, pin: fp }, to: { comp: tc, pin: tp }, path: [] }
    return id
  }

  /** Route every wire and return the circuit. */
  build(): Circuit {
    const paths = routeWires(this.c, Object.keys(this.c.wires))
    for (const [id, path] of Object.entries(paths)) this.c.wires[id].path = path
    return this.c
  }
}
