// Shared timings, keys and cancellation list for the socket runtime's room, seat, bot and auction timers.

const DEFAULT_RECONNECT_GRACE_MS = 120000;
const configuredTestReconnectGrace = Number(process.env.POORUP_TEST_RECONNECT_GRACE_MS);
const DISCONNECT_GRACE_MS = process.env.NODE_ENV === 'test'
  && Number.isFinite(configuredTestReconnectGrace)
  && configuredTestReconnectGrace > 0
  ? Math.min(DEFAULT_RECONNECT_GRACE_MS, Math.floor(configuredTestReconnectGrace))
  : DEFAULT_RECONNECT_GRACE_MS;
const EMPTY_ROOM_GC_INTERVAL_MS = 60 * 1000;
const TRADE_OFFER_TTL_MS = 120 * 1000;
const TRADE_EXPIRY_SWEEP_INTERVAL_MS = 5 * 1000;
const AUCTION_WATCHDOG_INTERVAL_MS = 1000;
// How often silent turn holders are checked for idleness. The idle
// threshold itself is PLAYER_INACTIVITY_REMOVAL_MS.
const IDLE_SEAT_SWEEP_INTERVAL_MS = 5000;
const EMPTY_ROOM_GRACE_PERIOD_MS = 10 * 60 * 1000;
const ROOMS_UPDATED_DEBOUNCE_MS = 750;
// Outer bound on one bot decision. The advisor's own timeout covers its request
// and body; this watchdog only frees the turn lock if a decision never settles.
const BOT_DECISION_WATCHDOG_MS = 15 * 1000;
const BOT_DECISION_WATCHDOG_MARGIN_MS = 5 * 1000;

// Grace timers belong to one room's seat. The same clientId may hold a seat in
// another room, so the registry key must name the room too.
function disconnectTimerKey(roomCode, clientId) {
  return `${roomCode}\u0000${clientId}`;
}

// Obligations that gate the whole table must die with a departing or
// AFK seat, or the remaining players wait forever on a ghost.
const CANCELLED_OBLIGATIONS = [
  { key: 'pendingTrade', label: 'trade' },
  { key: 'pendingPlayerContract', label: 'player contract' }
];

export {
  DISCONNECT_GRACE_MS,
  EMPTY_ROOM_GC_INTERVAL_MS,
  TRADE_OFFER_TTL_MS,
  TRADE_EXPIRY_SWEEP_INTERVAL_MS,
  AUCTION_WATCHDOG_INTERVAL_MS,
  IDLE_SEAT_SWEEP_INTERVAL_MS,
  EMPTY_ROOM_GRACE_PERIOD_MS,
  ROOMS_UPDATED_DEBOUNCE_MS,
  BOT_DECISION_WATCHDOG_MS,
  BOT_DECISION_WATCHDOG_MARGIN_MS,
  disconnectTimerKey,
  CANCELLED_OBLIGATIONS
};
