import { useMemo } from 'react'
import { clockChecks, formatHz, formatNs, setNsPerDelay, setShowPath, timingOf, useTiming } from '../app/timing'
import { select, useStore } from '../app/store'
import { getDef } from '../engine/registry'
import { partName } from '../model/timing'

/** The timing of the circuit: its slowest path, what a clock can do with it, and any feedback loops. */
export function TimingView() {
  const circuit = useStore((s) => s.circuit)
  const nsPerDelay = useTiming((s) => s.nsPerDelay)
  const showPath = useTiming((s) => s.showPath)
  const timing = useMemo(() => timingOf(circuit), [circuit])
  const { critical, endpoints, loops } = timing
  const name = (id: string) => (circuit.comps[id] ? partName(circuit.comps[id]) : id)
  const clocks = useMemo(() => (critical ? clockChecks(circuit, critical.delay, nsPerDelay) : []), [circuit, critical, nsPerDelay])
  const pathNs = critical ? critical.delay * nsPerDelay : 0
  const goTo = (...ids: string[]) => select(ids.filter((id) => circuit.comps[id]))

  return (
    <div className="timing" data-testid="timing">
      {critical ? (
        <>
          <div className="timing-summary">
            <p>
              <b data-testid="timing-delay">{critical.delay} gate delays</b> is the slowest path:{' '}
              <span data-testid="timing-fmax">
                {formatNs(pathNs)} at {nsPerDelay} ns each, so a clock can go up to about {formatHz(1e9 / pathNs)}
              </span>
              .
            </p>
            <div className="timing-controls">
              <label className="wave-window">
                <span>ns per gate delay</span>
                <input
                  type="number"
                  min={0.1}
                  max={10000}
                  step={1}
                  value={nsPerDelay}
                  onChange={(e) => Number.isFinite(e.target.valueAsNumber) && setNsPerDelay(e.target.valueAsNumber)}
                  aria-label="Nanoseconds per gate delay"
                  title="How long one gate delay is in real life. A fast gate of the 74 series takes about 10 ns."
                />
              </label>
              <button className={showPath ? 'active' : ''} aria-pressed={showPath} onClick={() => setShowPath(!showPath)} title="Mark the slowest path on the circuit">
                Show path
              </button>
            </div>
          </div>
          <div className="timing-cols">
            <section>
              <h4>The slowest path</h4>
              <ol className="timing-path" aria-label="The slowest path">
                {critical.steps.map((s, i) => (
                  <li key={`${s.comp}${i}`}>
                    <button className="timing-part" onClick={() => goTo(s.comp)} title="Select this part">
                      {name(s.comp)}
                    </button>
                    <span className="timing-time">
                      {i === 0 ? (s.delay ? `starts at ${s.delay}` : 'starts at 0') : i === critical.steps.length - 1 ? `arrives at ${s.arrival}` : `+${s.delay} → ${s.arrival}`}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
            <section>
              <h4>Where signals arrive last</h4>
              <table className="timing-table" aria-label="Slowest end points">
                <tbody>
                  {endpoints.map((e) => (
                    <tr key={`${e.comp}:${e.pin}`}>
                      <td>
                        <button className="timing-part" onClick={() => goTo(e.comp)}>
                          {name(e.comp)} {e.pin}
                        </button>
                      </td>
                      <td>{e.arrival}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {clocks.length > 0 && (
                <>
                  <h4>The clock</h4>
                  <ul className="timing-clocks">
                    {clocks.map((c) => (
                      <li key={c.comp} className={c.fits ? '' : 'bad'}>
                        <button className="timing-part" onClick={() => goTo(c.comp)}>
                          {name(c.comp)}
                        </button>{' '}
                        runs at {formatHz(c.hz)} (a cycle is {formatNs(c.periodNs)}).{' '}
                        {c.fits
                          ? `The path needs ${formatNs(pathNs)}, so there is room to spare (${c.ratio >= 10 ? Math.round(c.ratio).toLocaleString() : c.ratio.toFixed(1)}×).`
                          : `Too fast: the path needs ${formatNs(pathNs)}, more than one cycle. In real hardware the registers would catch wrong values.`}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>
        </>
      ) : (
        <p className="wave-empty">
          {loops.length > 0
            ? 'The only paths here are inside feedback loops, which cannot be timed (see below).'
            : 'Nothing to time yet. Wire some gates between a switch (or a clock, or a register) and an output, and the slowest path appears here. Every part takes one gate delay unless you give it another in the inspector.'}
        </p>
      )}
      {loops.length > 0 && (
        <section className="timing-loops">
          <h4>Feedback loops (not timed)</h4>
          <p>
            A latch or an oscillator built from gates feeds its own output back in, so it has no longest path. Paths that leave a loop start again at its output.
          </p>
          <ul>
            {loops.map((loop, i) => (
              <li key={i}>
                <button className="timing-part" onClick={() => goTo(...loop)} title="Select the parts of this loop">
                  {loop.length} part{loop.length === 1 ? '' : 's'}: {loop.slice(0, 4).map((id) => (circuit.comps[id] ? getDef(circuit.comps[id].type).name : id)).join(', ')}
                  {loop.length > 4 ? '…' : ''}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
