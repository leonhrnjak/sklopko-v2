import { isEmbed } from './embed'

/** A new build's worker, installed and waiting for the page to say it may take over. */
let waiting: ServiceWorker | null = null

/** Tell the page (`UpdatePrompt`) that a new version is ready. */
function offerUpdate(worker: ServiceWorker) {
  waiting = worker
  window.dispatchEvent(new Event('sklopko:update-ready'))
}

/**
 * Let the browser keep the app for use without a network: register the service worker `sw.js` that the build writes
 * (`scripts/sw-plugin.ts`). Only in the built app (the dev server has no worker), and not for a circuit shown inside another page.
 * A new build's worker waits instead of taking over under open tabs: the page offers a reload (`applyUpdate`).
 */
export function registerOffline() {
  if (!import.meta.env.PROD || isEmbed() || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // (With no worker in control yet this is the first install, which takes over by itself: nothing to offer.)
        const check = (w: ServiceWorker | null) => w && navigator.serviceWorker.controller && offerUpdate(w)
        check(reg.waiting)
        reg.addEventListener('updatefound', () => {
          const w = reg.installing
          w?.addEventListener('statechange', () => w.state === 'installed' && check(w))
        })
        document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void reg.update().catch(() => {}))
      })
      .catch(() => {
        // Not allowed here (a private window, an old browser): the app works as it did, online.
      })
  })
}

/** Is a new version waiting? */
export const updateWaiting = () => waiting !== null

/** Let the waiting worker take over, then reload into the new version. Without one, just reload. */
export function applyUpdate() {
  if (!waiting) return location.reload()
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true })
  waiting.postMessage({ type: 'skip-waiting' })
}

/**
 * File → Keep all examples offline: the worker fetches every example it does not have yet. Resolves with how many examples there
 * are and how many could not be fetched, or null when there is no worker in control (the dev server, a private window).
 */
export async function keepExamplesOffline(onProgress?: (done: number, total: number) => void): Promise<{ total: number; failed: number } | null> {
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
  const worker = navigator.serviceWorker?.controller ?? reg?.active
  if (!worker) return null
  return new Promise((resolve) => {
    const on = (e: MessageEvent) => {
      const d = e.data
      if (d?.type === 'examples-progress') onProgress?.(d.done, d.total)
      if (d?.type === 'examples-done') {
        navigator.serviceWorker.removeEventListener('message', on)
        resolve({ total: d.total, failed: d.failed })
      }
    }
    navigator.serviceWorker.addEventListener('message', on)
    worker.postMessage({ type: 'keep-examples' })
  })
}
