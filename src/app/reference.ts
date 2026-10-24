import { create } from 'zustand'

export type ReferenceTab = 'start' | 'format' | 'instructions' | 'ports' | 'examples'

/** The sections of the 6502 reference. */
export type Reference6502Tab = 'start' | 'instructions' | 'modes' | 'map'

type Language = 'skasm' | '6502'

/** The language references: a window that can be opened from the toolbar, the help panel and a program ROM. */
export const useReference = create<{ open: boolean; language: Language; tab: string }>(() => ({ open: false, language: 'skasm', tab: 'start' }))

const show = (language: Language, tab?: string) => useReference.setState((s) => ({ open: true, language, tab: tab ?? (s.language === language ? s.tab : 'start') }))

/** Open the SKASM reference. */
export const openReference = (tab?: ReferenceTab) => show('skasm', tab)
/** Open the 6502 reference. */
export const open6502Reference = (tab?: Reference6502Tab) => show('6502', tab)
export const closeReference = () => useReference.setState({ open: false })
export const setReferenceTab = (tab: ReferenceTab | Reference6502Tab) => useReference.setState({ tab })
