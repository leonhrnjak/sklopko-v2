import { useSimStatus } from '../app/hooks'
import { downloadJSON, openJSON, shareLink } from '../app/runtime'
import { sim } from '../app/sim'
import { clearAll, clearWires, loadCircuit, redo, setRunning, setSpeed, undo, useStore } from '../app/store'
import { EXAMPLES } from '../model/examples'
import { fitView } from './canvas/viewport'

export function Toolbar() {
  const running = useStore((s) => s.running)
  const speed = useStore((s) => s.speed)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)

  const step = () => {
    sim.tick()
    sim.publish()
  }
  const stepClock = () => {
    sim.stepClock()
    sim.publish()
  }
  const reset = () => {
    sim.reset()
    sim.settle()
    sim.publish()
  }

  return (
    <header className="toolbar">
      <div className="brand">
        SKLOPKO <span className="brand-sub">logic simulator</span>
      </div>
      <div className="group">
        <button
          className={`primary ${running ? 'running' : ''}`}
          onClick={() => setRunning(!running)}
          title={running ? 'Pause the simulation' : 'Run the simulation'}
          data-testid="run"
        >
          {running ? '❚❚ Pause' : '▶ Run'}
        </button>
        <button onClick={step} disabled={running} title="Advance one gate delay (pause first)">
          Step
        </button>
        <button onClick={stepClock} title="Jump to the next clock edge">
          Clock edge
        </button>
        <button onClick={reset} title="Power-cycle: all signals and memories return to their initial state">
          Reset
        </button>
        <select
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          aria-label="Simulation speed"
          title="Simulation speed (scales every clock)"
        >
          {[0.25, 0.5, 1, 2, 4].map((v) => (
            <option key={v} value={v}>
              {v === 1 ? '1× speed' : `${v}×`}
            </option>
          ))}
        </select>
      </div>
      <div className="group">
        <button onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
          ↶
        </button>
        <button onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">
          ↷
        </button>
        <button onClick={fitView} title="Fit circuit to screen (H)">
          Fit
        </button>
      </div>
      <div className="group">
        <select
          value=""
          onChange={(e) => {
            const ex = EXAMPLES.find((x) => x.id === e.target.value)
            if (ex) {
              loadCircuit(ex.build())
              requestAnimationFrame(fitView)
            }
          }}
          aria-label="Load an example"
        >
          <option value="" disabled>
            Examples…
          </option>
          {EXAMPLES.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <button onClick={clearAll} title="Start an empty circuit (undoable)">
          New
        </button>
        <button onClick={clearWires} title="Remove all wires, keep the parts (undoable)">
          Clear wires
        </button>
        <button onClick={openJSON} title="Open a saved circuit file">
          Open
        </button>
        <button onClick={downloadJSON} title="Download the circuit as a file">
          Save
        </button>
        <button onClick={shareLink} title="Copy a link containing this circuit">
          Share
        </button>
      </div>
    </header>
  )
}

export function StatusBar() {
  const status = useSimStatus()
  const running = useStore((s) => s.running)
  const toast = useStore((s) => s.toast)
  const empty = useStore((s) => Object.keys(s.circuit.comps).length === 0)
  return (
    <>
      <div className="status">
        {!running && <span className="badge paused">Paused</span>}
        {status === 'u' && (
          <span className="badge warn" title="Some signals keep changing on their own (feedback loop without memory)">
            Oscillating
          </span>
        )}
      </div>
      {empty && (
        <div className="empty-hint">
          Drag parts from the left onto the canvas, then drag from pin to pin to wire them.
          <br />
          Or pick one of the <b>Examples</b> above.
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}
