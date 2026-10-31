import { aciaBreak, aciaKey, aciaPut, aciaType, type AciaState } from './acia'
import { resolveLabels } from './netlabels'
import { layoutOf } from './layoutcache'
import { getDef, hasDef } from './registry'
import { buildPlan, type Plan, type Rejected } from './fast'
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
  /** For the fast engine, per input: 1 if a change there makes the part evaluate (always, but for a registered part's data pins). */
  wakeIns: Uint8Array
  /** Which inputs are clock pins. */
  clockIns: number[]
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

/** What the page can do to a terminal part (see `Simulator.terminal`). */
export type TerminalOp =
  | { op: 'type'; text: string; capitals: boolean }
  | { op: 'key'; code: number }
  | { op: 'break' }
  | { op: 'clear' }

/**
 * What a page that does not run the simulation itself needs to show it (see `engine/remote.ts`): the nets, the state of the parts
 * that have one, and the numbers beside them. `states` has `[index of the part, its state]` pairs.
 */
export interface ViewSnapshot {
  values: Uint8Array
  time: number
  unstable: boolean
  states: [number, unknown][]
  engine: 'fast' | 'exact'
  lagging: boolean
  offered: number
  skipped: number
  forces: [string, 0 | 1][]
  historyOn: boolean
  canBack: boolean
  captureVersion: number
  /** Only when it changed since the last snapshot sent. */
  capture?: Capture | null
  fastestHz: number | null
  hit: string | null
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
  /** Signals held at 0 or 1 from outside (a stuck-at fault): by the output pin that drives the net (`comp:pin`). Kept when the circuit is compiled again. */
  private forces = new Map<string, 0 | 1>()
  /** The forces by net (-1: not forced), or null while there are none, which keeps the commit of every tick free of the check. */
  private forced: Int8Array | null = null
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
  /** The nets this tick's evaluations changed (each once: a net has one writer). `tick` passes the changes on to the pins that read them. */
  private changedNets = new Int32Array(0)
  private nChanged = 0
  /**
   * Which input pins read each net, flat: the readers of net `n` are the entries `readerStart[n] .. readerStart[n + 1])` of
   * `readerPart` (the part), and `readerSlot` (where that pin lives in `pins`, times two, plus one if the part accepts Z).
   */
  private readerStart = new Int32Array(1)
  private readerPart = new Int32Array(0)
  private readerSlot = new Int32Array(0)
  /** Per reader entry, for the fast engine: does a change on this pin wake the part (see `CComp.wakeIns`)? */
  private readerWake = new Uint8Array(0)
  /**
   * Every part's input pins, one after the other: a part's `inst.ins` is a view of its stretch of this. A net that changes writes its new
   * value into the pins that read it as it is committed, so evaluating a part needs no gathering of its inputs.
   */
  private pins = new Uint8Array(0)
  /** Whether the fast engine may be used at all (see `setFast`), the plan for the current circuit (or why there is none), and whether it is in use. */
  private fastAllowed = false
  private plan: Plan | Rejected = 'untimed'
  private usingFast = false
  /** Fast engine: flags per position in the plan's order, the range of positions flagged, and the registered parts woken. */
  private rankFlag = new Uint8Array(0)
  private lo = 0
  private hi = -1
  private regList = new Int32Array(0)
  private regCount = 0
  private regQueued = new Uint8Array(0)
  /** The registered parts evaluated in one round, whose outputs are committed together. */
  private regRun = new Int32Array(0)
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
  /** Clock time asked of `advance` since the page opened, and how much of it was skipped (ms): see `clockTime`. */
  private offeredMs = 0
  private skippedMs = 0
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

