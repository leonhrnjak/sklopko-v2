import { useMemo } from 'react'
import { setLogicPorts, useLogic } from '../../app/logic'
import { useStore } from '../../app/store'
import { MAX_ANALYZE_INPUTS, analyzeCircuit, circuitPorts, type Analysis } from '../../model/analyze'

/**
 * The switches and LEDs of the circuit on the canvas, which of them are chosen as inputs and outputs (by default the
 * first 8 switches and all LEDs), and the analysis of that choice. The Analyze and Compare tabs share this.
 */
export function useCircuitAnalysis() {
  const circuit = useStore((s) => s.circuit)
  const chosenIn = useLogic((s) => s.inputIds)
  const chosenOut = useLogic((s) => s.outputIds)
  const ports = useMemo(() => circuitPorts(circuit), [circuit])
  // Chosen parts that are gone drop out; the order is always the circuit's reading order.
  const inputIds = ports.inputs.filter((p, i) => (chosenIn ? chosenIn.includes(p.id) : i < MAX_ANALYZE_INPUTS)).map((p) => p.id)
  const outputIds = ports.outputs.filter((p) => (chosenOut ? chosenOut.includes(p.id) : true)).map((p) => p.id)

  const toggle = (id: string, kind: 'in' | 'out') => {
    const current = kind === 'in' ? inputIds : outputIds
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    if (kind === 'in') setLogicPorts(next, outputIds)
    else setLogicPorts(inputIds, next)
  }

  const inKey = inputIds.join(',')
  const outKey = outputIds.join(',')
  const analysis = useMemo<{ result?: Analysis; error?: string }>(() => {
    if (!inputIds.length || !outputIds.length) return {}
    try {
      return { result: analyzeCircuit(circuit, inputIds, outputIds) }
    } catch (e) {
      return { error: (e as Error).message }
    }
  }, [circuit, inKey, outKey]) // oxlint-disable-line react-hooks/exhaustive-deps

  return { ports, inputIds, outputIds, toggle, ...analysis }
}
