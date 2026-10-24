import { counterDisplay } from '../model/example-counter'
import { WELCOME_ID, exampleFromPath, type ExampleInfo } from '../model/examples-index'
import { deserialize, fromShareHash, toJSON, toShareHash } from '../model/serialize'
import type { Circuit } from '../model/circuit'
import { unlockAudio, updateAudio } from './audio'
import { openCircuit, startAutosave, type Opening } from './documents'
import { isEmbed } from './embed'
import { flushFsm, restoreFsm } from './fsm'
import { installGamepadKeys } from './gamepad'
import { installKeypadKeys } from './keypad'
import { metaOf, openLastDoc, openLibrary, watchLibrary } from './library'
import { loadIntoSim, sim } from './sim'
import { setRunning, showToast, useStore } from './store'

/** Where the one saved circuit lived before the library; read once, to bring it in. */
const LEGACY_KEY = 'sklopko.circuit.v1'

/**
 * Show an example's short link in the address bar while it is open and unedited
 * (see `trackExampleUrl`), or the plain root otherwise.
 */
export function setExampleUrl(ex: ExampleInfo | null) {
  const path = ex ? `/${ex.id}` : '/'
  if (location.pathname !== path || location.hash) history.replaceState(null, '', path + location.search)
}

/** An example opens without a document of its own; editing it makes one, "<name> (copy)". */
const exampleOpening = (ex: ExampleInfo): Opening => ({ mode: 'on-edit', name: `${ex.name} (copy)`, origin: { example: ex.id } })

/**
 * An example's circuit. The build writes each one, routed, to `examples/<id>.json` (see `scripts/examples-plugin.ts`); the
 * welcome example is in the main chunk, so the first paint does not wait for the network.
 */
async function buildExample(ex: ExampleInfo): Promise<Circuit> {
  if (ex.id === WELCOME_ID) return counterDisplay()
  const res = await fetch(`${import.meta.env.BASE_URL}examples/${ex.id}.json`)
  if (!res.ok) throw new Error(`Example ${ex.id}: ${res.status}`)
  return deserialize(await res.json())
}

let opening = 0

/** Open an example and point the address bar at its short link. Of two quick clicks the later one wins. */
export async function openExample(ex: ExampleInfo) {
  const mine = ++opening
  let circuit: Circuit
  try {
    circuit = await buildExample(ex)
  } catch {
    if (mine === opening) showToast('That example could not be loaded.')
    return
  }
  if (mine !== opening) return
  openCircuit(circuit, exampleOpening(ex))
  setExampleUrl(ex)
}

/** What the app opens with, and how that relates to the library. */
async function initialCircuit(): Promise<{ circuit: Circuit; how: Opening }> {
  const ex = exampleFromPath(location.pathname)
  if (ex) {
    try {
      return { circuit: await buildExample(ex), how: exampleOpening(ex) }
    } catch {
      showToast('That example could not be loaded.')
    }
  }
  if (location.pathname !== '/') setExampleUrl(null)
  try {
    const fromHash = fromShareHash(location.hash)
    if (fromHash) {
      history.replaceState(null, '', location.pathname + location.search)
      return { circuit: fromHash, how: { mode: 'now', name: 'Shared circuit' } }
    }
  } catch {
    showToast('That share link could not be opened.')
  }
  const welcome = { circuit: counterDisplay(), how: { mode: 'on-edit', name: 'My circuit', origin: { example: WELCOME_ID } } as Opening }
  // An embedded circuit is the one in the link, never the visitor's own saved work.
  if (isEmbed()) return welcome
  try {
    // The document this tab had, or else the last one used.
    const rec = await openLastDoc('circuit')
    if (rec) return { circuit: deserialize(rec.data), how: { mode: 'stored', meta: metaOf(rec) } }
  } catch {
    // A record that no longer reads: carry on with what follows.
  }
  try {
    // The single saved circuit of earlier versions becomes the first document of the library.
    const old = localStorage.getItem(LEGACY_KEY)
    if (old) return { circuit: deserialize(JSON.parse(old)), how: { mode: 'now', name: 'My circuit' } }
  } catch {
    // Corrupt or unavailable storage: fall through to the welcome example.
  }
  return welcome
}

let started = false

/** Open the library, wire the store to the simulator, autosave, and start the animation loop. */
export async function startRuntime() {
  if (started) return
  started = true

  // An embedded circuit never reads or writes the visitor's library.
  if (!isEmbed()) {
    if (!(await openLibrary())) {
      window.setTimeout(() => showToast('This browser will not keep your circuits after you close the page (private window?).'), 600)
    }
    await restoreFsm()
    window.addEventListener('pagehide', flushFsm)
    let told = false
    watchLibrary(() => {
      if (told) return
      told = true
      showToast('This circuit was changed in another tab. Reload to see the change.')
    })
  }
  const first = await initialCircuit()

  let lastStruct = -1
  const sync = () => {
    const s = useStore.getState()
    if (s.structVersion === lastStruct) return
    lastStruct = s.structVersion
    loadIntoSim(s.circuit)
    if (s.running) sim.settle()
  }
  useStore.subscribe(sync)

  startAutosave()

  openCircuit(first.circuit, first.how)
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
    if (running) sim.frame(dt * speed, 10) // up to 10 ms of simulation work a frame, however many clock edges that is
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
  installGamepadKeys(sim, window, 350)
  installKeypadKeys(sim)
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
      const circuit = deserialize(JSON.parse(await file.text()))
      openCircuit(circuit, { mode: 'now', name: file.name.replace(/(\.sklopko)?\.json$/i, '') || 'Opened circuit' })
      showToast(`Opened ${file.name}`)
    } catch (e) {
      showToast(`Could not open ${file.name}: ${(e as Error).message}`)
    }
  }
  input.click()
}
