// Socket boundary: emits the existing server-authoritative events, plus patrol reconnect.
import { state } from "./clientState.js";
import {
  bootstrapAccountCookieSession,
  getAccountAuthGeneration,
  guardAccountAuthCallback,
  markAccountSocialStateFresh,
} from "./clientAccountIdentity.js";
import {
  handlePatrolReconnect,
  hasPendingPatrolSettlement,
} from "./clientNightShift.js";

let host = null;

// Configures the one client-owned callback the emit boundary needs.
export function configureSocketAdapter(deps) {
  host = deps;
}

export const socket = typeof window.io === "function" ? window.io() : null;

const ACCOUNT_SCOPED_RESPONSE_EVENTS = new Set([
  "get-social-data",
  "get-leaderboard-snapshot",
  "get-public-player-card",
  "search-players",
  "respond-friend-request",
  "respond-room-invite",
  "mark-notification-read",
  "clear-recent-players",
  "cancel-friend-request",
  "send-friend-request",
  "remove-friend",
  "send-room-invite",
  "get-match-history",
  "block-player",
  "report-player",
]);

export function emitServer(event, payload = {}, callback) {
  if (!socket) {
    host.setConnectionStatus("offline", true);
    callback?.({ success: false, error: "Live connection unavailable." });
    return;
  }
  const packet = { ...payload, clientId: state.clientId };
  if (state.account?.sessionToken) packet.sessionToken = state.account.sessionToken;
  if (typeof callback === "function" && ACCOUNT_SCOPED_RESPONSE_EVENTS.has(event)) {
    const generation = getAccountAuthGeneration();
    const onResponse = callback;
    callback = guardAccountAuthCallback((response) => {
      if (event === "get-social-data" && response?.success && response.social) markAccountSocialStateFresh(generation);
      onResponse(response);
    }, generation);
  }
  socket.emit(event, packet, callback);
}

function isPatrolRetryCurrent(ready, accountId) {
  return Boolean(ready && socket?.connected && state.account?.account?.id === accountId);
}

export function retryPatrolAfterAuthReady() {
  const accountId = state.account?.account?.id;
  if (!hasPendingPatrolSettlement() || !accountId) return;
  bootstrapAccountCookieSession().then((ready) => {
    if (isPatrolRetryCurrent(ready, accountId)) handlePatrolReconnect();
  }).catch(() => {});
}

export function reconnectAccountSocket() {
  if (!socket) return;
  if (socket.connected) socket.disconnect();
  socket.connect();
}
