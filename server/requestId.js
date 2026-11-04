// Idempotency-key normalization, in its own leaf module. A bare requestId is not an identity: " abc" and "abc" name the same request.
// Every bounded replay map keys on the request, so two spellings would execute the same request twice. One canonical form, one place.
// Imports nothing on purpose: the mixins import this, and importing it from contractLogic would close a cycle through gameLogic.js.
// Capped at 100, matching the per-domain key limits. The create-room ack key in roomSetup.js is a different thing (an opaque
// double-click dedupe token, capped at 120) and must not be shared.
export function normalizeRequestId(value) {
  // Objects and arrays stringify to one shared value ('[object Object]'), which
  // would make unrelated requests replay each other's result.
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().slice(0, 100);
}