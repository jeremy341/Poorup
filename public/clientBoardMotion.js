// Pure timing seam for board-piece walks. The renderer owns DOM placement;
// this helper only answers which path step should be visible at a given time.
export const PIECE_WALK_STEP_MS = 300;

export function createWalkTimeline({ path = [], stepMs = PIECE_WALK_STEP_MS, startedAt = 0, now = () => Date.now() } = {}) {
  const safePath = Array.isArray(path) ? [...path] : [];
  const duration = Math.max(0, Number(stepMs) || 0) * safePath.length;
  const start = Number.isFinite(Number(startedAt)) ? Number(startedAt) : 0;
  const step = Math.max(1, Number(stepMs) || 1);

  function snapshot(timestamp = now()) {
    if (!safePath.length) return { index: -1, beforeFirst: false, done: true, elapsed: 0 };
    const elapsed = Math.max(0, Number(timestamp) - start);
    const completedSteps = Math.floor(elapsed / step);
    const done = completedSteps >= safePath.length;
    const index = Math.min(safePath.length - 1, Math.max(0, completedSteps - 1));
    return { index, beforeFirst: !done && completedSteps === 0, done, elapsed };
  }

  return Object.freeze({
    path: Object.freeze(safePath),
    stepMs: step,
    startedAt: start,
    duration,
    snapshot,
  });
}

