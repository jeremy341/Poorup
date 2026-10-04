const STORAGE_PREFIX = "poorup:dismissed-trade-offer:";

function storageOrNull(storage) {
  if (storage) return storage;
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

function storageKey(roomCode) {
  const room = String(roomCode || "").trim();
  return room ? `${STORAGE_PREFIX}${encodeURIComponent(room)}` : null;
}

export function dismissedTradeOfferId(roomCode, storage) {
  const key = storageKey(roomCode);
  const target = storageOrNull(storage);
  if (!key || !target) return null;
  try {
    return target.getItem(key) || null;
  } catch {
    return null;
  }
}

export function dismissTradeOffer(roomCode, tradeId, storage) {
  const key = storageKey(roomCode);
  const id = String(tradeId || "");
  const target = storageOrNull(storage);
  if (!key || !id || !target) return false;
  try {
    target.setItem(key, id);
    return true;
  } catch {
    return false;
  }
}

/** Clear a dismissal once the authoritative snapshot resolves or replaces it. */
export function reconcileTradeOfferDismissal(roomCode, pendingTradeId, storage) {
  const key = storageKey(roomCode);
  const target = storageOrNull(storage);
  if (!key || !target) return null;
  const dismissedId = dismissedTradeOfferId(roomCode, target);
  if (!dismissedId) return null;
  const pendingId = pendingTradeId == null ? null : String(pendingTradeId);
  if (pendingId !== dismissedId) {
    try {
      target.removeItem(key);
    } catch {
      return null;
    }
    return null;
  }
  return dismissedId;
}

/** A different counteroffer ID is a new offer and clears the prior dismissal. */
export function isTradeOfferDismissed(roomCode, tradeId, storage) {
  const id = String(tradeId || "");
  if (!id) return false;
  return reconcileTradeOfferDismissal(roomCode, id, storage) === id;
}
