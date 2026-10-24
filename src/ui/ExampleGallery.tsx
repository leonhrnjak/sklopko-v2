import { useEffect } from 'react'
import { closeGallery, copyExampleLink, openFromGallery, setGalleryQuery, useGallery } from '../app/gallery'
import { EXAMPLE_GROUPS } from '../model/examples-index'
import { BLURBS, searchExamples } from '../model/examples-blurbs'

/** Every example as a card with its picture, name and a line about it, in groups, with a search box. */
export function ExampleGallery() {
  const open = useGallery((s) => s.open)
  const query = useGallery((s) => s.query)
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && closeGallery()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open])
  if (!open) return null
  const found = searchExamples(query)
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && closeGallery()}>
      <div className="modal gallery" role="dialog" aria-modal="true" aria-label="Examples">
        <header className="modal-head">
          <strong>Examples</strong>
          <input
            type="search"
            className="gallery-search"
            placeholder="Search examples…"
            aria-label="Search examples"
            value={query}
            // On a phone, focusing it would open the keyboard over the pictures the person came to see.
            autoFocus={!matchMedia('(pointer: coarse)').matches}
            onChange={(e) => setGalleryQuery(e.target.value)}
          />
          <span className="challenge-count">
            {found.length} of {searchExamples('').length}
          </span>
          <button className="modal-close" onClick={closeGallery} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">
          {found.length === 0 && <p className="challenge-intro">No example matches “{query}”.</p>}
          {EXAMPLE_GROUPS.map((group) => {
            const cards = found.filter((x) => x.group === group)
            if (!cards.length) return null
            return (
              <section key={group} className="gallery-group">
                <h3>{group}</h3>
                <ul className="gallery-grid">
                  {cards.map((x) => (
                    <li key={x.id} className="gallery-card">
                      <button className="gallery-open" onClick={() => openFromGallery(x)} data-testid={`example-${x.id}`} title={`Open ${x.name}`}>
                        <img className="gallery-thumb" src={`${import.meta.env.BASE_URL}examples/${x.id}.svg`} alt="" loading="lazy" width="160" height="100" />
                        <b>{x.name}</b>
                        <small>{BLURBS[x.id]}</small>
                      </button>
                      <button className="gallery-link" onClick={() => void copyExampleLink(x)} aria-label={`Copy link to ${x.name}`} title="Copy the link to this example">
                        Copy link
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
