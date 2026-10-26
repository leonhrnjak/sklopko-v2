import { useEffect, useState } from "react";
import { ClockMeter, describeClock, formatTime } from "../app/clockrate";
import { useForceCount, useSimStatus } from "../app/hooks";
import { sim } from "../app/sim";
import { select, useStore } from "../app/store";
import { ZoomControls } from "./ZoomControls";

interface Stats {
  clock: ReturnType<typeof describeClock> | null;
  /** Simulated time, and how many clock edges Back can go over (null: stepping back is switched off). Both only with a clock. */
  time: string | null;
  back: number | null;
}

/** What the footer measures, looked at twice a second: the fastest clock, the simulated time, the history to step back over. */
function useStats(): Stats {
  const [stats, setStats] = useState<Stats>({
    clock: null,
    time: null,
    back: null,
  });
  useEffect(() => {
    const meter = new ClockMeter();
    const look = () => {
      const { running, speed } = useStore.getState();
      const asked = sim.fastestClockHz();
      const { offered, skipped } = sim.clockTime;
      const share = meter.sample(performance.now(), offered, skipped, running);
      const next: Stats = {
        clock:
          asked === null
            ? null
            : describeClock(asked * speed, running ? share : null),
        time: asked === null ? null : formatTime(sim.time),
        back: asked === null ? null : sim.historyOn ? sim.stepBackDepth : -1,
      };
      setStats((prev) =>
        JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
      );
    };
    look();
    const timer = window.setInterval(look, 500);
    return () => window.clearInterval(timer);
  }, []);
  return stats;
}

const breakpointIds = (comps: Record<string, { type: string }>) =>
  Object.keys(comps)
    .filter((id) => comps[id].type === "breakpoint")
    .join(",");

/**
 * The run side of the canvas, under it: whether the simulation runs, the clock, warnings, signals held at a level, breakpoints, the
 * simulated time and the history to step back over; the zoom is at its right end. `locked`: editing is locked and the simulation runs
 * (passed in, so that this chunk does not need the settings).
 */
export function RunFooter({ locked }: { locked: boolean }) {
  const running = useStore((s) => s.running);
  const { clock, time, back } = useStats();
  const oscillating = useSimStatus() === "u";
  const held = useForceCount();
  const breakpoints = useStore((s) => breakpointIds(s.circuit.comps));
  const ids = breakpoints ? breakpoints.split(",") : [];
  return (
    <div className="run-footer">
      <div className="run-left" role="status" aria-label="Simulation">
        <span className="run-label">Run</span>
        <span className="run-state">
          <span
            className={`run-dot${running ? " live" : ""}`}
            aria-hidden="true"
          />
          <span data-testid="run-state">{running ? "Running" : "Paused"}</span>
        </span>
        {clock && (
          <span
            className={`run-clock${clock.slow ? " slow" : ""}`}
            data-testid="clock-rate"
            title={
              clock.slow
                ? "The fastest clock is faster than this page can simulate it, so part of its time is skipped. Lower its rate or the speed, or switch off Step-back history in Tools."
                : "The rate of the fastest clock, times the speed"
            }
          >
            Clock <b>{clock.asked}</b>
            {clock.actual && (
              <>
                {" "}
                · actual <b>{clock.actual}</b>
                {clock.percent !== null && ` (${clock.percent}%)`}
              </>
            )}
          </span>
        )}
        {oscillating && (
          <span
            className="run-pill warn"
            title="Some signals keep changing on their own (a feedback loop without memory)"
            data-testid="oscillating"
          >
            Oscillating
          </span>
        )}
        {locked && (
          <span
            className="run-pill locked"
            title="Nothing can be edited while the simulation runs. Pause it, or click the lock in the toolbar."
            data-testid="locked-pill"
          >
            🔒 Editing locked
          </span>
        )}
        {held > 0 && (
          <span className="run-pill held" data-testid="force-badge">
            ⚡ {held} held
            <button
              onClick={() => {
                sim.clearForces();
                sim.settle();
                sim.publish();
              }}
            >
              Release all
            </button>
          </span>
        )}
        {ids.length > 0 && (
          <button
            className="run-pill"
            onClick={() => select(ids)}
            title="Select the breakpoints"
            data-testid="breakpoint-count"
          >
            Breakpoints: {ids.length}
          </button>
        )}
        {time !== null && (
          <span
            className="run-time"
            data-testid="run-time"
            title="Simulated time since the last Reset"
          >
            t = <b>{time}</b>
          </span>
        )}
        {back !== null && (
          <span
            className="run-back"
            data-testid="run-back"
            title={
              back < 0
                ? "Stepping back is switched off for this circuit. Switch it on in Tools → Step-back history."
                : "Clock edges that ◀ Back can go back over"
            }
          >
            {back < 0 ? "Back: off" : `Back: ${back}`}
          </span>
        )}
      </div>
      <ZoomControls />
    </div>
  );
}
