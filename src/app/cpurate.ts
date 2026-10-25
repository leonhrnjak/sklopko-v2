/**
 * How fast a CPU part really runs in the page: the cycles it did over the last second or so of real time. A circuit with a fast clock
 * runs as fast as the page can simulate it (up to 10 ms of simulation work in each frame), whatever the clock says.
 */
export class RateMeter {
  private anchor: { at: number; cycles: number } | null = null
  private last: number | null = null

  /**
   * Take a reading: `now` in ms, the CPU's cycle count, and whether the simulation is running. Returns cycles a second, measured
   * over the last full second (null until there has been one, and while paused). A count that went down (reset, step back) starts again.
   */
  sample(now: number, cycles: number, running: boolean): number | null {
    if (!running || !this.anchor || cycles < this.anchor.cycles) {
      this.anchor = running ? { at: now, cycles } : null
      this.last = null
      return null
    }
    const elapsed = now - this.anchor.at
    if (elapsed >= 1000) {
      this.last = ((cycles - this.anchor.cycles) * 1000) / elapsed
      this.anchor = { at: now, cycles }
    }
    return this.last
  }
}

/** A real 6502 at 1 MHz does a million cycles a second. */
export const REAL_6502_HZ = 1_000_000

/** "Running at 80,000 cycles a second (8% of a 1 MHz 6502)". */
export function describeRate(cyclesPerSecond: number): string {
  const rate = Number(cyclesPerSecond.toPrecision(2))
  const percent = (cyclesPerSecond / REAL_6502_HZ) * 100
  const shown = percent >= 10 ? String(Math.round(percent)) : percent >= 1 ? percent.toFixed(1).replace(/\.0$/, '') : percent.toPrecision(1)
  return `Running at ${rate.toLocaleString('en-US')} cycles a second (${shown}% of a 1 MHz 6502)`
}
