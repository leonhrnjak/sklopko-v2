import { isEmbed } from './embed'

/**
 * Let the browser keep the app for use without a network: register the service worker `sw.js` that the build writes
 * (`scripts/sw-plugin.ts`). Only in the built app (the dev server has no worker), and not for a circuit shown inside another page.
 */
export function registerOffline() {
  if (!import.meta.env.PROD || isEmbed() || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Not allowed here (a private window, an old browser): the app works as it did, online.
    })
  })
}
