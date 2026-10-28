import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { openChallengeList } from '../app/challenges'
import { openGallery } from '../app/gallery'
import { leaveLevels, leaveToDepth, openMakeIc } from '../app/ics'
import { openTestbench } from '../app/testbench'
import { newCircuit, renameOpenDoc, useDoc } from '../app/documents'
import { isEmbed } from '../app/embed'
import { openFsm } from '../app/fsm'
import { openLibraryDialog } from '../app/libraryUi'
import { openMap, useDoneCount } from '../app/path'
import { openPicture } from '../app/picture'
import { openLogic } from '../app/logic'
import { open6502Reference, openBasicReference, openParts6502Reference, openReference } from '../app/reference'
import { copyEmbedCode, downloadJSON, openJSON, shareLink } from '../app/runtime'
import { updateSettings, useSettings } from '../app/settings'
import { setHistoryOn, useHistoryOn } from '../app/stepback'
import { setWaveOpen, toggleTiming, useWave } from '../app/waveform'
import { sim } from '../app/sim'
import {
  clearWires,
  redo,
  select,
  setRunning,
  setSheetOpen,
  setSpeed,
  undo,
  useStore,
} from '../app/store'
import { levelsOf } from '../model/ic'
import { PATH_STEP_COUNT } from '../model/path'
import { fitView } from './canvas/viewport'

/** Opens the map of the learning path. Once something is done, a ring shows how much. */
function LearnButton() {
  const done = useDoneCount()
  return (
    <button className="learn-btn" onClick={openMap} title="Learn: From NAND to a computer. A path of short lessons, each with something to build, ending in a real 6502 running BASIC" data-testid="learn-button">
      Learn
      {done > 0 && <span className="learn-ring" style={{ '--p': `${Math.round((100 * done) / PATH_STEP_COUNT)}%` } as CSSProperties} role="img" aria-label={`${done} of ${PATH_STEP_COUNT} steps done`} />}
    </button>
  )
}

/** Labelled display options; used in the settings popover and in the phone menu. */
function SettingsFields() {
  const gateStyle = useSettings((s) => s.gateStyle)
  const hops = useSettings((s) => s.hops)
  const wireColors = useSettings((s) => s.wireColors)
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
      <label className="setting">
        <span>Signal colours</span>
        <select
          value={wireColors}
          onChange={(e) => updateSettings({ wireColors: e.target.value === 'blue-orange' ? 'blue-orange' : 'classic' })}
          data-testid="setting-colors"
        >
          <option value="classic">Green 1 / red 0</option>
          <option value="blue-orange">Orange 1 / blue 0</option>
        </select>
      </label>
    </>
  )
}

/** Shows the help panel again after it was hidden (it is open on the first visit). */
function HelpToggle() {
  const helpOpen = useSettings((s) => s.helpOpen)
  return (
    <button
      onClick={() => {
        select([])
        updateSettings({ helpOpen: !helpOpen })
      }}
      aria-pressed={helpOpen}
      aria-label="Help"
      title={helpOpen ? 'Hide the help panel' : 'Show the help panel'}
      data-testid="help-toggle"
    >
      ?
    </button>
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

/** One entry of a menu: a button, or a checkbox when `checked` is given. */
function MenuItem({
  onClick,
  title,
  checked,
  disabled,
  testid,
  children,
}: {
  onClick: () => void
  title?: string
  checked?: boolean
  disabled?: boolean
  testid?: string
  children: ReactNode
}) {
  return (
    <button
      role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked}
      className={checked ? 'active' : ''}
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testid}
    >
      {children}
    </button>
  )
}

/** The small window that says an entry opens a window. Shown in the drop-down menus; left out of the phone menu's buttons, where it only adds clutter. */
const OpensWindow = () => <span className="opens-window" aria-hidden="true" />

/** A heading inside a menu, for a group of entries. */
const MenuLabel = ({ children }: { children: ReactNode }) => (
  <div className="menu-label" role="presentation">
    {children}
  </div>
)

