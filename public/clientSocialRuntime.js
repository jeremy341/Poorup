// SOCIAL RUNTIME: shared host hooks, auth-generation checks, request timers and
// friend-action locks used by the social, rankings and player surface modules.
import { state } from "./clientState.js";
import { getAccountAuthGeneration } from "./clientAccountIdentity.js";

function noop() {}
let host = { emitServer: noop, showView: noop };
export const SOCIAL_REQUEST_TIMEOUT_MS = 8000;
let socialRequestId = 0;
let socialRequestTimer = null;
let leaderboardRequestTimer = null;
const pendingFriendRequests = new Map();

export function configureSocialSurfaces(hooks) {
  host = { ...host, ...hooks };
}

export function socialHost() {
  return host;
}

export function getSocialRequestId() {
  return socialRequestId;
}

export function setSocialRequestId(id) {
  socialRequestId = id;
}

export function getSocialRequestTimer() {
  return socialRequestTimer;
}

export function setSocialRequestTimer(timer) {
  socialRequestTimer = timer;
}

export function getLeaderboardRequestTimer() {
  return leaderboardRequestTimer;
}

export function setLeaderboardRequestTimer(timer) {
  leaderboardRequestTimer = timer;
}

export function socialAuthToken() {
  return { accountId: state.account?.account?.id, generation: getAccountAuthGeneration() };
}

export function socialAuthCurrent(token) {
  return Boolean(token?.accountId) && token.accountId === state.account?.account?.id && token.generation === getAccountAuthGeneration();
}

export function beginFriendRequestAction(id) {
  if (!id || !state.account?.account || friendRequestPending(id)) return null;
  const token = socialAuthToken();
  pendingFriendRequests.set(String(id), token);
  return token;
}

export function friendRequestPending(id) {
  return socialAuthCurrent(pendingFriendRequests.get(String(id)));
}

export function finishFriendRequestAction(id, token) {
  if (pendingFriendRequests.get(String(id)) !== token) return false;
  pendingFriendRequests.delete(String(id));
  return socialAuthCurrent(token);
}
