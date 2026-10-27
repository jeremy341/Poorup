import {
  canCreateRoom as canCreateRoomInMode,
  canJoinRoom as canJoinRoomInMode,
  canStartRound as canStartRoundInMode,
  createMaintenanceSnapshot,
  MAINTENANCE_MODES,
  normalizeMaintenanceMode,
} from './maintenanceState.js';

const DEFAULT_DRAIN_MESSAGE = 'MAINTENANCE WINDOW';
// Graceful shutdown drains describe a process that is going away. They are
// published to live sockets but never written to maintenance.json, so the
// next boot starts normal unless an operator asked for a drain.
export const SHUTDOWN_RELEASE_ID = 'shutdown';
const SHUTDOWN_MESSAGE_PATTERN = /^(?:SIGTERM|SIGINT) · SERVER RESTARTING$/;

export function shutdownDrainMessage(signal) {
  return `${signal} · SERVER RESTARTING`;
}

// Drains persisted by older builds on SIGTERM carry releaseId "shutdown", or
// the restart message when POORUP_RELEASE_ID was set. Neither is an operator
// decision, so boot must not inherit them. The markers only describe a
// shutdown drain: a maintenance window that happens to carry the same release
// id or message is an operator decision (a lockout, a deploy window) and is
// kept.
function isLegacyShutdownDrain(persisted) {
  if (normalizeMaintenanceMode(persisted?.mode) !== 'draining') return false;
  if (persisted?.releaseId === SHUTDOWN_RELEASE_ID) return true;
  return SHUTDOWN_MESSAGE_PATTERN.test(String(persisted?.message || ''));
}

// The mode a record nobody can vouch for falls back to: the site stays closed
// instead of reopening on corrupt input.
const CORRUPT_BOOT_MODE = 'maintenance';

// The persisted state may arrive as the record itself or wrapped in the store
// loader's envelope ({ value, missing, corrupt }).
function resolvePersistedRecord(persisted) {
  if (persisted == null) return { record: null, present: false, corrupt: false };
  if (typeof persisted !== 'object') return { record: null, present: true, corrupt: true };
  const wrapped = 'value' in persisted || 'missing' in persisted || 'corrupt' in persisted;
  if (!wrapped) return { record: persisted, present: true, corrupt: false };
  if (persisted.corrupt === true) return { record: null, present: true, corrupt: true };
  if (persisted.missing === true) return { record: null, present: false, corrupt: false };
  const value = persisted.value;
  if (value == null) return { record: null, present: false, corrupt: false };
  if (typeof value !== 'object') return { record: null, present: true, corrupt: true };
  return { record: value, present: true, corrupt: false };
}

// The persisted mode, normalised, or null when the record does not name a
// known mode (a corrupt record).
function persistedMode(record) {
  if (!record || typeof record !== 'object') return null;
  const mode = typeof record.mode === 'string' ? record.mode.trim().toLowerCase() : '';
  return MAINTENANCE_MODES.includes(mode) ? mode : null;
}

// The env default is operator input, so a typo must stop the boot: the lenient
// normaliser reads any unknown word as "normal" and would open the site.
// Unset, empty or blank keeps the default.
function assertValidEnvMode(envMode) {
  if (envMode == null) return;
  const text = String(envMode).trim().toLowerCase();
  if (!text || MAINTENANCE_MODES.includes(text)) return;
  throw new Error(`POORUP_MAINTENANCE_MODE=${JSON.stringify(String(envMode))} is not a recognised mode; use one of: ${MAINTENANCE_MODES.join(', ')} (or leave it unset).`);
}

// Chooses the boot-time mode: a persisted operator state wins over the env
// default, except for stale shutdown records which fall through to the env.
// A record that cannot be trusted leaves the site closed. An unrecognised env
// default throws, whether or not a persisted record would have won.
export function bootMaintenanceMode(persisted, envMode) {
  assertValidEnvMode(envMode);
  const { record, present, corrupt } = resolvePersistedRecord(persisted);
  if (!present) return envMode;
  if (corrupt) return CORRUPT_BOOT_MODE;
  const mode = persistedMode(record);
  if (!mode) return CORRUPT_BOOT_MODE;
  if (mode === 'draining' && isLegacyShutdownDrain(record)) return envMode;
  return mode;
}

