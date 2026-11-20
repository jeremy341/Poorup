// Liveness (/healthz) and readiness (/readyz) for the deploy gate and the container health check.

// A lobby that is not started but holds a human seat is waiting for its round.
// A reload drops it, so the deploy gate waits for these as well as for rounds.
export function countWaitingRooms(roomManager) {
  return [...roomManager.rooms.values()].filter(room => !room.destroyed && !room.game.started && room.game.players.some(player => !player.isBot)).length;
}

function readinessStatus(snapshot, ready) {
  if (ready) return 'ready';
  if (snapshot.mode === 'draining') return 'draining';
  return 'unavailable';
}

// `isStoresLoaded` and `getBackupHealth` are functions because server.js updates both after boot.
export function registerHealthRoutes(app, { roomManager, maintenance, analyticsRollupStore, isStoresLoaded, getBackupHealth }) {
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'poorup', releaseId: process.env.POORUP_RELEASE_ID || 'local' });
  });

  app.get('/readyz', (_req, res) => {
    const snapshot = maintenance.snapshot();
    const rollup = analyticsRollupStore.health();
    const backup = getBackupHealth();
    const storesLoaded = isStoresLoaded();
    const backupReady = !backup.configured || backup.fresh;
    const ready = snapshot.mode === 'normal' && storesLoaded && backupReady;
    res.status(ready ? 200 : 503).json({
      status: readinessStatus(snapshot, ready),
      acceptingNewRounds: snapshot.mode === 'normal',
      activeRounds: snapshot.activeRounds,
      waitingRooms: countWaitingRooms(roomManager),
      storeLoaded: storesLoaded,
      backupConfigured: backup.configured,
      backupFresh: backup.configured ? backup.fresh : null,
      analyticsRollup: { loaded: rollup.loaded, fresh: rollup.fresh, lagSeconds: rollup.lagSeconds, pendingWrites: rollup.pendingWrites },
      releaseId: snapshot.releaseId || process.env.POORUP_RELEASE_ID || 'local'
    });
  });
}