    const wakes = (def: ComponentDef, pins: { name: string; clock?: boolean }[]) => {
      const w = new Uint8Array(pins.length).fill(def.idle ? 0 : 1)
      if (def.timing === 'registered') pins.forEach((p, i) => (w[i] = p.clock || def.immediateIns?.includes(p.name) ? 1 : 0))
      return w
    }
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
        wakeIns: wakes(def, ins),
        clockIns: ins.flatMap((p, i) => (p.clock ? [i] : [])),
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
    let pinCount = 0
    for (const cc of this.comps) pinCount += cc.inNets.length
    this.pins = new Uint8Array(pinCount)
    const readers = Array.from({ length: nets }, () => [] as [number, number, number][])
    let at = 0
    for (const cc of this.comps) {
      cc.inst.ins = this.pins.subarray(at, at + cc.inNets.length) as unknown as V[]
      cc.inNets.forEach((n, i) => {
        if (n >= 0) readers[n].push([cc.index, (at + i) * 2 + (cc.def.acceptsZ ? 1 : 0), cc.wakeIns[i]])
      })
      at += cc.inNets.length
    }
    this.readerStart = new Int32Array(nets + 1)
    for (let n = 0; n < nets; n++) this.readerStart[n + 1] = this.readerStart[n] + readers[n].length
    this.readerPart = Int32Array.from(readers.flatMap((r) => r.map((e) => e[0])))
    this.readerSlot = Int32Array.from(readers.flatMap((r) => r.map((e) => e[1])))
    this.readerWake = Uint8Array.from(readers.flatMap((r) => r.map((e) => e[2])))
    this.stale = new Uint8Array(this.comps.length)
    this.queue = new Int32Array(this.comps.length)
    this.running = new Int32Array(this.comps.length)
    this.changedNets = new Int32Array(nets)
    this.markAll()

