import { create } from 'zustand'

export type LogicTab = 'analyze' | 'build' | 'compare'

interface LogicState {
  open: boolean
  tab: LogicTab
  /** The text of the Build tab's expression box. */
  buildText: string
  /** Which switches (inputs) and LEDs (outputs) the Analyze and Compare tabs sweep and read. null: not chosen yet. */
  inputIds: string[] | null
  outputIds: string[] | null
}

export const useLogic = create<LogicState>(() => ({ open: false, tab: 'analyze', buildText: '', inputIds: null, outputIds: null }))

export const openLogic = (tab?: LogicTab) => useLogic.setState((s) => ({ open: true, tab: tab ?? s.tab }))
export const closeLogic = () => useLogic.setState({ open: false })
export const setLogicTab = (tab: LogicTab) => useLogic.setState({ tab })
export const setBuildText = (buildText: string) => useLogic.setState({ buildText })
export const setLogicPorts = (inputIds: string[], outputIds: string[]) => useLogic.setState({ inputIds, outputIds })

/** Put an expression in the Build tab and show it. */
export const sendToBuild = (buildText: string) => useLogic.setState({ buildText, tab: 'build', open: true })
