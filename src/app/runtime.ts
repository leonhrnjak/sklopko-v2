import { EXAMPLES, exampleFromPath, type Example } from '../model/examples'
import { deserialize, fromShareHash, toJSON, toShareHash } from '../model/serialize'
import type { Circuit } from '../model/circuit'
import { unlockAudio, updateAudio } from './audio'
import { isEmbed } from './embed'
import { loadIntoSim, sim } from './sim'
import { loadCircuit, setRunning, showToast, useStore } from './store'

const STORAGE_KEY = 'sklopko.circuit.v1'

/**
 * Show an example's short link in the address bar while it is open and unedited
 * (see `trackExampleUrl`), or the plain root otherwise.
 */
export function setExampleUrl(ex: Example | null) {
  const path = ex ? `/${ex.id}` : '/'
  if (location.pathname !== path || location.hash) history.replaceState(null, '', path + location.search)
}

/** Load an example and point the address bar at its short link. */
export function openExample(ex: Example) {
  loadCircuit(ex.build())
  setExampleUrl(ex)
}

function initialCircuit(): Circuit {
  const ex = exampleFromPath(location.pathname)
  if (ex) return ex.build()
  if (location.pathname !== '/') setExampleUrl(null)
  try {
    const fromHash = fromShareHash(location.hash)
    if (fromHash) {
      history.replaceState(null, '', location.pathname + location.search)
      return fromHash
    }
  } catch {
    showToast('That share link could not be opened.')
  }
  // An embedded circuit is the one in the link, never the visitor's own saved work.
  if (isEmbed()) return EXAMPLES[0].build()
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
    if (isEmbed() || s.circuit === lastSaved) return // an embedded circuit must not overwrite the visitor's saved one
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

  // The first real edit (anything that creates an undo step) leaves the example: drop its short link so a
  // reload brings back the edited circuit from autosave instead of a fresh example.
  useStore.subscribe((s, prev) => {
    if (s.past !== prev.past && exampleFromPath(location.pathname)) setExampleUrl(null)
  })
  sim.settle()

  let last = performance.now()
  const loop = (t: number) => {
    const dt = Math.min(t - last, 100)
    last = t
    const { running, speed } = useStore.getState()
    if (running) sim.frame(dt * speed)
    // A breakpoint stopped the simulation (while running or on a single step): say which one.
    const hit = sim.takeBreak()
    if (hit) {
      const name = useStore.getState().circuit.comps[hit]?.label || 'Breakpoint'
      if (running) setRunning(false)
      showToast(running ? `Paused at breakpoint “${name}”.` : `Breakpoint “${name}” hit.`)
    }
    sim.publish()
    updateAudio(useStore.getState().circuit, running, speed)
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  window.addEventListener('pointerdown', unlockAudio)
  window.addEventListener('keydown', unlockAudio)
}

export async function shareLink() {
  // An untouched example has a short link of its own.
  const ex = exampleFromPath(location.pathname)
  const url = ex ? `${location.origin}/${ex.id}` : `${location.origin}/#${toShareHash(useStore.getState().circuit)}`
  try {
    await navigator.clipboard.writeText(url)
    showToast('Share link copied to the clipboard.')
  } catch {
    window.prompt('Copy this link:', url)
  }
}

/** Copy the HTML for an iframe that shows this circuit, running, in another web page. */
export async function copyEmbedCode() {
  // An untouched example has a short link of its own, like in shareLink.
  const ex = exampleFromPath(location.pathname)
  const src = ex ? `${location.origin}/${ex.id}?embed=1` : `${location.origin}/?embed=1#${toShareHash(useStore.getState().circuit)}`
  const html =
    `<iframe src="${src}" width="900" height="560" loading="lazy" allowfullscreen title="Sklopko circuit" ` +
    `style="border: 1px solid #d0d0cc; border-radius: 8px; max-width: 100%"></iframe>`
  try {
    await navigator.clipboard.writeText(html)
    showToast('Embed code copied to the clipboard.')
  } catch {
    window.prompt('Copy this HTML:', html)
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
