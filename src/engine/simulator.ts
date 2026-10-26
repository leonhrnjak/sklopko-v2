import { resolveLabels } from './netlabels'
import { layoutOf } from './layoutcache'
import { getDef, hasDef } from './registry'
import { X, Z, type ComponentDef, type Instance, type Params, type V } from './types'

export interface SimComp {
  id: string
  type: string
  params: Params
  /** Propagation delay in ticks (default 1, at most MAX_DELAY): how long after its inputs change its outputs follow. */
  delay?: number
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
  /**
   * Parts that share the net of another part's output instead of having one (a Receive label carries what its Send label
   * got): the output pin that drives it, by part id. Worked out by `flatten`; the simulator works it out itself if it is left out.
   */
  aliases?: Map<string, PinRef>
}

/** The largest propagation delay a part can be given, in gate delays. */
export const MAX_DELAY = 16

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
  /**
   * Parts slower than one gate delay: the outputs computed in the last `delay - 1` ticks, oldest first, one group of
   * outputs per tick. Each tick the oldest group is committed. Undefined for the (common) delay of 1.
   */
  pipe?: Uint8Array
  /** Position in `comps` (-1 for a Receive label that only shares another part's net and is never evaluated). */
  index: number
}

const pinKey = (comp: string, pin: string) => `${comp}:${pin}`

/** Everything needed to return to a settled moment: the nets, every part's state, and the clocks (which are state). */
interface Snapshot {
  time: number
  ticks: number
  unstable: boolean
  values: Uint8Array
  /** Aligned with the compiled parts. Parts that record over time (probes) are not copied: see `ComponentDef.rewind`. */
  states: unknown[]
  /** Aligned with the compiled parts: the delay pipelines (copied), or undefined. */
  pipes: (Uint8Array | undefined)[]
}

/**
 * Part states are plain data (numbers, strings, arrays, objects), so a recursive copy is all that is needed. A big memory is a
 * typed array, which is copied in one go: this runs for every part at every clock edge.
 */
function cloneState<T>(s: T): T {
  if (ArrayBuffer.isView(s)) return (s as unknown as Uint8Array).slice() as unknown as T
  if (Array.isArray(s)) return s.map(cloneState) as T
  if (s && typeof s === 'object') {
    const o: Record<string, unknown> = {}
    for (const k in s) o[k] = cloneState((s as Record<string, unknown>)[k])
    return o as T
  }
  return s
}

/** How many ticks of one settle a capture keeps (see `Simulator.setCapture`). */
export const CAPTURE_TICKS = 256

/**
 * Every net's value at each tick of one settle: how the circuit got from one steady state to the next. A signal that
 * changes more often than the difference between where it began and where it ended is a glitch (see `glitch.ts`).
 */
export interface Capture {
  /** `frames[0]` is every net before the first tick, `frames[k]` after tick k. Indexed by net (see `netNames`). */
  frames: Uint8Array[]
  /** The settle went on for more ticks than `CAPTURE_TICKS`: the rest is not in `frames`. */
  truncated: boolean
  /** Simulated time in ms when it began. */
  time: number
  /** What started it: a clock edge, or something else (an input was operated, the circuit was loaded...). */
  cause: 'clock' | 'input'
}

