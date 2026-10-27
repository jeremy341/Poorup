const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ANALYTICS_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_BACKUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_ANALYTICS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_BACKUP_RETENTION_MS = 24 * 60 * 60 * 1000;
// Node clamps a timer delay above 2^31-1 ms down to 1 ms, so an unclamped
// interval would turn a daily retention job into a hot loop.
const MAX_TIMER_MS = 2 ** 31 - 1;

// An empty, zero, negative or non-numeric setting (an empty PM2 or .env value
// arrives as "") means "use the default"; below the floor it would age out
// every backup or analytics row, including the newest.
function retentionSetting(value, fallback, floor) {
  const number = Number(value);
  return Number.isFinite(number) && number >= floor ? number : fallback;
}

export function createRetentionJob({ deletionCoordinator, recovery, analyticsRollupStore, telemetryStore, backupStore, now = Date.now, intervalMs = DEFAULT_INTERVAL_MS, analyticsRetentionMs = DEFAULT_ANALYTICS_RETENTION_MS, backupRetentionMs = DEFAULT_BACKUP_RETENTION_MS } = {}) {
  let timer = null;
  let lastRun = null;
  let running = false;
  const analyticsWindow = retentionSetting(analyticsRetentionMs, DEFAULT_ANALYTICS_RETENTION_MS, MIN_ANALYTICS_RETENTION_MS);
  const backupWindow = retentionSetting(backupRetentionMs, DEFAULT_BACKUP_RETENTION_MS, MIN_BACKUP_RETENTION_MS);

  async function runOnce() {
    if (running) return { deletions: { processed: 0, succeeded: 0, failed: 0 }, analyticsPruned: 0, backupsPruned: 0, telemetryPruned: 0, failures: 0, skipped: true };
    running = true;
    try {
      // Each step is isolated: one failing store must not skip the others, and
      // the failure is counted and logged instead of vanishing in the timer.
      let stepFailures = 0;
      const step = async (name, work, fallback = 0) => {
        try {
          return await work();
        } catch (error) {
          stepFailures += 1;
          console.error(`Retention step ${name} failed:`, error?.message || error);
          return fallback;
        }
      };
      const deletions = await step('deletions', async () => await deletionCoordinator?.runDue?.() || { processed: 0, succeeded: 0, failed: 0 }, { processed: 0, succeeded: 0, failed: 0 });
      await step('recovery', () => recovery?.prune?.());
      const timestamp = Number(now()) || Date.now();
      let analyticsPruned = 0;
      let backupsPruned = 0;
      // A quiet run must write its prune out: otherwise the pruned rollup only
      // exists in memory and comes back on the next restart.
      if (typeof analyticsRollupStore?.prune === 'function') analyticsPruned = await step('analytics', async () => Number(await analyticsRollupStore.prune({ olderThan: timestamp - analyticsWindow, flush: true })) || 0);
      else if (typeof analyticsRollupStore?.pruneOlderThan === 'function') analyticsPruned = await step('analytics', async () => Number(await analyticsRollupStore.pruneOlderThan(timestamp - analyticsWindow)) || 0);
      if (typeof backupStore?.pruneByAge === 'function') backupsPruned = await step('backups', async () => Number(await backupStore.pruneByAge({ olderThan: timestamp - backupWindow })) || 0);
      let telemetryPruned = 0;
      if (typeof telemetryStore?.prune === 'function') telemetryPruned = await step('telemetry', async () => Number(telemetryStore.prune(timestamp - analyticsWindow)) || 0);
      const failures = (Number(deletions.failed) || 0) + stepFailures;
      lastRun = new Date(timestamp).toISOString();
      return { deletions, analyticsPruned, backupsPruned, telemetryPruned, failures };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    const delay = Math.min(MAX_TIMER_MS, Math.max(60_000, Number(intervalMs) || DEFAULT_INTERVAL_MS));
    timer = setInterval(() => { runOnce().catch(() => {}); }, delay);
    timer.unref?.();
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function status() {
    return { running: Boolean(timer), lastRunAt: lastRun };
  }

  return { runOnce, start, stop, status };
}

export { DEFAULT_INTERVAL_MS, DEFAULT_ANALYTICS_RETENTION_MS, DEFAULT_BACKUP_RETENTION_MS };
