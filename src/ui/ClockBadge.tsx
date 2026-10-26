import { useEffect, useState } from 'react'
import { ClockMeter, describeClock } from '../app/clockrate'
import { sim } from '../app/sim'
import { useStore } from '../app/store'

/** While the simulation runs: the fastest clock's rate, and, when the page cannot keep up with it, the rate it reaches. */
export function ClockBadge() {
  const [clock, setClock] = useState<{ text: string; slow: boolean } | null>(null)
  useEffect(() => {
    const meter = new ClockMeter()
    const look = () => {
      const { running, speed } = useStore.getState()
      const asked = sim.fastestClockHz()
      const { offered, skipped } = sim.clockTime
      const share = meter.sample(performance.now(), offered, skipped, running)
      const next = running && asked !== null ? describeClock(asked * speed, share) : null
      setClock((prev) => (prev?.text === next?.text ? prev : next))
    }
    look()
    const timer = window.setInterval(look, 500)
    return () => window.clearInterval(timer)
  }, [])
  if (!clock) return null
  return (
    <span
      className={`badge${clock.slow ? ' warn' : ''}`}
      title={
        clock.slow
          ? 'The fastest clock is faster than this page can simulate it, so part of its time is skipped. Lower its rate or the speed, or switch off Step-back history in Tools.'
          : 'The rate of the fastest clock, times the speed'
      }
      data-testid="clock-rate"
    >
      {clock.text}
    </span>
  )
}
