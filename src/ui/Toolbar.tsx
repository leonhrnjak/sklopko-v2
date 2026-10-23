import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useSimStatus } from '../app/hooks'
import { openChallengeList } from '../app/challenges'
import { openFsm } from '../app/fsm'
import { openLogic } from '../app/logic'
import { openReference } from '../app/reference'
import { copyEmbedCode, downloadJSON, openExample, openJSON, shareLink } from '../app/runtime'
import { updateSettings, useSettings } from '../app/settings'
import { setWaveOpen, toggleTiming, useWave } from '../app/waveform'
import { sim } from '../app/sim'
import {
  clearAll,
  clearWires,
  redo,
  select,
  setRunning,
  setSheetOpen,
  setSpeed,
  undo,
  useStore,
} from '../app/store'
import { EXAMPLES, EXAMPLE_GROUPS } from '../model/examples'
import { exportImage } from './canvas/exportImage'
import { fitView } from './canvas/viewport'

/** Labelled display options; used in the settings popover and in the phone menu. */
function SettingsFields() {
  const gateStyle = useSettings((s) => s.gateStyle)
  const hops = useSettings((s) => s.hops)
  return (
    <>
      <label className="setting">
        <span>Gate symbols</span>
        <select
          value={gateStyle}
          onChange={(e) => updateSettings({ gateStyle: e.target.value === 'iec' ? 'iec' : 'us' })}
          data-testid="setting-gates"
        >
          <option value="us">US (curved)</option>
          <option value="iec">IEC (rectangles)</option>
        </select>
      </label>
      <label className="setting">
        <span>Wire hops</span>
        <select
          value={hops ? 'on' : 'off'}
          onChange={(e) => updateSettings({ hops: e.target.value === 'on' })}
          data-testid="setting-hops"
        >
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </label>
    </>
  )
}

function SettingsPopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('keydown', key)
    }
  }, [open])
  return (
    <div className="settings-wrap" ref={ref}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Settings" title="Settings" data-testid="settings">
        ⚙
      </button>
      {open && (
        <div className="settings-pop" role="dialog" aria-label="Settings">
          <SettingsFields />
        </div>
      )}
    </div>
  )
}

