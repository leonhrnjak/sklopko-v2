import { create } from 'zustand'

/** Where the canvas's right-click menu is open (screen coordinates), or null while it is closed. */
export const useContextMenu = create<{ at: { x: number; y: number } | null }>(() => ({ at: null }))

export const openContextMenu = (x: number, y: number) => useContextMenu.setState({ at: { x, y } })
export const closeContextMenu = () => useContextMenu.setState({ at: null })
