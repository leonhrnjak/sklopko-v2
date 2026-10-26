import { useForced } from '../app/hooks'
import { sim } from '../app/sim'

/**
 * Hold the signal a part's output drives at 0 or 1, whatever the part says: for trying what a stuck-at fault does to a circuit.
 * It acts on the running simulation only; nothing is saved with the circuit, and Reset keeps it.
 */
export function ForceControls({ comp, pin }: { comp: string; pin: string }) {
  const held = useForced(comp, pin)
  const hold = (v: 0 | 1 | null) => {
    sim.force(comp, pin, v)
    sim.settle()
    sim.publish()
  }
  return (
    <div className="force-controls" role="group" aria-label="Hold this signal at a level">
      <span className="force-title" title="Hold the signal at a level, whatever drives it, to see what a stuck-at fault would do. Not saved with the circuit.">
        Hold at
      </span>
      <button aria-pressed={held === 0} onClick={() => hold(0)} data-testid="force-0">
        0
      </button>
      <button aria-pressed={held === 1} onClick={() => hold(1)} data-testid="force-1">
        1
      </button>
      <button aria-pressed={held === null} onClick={() => hold(null)} data-testid="force-release">
        Release
      </button>
    </div>
  )
}
