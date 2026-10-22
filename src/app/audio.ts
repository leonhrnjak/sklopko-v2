import { speakerPitch, speakerTone, type SpeakerState } from '../engine/components/devices'
import type { Circuit } from '../model/circuit'
import { sim } from './sim'

/** Level of one speaker: a square wave is loud. */
const VOLUME = 0.04

interface Voice {
  osc: OscillatorNode
  gain: GainNode
}

let ctx: AudioContext | null = null
const voices = new Map<string, Voice>()

/** Browsers only allow sound after the visitor has interacted with the page: start the audio on the first click or key. */
export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume()
    return
  }
  try {
    ctx = new AudioContext()
    void ctx.resume()
  } catch {
    // No audio in this browser: the speakers stay silent.
  }
}

/** Tune each speaker of the circuit to what its input is doing now, and silence the ones that stopped. Called every frame. */
export function updateAudio(circuit: Circuit, running: boolean, speed: number) {
  if (!ctx) return
  const seen = new Set<string>()
  for (const k of Object.values(circuit.comps)) {
    if (k.type !== 'speaker') continue
    seen.add(k.id)
    const st = sim.state(k.id) as SpeakerState | undefined
    const hz = st ? speakerTone(speakerPitch(st.edges, sim.time), speed, k.params.on !== false, running) : 0
    let v = voices.get(k.id)
    if (!v) {
      if (!hz) continue
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      gain.gain.value = 0
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      v = { osc, gain }
      voices.set(k.id, v)
    }
    const now = ctx.currentTime
    if (hz) v.osc.frequency.setTargetAtTime(hz, now, 0.01)
    v.gain.gain.setTargetAtTime(hz ? VOLUME : 0, now, 0.02)
  }
  for (const [id, v] of voices) {
    if (seen.has(id)) continue
    v.osc.stop()
    v.osc.disconnect()
    v.gain.disconnect()
    voices.delete(id)
  }
}
