import { create } from 'zustand'

/** On a phone the parts list sits under the canvas; this is whether it is open or folded down to its handle. */
export const usePartsDrawer = create<{ open: boolean }>(() => ({ open: true }))

export const setPartsOpen = (open: boolean) => usePartsDrawer.setState({ open })