/** A toolbar button that opens a list of entries; choosing one, clicking elsewhere or Escape closes it. */
function DropMenu({ label, children }: { label: string; children: ReactNode }) {
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
    <div className="drop-wrap" ref={ref}>
      <button onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        {label} ▾
      </button>
      {open && (
        <div
          className="drop-menu"
          role="menu"
          aria-label={label}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('[role^="menuitem"]')) setOpen(false)
          }}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)')]
            const at = items.indexOf(document.activeElement as HTMLElement)
            items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
            e.preventDefault()
          }}
        >
          {children}
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
  const historyOn = useHistoryOn()
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
        title={
          historyOn
            ? 'Go back to the previous clock edge: every signal, memory and the time as they were then. Pauses the simulation.'
            : 'Stepping back is switched off for this circuit, so that it runs faster. Switch it on in Tools → Step-back history.'
        }
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

  const toolItems = (
    <>
      <MenuLabel>Build and check</MenuLabel>
      <MenuItem onClick={() => openLogic()} title="Truth tables, Boolean expressions and Karnaugh maps: analyze this circuit, build one from an expression, or compare two">
        Logic
        <OpensWindow />
      </MenuItem>
      <MenuItem onClick={openFsm} title="Draw a state machine as states and arrows (or fill in a table), check it, and generate the circuit: gates and flip-flops">
        State machines
        <OpensWindow />
      </MenuItem>
      <MenuItem onClick={() => openMakeIc()} title="Make a part of your own from this circuit (or from the selected parts), to use like any other part">
        Make IC
        <OpensWindow />
      </MenuItem>
      <MenuItem onClick={openTestbench} title="Steps that set switches, pulse a clock and check LEDs, saved with the circuit: run them to see what passes">
        Tests
        <OpensWindow />
      </MenuItem>
      <MenuLabel>Learn</MenuLabel>
      <MenuItem onClick={openMap} title="From NAND to a computer: a path of short lessons, each with something to build, ending in a real 6502 running BASIC">
        Learn: from NAND to a computer
      </MenuItem>
      <MenuItem onClick={openChallengeList} title="Short lessons, each with something to build; your circuit is checked automatically">
        Challenges
      </MenuItem>
      <MenuItem onClick={() => openReference()} title="How to write programs for the computers: the SKASM assembly language, its instructions, ports and examples">
        SKASM
        <OpensWindow />
      </MenuItem>
      <MenuItem onClick={() => open6502Reference()} title="The 6502 assembly language">
        6502
        <OpensWindow />
      </MenuItem>
      <MenuItem onClick={() => openBasicReference()} title="The BASIC of the BASIC computer: its statements, functions and errors, and programs to type in">
        BASIC
        <OpensWindow />
      </MenuItem>
      <MenuItem onClick={() => openParts6502Reference()} title="How the 6502 built from parts works: its blocks, where they are in the circuit, and every instruction cycle by cycle">
        6502 from parts
        <OpensWindow />
      </MenuItem>
      <MenuLabel>Show</MenuLabel>
      <MenuItem
        checked={historyOn}
        onClick={() => setHistoryOn(!historyOn)}
        title="Keep a snapshot at every clock edge, so that ◀ Back can step back over the last 1,000. Switch it off for a circuit with a very fast clock, such as a computer running a program: it runs several times faster. Saved with the circuit."
        testid="history-toggle"
      >
        Step-back history
      </MenuItem>
      <MenuItem
        checked={waveOpen}
        onClick={() => (waveOpen ? setWaveOpen(false) : useWave.setState({ open: true, view: 'waves' }))}
        title="Show or hide the waveform panel (traces of Probe parts over time)"
        testid="waves-toggle"
      >
        Waveforms
      </MenuItem>
      <MenuItem
        checked={timingOpen}
        onClick={toggleTiming}
        title="How long the signals take to get through the circuit: the slowest path, how fast a clock can run, feedback loops"
        testid="timing-toggle"
      >
        Timing
      </MenuItem>
    </>
  )

  const fileItems = (
    <>
      <MenuItem onClick={newCircuit} title="Start an empty circuit. What is open stays in your library">
        New
      </MenuItem>
      <MenuItem onClick={openLibraryDialog} title="Every circuit and state machine you have made, kept in this browser: open, rename, copy, delete, back up">
        My circuits
      </MenuItem>
      <MenuItem onClick={openJSON} title="Open a saved circuit file">
        Open file
      </MenuItem>
      <MenuItem onClick={downloadJSON} title="Download the circuit as a file">
        Save file
      </MenuItem>
      <MenuItem onClick={copyEmbedCode} title="Copy HTML that shows this circuit, running, in a web page (an iframe)">
        Embed code
      </MenuItem>
      <MenuItem onClick={clearWires} title="Remove all wires, keep the parts (undoable)">
        Clear wires
      </MenuItem>
      <MenuItem onClick={openPicture} title="Save the circuit as an SVG or PNG picture: all of it, or what is on screen">
        Save picture
        <OpensWindow />
      </MenuItem>
    </>
  )

  const examplesButton = (
    <button className="examples-btn" onClick={openGallery} title="Pictures of every example, with a search: open one to see it work">
      Examples
    </button>
  )

  const shareButton = (
    <button onClick={shareLink} title="Copy a link containing this circuit">
      Share
    </button>
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
        <span className="wide-only toolbar-icons">
          <HelpToggle />
          <SettingsPopover />
        </span>
      </div>
      <div className="group wide-only">
        <LearnButton />
        {examplesButton}
        <DropMenu label="Tools">{toolItems}</DropMenu>
        <DropMenu label="File">{fileItems}</DropMenu>
        {shareButton}
      </div>
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
            <div className="menu-section">
              <LearnButton />
              {examplesButton}
              {shareButton}
            </div>
            <div className="menu-section">{simControls}</div>
            <div className="menu-section" role="menu" aria-label="Tools">
              <MenuLabel>Tools</MenuLabel>
              {toolItems}
            </div>
            <div className="menu-section" role="menu" aria-label="File">
              <MenuLabel>File</MenuLabel>
              {fileItems}
            </div>
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

/** The name of the open circuit, over the canvas: click to change it. Italic until it has been changed (and so is kept). */
function DocName() {
  const { name, saved } = useDoc()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  if (isEmbed()) return null
  if (editing)
    return (
      <input
        className="doc-name-input"
        aria-label="Circuit name"
        value={text}
        maxLength={100}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false)
          renameOpenDoc(text)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setText(name)
            e.currentTarget.blur()
          }
        }}
      />
    )
  return (
    <button
      className={`doc-name${saved ? '' : ' unsaved'}`}
      onClick={() => {
        setText(name)
        setEditing(true)
      }}
      title={saved ? 'The name of this circuit in your library. Click to change it.' : 'Not kept yet: it is saved as soon as you change something. Click to name it.'}
      aria-label={`Circuit name: ${name}`}
    >
      {name || 'Untitled'}
    </button>
  )
}