/** How many clock edges the simulator can step back over. */
export const HISTORY_EDGES = 1000

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
  /** The parts with a delay of more than one tick. */
  private slow: CComp[] = []
  private netByOut = new Map<string, number>()
  private values = new Uint8Array(0)
  private listeners = new Set<() => void>()
  private dirty = true

  /** Record the ticks of each settle (only the latest one in which something changed is kept). Off by default: it costs a copy of every net per tick. */
  private capturing = false
  private lastCapture: Capture | null = null
  private nextCause: Capture['cause'] = 'input'
  /** Bumped whenever a new capture is kept or the old one is dropped, so a view can tell. */
  captureVersion = 0

  /** True when the last settle hit its tick budget, i.e. the circuit keeps changing on its own. */
  unstable = false
  /** Called after each clock edge has settled, inside `advance`: for a watcher that must see every cycle, not only the state at the end of a frame. */
  edgeHook: (() => void) | null = null
  /** Total ticks simulated since the last reset. */
  ticks = 0
  /** Simulated time in ms since the last reset. Advances with the clocks while the simulation runs. */
  time = 0
  private samplers: CComp[] = []
  /**
   * A part is evaluated again only when one of its input nets changed (or it was operated or edited, or it has a delay pipeline,
   * which moves on every tick): evaluating it with the same inputs and the same state would give the same outputs.
   */
  private stale = new Uint8Array(0)
  /** The parts flagged in `stale`, in the order they were flagged: the next tick evaluates these (and the slow parts). */
  private queue = new Int32Array(0)
  private queued = 0
  /** The queue of the tick being run; the two swap each tick (a part is in a queue once, so each is as long as `comps`). */
  private running = new Int32Array(0)
  /** What this tick's evaluations wrote: net, then value, for each output of each part evaluated. Applied after all have run. */
  private writes = new Int32Array(0)
  private written = 0
  private readers: number[][] = []
  /** A snapshot after each clock edge (and one before the first), for stepping back. */
  private history: Snapshot[] = []
  /** Which snapshot the simulation is at, when it has not moved on since (see `moved`). */
  private cursor = -1
  /** The breakpoint that asked the simulation to stop, until someone collects it with `takeBreak`. */
  private hit: string | null = null
  /** The circuit has changed since the snapshot at `cursor`: time passed, or something was operated. */
  private moved = false
  /** Whether the snapshots for stepping back are taken at all (see `setHistory`). */
  private keepHistory = true
  /** The last `advance` ran out of its time (`deadline`) with clock time left over, which was skipped: the circuit is too big for its clock. */
  private late = false

  load(c: SimCircuit) {
    this.dropCapture()
    this.history = []
    this.cursor = -1
    this.moved = false
    this.unstable = false // a different circuit: whether it oscillates is found out by the next settle
    const oldValues = new Map<string, V>()
    for (const [key, net] of this.netByOut) oldValues.set(key, this.values[net] as V)
    const oldState = new Map(this.comps.map((cc) => [cc.id, cc]))

    this.comps = []
    this.byId.clear()
    this.netByOut.clear()
    let nets = 0

    // Receive labels that share the net of the signal they carry are set up after the other parts.
    const aliases = c.aliases ?? resolveLabels(c)
    const deferred: { sc: SimComp; src: PinRef }[] = []

    const build = (sc: SimComp): CComp => {
      const def = getDef(sc.type)
      const layout = layoutOf(sc.type, sc.params)
      const ins = layout.pins.filter((p) => p.dir === 'in')
      const outs = layout.pins.filter((p) => p.dir === 'out')
      const prev = oldState.get(sc.id)
      // A part keeps what it holds when it is edited, but not when its size changed (a 4-bit counter must not keep an 8-bit count).
      // Memories adapt their contents to a new size themselves.
      const sameShape = !!prev && prev.def === def && (!!def.memory || (def.params ?? []).every((p) => !p.structural || prev.inst.params[p.key] === sc.params[p.key]))
      return {
        id: sc.id,
        def,
        inst: {
          ins: ins.map(() => X),
          outs: outs.map(() => X),
          state: sameShape && prev.inst.state !== undefined ? prev.inst.state : def.init?.(sc.params),
          params: sc.params,
        },
        inNames: ins.map((p) => p.name),
        outNames: outs.map((p) => p.name),
        inNets: new Int32Array(ins.length).fill(-1),
        inDefaults: ins.map((p) => p.def ?? X),
        outNets: new Int32Array(outs.length),
        index: -1,
        pipe: sc.delay && sc.delay > 1 && outs.length ? new Uint8Array((Math.min(MAX_DELAY, Math.round(sc.delay)) - 1) * outs.length) : undefined,
      }
    }
    const own = (cc: CComp) => {
      cc.outNames.forEach((name, i) => {
        cc.outNets[i] = nets
        this.netByOut.set(pinKey(cc.id, name), nets++)
      })
      cc.index = this.comps.length
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

    // Which parts read each net: when a net changes, only these need evaluating again.
    this.readers = Array.from({ length: nets }, () => [] as number[])
    for (const cc of this.comps) for (const n of new Set(cc.inNets)) if (n >= 0) this.readers[n].push(cc.index)
    this.stale = new Uint8Array(this.comps.length)
    this.queue = new Int32Array(this.comps.length)
    this.running = new Int32Array(this.comps.length)
    this.writes = new Int32Array(2 * nets)
    this.markAll()

    this.values = new Uint8Array(nets).fill(X)
    for (const [key, net] of this.netByOut) {
      const v = oldValues.get(key)
      if (v !== undefined) this.values[net] = v
    }
    // A slow part starts out showing what its outputs show now, so loading a circuit does not make anything move.
    this.slow = this.comps.filter((cc) => cc.pipe)
    for (const cc of this.slow) this.fillPipe(cc)
    this.clocks = this.comps.filter((cc) => cc.def.clockHalfPeriod)
    this.samplers = this.comps.filter((cc) => cc.def.sample)
    this.dirty = true
  }

  /**
   * Evaluate a part again at the next tick (it was operated, edited or changed from outside). Whatever was oscillating may have
   * stopped now, so the next settle gets its whole budget again: `unstable` is set again if the circuit still does not settle.
   */
  private touch(cc: CComp) {
    this.unstable = false
    if (cc.index >= 0) this.mark(cc.index)
  }

  /** Flag a part for evaluation at the next tick (once, however often it is flagged). */
  private mark(i: number) {
    if (this.stale[i] === 0) {
      this.stale[i] = 1
      this.queue[this.queued++] = i
    }
  }

  /** Flag every part: after loading, resetting or going back, nothing is known to be up to date. */
  private markAll() {
    for (let i = 0; i < this.comps.length; i++) this.queue[i] = i
    this.queued = this.comps.length
    this.stale.fill(1)
  }

  /** Forget all values and internal state, as if the circuit was just switched on. */
  reset() {
    this.dropCapture()
    for (const cc of this.comps) cc.inst.state = cc.def.init?.(cc.inst.params)
    this.values.fill(X)
    this.markAll()
    for (const cc of this.slow) this.fillPipe(cc)
    this.ticks = 0
    this.time = 0
    this.unstable = false
    this.history = []
    this.cursor = -1
    this.moved = false
    this.dirty = true
  }

  /** Fill a part's delay pipeline with the values its outputs have now. */
  private fillPipe(cc: CComp) {
    const pipe = cc.pipe!
    const n = cc.outNets.length
    for (let k = 0; k < pipe.length; k++) pipe[k] = this.values[cc.outNets[k % n]]
  }

  /** Run one part on the nets as they are, and queue its outputs (net, value) in `writes`. */
  private evaluate(cc: CComp) {
    const values = this.values
    const { ins, outs } = cc.inst
    const zOk = cc.def.acceptsZ
    for (let i = 0; i < ins.length; i++) {
      const n = cc.inNets[i]
      const v = n >= 0 ? (values[n] as V) : cc.inDefaults[i]
      ins[i] = v === Z && !zOk ? X : v
    }
    cc.def.evaluate(cc.inst)
    const pipe = cc.pipe
    const writes = this.writes
    let w = this.written
    if (pipe === undefined) {
      for (let o = 0; o < outs.length; o++) {
        writes[w++] = cc.outNets[o]
        writes[w++] = outs[o]
      }
    } else {
      // Commit what was computed `delay - 1` ticks ago, and queue what was computed now.
      const n = outs.length
      for (let o = 0; o < n; o++) {
        writes[w++] = cc.outNets[o]
        writes[w++] = pipe[o]
      }
      pipe.copyWithin(0, n)
      for (let o = 0; o < n; o++) pipe[pipe.length - n + o] = outs[o]
    }
    this.written = w
  }

  /**
   * Advance one gate delay. Returns true if the circuit is still moving: a net changed, or a slow part has an output
   * on its way that differs from what it shows now.
   */
  tick(): boolean {
    const { values, stale, readers, writes, comps } = this
    // Parts flagged by the last tick's changes are evaluated now; flags raised while this tick commits belong to the next.
    const run = this.queue
    const count = this.queued
    this.queue = this.running
    this.running = run
    this.queued = 0
    this.written = 0
    for (let k = 0; k < count; k++) {
      const i = run[k]
      const cc = comps[i]
      stale[i] = 0
      if (cc.pipe === undefined) this.evaluate(cc)
    }
    // A slow part moves on every tick, flagged or not.
    for (const cc of this.slow) {
      stale[cc.index] = 0
      this.evaluate(cc)
    }
    // Commit every output at once, flagging the readers of each net that changed.
    let changed = false
    for (let k = 0; k < this.written; k += 2) {
      const net = writes[k]
      const v = writes[k + 1]
      if (values[net] !== v) {
        values[net] = v
        changed = true
        for (const r of readers[net]) this.mark(r)
      }
    }
    this.ticks++
    if (changed) {
      this.dirty = true
      this.moved = true
    }
    // Not settled while a slow part still has a different value on its way.
    let pending = false
    for (const cc of this.slow) {
      const pipe = cc.pipe!
      if (pending) break
      const n = cc.outNets.length
      for (let k = 0; k < pipe.length; k++) {
        if (pipe[k] !== values[cc.outNets[k % n]]) {
          pending = true
          break
        }
      }
    }
    return changed || pending
  }

  private dropCapture() {
    if (this.lastCapture) this.captureVersion++
    this.lastCapture = null
  }

  /** Start or stop recording the ticks of each settle (see `Capture`). Stopping forgets the last one. */
  setCapture(on: boolean) {
    this.capturing = on
    if (!on) this.dropCapture()
  }

  /** The ticks of the latest settle in which anything changed, if recording is on and there has been one. */
  getCapture(): Capture | null {
    return this.lastCapture
  }

  /** For each net, the output pin that drives it (`comp:pin`): the names used with a `Capture`. */
  netNames(): string[] {
    const names = new Array<string>(this.values.length).fill('')
    for (const [key, net] of this.netByOut) if (!names[net]) names[net] = key
    return names
  }

  /** The net an output pin drives, or an input pin reads (-1 if it is unconnected or unknown). */
  netOf(compId: string, pin: string): number {
    const out = this.netByOut.get(pinKey(compId, pin))
    if (out !== undefined) return out
    const cc = this.byId.get(compId)
    const i = cc ? cc.inNames.indexOf(pin) : -1
    return cc && i >= 0 ? cc.inNets[i] : -1
  }

  /** Tick until nothing changes or the budget runs out. Returns true if the circuit settled. */
  settle(maxTicks = 1000): boolean {
    const cause = this.nextCause
    this.nextCause = 'input'
    const rec: Capture | null = this.capturing ? { frames: [this.values.slice()], truncated: false, time: this.time, cause } : null
    let changed = false
    let settled = false
    for (let i = 0; i < maxTicks && !settled; i++) {
      settled = !this.tick()
      if (!rec) continue
      if (rec.frames.length > CAPTURE_TICKS) {
        rec.truncated = true
        changed = true
        continue
      }
      const now = this.values.slice()
      const before = rec.frames[rec.frames.length - 1]
      if (!changed) for (let n = 0; n < now.length; n++) if (now[n] !== before[n]) changed = true
      rec.frames.push(now)
    }
    this.unstable = !settled
    this.sample()
    if (rec && changed) {
      this.lastCapture = rec
      this.captureVersion++
      this.dirty = true
    }
    return settled
  }

  /** Let parts that record over time (probes, dot matrices) look at the settled values. */
  private sample() {
    for (const cc of this.samplers) {
      const { ins } = cc.inst
      const zOk = cc.def.acceptsZ
      for (let i = 0; i < ins.length; i++) {
        const n = cc.inNets[i]
        const v = n >= 0 ? (this.values[n] as V) : cc.inDefaults[i]
        ins[i] = v === Z && !zOk ? X : v
      }
      if (cc.def.sample!(cc.inst, this.time) === true && this.hit === null) this.hit = cc.id
      this.dirty = true
    }
  }

  /** Budget for a settle: an oscillating circuit gets a few ticks per call so it animates visibly. */
  private budget() {
    return this.unstable ? 2 : 1000
  }

  /**
   * Advance real time by `ms`, toggling clocks at their edges and settling after each edge. At most 64 edges are done, or, with
   * a `deadline` (a `performance.now()` time), as many as fit before it: time that cannot be simulated in time is skipped, so a
   * circuit that is too big for the clock runs slower than the clock says.
   */
  advance(ms: number, deadline?: number) {
    let left = ms
    this.late = false
    this.hit = null // a stop is reported for the call that tripped it (see takeBreak)
    const maxEdges = deadline === undefined ? 64 : 100000
    for (let edges = 0; edges < maxEdges && this.clocks.length; edges++) {
      if (deadline !== undefined && (edges & 3) === 3 && performance.now() > deadline) {
        this.late = true
        break
      }
      // A breakpoint stops the simulation at the edge that tripped it: no further edges, and the rest of the time is dropped.
      if (this.hit !== null) return
      let step = Infinity
      for (const c of this.clocks) step = Math.min(step, c.def.clockHalfPeriod!(c.inst.params) - c.inst.state.elapsed)
      step = Math.max(0, step)
      if (step > left) break
      if (!this.history.length) this.record() // so the very first edge can be stepped back over, too
      left -= step
      this.time += step
      for (const c of this.clocks) {
        const st = c.inst.state
        st.elapsed += step
        if (st.elapsed >= c.def.clockHalfPeriod!(c.inst.params) - 1e-9) {
          st.elapsed = 0
          st.phase = st.phase === 1 ? 0 : 1
          this.mark(c.index)
        }
      }
      this.nextCause = 'clock'
      this.settle(this.budget())
      this.record()
      this.edgeHook?.()
    }
    for (const c of this.clocks) {
      const st = c.inst.state
      st.elapsed = Math.min(st.elapsed + left, c.def.clockHalfPeriod!(c.inst.params))
    }
    this.time += left
    if (left > 1e-3) this.moved = true
  }

  /**
   * Take the snapshots for stepping back, or not. Off, nothing is copied at a clock edge and there is nothing to step back to: this
   * is what a circuit that runs too many edges to step back over (a computer running a program) needs. The setting stays when a
   * circuit is loaded or reset. Turning it off forgets the history; turning it on begins a new one at the next clock edge.
   */
  setHistory(on: boolean) {
    if (this.keepHistory === on) return
    this.keepHistory = on
    if (!on) {
      this.history = []
      this.cursor = -1
      this.moved = false
    }
    this.dirty = true
  }

  get historyOn() {
    return this.keepHistory
  }

  /** Did the last `advance` (or `frame`) have to skip clock time because its work took too long? Whoever runs the simulation may give it more time. */
  get lagging() {
    return this.late
  }

  /** Remember the settled state, dropping any snapshots after the one we stepped back to. */
  private record() {
    if (!this.keepHistory) return
    if (this.cursor < this.history.length - 1) this.history.length = this.cursor + 1
    this.history.push({
      time: this.time,
      ticks: this.ticks,
      unstable: this.unstable,
      values: this.values.slice(),
      states: this.comps.map((cc) => (cc.def.sample || cc.inst.state === undefined ? undefined : cloneState(cc.inst.state))),
      pipes: this.comps.map((cc) => cc.pipe?.slice()),
    })
    if (this.history.length > HISTORY_EDGES) this.history.shift()
    this.cursor = this.history.length - 1
    this.moved = false
  }

  /** Is there an earlier clock edge to go back to? */
  canStepBack(): boolean {
    return this.history.length > 0 && this.cursor >= (this.moved ? 0 : 1)
  }

  /**
   * Go back to the previous clock edge: the state right after it, with the time, the clocks and every memory as they
   * were. If the circuit has moved on since the last edge (time passed, a switch was flipped), this first returns to
   * that edge. Returns false if there is nothing to go back to.
   */
  stepBack(): boolean {
    if (!this.canStepBack()) return false
    const target = this.moved ? this.cursor : this.cursor - 1
    const snap = this.history[target]
    if (snap.values.length !== this.values.length || snap.states.length !== this.comps.length) return false
    this.values.set(snap.values)
    this.comps.forEach((cc, i) => {
      if (cc.def.sample) cc.def.rewind?.(cc.inst, snap.time)
      else if (snap.states[i] !== undefined) cc.inst.state = cloneState(snap.states[i])
      const saved = snap.pipes[i]
      if (cc.pipe && saved && saved.length === cc.pipe.length) cc.pipe.set(saved)
    })
    this.time = snap.time
    this.unstable = snap.unstable
    this.markAll()
    this.cursor = target
    this.dirty = true
    // Settle again, in case a switch was flipped since (parameters are not part of the snapshot), and let the
    // probes see the restored values. Either way we are now "at" this edge: another step back goes one further.
    if (snap.unstable) this.sample()
    else this.settle()
    this.ticks = snap.ticks
    this.moved = false
    return true
  }

  /**
   * The id of the breakpoint that stopped the last `advance`, `frame` or `stepClock`, if any (once: it is forgotten
   * when collected, and by the next `advance`). Whoever runs the simulation calls this after advancing it and, if it
   * returns something, stops running and says why.
   */
  takeBreak(): string | null {
    const h = this.hit
    this.hit = null
    return h
  }

  /** One animation frame of a running simulation. */
  frame(ms: number, workMs?: number) {
    this.advance(ms, workMs === undefined ? undefined : performance.now() + workMs)
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

  /** Current value seen at a pin (outputs: the net it drives, which can be Z; inputs: the net feeding it or its default, with Z read as X by parts that don't accept it). */
  pinValue(compId: string, pin: string): V {
    const out = this.netByOut.get(pinKey(compId, pin))
    if (out !== undefined) return this.values[out] as V
    const cc = this.byId.get(compId)
    if (!cc) return X
    const i = cc.inNames.indexOf(pin)
    if (i < 0) return X
    const n = cc.inNets[i]
    const v = n >= 0 ? (this.values[n] as V) : cc.inDefaults[i]
    return v === Z && !cc.def.acceptsZ ? X : v // an input shows what the part reads: only a part that accepts Z sees Z
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
    // Parts with a screen of their own (console, pixel screen) count their changes, so a write redraws them.
    const rev = cc.def.revision?.(cc.inst)
    return rev === undefined ? s : `${s}#${rev}`
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
    const mem = cc?.def.memory
    if (!cc || !mem || !(index >= 0 && index < mem.size(cc.inst))) return false
    mem.write(cc.inst, index, value)
    this.touch(cc)
    this.dirty = true
    this.moved = true
    return true
  }

  /** Change params that don't affect the pin layout (switch position, input value, clock rate...). */
  setParams(compId: string, params: Params) {
    const cc = this.byId.get(compId)
    if (!cc) return
    cc.inst.params = params
    this.touch(cc)
    this.dirty = true
  }

  setState(compId: string, patch: Record<string, unknown>) {
    const cc = this.byId.get(compId)
    if (!cc) return
    cc.inst.state = { ...cc.inst.state, ...patch }
    this.touch(cc)
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
