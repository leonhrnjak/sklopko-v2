import { afterEach, describe, expect, it, vi } from 'vitest'
import { Simulator } from '../engine/simulator'
import { GAMEPAD_BUTTONS, gamepadHeld } from '../engine/components/devices'
import { buttonOfKey, installGamepadKeys } from './gamepad'
import { CircuitBuilder } from '../model/builder'
import { simComps } from '../model/circuit'

function rig(minHoldMs = 0) {
  const b = new CircuitBuilder()
  const pad = b.add('gamepad', 0, 0)
  const c = b.build()
  const sim = new Simulator()
  sim.load({ comps: simComps(c), wires: [] })
  sim.settle()
  const target = new EventTarget()
  installGamepadKeys(sim, target as unknown as Window, minHoldMs)
  const send = (type: 'keydown' | 'keyup', key: string, extra: object = {}) => {
    const e = Object.assign(new Event(type, { cancelable: true }), { key, metaKey: false, ctrlKey: false, altKey: false }, extra)
    target.dispatchEvent(e)
    sim.settle()
    return e
  }
  const outs = () => GAMEPAD_BUTTONS.map((b) => sim.pinValue(pad, b.pin)).join('')
  return { sim, pad, send, outs, target }
}

describe('gamepad', () => {
  it('has six outputs, off at the start', () => {
    expect(rig().outs()).toBe('000000')
  })

  it('maps arrow keys, W A S D, Z and X to the buttons', () => {
    expect(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'z', 'x'].map(buttonOfKey)).toEqual([0, 1, 2, 3, 4, 5])
    expect(['w', 's', 'a', 'd', 'Z', 'W'].map(buttonOfKey)).toEqual([0, 1, 2, 3, 4, 0])
    expect(['q', 'Enter', ' ', 'r'].map(buttonOfKey)).toEqual([-1, -1, -1, -1])
  })

  it('a key held down holds its output, several keys together work, and letting go releases them', () => {
    const { send, outs } = rig()
    send('keydown', 'ArrowUp')
    expect(outs()).toBe('100000')
    send('keydown', 'z')
    expect(outs()).toBe('100010')
    send('keyup', 'ArrowUp')
    expect(outs()).toBe('000010')
    send('keyup', 'z')
    expect(outs()).toBe('000000')
  })

  it('takes the key (no scrolling) only when there is a pad; leaves shortcuts with a modifier alone', () => {
    const { send, outs } = rig()
    expect(send('keydown', 'ArrowDown').defaultPrevented).toBe(true)
    send('keyup', 'ArrowDown')
    expect(send('keydown', 'z', { ctrlKey: true }).defaultPrevented).toBe(false) // Ctrl-Z is undo
    expect(outs()).toBe('000000')
    const none = new Simulator()
    const target = new EventTarget()
    installGamepadKeys(none, target as unknown as Window)
    const e = Object.assign(new Event('keydown', { cancelable: true }), { key: 'ArrowDown', metaKey: false, ctrlKey: false, altKey: false })
    target.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
  })

  it('the pointer and the keyboard add together', () => {
    const { sim, pad, send, outs } = rig()
    send('keydown', 'ArrowLeft')
    sim.setState(pad, { pressed: true, key: 5 })
    sim.settle()
    expect(outs()).toBe('001001')
    sim.setState(pad, { pressed: false })
    sim.settle()
    expect(outs()).toBe('001000')
    expect(gamepadHeld({ pressed: true, key: 3, keys: 1 })).toBe(9)
  })

  it('losing the focus lets everything go', () => {
    const { sim, send, outs, target } = rig()
    send('keydown', 'ArrowRight')
    target.dispatchEvent(new Event('blur'))
    sim.settle()
    expect(outs()).toBe('000000')
  })
})

describe('gamepad: a short tap is kept down long enough to be seen', () => {
  afterEach(() => vi.useRealTimers())

  it('a key let go before the minimum time stays down until it is up, and a long press is let go at once', () => {
    vi.useFakeTimers()
    const { send, outs, sim } = rig(300)
    send('keydown', 'ArrowUp')
    vi.advanceTimersByTime(100)
    send('keyup', 'ArrowUp')
    expect(outs()).toBe('100000') // 100 ms: still down
    vi.advanceTimersByTime(199)
    sim.settle()
    expect(outs()).toBe('100000')
    vi.advanceTimersByTime(2)
    sim.settle()
    expect(outs()).toBe('000000') // 300 ms: let go

    send('keydown', 'ArrowDown')
    vi.advanceTimersByTime(500)
    send('keyup', 'ArrowDown')
    expect(outs()).toBe('000000') // held for long enough already
  })

  it('pressing again while the release is waiting keeps it down', () => {
    vi.useFakeTimers()
    const { send, outs, sim } = rig(300)
    send('keydown', 'z')
    send('keyup', 'z')
    send('keydown', 'z')
    vi.advanceTimersByTime(1000)
    sim.settle()
    expect(outs()).toBe('000010') // pressed again, never let go
    send('keyup', 'z')
    vi.advanceTimersByTime(1000)
    sim.settle()
    expect(outs()).toBe('000000')
  })
})
