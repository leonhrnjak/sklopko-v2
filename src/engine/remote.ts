import type { Params } from './types'
import { Simulator, type Capture, type SimCircuit, type TerminalOp, type ViewSnapshot } from './simulator'

/**
 * Running the canvas's simulation somewhere else, in a Web Worker (docs/spec-sim-worker.md).
 *
 * - `SimHost` lives where the simulation runs. It owns a `Simulator`, does what the page asks, runs by itself when told to, and sends
 *   a `ViewSnapshot` of it (at most one that the page has not yet taken).
 * - `WorkerSim` lives on the page and is what the app sees as `sim` (`SimApi`). Commands are messages. What is drawn is read from a
 *   mirror: a second `Simulator` of the same circuit that is never run, only filled in from the snapshots.
 *
 * Neither knows about `Worker`: they talk through a `Port`, so the tests can join them directly.
 */

export interface Port {
  postMessage(message: unknown, transfer?: Transferable[]): void
  onmessage: ((e: { data: unknown }) => void) | null
}

export type Command =
  | { t: 'load'; circuit: SimCircuit }
  | { t: 'reset' }
  | { t: 'settle' }
  | { t: 'tick' }
  | { t: 'stepClock' }
  | { t: 'stepBack' }
  | { t: 'terminal'; id: string; op: TerminalOp }
  | { t: 'stepCpu'; id: string; what: 'cycle' | 'instruction' }
  | { t: 'setParams'; id: string; params: Params }
  | { t: 'setState'; id: string; patch: Record<string, unknown> }
  | { t: 'writeWord'; id: string; index: number; value: number }
  | { t: 'force'; id: string; pin: string; v: 0 | 1 | null }
  | { t: 'clearForces' }
  | { t: 'setHistory'; on: boolean }
  | { t: 'setFast'; on: boolean }
  | { t: 'setCapture'; on: boolean }
  | { t: 'run'; running: boolean; speed: number }
  | { t: 'edgeHook'; on: boolean }
  | { t: 'ack' }

interface SnapshotMessage {
  t: 'snapshot'
  view: ViewSnapshot
  /** The nets (and time) after each clock edge since the last message, for an `edgeHook`: only while one is set. */
  edges?: { values: Uint8Array[]; times: number[] }
}

/** The most clock edges kept for an `edgeHook` between two messages (the oldest are dropped). */
const EDGES_MAX = 5000

/** The most simulation work done in one go before the host listens for commands again (ms). */
const SLICE_MS = 12

/** The part that runs the simulation (in the worker). */
export class SimHost {
  private sim = new Simulator()
  private running = false
  private speed = 1
  private last = 0
  private scheduled = false
  private inFlight = false
  private changed = true
  private captureSent = -1
  private hit: string | null = null
  private edges: { values: Uint8Array[]; times: number[] } | null = null
  private kicker: () => void
  private port: Pick<Port, 'postMessage'>

  /** `kick` asks for `slice` to be called soon, after other messages had their turn (a message channel in a worker; the tests do it by hand). */
  constructor(port: Pick<Port, 'postMessage'>, kick?: (fn: () => void) => void) {
    this.port = port
    const channel = typeof MessageChannel === 'function' ? new MessageChannel() : null
    let pending: (() => void) | null = null
    if (channel) channel.port1.onmessage = () => pending?.()
    this.kicker = () => {
      if (kick) kick(this.slice)
      else if (channel) {
        pending = this.slice
        channel.port2.postMessage(0)
      } else setTimeout(this.slice, 0)
    }
  }

