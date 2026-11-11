import { useEffect, useState } from 'react'
import { ClockMeter, describeClock, formatTime } from '../app/clockrate'
import { useForceCount, useSimStatus } from '../app/hooks'
import { restartSim, sim } from '../app/sim'
import { useSimHealth } from '../app/simHealth'
import { select, useStore } from '../app/store'
import { ZoomControls } from './ZoomControls'

interface Stats {
  clock: ReturnType<typeof describeClock> | null
  /** Which engine settles the circuit. */
  engine: 'fast' | 'exact'
  /** The fast engine runs in Rust (WebAssembly). */
  wasm: boolean
  /** Simulated time, only with a clock. */
  time: string | null
}

/** What the footer measures, looked at twice a second: the fastest clock and the simulated time. */
function useStats(): Stats {
  const [stats, setStats] = useState<Stats>({ clock: null, time: null, engine: 'exact', wasm: false })
  useEffect(() => {
    const meter = new ClockMeter()
    const look = () => {
      const { running, speed } = useStore.getState()
      const asked = sim.fastestClockHz()
      const { offered, skipped } = sim.clockTime
      const share = meter.sample(performance.now(), offered, skipped, running)
      const next: Stats = {
        clock: asked === null ? null : describeClock(asked * speed, running ? share : null),
        time: asked === null ? null : formatTime(sim.time),
        engine: sim.engine,
        wasm: sim.wasmOn,
      }
      setStats((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    look()
    const timer = window.setInterval(look, 500)
    return () => window.clearInterval(timer)
  }, [])
  return stats
}

const breakpointIds = (comps: Record<string, { type: string }>) => Object.keys(comps).filter((id) => comps[id].type === 'breakpoint').join(',')

/**
 * The run side of the canvas, under it: whether the simulation runs, the clock, the lock on editing (a status that is also its
 * switch), warnings, signals held at a level, breakpoints and the simulated time; the zoom is at its right end. The lock is passed in,
 * so that this chunk does not need the settings.
 */
function FooterRow({ lockEdits, onToggleLock }: { lockEdits: boolean; onToggleLock: () => void }) {
  const running = useStore((s) => s.running)
  const failed = useSimHealth((s) => s.failed)
  const { clock, time, engine, wasm } = useStats()
  const oscillating = useSimStatus() === 'u'
  const held = useForceCount()
  const breakpoints = useStore((s) => breakpointIds(s.circuit.comps))
  const ids = breakpoints ? breakpoints.split(',') : []
  return (
    <div className="run-footer">
      <div className="run-left" role="status" aria-label="Simulation">
        <span className="run-label">Run</span>
        <span className="run-state">
          <span className={`run-dot${running && !failed ? ' live' : ''}${failed ? ' dead' : ''}`} aria-hidden="true" />
          {failed ? (
            <span className="run-pill failed" data-testid="run-state">
              Simulator stopped
            </span>
          ) : (
            <span data-testid="run-state">{running ? 'Running' : 'Paused'}</span>
          )}
        </span>
        {clock && (
          <span
            className={`run-clock${clock.slow ? ' slow' : ''}`}
            data-testid="clock-rate"
            title={
              clock.slow
                ? 'The fastest clock is faster than this page can simulate it, so part of its time is skipped. Lower its rate or the speed, or switch off Step-back history in Tools.'
                : 'The rate of the fastest clock, times the speed'
            }
          >
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
        <span
          className="run-engine"
          data-testid="engine"
          title={
            engine === 'fast'
              ? 'The fast engine settles each clock edge in one pass. It is used for circuits where it gives the same result as exact timing; (Rust) is the faster version. Tools → Exact gate timing turns it off.'
              : 'Every gate delay is simulated tick by tick. This is used when the circuit has a loop of gates or a delay, while a signal is held or the glitch view is open, or when Tools → Exact gate timing is on.'
          }
        >
          {engine === 'fast' ? (wasm ? 'fast engine (Rust)' : 'fast engine') : 'exact timing'}
        </span>
        <button
          className={`run-pill lock${lockEdits ? ' locked' : ''}`}
          onClick={onToggleLock}
          aria-pressed={lockEdits}
          title={
            lockEdits
              ? 'Locked: nothing can be edited while the simulation runs. Pause to edit, or click to unlock.'
              : 'Click to lock editing while the simulation runs, so nothing is changed by accident. Switches and memories still work.'
          }
          data-testid="lock-toggle"
        >
          {lockEdits ? '🔒 Editing locked' : '🔓 Editing enabled'}
        </button>
        {oscillating && (
          <span className="run-pill warn" title="Some signals keep changing on their own (a feedback loop without memory)" data-testid="oscillating">
            Oscillating
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
        {time !== null && (
          <span className="run-time" data-testid="run-time" title="Simulated time since the last Reset">
            t = <b>{time}</b>
          </span>
        )}
      </div>
      <ZoomControls />
    </div>
  )
}

/** The footer, with a banner above it when the simulator has stopped (the engine did not load, or the worker crashed). */
export function RunFooter(props: { lockEdits: boolean; onToggleLock: () => void }) {
  const failed = useSimHealth((s) => s.failed)
  return (
    <>
      {failed && (
        <div className="sim-banner" role="alert" data-testid="sim-banner">
          <span>
            <b>The simulator stopped.</b> {failed} Nothing is simulated until it runs again; your circuit is not lost.
          </span>
          <button className="primary-action" onClick={() => void restartSim()}>
            Restart simulator
          </button>
          <button onClick={() => location.reload()}>Reload</button>
        </div>
      )}
      <FooterRow {...props} />
    </>
  )
}
