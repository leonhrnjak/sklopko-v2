/** What the app asks of the canvas without knowing it: the UI registers it (see `ui/canvas/viewport.ts`). */
let fit: () => void = () => {}

/** Register how to zoom and pan so the whole circuit is visible. */
export function registerFit(fn: () => void) {
  fit = fn
}

/** The frame the view was last fitted to (see `fitToExample`), if it was not the whole circuit. */
let lastFrame: string | undefined

/** Zoom and pan so the whole circuit is visible. */
export const fitToScreen = () => {
  lastFrame = undefined
  fit()
}

let focus: (title: string, maxZoom?: number) => boolean = () => false

/** Register how to zoom and pan to the frame whose title starts with a text (false if there is none). */
export function registerFocus(fn: (title: string, maxZoom?: number) => boolean) {
  focus = fn
}

/**
 * Where a circuit opens. A large example names a frame (its `fit`) so it opens at a zoom where the parts can be read; the Fit
 * button still shows everything. Without a frame, or if the circuit has no such frame, the whole circuit is fitted. A small
 * frame is not blown up: at most 80%, so the note and the parts around it stay in the picture. On a phone everything is fitted.
 */
export const EXAMPLE_MAX_ZOOM = 0.8
export function fitToExample(frame?: string) {
  // On a phone the whole circuit is fitted: the terminal, keypad and gamepad that are tapped are parts of it, often away from the frame.
  if (typeof matchMedia !== 'undefined' && matchMedia('(max-width: 760px)').matches) frame = undefined
  lastFrame = frame
  refitView()
  // A panel that opens a moment later (the waveforms of an example with probes) takes room from the canvas: fit again as it does.
  if (frame) fitWhileResizing(2000)
}

/** Fit again, to the same frame or to everything: what a change of the canvas's size asks for. */
export function refitView() {
  if (!lastFrame || !focus(lastFrame, EXAMPLE_MAX_ZOOM)) fit()
}

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