    this.values = new Uint8Array(nets).fill(X)
    for (const [key, net] of this.netByOut) {
      const v = oldValues.get(key)
      if (v !== undefined) this.values[net] = v
    }
    this.applyForces()
    this.syncPins()
    // A slow part starts out showing what its outputs show now, so loading a circuit does not make anything move.
    this.slow = this.comps.filter((cc) => cc.pipe)
    for (const cc of this.slow) this.fillPipe(cc)
    this.clocks = this.comps.filter((cc) => cc.def.clockHalfPeriod)
    this.samplers = this.comps.filter((cc) => cc.def.sample)
    this.plan = buildPlan(
      this.comps.map((cc) => ({
        timing: cc.def.timing,
        inNets: cc.inNets,
        outNets: cc.outNets,
        clockIns: cc.clockIns,
        slow: !!cc.pipe,
        ticking: !!cc.def.clockHalfPeriod,
      })),
      nets,
    )
    this.usingFast = false
    this.rankFlag = new Uint8Array(typeof this.plan === 'string' ? 0 : this.plan.order.length)
    this.regList = new Int32Array(this.comps.length)
    this.regRun = new Int32Array(this.comps.length)
    this.regQueued = new Uint8Array(this.comps.length)
    this.markAll()
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
    if (this.usingFast) {
      this.flagFast(i)
      return
    }
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
    // (the fast engine's flags too: whichever engine runs next re-evaluates everything once)
    this.rankFlag.fill(1)
    this.lo = 0
    this.hi = this.rankFlag.length - 1
    this.regCount = 0
    this.regQueued.fill(0)
    if (typeof this.plan !== 'string' && this.plan.rank.length === this.comps.length) {
      const rank = this.plan.rank
      for (let i = 0; i < this.comps.length; i++) if (rank[i] < 0) this.wakeReg(i)
    }
  }

  /** Flag a part for the fast engine: a part of the order by its position, a registered part in the list of those to evaluate. */
  private flagFast(i: number) {
    const plan = this.plan
    if (typeof plan === 'string') return
    const r = plan.rank[i]
    if (r < 0) this.wakeReg(i)
    else if (this.rankFlag[r] === 0) {
      this.rankFlag[r] = 1
      if (r < this.lo) this.lo = r
      if (r > this.hi) this.hi = r
    }
  }

  private wakeReg(i: number) {
    if (this.regQueued[i] === 0) {
      this.regQueued[i] = 1
      this.regList[this.regCount++] = i
    }
  }

  /**
   * Allow the fast engine for circuits that can use it (see docs/spec-sim-speed-tier2.md), or not. It is used when the circuit has
   * no loop of gates, no part with a delay and no race between a clock and its data, and while no signal is held and no capture is on.
   */
  setFast(on: boolean) {
    this.fastAllowed = on
  }

  /** Is the fast engine allowed (see `setFast`)? */
  get fastOn() {
    return this.fastAllowed
  }

  /** Which engine settles the circuit now: 'fast', or 'exact' (the unit-delay engine). */
  get engine(): 'fast' | 'exact' {
    return this.fastAllowed && this.plan !== null && typeof this.plan !== 'string' && !this.capturing && this.forced === null ? 'fast' : 'exact'
  }

  /** Why the fast engine cannot run this circuit, or null if it can. */
  get fastRejected(): Rejected | null {
    return typeof this.plan === 'string' ? this.plan : null
  }

  /** Forget all values and internal state, as if the circuit was just switched on. */
  reset() {
    this.dropCapture()
    for (const cc of this.comps) cc.inst.state = cc.def.init?.(cc.inst.params)
    this.values.fill(X)
    this.syncPins()
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

  /** Copy what the nets hold into every part's input pins (after the nets were set as a whole), and the defaults into the unconnected ones. */
  private syncPins() {
    for (const cc of this.comps) {
      const { ins } = cc.inst
      const zOk = cc.def.acceptsZ
      for (let i = 0; i < ins.length; i++) {
        const n = cc.inNets[i]
        const v = n >= 0 ? (this.values[n] as V) : cc.inDefaults[i]
        ins[i] = v === Z && !zOk ? X : v
      }
    }
  }

  /**
   * Run one part on its input pins and put its outputs on their nets, noting each net that changed in `changedNets`. The parts
   * that read those nets still see the old values on their pins until `tick` has run every part (see `tick`).
   * Every net has one writer, so writing at once cannot change what another part computes in the same tick.
   */
  private evaluate(cc: CComp) {
    const { outs } = cc.inst
    cc.def.evaluate(cc.inst)
    const pipe = cc.pipe
    const { values, forced, changedNets } = this
    const outNets = cc.outNets
    let c = this.nChanged
    const n = outs.length
    for (let o = 0; o < n; o++) {
      const net = outNets[o]
      let v: number = outs[o]
      if (pipe !== undefined) {
        // Commit what was computed `delay - 1` ticks ago (queue what was computed now, below).
        v = pipe[o]
      }
      if (forced !== null && forced[net] >= 0) v = forced[net]
      if (values[net] !== v) {
        values[net] = v
        changedNets[c++] = net
      }
    }
    if (pipe !== undefined) {
      pipe.copyWithin(0, n)
      for (let o = 0; o < n; o++) pipe[pipe.length - n + o] = outs[o]
    }
    this.nChanged = c
  }

  /**
   * Advance one gate delay. Returns true if the circuit is still moving: a net changed, or a slow part has an output
   * on its way that differs from what it shows now.
   */
  tick(): boolean {
    if (this.usingFast) {
      // Stepping gate delays one by one (the Step button) is what the exact engine is for: it takes over from here, and `settle` hands
      // back to the fast engine at the next clock edge or switch change.
      this.usingFast = false
      this.markAll()
    }
    const { values, stale, readerStart, readerPart, readerSlot, pins, changedNets, comps } = this
    // Parts flagged by the last tick's changes are evaluated now; flags raised while this tick commits belong to the next.
    const run = this.queue
    const count = this.queued
    this.queue = this.running
    this.running = run
    this.queued = 0
    this.nChanged = 0
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
    // Pass every change on to the pins that read the net, and flag those parts for the next tick.
    const nChanged = this.nChanged
    const queue = this.queue
    let queued = 0
    const changed = nChanged > 0
    for (let k = 0; k < nChanged; k++) {
      const net = changedNets[k]
      const v = values[net]
      for (let r = readerStart[net], end = readerStart[net + 1]; r < end; r++) {
        const slot = readerSlot[r]
        pins[slot >> 1] = v === Z && (slot & 1) === 0 ? X : v
        const i = readerPart[r]
        if (stale[i] === 0) {
          stale[i] = 1
          queue[queued++] = i
        }
      }
    }
    this.queued = queued
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
        const net = cc.outNets[k % n]
        if (pipe[k] !== values[net] && !(this.forced !== null && this.forced[net] >= 0)) {
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
    const fast = this.engine === 'fast'
    if (fast !== this.usingFast) {
      // The other engine takes over: it re-evaluates every part once, which changes nothing in a circuit that is up to date.
      this.usingFast = fast
      this.markAll()
    }
    if (fast) return this.settleFast(maxTicks)
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

  /**
   * The fast engine's settle (see docs/spec-sim-speed-tier2.md): rounds of one pass over the combinational parts that need it, in order,
   * each evaluated once, and then the registered parts whose clock (or clear) changed, which all read their inputs before any writes.
   */
  private settleFast(maxRounds: number): boolean {
    this.nextCause = 'input'
    const plan = this.plan as Plan
    const limit = Math.min(maxRounds, 64)
    let settled = false
    for (let round = 0; round < limit; round++) {
      this.combPass(plan)
      if (this.regCount === 0 && this.hi < this.lo) {
        settled = true
        break
      }
      this.ticks++
      this.registeredRound()
    }
    this.unstable = !settled
    this.sample()
    return settled
  }

  /** Evaluate the flagged parts of the order, lowest position first; a part flags only parts after it. */
  private combPass(plan: Plan) {
    const order = plan.order
    const flag = this.rankFlag
    const comps = this.comps
    while (this.lo <= this.hi) {
      const lo = this.lo
      const hi = this.hi
      this.lo = flag.length
      this.hi = -1
      for (let r = lo; r <= hi; r++) {
        if (flag[r] === 0) continue
        flag[r] = 0
        const cc = comps[order[r]]
        cc.def.evaluate(cc.inst)
        this.commitOuts(cc)
      }
    }
  }

  /** Evaluate the registered parts that were woken, all before any of them puts an output on a net, then commit the outputs. */
  private registeredRound() {
    const n = this.regCount
    const run = this.regRun
    for (let k = 0; k < n; k++) {
      const i = this.regList[k]
      run[k] = i
      this.regQueued[i] = 0
    }
    this.regCount = 0
    for (let k = 0; k < n; k++) {
      const cc = this.comps[run[k]]
      cc.def.evaluate(cc.inst)
    }
    for (let k = 0; k < n; k++) this.commitOuts(this.comps[run[k]])
  }

  /** Put a part's outputs on their nets; each net that changes updates the pins that read it and wakes the readers it should. */
  private commitOuts(cc: CComp) {
    const { values, pins, readerStart, readerPart, readerSlot, readerWake } = this
    const outs = cc.inst.outs
    const outNets = cc.outNets
    for (let o = 0; o < outs.length; o++) {
      const net = outNets[o]
      const v = outs[o]
      if (values[net] === v) continue
      values[net] = v
      this.dirty = true
      this.moved = true
      for (let r = readerStart[net], end = readerStart[net + 1]; r < end; r++) {
        const slot = readerSlot[r]
        pins[slot >> 1] = v === Z && (slot & 1) === 0 ? X : v
        if (readerWake[r] === 1) this.flagFast(readerPart[r])
      }
    }
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
    if (this.clocks.length) this.offeredMs += ms
    this.hit = null // a stop is reported for the call that tripped it (see takeBreak)
    const maxEdges = deadline === undefined ? 64 : 100000
    for (let edges = 0; edges < maxEdges && this.clocks.length; edges++) {
      if (deadline !== undefined && (edges & 3) === 3 && performance.now() > deadline) {
        this.late = true
        this.skippedMs += left
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

  /** Rebuild `forced` from `forces` for the current nets (a force on a pin that is gone is dropped), and put the forced values on the nets. */
  private applyForces() {
    for (const key of [...this.forces.keys()]) if (!this.netByOut.has(key)) this.forces.delete(key)
    if (!this.forces.size) {
      this.forced = null
      return
    }
    this.forced = new Int8Array(this.values.length).fill(-1)
    for (const [key, v] of this.forces) {
      const net = this.netByOut.get(key)!
      this.forced[net] = v
      this.setNet(net, v)
    }
  }

  /** Put a value on a net from outside, flagging the parts that read it. */
  private setNet(net: number, v: V) {
    if (this.values[net] === v) return
    this.values[net] = v
    for (let r = this.readerStart[net], end = this.readerStart[net + 1]; r < end; r++) {
      const slot = this.readerSlot[r]
      this.pins[slot >> 1] = v === Z && (slot & 1) === 0 ? X : v
      this.mark(this.readerPart[r])
    }
    this.unstable = false
    this.dirty = true
    this.moved = true
  }

  /**
   * Hold the signal an output pin drives at 0 or 1, whatever its part says (a stuck-at fault), or let it go again with `null`.
   * Returns false when the pin drives nothing here. The caller settles afterwards.
   */
  force(compId: string, pin: string, v: 0 | 1 | null): boolean {
    const key = pinKey(compId, pin)
    const net = this.netByOut.get(key)
    if (net === undefined) return false
    if (v === null) this.forces.delete(key)
    else this.forces.set(key, v)
    this.applyForces()
    // Letting go: the part that drives the net says what it is again.
    if (v === null) {
      const driver = this.byId.get(compId)
      if (driver) this.touch(driver)
    }
    this.dirty = true
    return true
  }

  /** What an output pin is held at, or null if it is not held. */
  forcedValue(compId: string, pin: string): 0 | 1 | null {
    if (!this.forces.size) return null // every wire asks on every publish
    return this.forces.get(pinKey(compId, pin)) ?? null
  }

  /** How many signals are held at the moment. */
  get forceCount(): number {
    return this.forces.size
  }

  /** Let every held signal go. */
  clearForces() {
    if (!this.forces.size) return
    const drivers = [...this.forces.keys()].map((k) => this.byId.get(k.slice(0, k.lastIndexOf(':'))))
    this.forces.clear()
    this.forced = null
    for (const d of drivers) if (d) this.touch(d)
    this.dirty = true
  }

  /** Clock time asked of the simulation, and how much of it had to be skipped because the work did not fit (ms, running totals). */
  get clockTime() {
    return { offered: this.offeredMs, skipped: this.skippedMs }
  }

  /** The rate of the fastest clock in Hz, or null if there is no clock (or none that ticks). */
  fastestClockHz(): number | null {
    let hz = 0
    for (const c of this.clocks) {
      const half = c.def.clockHalfPeriod!(c.inst.params)
      if (half > 0 && Number.isFinite(half)) hz = Math.max(hz, 500 / half)
    }
    return hz > 0 ? hz : null
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
    this.syncPins()
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

  /**
   * Clock edges until a 6502 part has finished a cycle (`'cycle'`) or is about to fetch the next instruction (`'instruction'`), at most
   * `max` of them: the stepping buttons of the CPU inspector. It is here, and not a loop in the inspector, so that it can run next to the
   * simulation, where the answer is at hand after every edge.
   */
  stepCpu(compId: string, what: 'cycle' | 'instruction', max = 400) {
    const cpu = () => (this.byId.get(compId)?.inst.state as { cpu?: { cycles: number; prog: number; sync: boolean } } | undefined)?.cpu
    const before = cpu()?.cycles
    for (let i = 0; i < max; i++) {
      const c = cpu()
      if (c && c.cycles !== before && (what === 'cycle' || (c.prog < 0 && c.sync))) break
      this.stepClock()
    }
  }

  /** What the page does to a terminal part's keyboard and screen: the part's state is changed here, where the simulation is. */
  terminal(compId: string, op: TerminalOp) {
    const st = this.byId.get(compId)?.inst.state as AciaState | undefined
    if (!st) return
    if (op.op === 'type') aciaType(st, op.text, op.capitals)
    else if (op.op === 'key') aciaKey(st, op.code)
    else if (op.op === 'break') aciaBreak(st)
    else aciaPut(st, 12) // clear the screen
    this.dirty = true
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
    cc.inst.cfg = undefined
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

  /** Always false here: the simulation of the canvas may run in a worker instead (`engine/remote.ts`), and says so. */
  readonly threaded: boolean = false

  /** Run the simulation by itself (a worker does) at a speed, or stop. Does nothing here: whoever drives this simulator calls `frame`. */
  run(_running: boolean, _speed: number) {}

  /** What a mirror needs to show the simulation as it is now. `sinceCapture` is the capture version the mirror already has. */
  viewSnapshot(sinceCapture: number): ViewSnapshot {
    const states: [number, unknown][] = []
    this.comps.forEach((cc, i) => {
      if (cc.inst.state !== undefined) states.push([i, cc.inst.state])
    })
    return {
      values: this.values.slice(),
      time: this.time,
      unstable: this.unstable,
      states,
      engine: this.engine,
      lagging: this.late,
      offered: this.offeredMs,
      skipped: this.skippedMs,
      forces: [...this.forces],
      historyOn: this.keepHistory,
      canBack: this.canStepBack(),
      captureVersion: this.captureVersion,
      ...(this.captureVersion !== sinceCapture ? { capture: this.lastCapture } : {}),
      fastestHz: this.fastestClockHz(),
      hit: this.takeBreak(),
    }
  }

  /** A copy of the nets, for `edgeHook` watchers on another thread. */
  viewValues(): Uint8Array {
    return this.values.slice()
  }

  /** Show what a `viewSnapshot` of the same circuit holds: the nets and part states are replaced, nothing is evaluated. */
  applyView(v: ViewSnapshot) {
    if (v.values.length !== this.values.length) return
    this.values.set(v.values)
    this.time = v.time
    this.unstable = v.unstable
    for (const [i, st] of v.states) if (this.comps[i]) this.comps[i].inst.state = st
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
