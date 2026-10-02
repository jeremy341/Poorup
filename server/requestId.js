// Idempotency-key normalization, in its own leaf module.
//
// A bare requestId is not an identity: " abc" and "abc" name the same
// logical request. Every bounded replay map (contract responses, trades,
// economy transactions, sponsorship, vote-kicks) keys on the request, so if
// two spellings produce two keys the same request executes twice. One
// canonical form, one place.
//
// Deliberately imports nothing: the mixins below import this, and importing it
// from contractLogic instead would close a cycle through gameLogic.js.
//
// Bounded at 100, matching the per-domain key limits. This is NOT the
// create-room ack key in roomSetup.js, which is a different thing (an opaque
// double-click dedupe token, capped at 120) and must not be shared.
export function normalizeRequestId(value) {
  return String(value ?? '').trim().slice(0, 100);
}