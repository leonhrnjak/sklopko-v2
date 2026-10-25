/** The simulation's share of a frame, in ms of work, when it keeps up with its clocks. */
export const MIN_WORK_MS = 10
/** The most it is given, however slow the rest of the frame is. */
export const MAX_WORK_MS = 100

/**
 * How long the next frame may spend simulating. A circuit that keeps up needs no more than the usual 10 ms, and the page stays at 60
 * frames a second. One that is too big for its clock (a computer at 1 MHz) is given as much as the rest of the frame took (drawing,
 * and waiting for the next frame), so that it gets about half of the time instead of a tenth, up to 100 ms: the picture is
 * redrawn less often, but the circuit runs several times faster.
 */
export function workBudget(lagging: boolean, otherMs: number): number {
  if (!lagging) return MIN_WORK_MS
  return Math.min(MAX_WORK_MS, Math.max(MIN_WORK_MS, Math.round(otherMs)))
}
