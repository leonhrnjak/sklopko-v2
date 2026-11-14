import { useEffect } from 'react'
import { closeLongShare, useLongShare } from '../app/shareLimit'
import { downloadJSON, copyText } from '../app/runtime'

/** Shown instead of copying a share link that chat and mail tools would cut: offers a file, or the long link anyway. */
export function ShareTooLong() {
  const pending = useLongShare((s) => s.pending)
  useEffect(() => {
    if (!pending) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeLongShare()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [pending])
  if (!pending) return null
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && closeLongShare()}>
      <div className="modal share-long" role="dialog" aria-modal="true" aria-label="Too big for a link">
        <header className="modal-head">
          <strong>Too big for a link</strong>
          <button className="modal-close" onClick={closeLongShare} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <p data-testid="share-too-long">
            This circuit is too big for a link ({pending.length.toLocaleString('en-US')} characters). Save it as a file to share it.
          </p>
          <div className="failure-actions">
            <button
              className="primary-action"
              onClick={() => {
                downloadJSON()
                closeLongShare()
              }}
            >
              Save file
            </button>
            <button
              onClick={() => {
                const p = pending
                closeLongShare()
                void copyText(p.text, p.toast)
              }}
            >
              Copy the long {pending.what} anyway
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
