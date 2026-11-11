import { Component, useEffect, useState, type ReactNode } from 'react'

/**
 * Catches a failure while a part of the page renders or loads (a lazy chunk that cannot be fetched, a bug in a panel) so the
 * rest of the page stays. `panel` shows a small card in place of the part; `root` shows a full screen with a way to keep the work.
 */
export class ErrorBoundary extends Component<{ kind: 'root' | 'panel'; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown) {
    console.error(error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return this.props.kind === 'root' ? <CrashScreen /> : <PanelFailed />
  }
}

function PanelFailed() {
  return (
    <div className="failure-card" role="alert">
      <span>This panel could not load.</span>
      <button onClick={() => location.reload()}>Reload</button>
    </div>
  )
}

/** What the page shows when nothing else could be drawn. Also used by `main.tsx` when `App` itself cannot be fetched. */
export function CrashScreen() {
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  const download = async () => {
    setSaving(true)
    try {
      await (await import('../app/libraryUi')).downloadLibrary()
      setNote('Saved to a file.')
    } catch {
      setNote('Could not save a copy. Reload and try again.')
    }
    setSaving(false)
  }
  return (
    <div className="failure-screen" role="alert">
      <h1>Something went wrong</h1>
      <p>Sklopko could not show this page. Your circuits are still kept in this browser.</p>
      <div className="failure-actions">
        <button className="primary-action" onClick={() => location.reload()}>
          Reload
        </button>
        <button onClick={() => void download()} disabled={saving}>
          Download all
        </button>
      </div>
      {note && <p>{note}</p>}
    </div>
  )
}

/**
 * After a deploy, a tab that was open asks for chunk names that no longer exist. Vite reports that as `vite:preloadError`:
 * keep the circuit and offer a reload.
 */
export function UpdatePrompt() {
  const [stale, setStale] = useState(false)
  useEffect(() => {
    const onError = () => {
      setStale(true)
      void import('../app/documents').then((m) => m.flushSave()).catch(() => {})
    }
    window.addEventListener('vite:preloadError', onError)
    return () => window.removeEventListener('vite:preloadError', onError)
  }, [])
  if (!stale) return null
  return (
    <div className="update-prompt" role="alert">
      <span>A new version of Sklopko is available. Your circuit is saved.</span>
      <button className="primary-action" onClick={() => location.reload()}>
        Reload
      </button>
    </div>
  )
}
