import { resolveLabels } from './netlabels'
import { getDef, hasDef } from './registry'
import { X, type ComponentDef, type Instance, type Layout, type Params, type V } from './types'

export interface SimComp {
  id: string
  type: string
  params: Params
}
export interface PinRef {
  comp: string
  pin: string
}
export interface SimWire {
  from: PinRef
  to: PinRef
}
export interface SimCircuit {
  comps: SimComp[]
  wires: SimWire[]
}

const layoutCache = new Map<string, Layout>()

/** Layout of a component type with given params (cached; layouts are pure). */
export function layoutOf(type: string, params: Params): Layout {
  const key = type + JSON.stringify(params)
  let l = layoutCache.get(key)
  if (!l) {
    if (layoutCache.size > 500) layoutCache.clear()
    l = getDef(type).layout(params)
    layoutCache.set(key, l)
  }
  return l
}

interface CComp {
  id: string
  def: ComponentDef
  inst: Instance
  inNames: string[]
  outNames: string[]
  /** Net index feeding each input, or -1 when unconnected. */
  inNets: Int32Array
  inDefaults: V[]
  outNets: Int32Array
}

const pinKey = (comp: string, pin: string) => `${comp}:${pin}`

/**
 * Unit-delay, two-phase logic simulator.
 *
 * Every output pin owns one net. Each tick, every component reads the nets as they were at the end
 * of the previous tick and computes its outputs; then all outputs are committed at once. Feedback
 * loops (latches, oscillators) are therefore deterministic and flip-flops sharing a clock never race.
 */
export class Simulator {
  private comps: CComp[] = []
  private byId = new Map<string, CComp>()
  private clocks: CComp[] = []
  private netByOut = new Map<string, number>()
  private values = new Uint8Array(0)
  private next = new Uint8Array(0)
  private listeners = new Set<() => void>()
  private dirty = true

  /** True when the last settle hit its tick budget, i.e. the circuit keeps changing on its own. */
  unstable = false
  /** Total ticks simulated since the last reset. */
  ticks = 0
  /** Simulated time in ms since the last reset. Advances with the clocks while the simulation runs. */
  time = 0
  private samplers: CComp[] = []

  load(c: SimCircuit) {
    const oldValues = new Map<string, V>()
    for (const [key, net] of this.netByOut) oldValues.set(key, this.values[net] as V)
    const oldState = new Map(this.comps.map((cc) => [cc.id, cc]))

    this.comps = []
    this.byId.clear()
    this.netByOut.clear()
    let nets = 0

    // Receive labels that share the net of the signal they carry are set up after the other parts.
    const aliases = resolveLabels(c)
    const deferred: { sc: SimComp; src: PinRef }[] = []

    const build = (sc: SimComp): CComp => {
      const def = getDef(sc.type)
      const layout = layoutOf(sc.type, sc.params)
      const ins = layout.pins.filter((p) => p.dir === 'in')
      const outs = layout.pins.filter((p) => p.dir === 'out')
      const prev = oldState.get(sc.id)
      return {
        id: sc.id,
        def,
        inst: {
          ins: ins.map(() => X),
          outs: outs.map(() => X),
          state: prev && prev.def === def && prev.inst.state !== undefined ? prev.inst.state : def.init?.(sc.params),
          params: sc.params,
        },
        inNames: ins.map((p) => p.name),
        outNames: outs.map((p) => p.name),
        inNets: new Int32Array(ins.length).fill(-1),
        inDefaults: ins.map((p) => p.def ?? X),
        outNets: new Int32Array(outs.length),
      }
    }
    const own = (cc: CComp) => {
      cc.outNames.forEach((name, i) => {
        cc.outNets[i] = nets
        this.netByOut.set(pinKey(cc.id, name), nets++)
      })
      this.comps.push(cc)
      this.byId.set(cc.id, cc)
    }

    for (const sc of c.comps) {
      if (!hasDef(sc.type)) continue
      const src = aliases.get(sc.id)
      if (src) deferred.push({ sc, src })
      else own(build(sc))
    }
    for (const { sc, src } of deferred) {
      const cc = build(sc)
      const net = this.netByOut.get(pinKey(src.comp, src.pin))
      if (net === undefined) own(cc) // the driver isn't in the simulation: an ordinary label, reading X
      else {
        cc.outNets[0] = net
        this.netByOut.set(pinKey(sc.id, cc.outNames[0]), net)
        this.byId.set(sc.id, cc) // visible to pinValue and signature, but never evaluated
      }
    }

    for (const w of c.wires) {
      const net = this.netByOut.get(pinKey(w.from.comp, w.from.pin))
      const target = this.byId.get(w.to.comp)
      if (net === undefined || !target) continue
      const i = target.inNames.indexOf(w.to.pin)
      if (i >= 0) target.inNets[i] = net
    }

    this.values = new Uint8Array(nets).fill(X)
    for (const [key, net] of this.netByOut) {
      const v = oldValues.get(key)
      if (v !== undefined) this.values[net] = v
    }
    this.next = new Uint8Array(nets)
    this.clocks = this.comps.filter((cc) => cc.def.clockHalfPeriod)
    this.samplers = this.comps.filter((cc) => cc.def.sample)
    this.dirty = true
  }

  /** Forget all values and internal state, as if the circuit was just switched on. */
  reset() {
    for (const cc of this.comps) cc.inst.state = cc.def.init?.(cc.inst.params)
    this.values.fill(X)
    this.ticks = 0
    this.time = 0
    this.unstable = false
    this.dirty = true
  }

