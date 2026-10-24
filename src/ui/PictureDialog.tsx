import { useEffect, useState } from 'react'
import { closePicture, usePicture } from '../app/picture'
import { exportImage } from './canvas/exportImage'

/** Asks for the format and for how much of the circuit, then saves the picture. */
export function PictureDialog() {
  const open = usePicture((s) => s.open)
  return open ? <Dialog /> : null
}

function Dialog() {
  const [format, setFormat] = useState<'svg' | 'png'>('svg')
  const [area, setArea] = useState<'all' | 'view'>('all')
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closePicture()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && closePicture()}>
      <div className="modal picture" role="dialog" aria-modal="true" aria-label="Save a picture">
        <header className="modal-head">
          <strong>Save a picture</strong>
          <button className="modal-close" onClick={closePicture} aria-label="Close">
            ✕
          </button>
        </header>
        <form
          className="modal-body"
          onSubmit={(e) => {
            e.preventDefault()
            closePicture()
            void exportImage(format, area)
          }}
        >
          <fieldset className="picture-choice">
            <legend>Format</legend>
            <label>
              <input type="radio" name="format" checked={format === 'svg'} onChange={() => setFormat('svg')} />
              SVG <small>sharp at any size</small>
            </label>
            <label>
              <input type="radio" name="format" checked={format === 'png'} onChange={() => setFormat('png')} />
              PNG <small>a normal image</small>
            </label>
          </fieldset>
          <fieldset className="picture-choice">
            <legend>Show</legend>
            <label>
              <input type="radio" name="area" checked={area === 'all'} onChange={() => setArea('all')} />
              Whole circuit
            </label>
            <label>
              <input type="radio" name="area" checked={area === 'view'} onChange={() => setArea('view')} />
              What is on screen
            </label>
          </fieldset>
          <button type="submit" className="primary-action">
            Save {format.toUpperCase()}
          </button>
        </form>
      </div>
    </div>
  )
}
