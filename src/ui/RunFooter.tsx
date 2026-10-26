import { useEffect, useState } from 'react'
import { ClockMeter, describeClock } from '../app/clockrate'
import { useForceCount } from '../app/hooks'
import { sim } from '../app/sim'
import { select, useStore } from '../app/store'

type Clock = ReturnType<typeof describeClock>

/** The fastest clock's rate as asked for and, once measured over a second, as reached. Null without a clock. */
function useClock(): Clock | null {
  const [clock, setClock] = useState<Clock | null>(null)
  useEffect(() => {
    const meter = new ClockMeter()
    const look = () => {
      const { running, speed } = useStore.getState()
      const asked = sim.fastestClockHz()
      const { offered, skipped } = sim.clockTime
      const share = meter.sample(performance.now(), offered, skipped, running)
      const next = asked === null ? null : describeClock(asked * speed, running ? share : null)
      setClock((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    look()
    const timer = window.setInterval(look, 500)
    return () => window.clearInterval(timer)
  }, [])
  return clock
}

const breakpointIds = (comps: Record<string, { type: string }>) => Object.keys(comps).filter((id) => comps[id].type === 'breakpoint').join(',')

/** The run side of the canvas, under it: whether the simulation runs, the clock, signals held at a level, breakpoints. */
export function RunFooter() {
  const running = useStore((s) => s.running)
  const clock = useClock()
  const held = useForceCount()
  const breakpoints = useStore((s) => breakpointIds(s.circuit.comps))
  const ids = breakpoints ? breakpoints.split(',') : []
  return (
    <div className="run-footer" role="status" aria-label="Simulation">
      <span className="run-label">Run</span>
      <span className="run-state">
        <span className={`run-dot${running ? ' live' : ''}`} aria-hidden="true" />
        <span data-testid="run-state">{running ? 'Running' : 'Paused'}</span>
      </span>
      {clock && (
        <span className={`run-clock${clock.slow ? ' slow' : ''}`} data-testid="clock-rate" title={clock.slow ? 'The fastest clock is faster than this page can simulate it, so part of its time is skipped. Lower its rate or the speed, or switch off Step-back history in Tools.' : 'The rate of the fastest clock, times the speed'}>
          Clock <b>{clock.asked}</b>
          {clock.actual && (
            <>
              {' '}
              · actual <b>{clock.actual}</b>
              {clock.percent !== null && ` (${clock.percent}%)`}
            </>
          )}
        </span>
      )}
      {held > 0 && (
        <span className="run-pill held" data-testid="force-badge">
          ⚡ {held} held
          <button
            onClick={() => {
              sim.clearForces()
              sim.settle()
              sim.publish()
            }}
          >
            Release all
          </button>
        </span>
      )}
      {ids.length > 0 && (
        <button className="run-pill" onClick={() => select(ids)} title="Select the breakpoints" data-testid="breakpoint-count">
          Breakpoints: {ids.length}
        </button>
      )}
    </div>
  )
}
