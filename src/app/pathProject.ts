import { create } from 'zustand'
import type { Circuit } from '../model/circuit'
import type { ProjectResult } from '../model/path/run'

/** What the last check of the open CPU-project step found, and the circuit it was of (it is out of date once the circuit has changed). */
export const useProject = create<{ step: string | null; of: Circuit | null; result: ProjectResult | null }>(() => ({ step: null, of: null, result: null }))

export const clearProject = () => useProject.setState({ step: null, of: null, result: null })
