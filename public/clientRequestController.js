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
