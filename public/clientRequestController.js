// One acknowledgement/timeout seam for client actions that mutate server
// state. Late acknowledgements are ignored after timeout; the request ID stays
// in the payload so a reconnect refresh can safely re-read an idempotent result.
export function emitWithTimeout(emitServer, eventName, payload, { onResponse, timeoutMs = 8_000, onTimeout } = {}) {
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    onTimeout?.();
  }, Math.max(1_000, Number(timeoutMs) || 8_000));
  emitServer(eventName, payload, (response) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    onResponse?.(response);
  });
  return () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
  };
}

// One in-flight request per user intent. A double click or an Enter key
// repeat on a money/turn action must reach the server once: the guard key is
// held until the acknowledgement (or the bounded timeout) releases it.
const inFlightIntents = new Set();

export function intentInFlight(key) {
  return inFlightIntents.has(key);
}

/** Returns false (and sends nothing) while an identical intent is in flight. */
export function emitIntent(emitServer, key, eventName, payload, { onResponse, onTimeout, timeoutMs } = {}) {
  if (inFlightIntents.has(key)) return false;
  inFlightIntents.add(key);
  const release = () => { inFlightIntents.delete(key); };
  emitWithTimeout(emitServer, eventName, payload, {
    timeoutMs,
    onResponse: (response) => { release(); onResponse?.(response); },
    onTimeout: () => { release(); onTimeout?.(); },
  });
  return true;
}
