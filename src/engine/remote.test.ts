import { describe, expect, it } from 'vitest'
import { flatten } from '../model/buses'
import { EXAMPLES } from '../model/examples'
import { SimHost, WorkerSim, type Port } from './remote'
import { Simulator } from './simulator'

/** A host and a client joined directly. Messages are copied as a worker would copy them, and delivered when `pump` is called. */
function join() {
  const toHost: unknown[] = []
  const toPage: unknown[] = []
  let slice: (() => void) | null = null
  const host = new SimHost({ postMessage: (m, t) => void toPage.push(structuredClone(m, { transfer: t })) }, (fn) => (slice = fn))
  const port: Port = { postMessage: (m) => void toHost.push(structuredClone(m)), onmessage: null }
  const client = new WorkerSim(port)
  const pump = () => {
    for (let guard = 0; guard < 1000 && (toHost.length || toPage.length || slice); guard++) {
      const h = toHost.shift()
      if (h) host.handle(h as never)
      const p = toPage.shift()
      if (p) port.onmessage?.({ data: p })
      if (!toHost.length && !toPage.length && slice) {
        const s = slice as () => void
        slice = null
        s()
        break // one slice per pump: running is endless
      }
    }
  }
  return { host, client, pump }
}

const valuesOf = (s: unknown) => Array.from((s as { values: Uint8Array }).values)
const digest = (x: unknown): string => {
  if (ArrayBuffer.isView(x)) return `#${Array.from(x as unknown as ArrayLike<number>).join(',')}`
  if (Array.isArray(x)) return `[${x.map(digest).join(',')}]`
  if (x && typeof x === 'object') return `{${Object.keys(x).sort().map((k) => `${k}:${digest((x as Record<string, unknown>)[k])}`).join(',')}}`
  return String(x)
}
const stateOf = (s: Simulator | WorkerSim, ids: string[]) => ids.map((id) => `${id}=${digest((s as Simulator).state(id))}`)

describe('the simulation in a worker, seen through a mirror', () => {
  const ids = ['counter', 'adder', 'computer-tictactoe', '6502-lcd', '6502-basic-lcd', 'uart', '6502-keypad', 'ic-adder', 'hazard']
  for (const ex of EXAMPLES.filter((e) => ids.includes(e.id))) {
    it(`${ex.id}: after each clock edge the mirror shows the nets and part states of a simulator run directly`, () => {
      const circuit = flatten(ex.build())
      const { client, pump } = join()
      const direct = new Simulator()
      direct.setFast(true)
      client.setFast(true)
      direct.load(circuit)
      client.load(circuit)
      direct.settle()
      client.settle()
      pump()
      const mirror = (client as unknown as { mirror: Simulator }).mirror
      const comps = (direct as unknown as { comps: { id: string }[] }).comps.map((c) => c.id)
      const edges = 40
      for (let i = 0; i < edges; i++) {
        direct.stepClock()
        client.stepClock()
        pump()
        pump()
        expect(valuesOf(mirror), `edge ${i}`).toEqual(valuesOf(direct))
        expect(client.time).toBe(direct.time)
        expect(client.unstable).toBe(direct.unstable)
      }
      expect(stateOf(client, comps)).toEqual(stateOf(direct, comps))
    })
  }

  it('carries the numbers beside the nets: engine, history, forces and the answer to canStepBack', () => {
    const ex = EXAMPLES.find((e) => e.id === 'counter')!
    const { client, pump } = join()
    client.setFast(true)
    client.load(flatten(ex.build()))
    client.settle()
    client.stepClock()
    client.stepClock()
    pump()
    pump()
    expect(client.engine).toBe('fast')
    expect(client.canStepBack()).toBe(true)
    expect(client.historyOn).toBe(true)
    client.setHistory(false)
    pump()
    pump()
    expect(client.canStepBack()).toBe(false)
    expect(client.historyOn).toBe(false)
  })

  it('runs by itself when told to, and stops when told to', () => {
    const ex = EXAMPLES.find((e) => e.id === 'counter')!
    const { client, pump } = join()
    client.load(flatten(ex.build()))
    client.settle()
    client.run(true, 1)
    const t0 = client.time
    const until = performance.now() + 200
    while (performance.now() < until) pump()
    expect(client.time).toBeGreaterThan(t0)
    client.run(false, 1)
    pump()
    pump()
  })

  it('shows an edge hook every clock edge, also when several edges happen between two messages', () => {
    const ex = EXAMPLES.find((e) => e.id === 'counter')!
    const { client, pump } = join()
    client.load(flatten(ex.build()))
    client.settle()
    pump()
    let seen = 0
    client.edgeHook = () => void seen++
    pump()
    for (let i = 0; i < 6; i++) client.stepClock() // no pump between: the host has the first one in flight and keeps the rest
    pump()
    pump()
    pump()
    expect(seen).toBe(6)
    client.edgeHook = null
  })
})

describe('when the simulation cannot go on', () => {
  it('a fatal message from the host sets `failed` and calls onFatal', () => {
    const told: string[] = []
    const port: Port = { postMessage: () => {}, onmessage: null }
    const client = new WorkerSim(port, null, (m) => told.push(m))
    expect(client.failed).toBeNull()
    port.onmessage?.({ data: { t: 'fatal', message: 'engine.wasm: 404' } })
    expect(client.failed).toBe('engine.wasm: 404')
    expect(told).toEqual(['engine.wasm: 404'])
  })

  it("the worker's own error event counts too", () => {
    const told: string[] = []
    const port: Port = { postMessage: () => {}, onmessage: null, onerror: null }
    const client = new WorkerSim(port, null, (m) => told.push(m))
    port.onerror?.({ message: 'boom' })
    expect(client.failed).toBe('boom')
    expect(told).toEqual(['boom'])
  })

  it('a command that throws in the host is reported and the host stops', () => {
    const sent: { t: string; message?: string }[] = []
    const host = new SimHost({ postMessage: (m) => void sent.push(m as never) }, () => {})
    host.handle({ t: 'load', circuit: null as never })
    expect(sent.at(-1)?.t).toBe('fatal')
    const n = sent.length
    host.handle({ t: 'reset' })
    expect(sent.length).toBe(n) // dead: nothing more is done or sent
  })

  it('restart makes a new port, clears the failure and loads the last circuit again', () => {
    const made: { sent: { t: string }[]; port: Port; terminated: boolean }[] = []
    const spawn = () => {
      const rec = { sent: [] as { t: string }[], terminated: false, port: null as unknown as Port }
      rec.port = { postMessage: (m) => void rec.sent.push(m as { t: string }), onmessage: null, onerror: null, terminate: () => void (rec.terminated = true) }
      made.push(rec)
      return rec.port
    }
    const client = new WorkerSim(spawn(), spawn)
    const circuit = flatten(EXAMPLES.find((e) => e.id === 'counter')!.build())
    client.load(circuit)
    client.run(true, 1)
    made[0].port.onerror?.({ message: 'crash' })
    expect(client.failed).toBe('crash')
    expect(client.restart()).toBe(true)
    expect(client.failed).toBeNull()
    expect(made[0].terminated).toBe(true)
    expect(made[1].sent.map((m) => m.t)).toEqual(['setHistory', 'setFast', 'load', 'run'])
  })

  it('restart is refused when there is no way to make a worker', () => {
    expect(new WorkerSim({ postMessage: () => {}, onmessage: null }).restart()).toBe(false)
  })
})