// The persisted record boot should restore, or null when the env default
// applies (no record, a corrupt record, or a stale shutdown drain). Release
// id, message, deadline and lockout come back with the mode so a restart
// does not drop them.
export function bootMaintenanceRecord(persisted) {
  const { record, present, corrupt } = resolvePersistedRecord(persisted);
  if (!present || corrupt) return null;
  if (!persistedMode(record)) return null;
  if (normalizeMaintenanceMode(record.mode) === 'draining' && isLegacyShutdownDrain(record)) return null;
  return record;
}

// The message the table shows after a corrupt maintenance file was replaced
// by a durable closed marker: the operator must be able to see that the state
// was recovered rather than chosen.
export const CORRUPT_RECOVERY_MESSAGE = 'MAINTENANCE IN PROGRESS · RECOVERED FROM CORRUPT STATE';

// The durable marker that takes the place of a quarantined maintenance file.
// The corrupt bytes leave no valid record behind, so without a marker the
// next boot finds no file at all and falls back to the environment default
// with the site open. The marker boots closed, exactly like the corrupt boot
// it replaces, and it carries no lockout: recovering the state does not
// change who may join.
export function corruptMaintenanceMarker() {
  return createMaintenanceSnapshot({ mode: 'maintenance', message: CORRUPT_RECOVERY_MESSAGE });
}

// setTimeout treats a delay above 2^31-1 ms (about 24.8 days) as 1 ms, which
// would end a far-off drain at once. Longer waits are chained.
const MAX_TIMER_MS = 2_147_483_647;

// How long the controller waits before writing the state again after a failed
// write.
const PERSIST_RETRY_MS = 1_000;

function deadlineTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function createDrainController({
  getActiveRounds = () => 0,
  onChange = () => {},
  now = () => Date.now(),
  schedule = setTimeout,
  cancel = clearTimeout,
  initialMode = 'normal',
  initialLockout = false,
  // The persisted record behind initialMode (see bootMaintenanceRecord). Only
  // applied when it describes the same mode the controller boots into.
  initialState = null,
} = {}) {
  let timer = null;
  // False when the last onChange reported (by returning false) that it could
  // not make the change durable.
  let persistFailed = false;
  // The last snapshot known to be on disk. A failed write leaves the live
  // state ahead of it, so the difference is retried until it lands: the disk
  // must never come back older (and so more open) than the live site.
  let lastDurable = null;
  let persistTimer = null;
  // Whether the pending deadline transition may be written to disk. A shutdown
  // drain is published with persist:false and its deadline must stay that way.
  let deadlinePersist = true;
  const restored = initialState && normalizeMaintenanceMode(initialState.mode) === normalizeMaintenanceMode(initialMode) ? initialState : {};
  // A restored lockout belongs to the maintenance window it was saved with, so
  // the mode is normalised before the two are compared.
  const restoredLockout = normalizeMaintenanceMode(restored?.mode) === 'maintenance' && restored?.lockout === true;
  let current = createMaintenanceSnapshot({
    mode: initialMode,
    lockout: restoredLockout || initialLockout === true,
    releaseId: restored.releaseId,
    message: restored.message,
    drainDeadline: restored.drainDeadline,
  });
  lastDurable = current;

  // The last count that could be read. A failed read is unknown, and an
  // unknown count must never look like an empty server.
  let lastKnownActiveRounds = 0;

  // The number of running rounds, or null when the count cannot be read.
  function readActiveRounds() {
    try {
      const count = Number(getActiveRounds());
      if (!Number.isFinite(count)) return null;
      return Math.max(0, Math.floor(count));
    } catch {
      return null;
    }
  }

  // Infinity marks an unknown count: the drain is not complete and the
  // published state keeps the last known number instead of claiming zero.
  function activeRoundCount() {
    const count = readActiveRounds();
    if (count == null) return Infinity;
    lastKnownActiveRounds = count;
    return count;
  }

  function snapshot() {
    const count = activeRoundCount();
    return createMaintenanceSnapshot({ ...current, activeRounds: Number.isFinite(count) ? count : lastKnownActiveRounds });
  }

  function clearPersistRetry() {
    if (persistTimer == null) return;
    cancel(persistTimer);
    persistTimer = null;
  }

  // Writes the state again until it lands, so a restart cannot come back
  // more open than the live site.
  function armPersistRetry(state) {
    clearPersistRetry();
    persistTimer = schedule(() => {
      persistTimer = null;
      // A newer state took over; that one owns the write.
      if (current !== state) return;
      if (onChange(state, { persist: true }) === false) {
        armPersistRetry(state);
        return;
      }
      lastDurable = state;
      persistFailed = false;
    }, PERSIST_RETRY_MS);
    persistTimer?.unref?.();
  }

  function publish({ persist = true } = {}) {
    const next = snapshot();
    current = next;
    const persisted = onChange(next, { persist });
    persistFailed = persisted === false;
    if (persistFailed) {
      // A shutdown drain is never written, so it is never retried either.
      if (persist) armPersistRetry(next);
    } else {
      lastDurable = next;
      clearPersistRetry();
    }
    return next;
  }

  function clearDeadlineTimer() {
    if (timer == null) return;
    cancel(timer);
    timer = null;
  }

  // Arms from the snapshot's own (normalised) deadline, so the timer and the
  // published deadline cannot disagree.
  function scheduleDeadline() {
    clearDeadlineTimer();
    const timestamp = deadlineTimestamp(current.drainDeadline);
    if (timestamp == null) return;
    const remaining = Math.max(0, timestamp - now());
    timer = schedule(() => {
      timer = null;
      if (normalizeMaintenanceMode(current.mode) !== 'draining') return;
      if (remaining > MAX_TIMER_MS) return scheduleDeadline();
      enterMaintenance({ message: 'MAINTENANCE WINDOW · DRAIN DEADLINE REACHED', deadline: current.drainDeadline, persist: deadlinePersist });
    }, Math.min(remaining, MAX_TIMER_MS));
    timer?.unref?.();
  }

  function beginDrain({ releaseId = '', deadline = null, message = DEFAULT_DRAIN_MESSAGE, persist = true } = {}) {
    // A maintenance window is stricter than a drain. A later drain request
    // (deploy, CI, or a shutdown signal) must not relax it back to draining.
    if (current.mode === 'maintenance') return snapshot();
    current = createMaintenanceSnapshot({ mode: 'draining', releaseId, drainDeadline: deadline, message, activeRounds: activeRoundCount() });
    deadlinePersist = persist;
    scheduleDeadline();
    return publish({ persist });
  }

  // Re-entering maintenance (a new message, a deploy script) keeps a lockout
  // that is already on; only setLockout(false) or finishMaintenance lifts it.
  // A deadline is carried only by the deadline-driven transition and by
  // restating maintenance that already has one; entering by hand from a drain
  // or normal mode leaves no stale deadline behind.
  function enterMaintenance({ releaseId = current.releaseId, deadline = current.mode === 'maintenance' ? current.drainDeadline : null, message = 'MAINTENANCE IN PROGRESS', lockout = current.lockout, persist = true } = {}) {
    clearDeadlineTimer();
    current = createMaintenanceSnapshot({ mode: 'maintenance', lockout, releaseId, drainDeadline: deadline, message, activeRounds: activeRoundCount() });
    return publish({ persist });
  }

  // Turning the lockout on enters maintenance (from any mode). Turning it off
  // leaves the table in plain maintenance; finishMaintenance reopens it. Off
  // while no lockout is on is a no-op, so the toggle is idempotent.
  function setLockout(enabled, { releaseId = current.releaseId, message } = {}) {
    if (enabled === true) {
      return enterMaintenance({ releaseId, message: message || (current.mode === 'maintenance' ? current.message : undefined), lockout: true });
    }
    if (!current.lockout) return snapshot();
    return enterMaintenance({ releaseId, message: message || current.message, lockout: false });
  }

  function finishMaintenance() {
    clearDeadlineTimer();
    current = createMaintenanceSnapshot({ mode: 'normal' });
    return publish();
  }

  // A restored drain keeps ending on schedule; an expired one goes straight
  // to maintenance on the next tick (and is persisted, being an operator drain).
  if (current.mode === 'draining') scheduleDeadline();

  return Object.freeze({
    activeRoundCount,
    beginDrain,
    canCreateRoom: (options) => canCreateRoomInMode(snapshot(), options),
    canJoinRoom: (options) => canJoinRoomInMode(snapshot(), options),
    canStartRound: (options) => canStartRoundInMode(snapshot(), options),
    enterMaintenance,
    finishMaintenance,
    setLockout,
    lastPersistFailed: () => persistFailed,
    // The last state known to be on disk. A boot that cannot trust the file
    // uses this instead of guessing.
    lastDurableSnapshot: () => lastDurable,
    // A drain finishes on a count that was actually read and is zero. An
    // unreadable count is unknown, and unknown is not drained.
    isDrainComplete: () => current.mode !== 'normal' && readActiveRounds() === 0,
    snapshot,
    dispose: () => {
      clearDeadlineTimer();
      clearPersistRetry();
    },
  });
}
