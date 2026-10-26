import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** The spotlight's store: pointing, bringing a part forward, and the dimming that ends by itself. */

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.stubGlobal('window', { setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (t: number) => clearTimeout(t), addEventListener: () => {} })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function load() {
  const [spot, store, builder] = await Promise.all([import('./pathSpot'), import('./store'), import('../model/builder')])
  const b = new builder.CircuitBuilder()
  b.add('switch', 100, 100, { label: 'S' })
  store.loadCircuit(b.build())
  return { spot, store }
}

describe('the spotlight', () => {
  it('outlines what is pointed at, and lets go', async () => {
    const { spot } = await load()
    spot.hoverSpot('S')
    expect(spot.useSpot.getState().hover).toBe('S')
    spot.hoverSpot(null)
    expect(spot.useSpot.getState().hover).toBeNull()
  })

  it('dims for a moment after a click, then lets go by itself', async () => {
    const { spot, store } = await load()
    expect(Object.values(store.useStore.getState().circuit.comps).some((k) => k.label === 'S')).toBe(true)
    spot.focusSpot('S')
    expect(spot.useSpot.getState().focus).toBe('S')
    vi.advanceTimersByTime(spot.DIM_MS + 10)
    expect(spot.useSpot.getState().focus).toBeNull()
  })

  it('does nothing for a part that is not there, and clearing ends everything', async () => {
    const { spot } = await load()
    spot.focusSpot('No such part')
    expect(spot.useSpot.getState().focus).toBeNull()
    spot.hoverSpot('S')
    spot.focusSpot('S')
    spot.clearSpot()
    expect(spot.useSpot.getState()).toEqual({ hover: null, focus: null })
  })
})