/** While the inside of an IC is open: where it is (Main › Full adder › Half adder), and the way back. */
function Crumbs() {
  const circuit = useStore((s) => s.circuit)
  const levels = levelsOf(circuit)
  if (!levels.length) return null
  return (
    <nav className="crumbs" aria-label="Editing an IC" data-testid="crumbs">
      <button onClick={() => leaveLevels(1)} title="Back to the circuit this IC is placed in. Every copy of the IC changes with it">
        ← Back
      </button>
      <ol>
        <li>
          <button onClick={() => leaveToDepth(0)}>Main</button>
        </li>
        {levels.map((id, i) => (
          <li key={i}>
            {i < levels.length - 1 ? (
              <button onClick={() => leaveToDepth(i + 1)}>{circuit.ics?.[id]?.name ?? id}</button>
            ) : (
              <span aria-current="location">{circuit.ics?.[id]?.name ?? id}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function StatusBar() {
  const toast = useStore((s) => s.toast)
  const toastAction = useStore((s) => s.toastAction)
  const empty = useStore((s) => Object.keys(s.circuit.comps).length === 0)
  return (
    <>
      <div className="status">
        <DocName />
        <Crumbs />
      </div>
      {empty && (
        <div className="empty-hint">
          <p>
            Drag parts from the left onto the canvas, then drag from pin to pin to wire them.
            <br />
            Or pick one of the <b>Examples</b> above.
          </p>
        </div>
      )}
      {toast && (
        <div className={`toast${toastAction ? ' has-action' : ''}`}>
          {toast}
          {toastAction && (
            <button
              onClick={() => {
                toastAction.run()
                useStore.setState({ toast: null, toastAction: null })
              }}
            >
              {toastAction.label}
            </button>
          )}
        </div>
      )}
      <div className="version" title={__APP_COMMIT__ ? `Build ${__APP_COMMIT__}` : undefined}>
        v{__APP_VERSION__}
      </div>
    </>
  )
}