  /** Advance one gate delay. Returns true if any net changed. */
  tick(): boolean {
    const { values, next } = this
    for (const cc of this.comps) {
      const { ins, outs } = cc.inst
      for (let i = 0; i < ins.length; i++) {
        const n = cc.inNets[i]
        ins[i] = n >= 0 ? (values[n] as V) : cc.inDefaults[i]
      }
      cc.def.evaluate(cc.inst)
      for (let o = 0; o < outs.length; o++) next[cc.outNets[o]] = outs[o]
    }
    let changed = false
    for (let i = 0; i < next.length; i++) {
      if (next[i] !== values[i]) {
        changed = true
        break
      }
    }
    this.values = next
    this.next = values
    this.ticks++
    if (changed) this.dirty = true
    return changed
  }

  /** Tick until nothing changes or the budget runs out. Returns true if the circuit settled. */
  settle(maxTicks = 1000): boolean {
    let settled = false
    for (let i = 0; i < maxTicks && !settled; i++) settled = !this.tick()
    this.unstable = !settled
    this.sample()
    return settled
  }

  /** Let parts that record over time (probes, dot matrices) look at the settled values. */
  private sample() {
    for (const cc of this.samplers) {
      const { ins } = cc.inst
      for (let i = 0; i < ins.length; i++) {
        const n = cc.inNets[i]
        ins[i] = n >= 0 ? (this.values[n] as V) : cc.inDefaults[i]
      }
      cc.def.sample!(cc.inst, this.time)
      this.dirty = true
    }
  }

  /** Budget for a settle: an oscillating circuit gets a few ticks per call so it animates visibly. */
  private budget() {
    return this.unstable ? 2 : 1000
  }

  /** Advance real time by `ms`, toggling clocks at their edges and settling after each edge. */
  advance(ms: number) {
    let left = ms
    for (let edges = 0; edges < 64 && this.clocks.length; edges++) {
      let step = Infinity
      for (const c of this.clocks) step = Math.min(step, c.def.clockHalfPeriod!(c.inst.params) - c.inst.state.elapsed)
      step = Math.max(0, step)
      if (step > left) break
      left -= step
      this.time += step
      for (const c of this.clocks) {
        const st = c.inst.state
        st.elapsed += step
        if (st.elapsed >= c.def.clockHalfPeriod!(c.inst.params) - 1e-9) {
          st.elapsed = 0
          st.phase = st.phase === 1 ? 0 : 1
        }
      }
      this.settle(this.budget())
    }
    for (const c of this.clocks) {
      const st = c.inst.state
      st.elapsed = Math.min(st.elapsed + left, c.def.clockHalfPeriod!(c.inst.params))
    }
    this.time += left
  }

  /** One animation frame of a running simulation. */
  frame(ms: number) {
    this.advance(ms)
    this.settle(this.budget())
  }

  /** Jump to the next clock edge (any clock) and settle. Useful while paused. */
  stepClock() {
    if (!this.clocks.length) return
    let step = Infinity
    for (const c of this.clocks) step = Math.min(step, c.def.clockHalfPeriod!(c.inst.params) - c.inst.state.elapsed)
    this.advance(Math.max(step, 0) + 1e-6)
    this.settle(this.budget())
  }

  /** Ids of all components of a type, in circuit order. */
  idsOfType(type: string): string[] {
    return this.comps.filter((cc) => cc.def.type === type).map((cc) => cc.id)
  }

  get hasClocks() {
    return this.clocks.length > 0
  }

  /** Current value seen at a pin (outputs: the net it drives; inputs: the net feeding it or its default). */
  pinValue(compId: string, pin: string): V {
    const out = this.netByOut.get(pinKey(compId, pin))
    if (out !== undefined) return this.values[out] as V
    const cc = this.byId.get(compId)
    if (!cc) return X
    const i = cc.inNames.indexOf(pin)
    if (i < 0) return X
    const n = cc.inNets[i]
    return n >= 0 ? (this.values[n] as V) : cc.inDefaults[i]
  }

  /** Compact string of all pin values of a component; changes whenever anything it shows changes. */
  signature(compId: string): string {
    const cc = this.byId.get(compId)
    if (!cc) return ''
    let s = ''
    for (let i = 0; i < cc.inNets.length; i++) {
      const n = cc.inNets[i]
      s += n >= 0 ? this.values[n] : cc.inDefaults[i]
    }
    for (let o = 0; o < cc.outNets.length; o++) s += this.values[cc.outNets[o]]
    return s
  }

  /** All input values of a component, in layout order. */
  inputValues(compId: string): V[] {
    const cc = this.byId.get(compId)
    return cc ? cc.inNames.map((p) => this.pinValue(compId, p)) : []
  }

  state(compId: string): any {
    return this.byId.get(compId)?.inst.state
  }

  /**
   * Overwrite one word of a memory part's contents from outside (the memory editor). The value is cut to the part's
   * word size. Returns false if the part has no such word.
   */
  writeWord(compId: string, index: number, value: number): boolean {
    const cc = this.byId.get(compId)
    const mem = (cc?.inst.state as { mem?: number[] } | undefined)?.mem
    if (!cc || !mem || !(index >= 0 && index < mem.length)) return false
    mem[index] = value & (2 ** Number(cc.inst.params.dbits ?? 4) - 1)
    this.dirty = true
    return true
  }

  /** Change params that don't affect the pin layout (switch position, input value, clock rate...). */
  setParams(compId: string, params: Params) {
    const cc = this.byId.get(compId)
    if (!cc) return
    cc.inst.params = params
    this.dirty = true
  }

  setState(compId: string, patch: Record<string, unknown>) {
    const cc = this.byId.get(compId)
    if (!cc) return
    cc.inst.state = { ...cc.inst.state, ...patch }
    this.dirty = true
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  /** Notify subscribers if anything changed since the last publish. */
  publish() {
    if (!this.dirty) return
    this.dirty = false
    for (const fn of this.listeners) fn()
  }
}
