/**
 * Value Change Dump: the plain-text waveform format that GTKWave, Surfer, Sigrok/PulseView and most other waveform
 * viewers read. https://en.wikipedia.org/wiki/Value_change_dump
 */

export interface VcdSignal {
  name: string
  /** 1 for a single wire, more for a bus. */
  width: number
  /** `v[i]` holds from `t[i]` ms. A wire is 0, 1, 2 (unknown) or 3 (high impedance); a bus is a number, or -1 when unknown. */
  t: number[]
  v: number[]
}

/** The identifier for the n-th signal: printable ASCII characters ! to ~, in base 94. */
export function vcdId(n: number): string {
  let id = ''
  do {
    id = String.fromCharCode(33 + (n % 94)) + id
    n = Math.floor(n / 94) - 1
  } while (n >= 0)
  return id
}

const clean = (name: string) => name.trim().replace(/\s+/g, '_') || 'signal'

function valueText(sig: VcdSignal, v: number, id: string): string {
  if (sig.width === 1) return `${v === 0 ? '0' : v === 1 ? '1' : v === 3 ? 'z' : 'x'}${id}`
  if (v < 0) return `bx ${id}`
  return `b${v.toString(2).padStart(sig.width, '0')} ${id}`
}

/**
 * The signals as a VCD file with a microsecond timescale. Time starts at the earliest recorded change, so a trace
 * that has already lost its beginning still opens at zero. A signal with nothing recorded yet is unknown (`x`) until
 * its first change. `endTime` (ms, the present) is written last, so viewers show the whole recording.
 */
export function toVcd(signals: VcdSignal[], endTime: number, date = new Date()): string {
  const used = new Set<string>()
  const names = signals.map((s) => {
    let name = clean(s.name)
    for (let k = 2; used.has(name); k++) name = `${clean(s.name)}_${k}`
    used.add(name)
    return name
  })
  const origin = Math.min(...signals.flatMap((s) => (s.t.length ? [s.t[0]] : [])), endTime)
  const us = (t: number) => Math.max(0, Math.round((t - origin) * 1000))

  const out: string[] = [
    `$date ${date.toISOString()} $end`,
    '$version Sklopko logic simulator $end',
    '$timescale 1 us $end',
    '$scope module sklopko $end',
    ...signals.map((s, i) => `$var wire ${s.width} ${vcdId(i)} ${names[i]} $end`),
    '$upscope $end',
    '$enddefinitions $end',
  ]

  // Every change of every signal, in time order (a stable sort keeps the signals' order within one instant).
  const changes = signals
    .flatMap((s, i) => s.t.map((t, k) => ({ at: us(t), i, text: valueText(s, s.v[k], vcdId(i)) })))
    .sort((a, b) => a.at - b.at)

  // The state at time zero: whatever was recorded at the origin, unknown for everything else.
  const initial = signals.map((s, i) => valueText(s, s.width === 1 ? 2 : -1, vcdId(i)))
  let k = 0
  while (k < changes.length && changes[k].at === 0) {
    initial[changes[k].i] = changes[k].text
    k++
  }
  out.push('#0', '$dumpvars', ...initial, '$end')

  let last = 0
  for (; k < changes.length; k++) {
    if (changes[k].at !== last) {
      last = changes[k].at
      out.push(`#${last}`)
    }
    out.push(changes[k].text)
  }
  if (us(endTime) > last) out.push(`#${us(endTime)}`)
  return out.join('\n') + '\n'
}
