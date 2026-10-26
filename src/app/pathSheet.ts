import { create } from 'zustand'
import { usePath } from './path'

/**
 * On a phone the step's panel is a sheet over the parts list. Folded, it is a bar with the step's title, and the parts list shows
 * above it; the same button unfolds it. A step that opens comes unfolded. Loads with the step panel.
 */
export const useSheet = create<{ folded: boolean }>(() => ({ folded: false }))

export const toggleSheet = () => useSheet.setState((s) => ({ folded: !s.folded }))

usePath.subscribe((s, prev) => {
  if (s.step !== prev.step) useSheet.setState({ folded: false })
})