  handle(m: Command) {
    const s = this.sim
    switch (m.t) {
      case 'load':
        s.load(m.circuit)
        break
      case 'reset':
        s.reset()
        break
      case 'settle':
        s.settle()
        break
      case 'tick':
        s.tick()
        break
      case 'stepClock':
        s.stepClock()
        break
      case 'stepBack':
        s.stepBack()
        break
      case 'terminal':
        s.terminal(m.id, m.op)
        break
      case 'stepCpu':
        s.stepCpu(m.id, m.what)
        break
      case 'setParams':
        s.setParams(m.id, m.params)
        if (!this.running) s.settle() // (a paused simulation has no frame to carry the change through the circuit)
        break
      case 'setState':
        s.setState(m.id, m.patch)
        if (!this.running) s.settle()
        break
      case 'writeWord':
        s.writeWord(m.id, m.index, m.value)
        break
      case 'force':
        s.force(m.id, m.pin, m.v)
        break
      case 'clearForces':
        s.clearForces()
        break
      case 'setHistory':
        s.setHistory(m.on)
        break
      case 'setFast':
        s.setFast(m.on)
        break
      case 'setCapture':
        s.setCapture(m.on)
        break
      case 'run':
        if (m.running && !this.running) this.last = performance.now()
        this.running = m.running
        this.speed = m.speed
        if (this.running) this.schedule()
        break
      case 'edgeHook':
        this.edges = m.on ? { values: [], times: [] } : null
        s.edgeHook = m.on ? () => this.noteEdge() : null
        break
      case 'ack':
        this.inFlight = false
        break
    }
    if (m.t !== 'ack') this.changed = true
    this.flush()
  }

  /** Keep the nets after a clock edge for the page's `edgeHook`. */
  private noteEdge() {
    const e = this.edges
    if (!e) return
    if (e.values.length >= EDGES_MAX) {
      e.values.shift()
      e.times.shift()
    }
    e.values.push(this.sim.viewValues())
    e.times.push(this.sim.time)
  }

  private schedule() {
    if (this.scheduled) return
    this.scheduled = true
    this.kicker()
  }

  /** One slice of running: simulate the time since the last one (as far as `SLICE_MS` of work goes), then pass the snapshot on. */
  slice = () => {
    this.scheduled = false
    if (!this.running) return
    const now = performance.now()
    const dt = Math.min(now - this.last, 100)
    this.last = now
    this.sim.frame(dt * this.speed, SLICE_MS)
    const hit = this.sim.takeBreak()
    if (hit) {
      this.hit = hit
      this.running = false
    }
    this.changed = true
    this.flush()
    if (this.running) this.schedule()
  }

  /** Send a snapshot if there is something new and the page has taken the last one. */
  private flush() {
    if (this.changed && !this.inFlight) this.send()
  }

  private send() {
    const view = this.sim.viewSnapshot(this.captureSent)
    this.captureSent = view.captureVersion
    view.hit = view.hit ?? this.hit
    this.hit = null
    this.changed = false
    this.inFlight = true
    const message: SnapshotMessage = { t: 'snapshot', view }
    const transfer = [view.values.buffer]
    if (this.edges && this.edges.values.length) {
      message.edges = this.edges
      this.edges = { values: [], times: [] }
      for (const v of message.edges.values) transfer.push(v.buffer)
    }
    this.port.postMessage(message, transfer)
  }
}

/** The part on the page: what the app uses as `sim` when the simulation runs in a worker. */
export class WorkerSim {
  readonly threaded = true
  private port: Port
  private mirror = new Simulator()
  private view: ViewSnapshot | null = null
  private capture: Capture | null = null
  private hit: string | null = null
  private fast = false
  private history = true
  private lastRun = ''
  private hook: (() => void) | null = null
  private hooked = false

  constructor(port: Port) {
    this.port = port
    port.onmessage = (e) => {
      const m = e.data as SnapshotMessage
      if (m?.t !== 'snapshot') return
      this.take(m)
    }
  }

  private send(m: Command) {
    this.port.postMessage(m)
  }

  private take(m: SnapshotMessage) {
    const v = m.view
    if (v.capture !== undefined) this.capture = v.capture
    this.view = v
    if (v.hit) this.hit = v.hit
    if (m.edges) {
      // Every clock edge since the last message, one after the other, for a watcher that must see each of them.
      for (let i = 0; i < m.edges.values.length; i++) {
        this.mirror.applyView({ ...v, values: m.edges.values[i], time: m.edges.times[i], states: i === m.edges.values.length - 1 ? v.states : [] })
        this.hook?.()
      }
    }
    this.mirror.applyView(v)
    this.send({ t: 'ack' })
    this.mirror.publish()
  }