export function Toolbar() {
  const running = useStore((s) => s.running)
  const speed = useStore((s) => s.speed)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const waveOpen = useWave((s) => s.open && s.view === 'waves')
  const timingOpen = useWave((s) => s.open && s.view === 'timing')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close the overflow menu when tapping anywhere outside it.
  useEffect(() => {
    if (!menuOpen) return
    const down = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', down)
    return () => window.removeEventListener('pointerdown', down)
  }, [menuOpen])

  const canBack = useSyncExternalStore(sim.subscribe, () => sim.canStepBack())
  const step = () => {
    sim.tick()
    sim.publish()
  }
  const stepBack = () => {
    setRunning(false)
    sim.stepBack()
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

  const simControls = (
    <>
      <button onClick={step} disabled={running} title="Advance one gate delay (pause first)">
        Step
      </button>
      <button
        onClick={stepBack}
        disabled={!canBack}
        title="Go back to the previous clock edge: every signal, memory and the time as they were then. Pauses the simulation."
      >
        ◀ Back
      </button>
      <button
        onClick={stepClock}
        title="Flip the clock(s) to their next level right away (0→1 or 1→0). Handy while paused to step a counter or shift register one tick at a time."
      >
        Clock step
      </button>
      <button onClick={reset} title="Power-cycle: all signals and memories return to their initial state">
        Reset
      </button>
      <button onClick={() => openLogic()} title="Truth tables, Boolean expressions and Karnaugh maps: analyze this circuit, build one from an expression, or compare two">
        Logic…
      </button>
      <button onClick={openFsm} title="Draw a state machine as states and arrows (or fill in a table), check it, and generate the circuit: gates and flip-flops">
        State machines…
      </button>
      <button onClick={() => openReference()} title="How to write programs for the computers: the SKASM assembly language, its instructions, ports and examples">
        SKASM…
      </button>
      <button onClick={openChallengeList} title="Short lessons, each with something to build; your circuit is checked automatically">
        Challenges
      </button>
      <button
        className={waveOpen ? 'active' : ''}
        onClick={() => (waveOpen ? setWaveOpen(false) : useWave.setState({ open: true, view: 'waves' }))}
        aria-pressed={waveOpen}
        title="Show or hide the waveform panel (traces of Probe parts over time)"
        data-testid="waves-toggle"
      >
        Waveforms
      </button>
      <button
        className={timingOpen ? 'active' : ''}
        onClick={toggleTiming}
        aria-pressed={timingOpen}
        title="How long the signals take to get through the circuit: the slowest path, how fast a clock can run, feedback loops"
        data-testid="timing-toggle"
      >
        Timing
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
    </>
  )

  const fileControls = (
    <>
      <select
        value=""
        onChange={(e) => {
          const ex = EXAMPLES.find((x) => x.id === e.target.value)
          if (ex) {
            openExample(ex)
            setMenuOpen(false)
            requestAnimationFrame(fitView)
          }
        }}
        aria-label="Load an example"
      >
        <option value="" disabled>
          Examples…
        </option>
        {EXAMPLE_GROUPS.map((group) => (
          <optgroup key={group} label={group}>
            {EXAMPLES.filter((x) => x.group === group).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </optgroup>
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
      <button onClick={copyEmbedCode} title="Copy HTML that shows this circuit, running, in a web page (an iframe)">
        Embed
      </button>
      <select
        value=""
        onChange={(e) => {
          const [format, area] = e.target.value.split('-') as ['svg' | 'png', 'all' | 'view']
          void exportImage(format, area)
        }}
        aria-label="Export a picture"
        title="Save a picture of the circuit"
      >
        <option value="" disabled>
          Picture…
        </option>
        <option value="svg-all">SVG, whole circuit</option>
        <option value="svg-view">SVG, what is on screen</option>
        <option value="png-all">PNG, whole circuit</option>
        <option value="png-view">PNG, what is on screen</option>
      </select>
    </>
  )

  return (
    <header className="toolbar">
      <div className="brand">
        SKLOPKO <span className="brand-sub">logic simulator</span>
      </div>
      <button
        className={`primary ${running ? 'running' : ''}`}
        onClick={() => setRunning(!running)}
        title={running ? 'Pause the simulation' : 'Run the simulation'}
        data-testid="run"
      >
        {running ? '❚❚ Pause' : '▶ Run'}
      </button>
      <div className="group wide-only">{simControls}</div>
      <div className="group">
        <button onClick={undo} disabled={!canUndo} title="Undo (⌘Z)" aria-label="Undo">
          ↶
        </button>
        <button onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)" aria-label="Redo">
          ↷
        </button>
        <button onClick={fitView} title="Fit circuit to screen (H)">
          Fit
        </button>
        <span className="wide-only">
          <SettingsPopover />
        </span>
      </div>
      <div className="group wide-only">{fileControls}</div>
      <div className="menu-wrap narrow-only" ref={menuRef}>
        <button
          className="menu-btn"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-expanded={menuOpen}
          aria-label="More actions"
        >
          ☰
        </button>
        {menuOpen && (
          <div
            className="toolbar-menu"
            onClick={(e) => {
              // Any button in the menu closes it; selects close themselves after a choice.
              if ((e.target as HTMLElement).closest('button')) setMenuOpen(false)
            }}
          >
            <div className="menu-section">{simControls}</div>
            <div className="menu-section">{fileControls}</div>
            <div className="menu-section settings-section">
              <SettingsFields />
            </div>
            <div className="menu-section">
              <button
                onClick={() => {
                  select([])
                  setSheetOpen(true)
                }}
              >
                Help
              </button>
            </div>
          </div>
        )}
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
      <div className="version" title={__APP_COMMIT__ ? `Build ${__APP_COMMIT__}` : undefined}>
        v{__APP_VERSION__}
      </div>
    </>
  )
}
