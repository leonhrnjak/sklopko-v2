import { EXAMPLES } from '../model/examples'
import { deserialize, fromShareHash, toJSON, toShareHash } from '../model/serialize'
import type { Circuit } from '../model/circuit'
import { loadIntoSim, sim } from './sim'
import { loadCircuit, showToast, useStore } from './store'

const STORAGE_KEY = 'sklopko.circuit.v1'

function initialCircuit(): Circuit {
  try {
    const fromHash = fromShareHash(location.hash)
    if (fromHash) {
      history.replaceState(null, '', location.pathname + location.search)
      return fromHash
    }
  } catch {
    showToast('That share link could not be opened.')
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return deserialize(JSON.parse(saved))
  } catch {
    // Corrupt or unavailable storage: fall through to the welcome example.
  }
  return EXAMPLES[0].build()
}

let started = false

/** Wire the store to the simulator, autosave, and start the animation loop. */
export function startRuntime() {
  if (started) return
  started = true

  let lastStruct = -1
  const sync = () => {
    const s = useStore.getState()
    if (s.structVersion === lastStruct) return
    lastStruct = s.structVersion
    loadIntoSim(s.circuit)
    if (s.running) sim.settle()
  }
  useStore.subscribe(sync)

  let saveTimer = 0
  let lastSaved: Circuit | null = null
  useStore.subscribe((s) => {
    if (s.circuit === lastSaved) return
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      lastSaved = s.circuit
      try {
        localStorage.setItem(STORAGE_KEY, toJSON(useStore.getState().circuit))
      } catch {
        // Storage full or blocked; the circuit still works, it just won't survive a reload.
      }
    }, 400)
  })

  loadCircuit(initialCircuit(), false)
  sync()
  sim.settle()

  let last = performance.now()
  const loop = (t: number) => {
    const dt = Math.min(t - last, 100)
    last = t
    const { running, speed } = useStore.getState()
    if (running) sim.frame(dt * speed)
    sim.publish()
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
}

export async function shareLink() {
  const url = `${location.origin}${location.pathname}#${toShareHash(useStore.getState().circuit)}`
  try {
    await navigator.clipboard.writeText(url)
    showToast('Share link copied to the clipboard.')
  } catch {
    window.prompt('Copy this link:', url)
  }
}

export function downloadJSON() {
  const blob = new Blob([JSON.stringify(JSON.parse(toJSON(useStore.getState().circuit)), null, 1)], {
    type: 'application/json',
  })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'circuit.sklopko.json'
  a.click()
  URL.revokeObjectURL(a.href)
}

export function openJSON() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      loadCircuit(deserialize(JSON.parse(await file.text())))
      showToast(`Opened ${file.name}`)
    } catch (e) {
      showToast(`Could not open ${file.name}: ${(e as Error).message}`)
    }
  }
  input.click()
}
