// Night Shift settlements that must survive a dropped connection. A settlement
// is written to sessionStorage (localStorage as the durable fallback) under a
// per-account, per-run key until the server acknowledges it or it expires.
// Nothing here touches the live run state; clientNightShift.js owns that.
export const NIGHT_SHIFT_PENDING_TTL_MS = 6 * 60_000;
const NIGHT_SHIFT_PENDING_KEY_PREFIX = "poorup.night-shift.pending.v1.";

function pendingSettlementAccountKey(accountId) {
  const encodedAccountId = encodeURIComponent(accountId).replace(/\./g, "%2E");
  return `${NIGHT_SHIFT_PENDING_KEY_PREFIX}${encodedAccountId}`;
}

function pendingSettlementKey(accountId, token) {
  return `${pendingSettlementAccountKey(accountId)}.${encodeURIComponent(token)}`;
}

export function pendingSettlementCreatedAt(saved) {
  const createdAt = Number(saved?.createdAt);
  return Number.isFinite(createdAt) && createdAt > 0
    ? createdAt
    : Math.max(0, Number(saved?.expiresAt) - NIGHT_SHIFT_PENDING_TTL_MS);
}

function visitStorageAccountKeys(storage, accountId, visit) {
  if (!storage) return;
  const legacyKey = pendingSettlementAccountKey(accountId);
  const tokenKeyPrefix = `${legacyKey}.`;
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key === legacyKey || key?.startsWith(tokenKeyPrefix)) visit(storage, key);
  }
}

function eachPendingSettlementKey(accountId, visit) {
  for (const storageName of ["sessionStorage", "localStorage"]) {
    try {
      visitStorageAccountKeys(globalThis[storageName], accountId, visit);
    } catch { /* storage unavailable: try the other storage area */ }
  }
}

function isLivePendingSettlement(saved, accountId) {
  return saved?.accountId === accountId
    && typeof saved.runToken === "string"
    && saved.runToken.length > 0
    && Number.isFinite(Number(saved.expiresAt))
    && Number(saved.expiresAt) > Date.now();
}

export function readPendingSettlementRecord(accountId) {
  const records = [];
  eachPendingSettlementKey(accountId, (storage, key) => {
    const raw = storage.getItem(key);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (isLivePendingSettlement(saved, accountId)) {
      records.push({ ...saved, createdAt: pendingSettlementCreatedAt(saved) });
    } else {
      storage.removeItem(key);
    }
  });
  return records.sort((left, right) => right.createdAt - left.createdAt)[0] || null;
}

export function persistPendingSettlement(settlement) {
  if (!settlement?.token || !settlement.accountId) return;
  const key = pendingSettlementKey(settlement.accountId, settlement.token);
  const createdAt = Number(settlement.createdAt) || Date.now();
  const value = JSON.stringify({
    accountId: settlement.accountId,
    runToken: settlement.token,
    createdAt,
    expiresAt: Date.now() + NIGHT_SHIFT_PENDING_TTL_MS,
  });
  try {
    globalThis.sessionStorage.setItem(key, value);
    try { globalThis.localStorage.removeItem(key); } catch { /* old fallback may remain until expiry */ }
    return;
  } catch { /* fall back to durable same-origin storage */ }
  try { globalThis.localStorage.setItem(key, value); } catch { /* same-page reconnect retry still works */ }
}

export function clearPersistedPendingSettlement(settlement) {
  if (!settlement?.token || !settlement.accountId) return;
  eachPendingSettlementKey(settlement.accountId, (storage, key) => {
    const saved = JSON.parse(storage.getItem(key) || "null");
    const olderThanSettlement = pendingSettlementCreatedAt(saved) <= Number(settlement.createdAt || 0);
    if (saved?.runToken === settlement.token || olderThanSettlement) storage.removeItem(key);
  });
}
