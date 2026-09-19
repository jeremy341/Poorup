const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ANALYTICS_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_BACKUP_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function createRetentionJob({ deletionCoordinator, recovery, analyticsRollupStore, telemetryStore, backupStore, now = Date.now, intervalMs = DEFAULT_INTERVAL_MS, analyticsRetentionMs = DEFAULT_ANALYTICS_RETENTION_MS, backupRetentionMs = DEFAULT_BACKUP_RETENTION_MS } = {}) {
  let timer = null;
  let lastRun = null;
  let running = false;

  async function runOnce() {
    if (running) return { deletions: { processed: 0, succeeded: 0, failed: 0 }, analyticsPruned: 0, backupsPruned: 0, failures: 0, skipped: true };
    running = true;
    try {
      const deletions = await deletionCoordinator?.runDue?.() || { processed: 0, succeeded: 0, failed: 0 };
      recovery?.prune?.();
      const timestamp = Number(now()) || Date.now();
      let analyticsPruned = 0;
      let backupsPruned = 0;
      if (typeof analyticsRollupStore?.prune === 'function') analyticsPruned = Number(await analyticsRollupStore.prune({ olderThan: timestamp - analyticsRetentionMs })) || 0;
      else if (typeof analyticsRollupStore?.pruneOlderThan === 'function') analyticsPruned = Number(await analyticsRollupStore.pruneOlderThan(timestamp - analyticsRetentionMs)) || 0;
      if (typeof backupStore?.pruneByAge === 'function') backupsPruned = Number(await backupStore.pruneByAge({ olderThan: timestamp - backupRetentionMs })) || 0;
      let telemetryPruned = 0;
      if (typeof telemetryStore?.prune === 'function') telemetryPruned = Number(telemetryStore.prune(timestamp - analyticsRetentionMs)) || 0;
      const failures = Number(deletions.failed) || 0;
      lastRun = new Date(timestamp).toISOString();
      return { deletions, analyticsPruned, backupsPruned, telemetryPruned, failures };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    const delay = Math.max(60_000, Number(intervalMs) || DEFAULT_INTERVAL_MS);
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
