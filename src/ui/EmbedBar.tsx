import { useSyncExternalStore } from 'react'
import { sim } from '../app/sim'
import { setRunning, useStore } from '../app/store'
import { fitView } from './canvas/viewport'

/** The few controls an embedded circuit has, and a way to open it in the full editor. */
export function EmbedBar() {
  const running = useStore((s) => s.running)
  const canBack = useSyncExternalStore(sim.subscribe, () => sim.canStepBack())
  // The same circuit in the editor: the link without ?embed=1 (a share link or an example's short link).
  const params = new URLSearchParams(location.search)
  params.delete('embed')
  const query = params.toString()
  const editor = `${location.pathname}${query ? `?${query}` : ''}${location.hash}`
  return (
    <div className="embed-bar" role="toolbar" aria-label="Simulation controls">
      <button className="primary" onClick={() => setRunning(!running)} data-testid="run" title={running ? 'Pause the simulation' : 'Run the simulation'}>
        {running ? '❚❚ Pause' : '▶ Run'}
      </button>
      <button
        onClick={() => {
          setRunning(false)
          sim.stepBack()
          sim.publish()
        }}
        disabled={!canBack}
        title="Go back to the previous clock edge"
      >
        ◀ Back
      </button>
      <button
        onClick={() => {
          sim.stepClock()
          sim.publish()
        }}
        title="Flip the clock(s) to their next level"
      >
        Clock step
      </button>
      <button
        onClick={() => {
          sim.reset()
          sim.settle()
          sim.publish()
        }}
        title="Power-cycle: all signals and memories return to their initial state"
      >
        Reset
      </button>
      <button onClick={fitView} title="Fit the circuit to the window">
        Fit
      </button>
      <a className="embed-open" href={editor} target="_blank" rel="noopener noreferrer" title="Open this circuit in the Sklopko editor">
        Open in Sklopko ↗
      </a>
    </div>
  )
}
