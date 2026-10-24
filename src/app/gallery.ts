import { create } from 'zustand'
import type { ExampleInfo } from '../model/examples-index'
import { openExample } from './runtime'
import { showToast } from './store'
import { fitToScreen } from './view'

/** The example gallery: a window with a card for every example. */
export const useGallery = create<{ open: boolean; query: string }>(() => ({ open: false, query: '' }))

export const openGallery = () => useGallery.setState({ open: true, query: '' })
export const closeGallery = () => useGallery.setState({ open: false })
export const setGalleryQuery = (query: string) => useGallery.setState({ query })

/** Open an example and close the gallery. What was open stays in the library (see `openExample`). */
export function openFromGallery(ex: ExampleInfo) {
  closeGallery()
  void openExample(ex).then(() => requestAnimationFrame(fitToScreen))
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
