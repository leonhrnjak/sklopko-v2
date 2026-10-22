import { create } from 'zustand'

interface TraceState {
  /** Also highlight the logic that feeds the selected wire's source. */
  cone: boolean
}

export const useTraceOptions = create<TraceState>(() => ({ cone: false }))
export const setCone = (cone: boolean) => useTraceOptions.setState({ cone })
