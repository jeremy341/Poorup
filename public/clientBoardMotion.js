// Pure timing seam for board-piece walks. The renderer owns DOM placement;
// this helper only answers which path step should be visible at a given time.
import { HUMAN_MOVEMENT_STEP_MS, walkStepDurationsMs } from './gamePresentationTiming.js';
export const PIECE_WALK_STEP_MS = HUMAN_MOVEMENT_STEP_MS;

// Default pacing is uniform (the approved cadence). `pacing: 'accelerated'` opts into the shared
// accelerating schedule with a longer settle on the final tile.
export function createWalkTimeline({ path = [], stepMs = PIECE_WALK_STEP_MS, startedAt = 0, now = () => Date.now(), pacing = 'uniform' } = {}) {
  const safePath = Array.isArray(path) ? [...path] : [];
  const start = Number.isFinite(Number(startedAt)) ? Number(startedAt) : 0;
  const step = Math.max(1, Number(stepMs) || 1);
  const accelerated = pacing === 'accelerated';
  const durations = accelerated
    ? walkStepDurationsMs(safePath.length, step)
    : safePath.map(() => step);
  // ends[k] = elapsed ms at which step k completes.
  const ends = [];
  durations.reduce((total, ms) => { ends.push(total + ms); return total + ms; }, 0);
  const duration = Number(stepMs) > 0 || accelerated ? (ends.at(-1) || 0) : 0;

  function completedBefore(elapsed) {
    let completed = 0;
    while (completed < ends.length && ends[completed] <= elapsed) completed++;
    return completed;
  }

  function snapshot(timestamp = now()) {
    if (!safePath.length) return { index: -1, beforeFirst: false, done: true, elapsed: 0 };
    const elapsed = Math.max(0, Number(timestamp) - start);
    const completedSteps = completedBefore(elapsed);
    const done = completedSteps >= safePath.length;
    const index = Math.min(safePath.length - 1, Math.max(0, completedSteps - 1));
    return { index, beforeFirst: !done && completedSteps === 0, done, elapsed };
  }

  // Elapsed ms of the next step boundary after `elapsed` (the walk's end once finished).
  function nextBoundaryMs(elapsed) {
    return ends[Math.min(ends.length - 1, completedBefore(elapsed))] ?? 0;
  }

  // Duration of the step that begins after `index` tiles are placed (what a slide should fit inside).
  function stepDurationMs(index) {
    return durations[Math.max(0, Math.min(durations.length - 1, index))] ?? step;
  }

  return Object.freeze({
    path: Object.freeze(safePath),
    stepMs: step,
    startedAt: start,
    duration,
    accelerated,
    snapshot,
    nextBoundaryMs,
    stepDurationMs,
  });
}
