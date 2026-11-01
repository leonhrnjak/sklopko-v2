import { newCpu, reset, type Cpu6502 } from '../cpu6502'
import { box, names } from '../layouts'
import { X, type ComponentDef, type V } from '../types'

/** What the 6502 part keeps between clocks. The CPU is plain numbers, so a copy of it is cheap (it is copied at every edge). */
export interface CpuState {
  cpu: Cpu6502
  /** PHI2 as it was last time (for finding its falling edge). */
  pc: V
  /** The CPU is running (the reset sequence has begun). Until then the pins are unknown. */
  started: boolean
  /** RES was low at the last falling edge: the CPU waits for it to go high. */
  held: boolean
  /** A read cycle is waiting for data on DI that is still unknown (X): the CPU does not move on. */
  waiting: boolean
  /** Waiting for RDY: a read cycle is held while RDY is low. */
  stalled: boolean
}

const hasPowerOn = (p: { powerOn?: unknown }) => p.powerOn !== false

export function cpuInit(powerOn: boolean, cmos = false): CpuState {
  const cpu = newCpu(cmos)
  if (powerOn) reset(cpu)
  return { cpu, pc: X, started: powerOn, held: false, waiting: false, stalled: false }
}

export const cpus: ComponentDef[] = [
  {
    type: 'cpu6502',
    name: 'MOS 6502',
    category: 'cpu',
    description:
      'The MOS 6502, the 8-bit processor of the Apple II, the Commodore 64 and the NES (documented instructions), or the WDC 65C02. In every clock ' +
      'cycle it puts an address on A and R/W on the pins and reads or writes one byte; it moves on at the falling edge of Φ2. ' +
      'Select it to see its registers and the instruction it is running.',
    params: [
      {
        key: 'chip',
        label: 'Chip',
        kind: 'select',
        default: 'nmos',
        structural: true,
        options: [
          { value: 'nmos', label: 'MOS 6502 (NMOS)' },
          { value: 'cmos', label: 'WDC 65C02' },
        ],
      },
      {
        key: 'powerOn',
        label: 'Resets itself at power-up',
        kind: 'bool',
        default: true,
        structural: false,
      },
      {
        key: 'tristate',
        label: 'Tri-state data bus',
        kind: 'bool',
        default: false,
        structural: false,
      },
    ],
    title: (p) => (p.chip === 'cmos' ? '65C02' : '6502'),
    live: true,
    init: (p): CpuState => cpuInit(hasPowerOn(p), p.chip === 'cmos'),
    layout: (p) =>
      box({
        left: [
          { name: 'PHI2', label: 'Φ2', clock: true },
          { name: 'RESB', label: 'RES', invert: true, def: 1 },
          { name: 'IRQB', label: 'IRQ', invert: true, def: 1 },
          { name: 'NMIB', label: 'NMI', invert: true, def: 1 },
          { name: 'RDY', def: 1 },
          ...names('DI', 8),
          ...(p.chip === 'cmos' ? [{ name: 'BE', def: 1 as V }] : []),
        ],
        right: [
          ...names('A', 16),
          ...names('D', 8),
          { name: 'RWB', label: 'R/W' },
          'SYNC',
          ...(p.chip === 'cmos' ? [{ name: 'VPB', label: 'VP', invert: true }, { name: 'MLB', label: 'ML', invert: true }] : []),
        ],
      }),
  },
]
