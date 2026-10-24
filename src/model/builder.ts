import { getDef } from '../engine/registry'
import { legacyDefaults, paramDefaults, type Params } from '../engine/types'
import { routeWires } from '../routing/router'
import { isLabel } from './labels'
import { boundsRect, emptyCircuit, findPin, rectsIntersect, type Circuit, type Comp, type Rot } from './circuit'
import { icParams } from './ic'

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
      // Parts that gained a bus mode keep their scalar pins here (as in old files) unless the caller asks for `bus: true`.
      params: { ...legacyDefaults(getDef(type)), ...o.params },
      ...(o.label ? { label: o.label } : {}),
    }
    return id
  }

  /**
   * A net label of `type` named `name`, set `gap` px from the pin `at` ('comp.pin') and turned to face it, with the
   * label's pin connected to it by a wire. If it would run into another part, it is moved out 10px at a time, and
   * if it still doesn't fit nothing is added. Returns the label's id, or undefined if there was no room.
   */
  private flag(type: 'netsend' | 'netrecv', name: string, at: string, gap: number, bits = 1): string | undefined {
    const [compId, pinName] = at.split('.')
    const target = findPin(this.c.comps[compId], pinName)
    if (!target) throw new Error(`No pin ${at}`)
    const mine = type === 'netsend' ? 'A' : 'Y'
    const params = { ...paramDefaults(getDef(type)), name, bits }
    for (const rot of [0, 1, 2, 3] as Rot[]) {
      const probe: Comp = { id: '', type, x: 0, y: 0, rot, flip: false, params }
      const pin = findPin(probe, mine)!
      if (pin.dir.x !== -target.dir.x || pin.dir.y !== -target.dir.y) continue
      for (let g = gap; g <= gap + 20; g += 10) {
        const x = target.pos.x + target.dir.x * g - pin.pos.x
        const y = target.pos.y + target.dir.y * g - pin.pos.y
        const r = boundsRect({ ...probe, x, y })
        // Keep 10px clear of other parts so wires can get to the pins; labels may sit flush against each other (touching edges count as overlap, hence the -1).
        const blocked = Object.values(this.c.comps).some((k) => {
          const pad = isLabel(k.type) ? -1 : 10
          return rectsIntersect({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad }, boundsRect(k))
        })
        if (blocked) continue
        const id = this.add(type, x, y, { params, rot })
        if (type === 'netsend') this.wire(at, `${id}.A`)
        else this.wire(`${id}.Y`, at)
        return id
      }
      return undefined
    }
    throw new Error(`Cannot turn a label to face ${at}`)
  }

  /** Publish the output pin `from` ('comp.pin') under `name` with a Send label right next to it, if there is room. */
  tap(from: string, name: string, gap = 20, bits = 1): string | undefined {
    return this.flag('netsend', name, from, gap, bits)
  }

  /** Feed the input pin `to` ('comp.pin') from the signal published under `name`, with a Receive label right next to it, if there is room. */
  tag(to: string, name: string, gap = 20, bits = 1): string | undefined {
    return this.flag('netrecv', name, to, gap, bits)
  }

  /**
   * Make a custom IC from a circuit (its labelled switches and LEDs become its pins, see `deriveInterface`) and add it to this
   * circuit's ICs. Returns its id, which `ic` places.
   */
  defineIC(name: string, circuit: Circuit, id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ic'): string {
    ;(this.c.ics ??= {})[id] = { id, name, circuit: { comps: circuit.comps, wires: circuit.wires } }
    return id
  }

  /** Place an instance of a custom IC defined with `defineIC`; returns its part id. */
  ic(defId: string, x: number, y: number, o: Omit<AddOpts, 'params'> = {}): string {
    const def = this.c.ics?.[defId]
    if (!def) throw new Error(`No IC ${defId}`)
    return this.add('ic', x, y, { ...o, params: icParams(def) })
  }

  /** wire('and1.Y', 'led2.A') */
  wire(from: string, to: string): string {
    const [fc, fp] = from.split('.')
    const [tc, tp] = to.split('.')
    const id = `w${++this.n}`
    this.c.wires[id] = { id, from: { comp: fc, pin: fp }, to: { comp: tc, pin: tp }, path: [] }
    return id
  }

  /**
   * Route every wire and return the circuit. `improve` caps the passes that re-route crossing wires (default: all);
   * large circuits take most of their routing time there, for diminishing returns after the first pass.
   */
  build(improve: boolean | number = true): Circuit {
    const paths = routeWires(this.c, Object.keys(this.c.wires), improve)
    for (const [id, path] of Object.entries(paths)) this.c.wires[id].path = path
    return this.c
  }
}
