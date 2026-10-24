/** What the app asks of the canvas without knowing it: the UI registers it (see `ui/canvas/viewport.ts`). */
let fit: () => void = () => {}

/** Register how to zoom and pan so the whole circuit is visible. */
export function registerFit(fn: () => void) {
  fit = fn
}

/** Zoom and pan so the whole circuit is visible. */
export const fitToScreen = () => fit()
