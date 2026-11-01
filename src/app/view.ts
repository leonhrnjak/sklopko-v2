/** What the app asks of the canvas without knowing it: the UI registers it (see `ui/canvas/viewport.ts`). */
let fit: () => void = () => {}

/** Register how to zoom and pan so the whole circuit is visible. */
export function registerFit(fn: () => void) {
  fit = fn
}

/** Zoom and pan so the whole circuit is visible. */
export const fitToScreen = () => fit()

let refit: ((ms: number) => void) | null = null
let waiting: number | null = null
/** Register how to keep the circuit fitted for a while as the canvas changes size. */
export function registerRefit(fn: (ms: number) => void) {
  refit = fn
  if (waiting !== null) fn(waiting) // (asked for before the canvas had loaded)
  waiting = null
}
/** Fit again whenever the canvas changes size in the next `ms` (a panel that arrives late takes room from it). */
export const fitWhileResizing = (ms: number) => {
  if (refit) refit(ms)
  else waiting = ms
}
