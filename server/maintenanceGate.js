// The maintenance lockout as the socket layer sees it: the current state, who may bypass it, the per-socket state broadcast, and the
// refusal answered to a blocked create, join or start.
import { isAdminAccount } from './analyticsApi.js';

export function createMaintenanceGate({ io, maintenance, maintenanceAccess, social, getAdminIds }) {
  function maintenanceSnapshot() {
    return maintenance?.snapshot?.() || {
      mode: 'normal',
      lockout: false,
      message: '',
      releaseId: '',
      drainDeadline: null,
      activeRounds: 0,
    };
  }

  // A socket passes the lockout with a live operator cookie grant (read at the
  // handshake, see server.js) or as an admin account. account undefined means
  // "resolve it from the socket"; null means "known anonymous".
  function maintenanceBypass(socket, account) {
    if (maintenanceAccess?.isGrantActive?.(socket?.data?.maintenanceAccess)) return true;
    let resolved = account;
    if (resolved === undefined) {
      try { resolved = social?.accountForSocket?.(socket, {}) || null; } catch { resolved = null; }
    }
    return isAdminAccount(resolved?.id, getAdminIds());
  }

  // The bypass is only worked out when the plain gate says no, so normal play
  // never pays for the account lookup.
  function gate(check, socket, account, options = {}) {
    if (typeof maintenance?.[check] !== 'function') return true;
    if (maintenance[check](options)) return true;
    return maintenance[check]({ ...options, bypass: maintenanceBypass(socket, account) });
  }

  const canCreateRoom = (socket, account) => gate('canCreateRoom', socket, account);
  const canStartRound = (socket, account) => gate('canStartRound', socket, account);
  const canJoinRoom = (socket, account, { reconnecting = false } = {}) => gate('canJoinRoom', socket, account, { reconnecting });

  // Per-socket copy of the state: bypass tells this client whether to hide the
  // lockout panel. It is never broadcast as one shared value.
  function maintenanceStateFor(socket, snapshot = maintenanceSnapshot()) {
    return { ...snapshot, bypass: maintenanceBypass(socket) };
  }

  function emitMaintenanceState(socket, snapshot) {
    socket?.emit?.('maintenance-state', maintenanceStateFor(socket, snapshot));
  }

  function broadcastMaintenanceState(snapshot = maintenanceSnapshot()) {
    io?.sockets?.sockets?.forEach?.(socket => emitMaintenanceState(socket, snapshot));
  }

  // Refusal for a lockout gate, or for the older drain/maintenance pause.
  function lockoutRefusal(socket, pausedError = 'New rooms are paused for maintenance.') {
    const snapshot = maintenanceSnapshot();
    return snapshot.lockout
      ? { success: false, error: 'The site is closed for maintenance.', code: 'MAINTENANCE_LOCKOUT', maintenance: maintenanceStateFor(socket, snapshot) }
      : { success: false, error: pausedError, code: 'MAINTENANCE_DRAINING', maintenance: maintenanceStateFor(socket, snapshot) };
  }

  return { maintenanceSnapshot, maintenanceBypass, canCreateRoom, canStartRound, canJoinRoom, maintenanceStateFor, emitMaintenanceState, broadcastMaintenanceState, lockoutRefusal };
}
