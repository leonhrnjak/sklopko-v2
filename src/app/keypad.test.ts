import { describe, expect, it } from 'vitest'
import { Simulator } from '../engine/simulator'
import { keypadCodeOfKey } from '../engine/components/devices'
import { CircuitBuilder } from '../model/builder'
import { keyedSwitches } from '../model/keys'
import { simComps } from '../model/circuit'
import { deserialize, serialize } from '../model/serialize'
import { installKeypadKeys } from './keypad'
import { loadCircuit, select } from './store'

describe('keypad codes of keyboard keys', () => {
  it('hex: digits and A–F in either case; nothing else', () => {
    expect(['0', '9', 'a', 'F', 'c'].map((k) => keypadCodeOfKey('hex', k))).toEqual([0, 9, 10, 15, 12])
    expect(['g', '+', 'Enter', ' '].map((k) => keypadCodeOfKey('hex', k))).toEqual([undefined, undefined, undefined, undefined])
  })

  it('calculator: digits, + - * / (and x), = (and Enter), C; letters A–F are not keys', () => {
    expect(['5', '+', '-', '*', 'x', '/', '=', 'Enter', 'C'].map((k) => keypadCodeOfKey('calc', k))).toEqual([5, 10, 11, 12, 12, 13, 14, 14, 15])
    expect(['a', 'f'].map((k) => keypadCodeOfKey('calc', k))).toEqual([undefined, undefined])
  })
})

function rig(layout: 'hex' | 'calc' = 'hex') {
  loadCircuit(new CircuitBuilder().c, false)
  const b = new CircuitBuilder()
  const pad = b.add('keypad', 0, 0, { params: { layout, sticky: false } })
  const c = b.build()
  loadCircuit(c, false)
  const sim = new Simulator()
  sim.load({ comps: simComps(c), wires: [] })
  sim.settle()
  const target = new EventTarget()
  installKeypadKeys(sim, target as unknown as Window)
  const send = (type: 'keydown' | 'keyup', key: string, extra: object = {}) => {
    const e = Object.assign(new Event(type, { cancelable: true }), { key, metaKey: false, ctrlKey: false, altKey: false, repeat: false }, extra)
    target.dispatchEvent(e)
    sim.settle()
    return e
  }
  const code = () => [0, 1, 2, 3].reduce((n, i) => n | ((sim.pinValue(pad, `K${i}`) as number) << i), 0)
  return { sim, pad, send, code, held: () => sim.pinValue(pad, 'P') }
}

describe('the keyboard on a keypad', () => {
  it('a key held down sends its code and raises P; letting go lowers P and keeps the code', () => {
    const { send, code, held } = rig()
    send('keydown', 'b')
    expect(code()).toBe(11)
    expect(held()).toBe(1)
    send('keyup', 'b')
    expect(held()).toBe(0)
    expect(code()).toBe(11)
  })

  it('takes the key (no browser action) only when it is a key of the pad, and leaves modifiers alone', () => {
    const { send, held } = rig('calc')
    expect(send('keydown', '7').defaultPrevented).toBe(true)
    send('keyup', '7')
    expect(send('keydown', 'q').defaultPrevented).toBe(false)
    expect(send('keydown', '8', { metaKey: true }).defaultPrevented).toBe(false)
    expect(held()).toBe(0)
  })

  it('leaves a letter to the editor while a part is selected, but digits always go to the pad', () => {
    const { send, code } = rig()
    select(['something'])
    expect(send('keydown', 'f').defaultPrevented).toBe(false)
    expect(send('keydown', '4').defaultPrevented).toBe(true)
    expect(code()).toBe(4)
    select([])
  })
})

describe('keys of switches', () => {
  it('a switch has an optional key; matching ignores case, and only digits 1–9 and letters count', () => {
    const b = new CircuitBuilder()
    const a = b.add('switch', 0, 0, { params: { key: 'r' } })
    const c = b.add('switch', 0, 40, { params: { key: '3' } })
    const d = b.add('switch', 0, 80)
    const circuit = b.build()
    expect(keyedSwitches(circuit, 'R')).toEqual([a])
    expect(keyedSwitches(circuit, 'r')).toEqual([a])
    expect(keyedSwitches(circuit, '3')).toEqual([c])
    expect(keyedSwitches(circuit, 'q')).toEqual([])
    expect(keyedSwitches(circuit, '0')).toEqual([])
    expect(keyedSwitches(circuit, 'Enter')).toEqual([])
    expect(d).toBeDefined()
  })

  it('the key is saved with the circuit, and a value that is not a key is dropped when loading', () => {
    const b = new CircuitBuilder()
    const a = b.add('switch', 0, 0, { params: { key: 'k' } })
    const back = deserialize(JSON.parse(JSON.stringify(serialize(b.build()))))
    expect(back.comps[a].params.key).toBe('k')
    const bad = JSON.parse(JSON.stringify(serialize(b.build())))
    bad.comps[0].params.key = 'ab'
    expect(deserialize(bad).comps[a].params.key).toBe('')
    // A file from before the key existed has none.
    delete bad.comps[0].params.key
    expect(deserialize(bad).comps[a].params.key).toBe('')
  })
})
