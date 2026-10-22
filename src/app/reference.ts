import { create } from 'zustand'

export type ReferenceTab = 'start' | 'format' | 'instructions' | 'ports' | 'examples'

interface ReferenceState {
  open: boolean
  tab: ReferenceTab
}

/** The SKASM language reference: a window that can be opened from the toolbar, the help panel and a program ROM. */
export const useReference = create<ReferenceState>(() => ({ open: false, tab: 'start' }))

export const openReference = (tab?: ReferenceTab) => useReference.setState((s) => ({ open: true, tab: tab ?? s.tab }))
export const closeReference = () => useReference.setState({ open: false })
export const setReferenceTab = (tab: ReferenceTab) => useReference.setState({ tab })
