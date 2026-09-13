import {
  canCreateRoom as canCreateRoomInMode,
  canStartRound as canStartRoundInMode,
  createMaintenanceSnapshot,
  normalizeMaintenanceMode,
} from './maintenanceState.js';

const DEFAULT_DRAIN_MESSAGE = 'MAINTENANCE WINDOW';

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
} = {}) {
  let timer = null;
  let current = createMaintenanceSnapshot({ mode: initialMode });

  function activeRoundCount() {
    try {
      const count = Number(getActiveRounds());
      return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    } catch {
      return 0;
    }
  }

  function snapshot() {
    return createMaintenanceSnapshot({ ...current, activeRounds: activeRoundCount() });
  }

  function publish() {
    const next = snapshot();
    current = next;
    onChange(next);
    return next;
  }

  function clearDeadlineTimer() {
    if (timer == null) return;
    cancel(timer);
    timer = null;
  }

  function scheduleDeadline(deadline) {
    clearDeadlineTimer();
    const timestamp = deadlineTimestamp(deadline);
    if (timestamp == null) return;
    const delay = Math.max(0, timestamp - now());
    timer = schedule(() => {
      timer = null;
      if (normalizeMaintenanceMode(current.mode) !== 'draining') return;
      enterMaintenance({ message: 'MAINTENANCE WINDOW · DRAIN DEADLINE REACHED' });
    }, delay);
    timer?.unref?.();
  }

  function beginDrain({ releaseId = '', deadline = null, message = DEFAULT_DRAIN_MESSAGE } = {}) {
    current = createMaintenanceSnapshot({ mode: 'draining', releaseId, deadline, message, activeRounds: activeRoundCount() });
    scheduleDeadline(deadline);
    return publish();
  }

  function enterMaintenance({ releaseId = current.releaseId, deadline = current.drainDeadline, message = 'MAINTENANCE IN PROGRESS' } = {}) {
    clearDeadlineTimer();
    current = createMaintenanceSnapshot({ mode: 'maintenance', releaseId, deadline, message, activeRounds: activeRoundCount() });
    return publish();
  }

  function finishMaintenance() {
    clearDeadlineTimer();
    current = createMaintenanceSnapshot({ mode: 'normal' });
    return publish();
  }

  return Object.freeze({
    activeRoundCount,
    beginDrain,
    canCreateRoom: () => canCreateRoomInMode(snapshot()),
    canStartRound: () => canStartRoundInMode(snapshot()),
    enterMaintenance,
    finishMaintenance,
    isDrainComplete: () => current.mode !== 'normal' && activeRoundCount() === 0,
    snapshot,
    dispose: clearDeadlineTimer,
  });
}