  // The commands: sent to the simulation, nothing to wait for. What they did arrives with the next snapshot.
  load(c: SimCircuit) {
    this.mirror.load(c)
    this.mirror.settle()
    this.view = null
    this.send({ t: 'load', circuit: c })
  }
  reset() {
    this.send({ t: 'reset' })
  }
  settle(): boolean {
    this.send({ t: 'settle' })
    return true
  }
  tick(): boolean {
    this.send({ t: 'tick' })
    return true
  }
  stepClock() {
    this.send({ t: 'stepClock' })
  }
  stepBack(): boolean {
    this.send({ t: 'stepBack' })
    return true
  }
  terminal(id: string, op: TerminalOp) {
    this.send({ t: 'terminal', id, op })
  }
  stepCpu(id: string, what: 'cycle' | 'instruction') {
    this.send({ t: 'stepCpu', id, what })
  }
  /** Not used: the simulation runs by itself (see `run`). */
  frame(_ms: number, _workMs?: number) {}
  setParams(id: string, params: Params) {
    this.mirror.setParams(id, params)
    this.send({ t: 'setParams', id, params })
  }
  setState(id: string, patch: Record<string, unknown>) {
    this.send({ t: 'setState', id, patch })
  }
  writeWord(id: string, index: number, value: number): boolean {
    this.send({ t: 'writeWord', id, index, value })
    return true
  }
  force(id: string, pin: string, v: 0 | 1 | null): boolean {
    this.send({ t: 'force', id, pin, v })
    return true
  }
  clearForces() {
    this.send({ t: 'clearForces' })
  }
  setHistory(on: boolean) {
    this.history = on
    this.send({ t: 'setHistory', on })
  }
  setFast(on: boolean) {
    this.fast = on
    this.send({ t: 'setFast', on })
  }
  setCapture(on: boolean) {
    this.send({ t: 'setCapture', on })
  }
  publish() {
    this.mirror.publish()
  }
  run(running: boolean, speed: number) {
    const key = `${running}:${speed}`
    if (key === this.lastRun) return
    this.lastRun = key
    this.send({ t: 'run', running, speed })
  }

  /** A watcher that must see every clock edge: the host sends a snapshot at each one while it is set (not meant for a fast clock). */
  get edgeHook() {
    return this.hook
  }
  set edgeHook(fn: (() => void) | null) {
    this.hook = fn
    this.syncHook()
  }

  private syncHook() {
    const on = this.hook !== null
    if (on === this.hooked) return
    this.hooked = on
    this.send({ t: 'edgeHook', on })
  }

  // What is drawn: the mirror.
  pinValue(id: string, pin: string) {
    return this.mirror.pinValue(id, pin)
  }
  signature(id: string) {
    return this.mirror.signature(id)
  }
  inputValues(id: string) {
    return this.mirror.inputValues(id)
  }
  // oxlint-disable-next-line no-explicit-any
  state(id: string): any {
    return this.mirror.state(id)
  }
  netOf(id: string, pin: string) {
    return this.mirror.netOf(id, pin)
  }
  netNames() {
    return this.mirror.netNames()
  }
  idsOfType(type: string) {
    return this.mirror.idsOfType(type)
  }
  get time() {
    return this.mirror.time
  }
  get unstable() {
    return this.mirror.unstable
  }
  get engine() {
    return this.view?.engine ?? 'exact'
  }
  get fastOn() {
    return this.fast
  }
  get wasmOn() {
    return this.view?.wasm ?? false
  }
  fastestClockHz() {
    return this.view?.fastestHz ?? null
  }
  get clockTime() {
    return { offered: this.view?.offered ?? 0, skipped: this.view?.skipped ?? 0 }
  }
  get lagging() {
    return this.view?.lagging ?? false
  }
  get forceCount() {
    return this.view?.forces.length ?? 0
  }
  forcedValue(id: string, pin: string): 0 | 1 | null {
    const key = `${id}:${pin}`
    return this.view?.forces.find(([k]) => k === key)?.[1] ?? null
  }
  get historyOn() {
    return this.history
  }
  canStepBack() {
    return this.view?.canBack ?? false
  }
  getCapture() {
    return this.capture
  }
  get captureVersion() {
    return this.view?.captureVersion ?? 0
  }
  takeBreak() {
    const h = this.hit
    this.hit = null
    return h
  }
  subscribe = (fn: () => void) => this.mirror.subscribe(fn)
}
