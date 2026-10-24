import { create } from 'zustand'

export type ReferenceTab = 'start' | 'format' | 'instructions' | 'ports' | 'examples'

/** The sections of the 6502 reference. */
export type Reference6502Tab = 'start' | 'instructions' | 'modes' | 'map'

interface ReferenceState {
  open: boolean
  /** Which language's reference is shown. */
  language: 'skasm' | '6502'
  tab: ReferenceTab
  tab6502: Reference6502Tab
}

/** The language references: a window that can be opened from the toolbar, the help panel and a program ROM. */
export const useReference = create<ReferenceState>(() => ({ open: false, language: 'skasm', tab: 'start', tab6502: 'start' }))

/** Open the SKASM reference. */
export const openReference = (tab?: ReferenceTab) => useReference.setState((s) => ({ open: true, language: 'skasm', tab: tab ?? s.tab }))
/** Open the 6502 reference. */
export const open6502Reference = (tab?: Reference6502Tab) => useReference.setState((s) => ({ open: true, language: '6502', tab6502: tab ?? s.tab6502 }))
export const closeReference = () => useReference.setState({ open: false })
export const setReferenceTab = (tab: ReferenceTab) => useReference.setState({ tab })
export const set6502ReferenceTab = (tab: Reference6502Tab) => useReference.setState({ tab6502: tab })
