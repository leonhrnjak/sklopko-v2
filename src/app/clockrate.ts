/**
 * How much of the clock the page really simulates. A running simulation gets a few milliseconds of work a frame; a circuit with a
 * clock faster than that (or too big for it) has clock time skipped, and its clock runs slower than it says (see `Simulator.advance`).
 */
export class ClockMeter {
  private anchor: { at: number; offered: number; skipped: number } | null = null
  private last: number | null = null

  /**
   * Take a reading: `now` in ms, and the simulator's totals of clock time offered and skipped (ms). Returns the share of the clock
   * time that was simulated (0 to 1), measured over the last full second: null until there has been one, and while paused. Totals
   * that went down (a different circuit) start again.
   */
  sample(now: number, offered: number, skipped: number, running: boolean): number | null {
    if (!running || !this.anchor || offered < this.anchor.offered) {
      this.anchor = running ? { at: now, offered, skipped } : null
      this.last = null
      return null
    }
    if (now - this.anchor.at >= 1000) {
      const asked = offered - this.anchor.offered
      this.last = asked > 0 ? 1 - (skipped - this.anchor.skipped) / asked : null
      this.anchor = { at: now, offered, skipped }
    }
    return this.last
  }
}

/** "1 Hz", "2.5 kHz", "1 MHz": three significant digits, no trailing zeros. */
export function formatHz(hz: number): string {
  const [value, unit] = hz >= 1e6 ? [hz / 1e6, 'MHz'] : hz >= 1e3 ? [hz / 1e3, 'kHz'] : [hz, 'Hz']
  return `${Number(value.toPrecision(3))} ${unit}`
}

/** A clock that reaches less than this share of what it was asked for is "not keeping up". */
export const KEEPING_UP = 0.95

/** What the status badge says about the fastest clock: what it was asked to do and, when it falls short, what it reaches. */
export function describeClock(askedHz: number, share: number | null): { text: string; slow: boolean } {
  if (share === null || share >= KEEPING_UP) return { text: `Clock ${formatHz(askedHz)}`, slow: false }
  const percent = Math.max(1, Math.round(share * 100))
  return { text: `Clock ${formatHz(askedHz)} · reaching ${formatHz(askedHz * share)} (${percent}%)`, slow: true }
}
