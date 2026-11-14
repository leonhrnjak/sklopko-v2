import { create } from 'zustand'
import type { ExampleGroup, ExampleInfo } from '../model/examples-index'
import { openExample } from './runtime'
import { showToast } from './store'
import { fitToExample } from './view'

/** The example gallery: a window with a card for every example, one category at a time (or all of them). */
export const useGallery = create<{ open: boolean; query: string; group: ExampleGroup | 'all' }>(() => ({ open: false, query: '', group: 'Start here' }))

export const openGallery = () => useGallery.setState({ open: true, query: '', group: 'Start here' })
export const closeGallery = () => useGallery.setState({ open: false })
/** Searching looks through every category, so typing switches to all of them. */
export const setGalleryQuery = (query: string) => useGallery.setState(query.trim() ? { query, group: 'all' } : { query })
export const setGalleryGroup = (group: ExampleGroup | 'all') => useGallery.setState({ group })

/** Open an example and close the gallery. What was open stays in the library (see `openExample`). */
export function openFromGallery(ex: ExampleInfo) {
  closeGallery()
  void openExample(ex).then(() => requestAnimationFrame(() => fitToExample(ex.fit)))
}

/** Copy the short link of an example. */
export async function copyExampleLink(ex: ExampleInfo) {
  const url = `${location.origin}/${ex.id}`
  try {
    await navigator.clipboard.writeText(url)
    showToast(`Link to “${ex.name}” copied.`)
  } catch {
    window.prompt('Copy this link:', url)
  }
}
