// Lobby persistence across restarts. A restart used to drop every table; now each unstarted lobby (identity, settings, human roster,
// host, visibility, kick lists) is snapshotted into the authoritative room store (rooms.json) and restored at boot.
//
// Tier: lobbies only. A started GameState is not plain JSON (Sets, bounded replay maps, presentation objects, and timers/bot controllers
// that live in socketRuntime closures), so started matches still end with the process and their clients get "room gone".
//
// Sweep model: instead of hooking every mutation site (most live in socketRuntime), flush() serializes the current lobbies on a short timer
// and writes only the rooms whose snapshot changed. Rewriting from the live registry means destroyed rooms and removed seats (including an
// erased account's seat) drop out of the file on the next tick without any per-path bookkeeping.

// Mirrors EMPTY_ROOM_GRACE_PERIOD_MS in socketRuntime.js: a lobby nobody has touched for this long would be garbage collected anyway.
export const LOBBY_SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
// A lobby with a connected human is re-stamped this often so an idle but occupied lobby is not mistaken for an abandoned one at boot.
export const LOBBY_HEARTBEAT_MS = 60 * 1000;
export const LOBBY_FLUSH_INTERVAL_MS = 2_000;

function stampedSnapshot(snapshot, updatedAt) {
  return { ...snapshot, updatedAt };
}

export function createRoomPersistence({
  store,
  roomManager,
  now = Date.now,
  maxAgeMs = LOBBY_SNAPSHOT_MAX_AGE_MS,
  heartbeatMs = LOBBY_HEARTBEAT_MS,
  graceMs,
  log = console
} = {}) {
  if (!store || !roomManager) throw new Error('Room persistence needs a store and a room manager.');
  // roomCode -> { version, body (snapshot JSON without the volatile stamp), at (last write time) }
  const written = new Map();

  function warn(message, error) {
    log?.error?.(`Room persistence: ${message}${error?.message ? ` (${error.message})` : ''}`);
  }

  function dropRow(roomId, version) {
    const result = store.deleteRoom(roomId, version);
    if (result?.success === false && result.code !== 'STALE_VERSION') warn(`could not delete ${roomId}: ${result.error || result.code}`);
    return result?.success !== false;
  }

  // Boot: rebuild every fresh, well-formed lobby; delete rows that are stale, malformed or collide. One bad row never blocks the rest, and a
  // store that failed to load was already quarantined by the JSON adapter (it simply lists nothing), so boot cannot fail on a corrupt file.
  function restore() {
    const at = now();
    const summary = { restored: 0, pruned: 0, skipped: 0 };
    let rows = [];
    try {
      rows = store.listRooms?.() || [];
    } catch (error) {
      warn('could not list stored rooms', error);
    }
    rows.sort((left, right) => Number(right.snapshot?.updatedAt || 0) - Number(left.snapshot?.updatedAt || 0));
    for (const row of rows) {
      const updatedAt = Number(row.snapshot?.updatedAt);
      const fresh = Number.isFinite(updatedAt) && at - updatedAt <= maxAgeMs && updatedAt <= at + maxAgeMs;
      let room = null;
      try {
        room = fresh ? roomManager.restoreLobby(row.snapshot, { now: at, graceMs }) : null;
      } catch (error) {
        warn(`skipped unreadable room ${row.roomId}`, error);
      }
      if (!room) {
        summary[fresh ? 'skipped' : 'pruned'] += 1;
        dropRow(row.roomId, row.version);
        continue;
      }
      summary.restored += 1;
      written.set(room.roomCode, { version: row.version, body: JSON.stringify(room.toLobbySnapshot()), at: updatedAt });
    }
    return summary;
  }

  // Persists changed lobbies and removes rows for rooms that are gone. force re-stamps every occupied lobby (shutdown).
  function flush({ force = false } = {}) {
    const at = now();
    const live = new Set();
    for (const room of roomManager.rooms.values()) {
      if (!room.isPersistableLobby()) continue;
      live.add(room.roomCode);
      try {
        writeIfChanged(room, at, force);
      } catch (error) {
        warn(`could not snapshot ${room.roomCode}`, error);
      }
    }
    for (const [roomCode, entry] of [...written]) {
      if (live.has(roomCode)) continue;
      if (dropRow(roomCode, entry.version)) written.delete(roomCode);
    }
  }

  function writeIfChanged(room, at, force) {
    const body = JSON.stringify(room.toLobbySnapshot());
    const entry = written.get(room.roomCode);
    const heartbeatDue = room.hasConnectedHumans() && (force || !entry || at - entry.at >= heartbeatMs);
    if (entry && entry.body === body && !heartbeatDue) return;
    const version = (entry?.version || 0) + 1;
    const result = store.writeRoom(room.roomCode, stampedSnapshot(JSON.parse(body), at), version);
    if (result?.success) {
      written.set(room.roomCode, { version, body, at });
      return;
    }
    // A stale version means another writer advanced the row (an old process); adopt it so the next sweep retries above it.
    if (result?.code === 'STALE_VERSION') written.set(room.roomCode, { version: result.version, body: '', at: 0 });
    else warn(`could not persist ${room.roomCode}: ${result?.error || result?.code}`);
  }

  function start({ intervalMs = LOBBY_FLUSH_INTERVAL_MS, setIntervalFn = setInterval } = {}) {
    const timer = setIntervalFn(() => flush(), intervalMs);
    timer?.unref?.();
    return timer;
  }

  return { restore, flush, start, writtenRoomCodes: () => [...written.keys()] };
}
