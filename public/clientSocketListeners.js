/* ============================================================
   SOCKET LISTENERS: every socket.on(...) boundary for the client.
   The listeners update shared state and re-render through hooks
   injected by the entry module (emitServer, setConnectionStatus,
   renderAll, say, renderChat, handleRestoreSessionResponse,
   openChoiceModal, openCardReveal, openOfferModal, serverSyncHost).
   Event names and payload shapes are byte-identical to the old
   inline block in main.js.
   ============================================================ */
import { state, saveAccountSession, activeAppearance, buildPlayers } from "./clientState.js";
import { $ } from "./clientDom.js";
import { afterPieceMovement, applyServerState, markContractOfferAnnounced } from "./clientStateSync.js";
import { TILES, TILE_COUNT } from "./clientBoardData.js";
import { serverTileFor } from "./clientDeedRules.js";
import { renderRightRail } from "./clientRailRender.js";
import {
  ACCOUNT_SESSION_READY_KEY,
  bootstrapAccountCookieSession,
  canApplyAccountSocialUpdate,
  getAccountAuthGeneration,
  isAccountAuthGenerationCurrent,
  resetAccountScopedClientState,
  renderAchievements,
  updateAccountFromResponse,
} from "./clientAccountIdentity.js";
import { applyProfileToHomeUI, renderAccountPanel, renderProfileLibrary } from "./clientProfileRender.js";
import {
  announceSocialNotification,
  renderPlayerSurface,
  renderSocialSurface,
} from "./clientSocialSurfaces.js";
import { applyRoomsUpdated } from "./clientRoomsUi.js";
import { onSponsorshipUpdate } from "./clientSponsorshipUi.js";
import { ACCOUNT_SESSION_KEY, clearLocalPlayerData, loadAccountSession, loadGuestAlias } from "./clientSanitize.js";
import { DEFAULT_THEME_ID } from "./clientThemeData.js";
import { reconcileAccountLifecycleEvent } from "./clientAccountRights.js";
import { isTradeOfferDismissed } from "./clientTradeOfferDismissal.js";

let host = {
  setConnectionStatus: noop,
  emitServer: noop,
  handleRestoreSessionResponse: noop,
  say: noop,
  notice: noop,
  renderChat: noop,
  renderAll: noop,
  addActivityNotice: noop,
  openChoiceModal: noop,
  openCardReveal: noop,
  openOfferModal: noop,
  openDealDetails: noop,
  renderDealDetailsIfOpen: noop,
  applyMaintenanceState: noop,
  syncAudioButtons: noop,
  syncHomeMusic: noop,
  closePlayerSurface: noop,
  reconnectSocket: noop,
  serverSyncHost: {},
};
let storageListenerInstalled = false;
let pendingAccountSync = null;
let cookieSessionReady = null;
let pendingCrossTabAccountId = null;

function noop() {}

function clearLocalPlayerDataPreservingAccountSession() {
  const storage = globalThis.localStorage;
  if (!storage || typeof storage.length !== "number") return clearLocalPlayerData();
  const keys = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === "string" && key !== ACCOUNT_SESSION_KEY) keys.push(key);
    }
  } catch { return clearLocalPlayerData(); }
  return clearLocalPlayerData({
    get length() { return keys.length; },
    key(index) { return keys[index] || null; },
    removeItem(key) { storage.removeItem(key); },
  });
}

export function reconcileSignedOutState(message = "This account session ended in another tab.", { persistSession = true, notify = true } = {}) {
  resetAccountScopedClientState();
  pendingAccountSync = null;
  cookieSessionReady = null;
  const clearPrivateStorage = persistSession ? clearLocalPlayerData : clearLocalPlayerDataPreservingAccountSession;
  clearPrivateStorage();
  if (persistSession) saveAccountSession(null);
  else state.account = null;
  state.account = null;
  state.profiles = [];
  state.appearance = 0;
  state.themeId = DEFAULT_THEME_ID;
  state.tableAppearanceOverride = null;
  state.profileDraft = null;
  state.editingProfileId = null;
  state.alias = loadGuestAlias();
  state.players = buildPlayers(activeAppearance(), state.alias);
  state.sound = false;
  state.music = false;
  state.unlockedAchievements = new Set();
  state.achievementRecords = new Map();
  renderAccountPanel();
  applyProfileToHomeUI();
  renderProfileLibrary();
  host.syncAudioButtons();
  host.syncHomeMusic();
  host.renderAll();
  host.renderSocialSurfaces?.();
  host.closePlayerSurface?.();
  // A live-room render can persist a guest save; ensure account-owned local
  // data stays cleared after the render hook has completed.
  clearPrivateStorage();
  if (notify) host.notice("ACCOUNT", message);
}

export function onStorage(event) {
  if (event?.key === "poorup.account.lifecycle.v1" && event.newValue) {
    try {
      reconcileAccountLifecycleEvent(JSON.parse(event.newValue), state);
      renderAccountPanel();
      host.renderAll();
    } catch { /* malformed cross-tab lifecycle data is ignored */ }
    return;
  }
  if (event?.key === ACCOUNT_SESSION_READY_KEY && event.newValue) {
    try {
      const ready = JSON.parse(event.newValue);
      const account = loadAccountSession()?.account;
      if (!account || account.id !== ready?.accountId) return;
      if (state.account?.account?.id && state.account.account.id !== account.id) {
        pendingCrossTabAccountId = account.id;
        reconcileSignedOutState("Account changed in another tab.", { persistSession: false });
      }
      if (pendingCrossTabAccountId && pendingCrossTabAccountId !== account.id) return;
      pendingCrossTabAccountId = null;
      pendingAccountSync = null;
      cookieSessionReady = null;
      updateAccountFromResponse({ account, sessionToken: "", logoutToken: "" });
      host.reconnectSocket();
    } catch { /* malformed cross-tab session readiness is ignored */ }
    return;
  }
  if (event?.key !== ACCOUNT_SESSION_KEY) return;
  if (event.newValue === null) {
    pendingCrossTabAccountId = null;
    if (state.account?.account?.id) reconcileSignedOutState();
    return;
  }
  const nextAccount = loadAccountSession()?.account;
  const currentAccountId = state.account?.account?.id || null;
  if (!nextAccount?.id || !currentAccountId || nextAccount.id === currentAccountId) return;
  pendingCrossTabAccountId = nextAccount.id;
  reconcileSignedOutState("Account changed in another tab.", { persistSession: false });
}

export function isExplicitSessionInvalidation(response) {
  const code = String(response?.code || response?.errorCode || response?.reason || "").toLowerCase();
  const message = String(response?.error || "").toLowerCase();
  return /expired|invalid|revoked|sign in again|not found/.test(`${code} ${message}`);
}

function onSocketConnect() {
  host.setConnectionStatus("online", true);
  if (state.account) {
    const generation = getAccountAuthGeneration();
    const accountId = state.account.account?.id || null;
    Promise.resolve(bootstrapAccountCookieSession()).then((ready) => {
      if (!ready || !isAccountAuthGenerationCurrent(generation) || state.account?.account?.id !== accountId) return;
      cookieSessionReady = { accountId, generation };
      if (!pendingAccountSync) return;
      const buffered = pendingAccountSync;
      pendingAccountSync = null;
      if (buffered.generation === generation && buffered.account?.id === accountId) {
        updateAccountFromResponse({ account: buffered.account, sessionToken: state.account?.sessionToken || "", logoutToken: state.account?.logoutToken || "" });
      }
    }).catch(() => {});
  }
  host.emitServer("restore-session", {}, (response) => host.handleRestoreSessionResponse(response, false));
}

function onSocialNotification(notification) {
  const list = state.social.notifications || [];
  state.social.notifications = [notification, ...list.filter(item => item.id !== notification.id)].slice(0, 50);
  if (notification?.kind === "achievement-unlocked") return;
  announceSocialNotification(notification);
  renderSocialSurface("#social-page-content");
  renderSocialSurface("#social-card");
}

function onMythicalAchievement(notification, { includePrivate = true } = {}) {
  announceSocialNotification(notification);
  if (!includePrivate) return;
  state.social.notifications = [notification, ...(state.social.notifications || [])].slice(0, 50);
  renderSocialSurface("#social-page-content");
}

function onBotStatus(status) {
  state.botStatus = status || null;
  const label = $("#hud-bot-status");
  if (!label || !status?.nickname) return;
  clearTimeout(label._hideTimer);
  label.classList.remove("is-hidden", "is-thinking");
  if (status.state === "thinking") {
    label.classList.add("is-thinking");
    label.textContent = `${status.nickname} · CPU THINKING · ${String(status.brain || "ai").toUpperCase()}`;
    return;
  }
  const brainLabel = status.fallback || status.effectiveBrain === "no-ai" ? "NO-AI FALLBACK" : "AI ADVISOR";
  const actionLabel = status.actionId ? String(status.actionId).toUpperCase() : "ACTION COMPLETE";
  label.textContent = `${status.nickname} · ${brainLabel} · ${actionLabel}`;
  label._hideTimer = setTimeout(() => label.classList.add("is-hidden"), 3200);
}

function clearBotStatus() {
  state.botStatus = null;
  const label = $("#hud-bot-status");
  if (!label) return;
  clearTimeout(label._hideTimer);
  label.classList.add("is-hidden");
  label.classList.remove("is-thinking");
  label.textContent = "";
}

function onBotProviderStatus(status) {
  const allowed = new Set(["healthy", "unconfigured", "quota-exhausted", "cooldown"]);
  const stateName = allowed.has(status?.state) ? status.state : "unconfigured";
  const revision = Number.isFinite(Number(status?.revision)) ? Math.max(0, Math.floor(Number(status.revision))) : 0;
  const next = { state: stateName, revision, reason: stateName === "quota-exhausted" ? "credits-exhausted" : stateName === "unconfigured" ? "missing-credentials" : stateName === "cooldown" ? "provider-cooldown" : null };
  const previous = state.botProviderStatus;
  if (previous && revision < Number(previous.revision || 0)) return;
  state.botProviderStatus = next;
  document.dispatchEvent(new CustomEvent("poorup-bot-provider-status", { detail: next }));
  const banner = $("#bot-provider-banner");
  const usingAi = state.players.some(player => player.bot && player.botBrain === "ai")
    || (Number(state.settings?.bots) > 0 && state.settings?.botBrain === "ai");
  if (banner) {
    const show = next.state === "quota-exhausted" && usingAi;
    banner.hidden = !show;
    banner.setAttribute("aria-hidden", String(!show));
    if (show) banner.textContent = "AI CREDITS EXHAUSTED · BOT IS NOW USING NO-AI MODE";
  }
  if (next.state === "quota-exhausted" && (!previous || previous.state !== next.state || previous.revision !== next.revision)) {
    // F789-11: informational, so it goes to the polite status region, not the assertive alert one.
    $("#status-announcer").textContent = "AI credits are exhausted. Bots are now using No-AI mode.";
  }
  host.renderAll();
}

function syncSelectedPlayerRelationship() {
  const accountId = state.selectedPlayer?.accountId;
  if (!accountId) return;
  const social = state.social || {};
  if ((social.friends || []).some((friend) => friend.id === accountId)) {
    state.selectedPlayerRelationship = "accepted";
  } else if ((social.outgoing || []).some((request) => request.to?.id === accountId)) {
    state.selectedPlayerRelationship = "requested";
  } else {
    state.selectedPlayerRelationship = "none";
  }
  if (!$("#player-modal")?.classList.contains("is-hidden")) renderPlayerSurface();
}

function mergeAchievementIntoAccount(notification) {
  if (!state.account?.account) return;
  if (!notification?.achievementId) return;
  const account = state.account.account;
  const existing = Array.isArray(account.achievements) ? account.achievements : [];
  if (existing.some((entry) => entry.id === notification.achievementId)) return;
  account.achievements = [{ id: notification.achievementId, unlockedAt: notification.createdAt || new Date().toISOString() }, ...existing].slice(0, 100);
  saveAccountSession(state.account);
}

function announceAchievementUnlocked(notification) {
  if (!notification) return;
  announceSocialNotification({ ...notification, title: notification.title || "ACHIEVEMENT UNLOCKED" });
  renderAchievements();
  renderAccountPanel();
}

function onAchievementUnlocked(notification) {
  mergeAchievementIntoAccount(notification);
  announceAchievementUnlocked(notification);
}

function onAccountSync({ account } = {}) {
  const session = state.account;
  const accountId = session?.account?.id;
  if (!account || !accountId || account.id !== accountId) return;
  const generation = getAccountAuthGeneration();
  const hasActiveBearer = Boolean(session.sessionToken);
  const hasVerifiedCookieSession = cookieSessionReady?.accountId === accountId && cookieSessionReady.generation === generation;
  if (!hasActiveBearer && !hasVerifiedCookieSession) {
    pendingAccountSync = { account, generation };
    return;
  }
  pendingAccountSync = null;
  updateAccountFromResponse({
    account,
    sessionToken: session.sessionToken || "",
    logoutToken: session.logoutToken || "",
  });
}
function onAccountLifecycle(event) {
  if (!event?.state) return;
  reconcileAccountLifecycleEvent(event, state);
  renderAccountPanel();
  host.renderAll();
}

function onPlayerContractUpdate({ contract }) {
  state.playerContractOffer = null;
  if (contract) {
    state.playerContracts = {
      ...(state.playerContracts || {}),
      active: [...(state.playerContracts?.active || []).filter(entry => entry.id !== contract.id), contract]
    };
  }
  renderRightRail();
}

function onChatMessage({ nickname, text, senderId }) {
  // senderId is the authoritative server player id; nickname matching stays
  // only as a fallback (A4-F7: duplicate names cross-wire attribution).
  const sender = findChatSender(nickname, senderId);
  host.say(text, sender || { name: nickname, textColor: "#a79d7d" });
  host.renderChat();
}

function findChatSender(nickname, senderId) {
  const byServerId = senderId != null ? state.players.find((player) => player.serverId === senderId) : null;
  if (byServerId) return byServerId;
  return state.players.find((player) => player.name === String(nickname).toUpperCase());
}

function purchaseOfferTile(index) {
  const tileIndex = Number(index);
  const base = TILES[tileIndex % TILE_COUNT] || TILES[0];
  return { ...base, i: tileIndex };
}

function purchaseOfferName(serverTile, offer, tile) {
  if (serverTile?.name) return serverTile.name;
  if (offer?.name) return offer.name;
  return tile.name;
}

function purchaseOfferPrice(serverTile, offer, tile) {
  const serverPrice = serverTile?.price;
  if (serverPrice != null) return serverPrice;
  const offerPrice = offer?.price;
  if (offerPrice != null) return offerPrice;
  return tile.price;
}

function onPurchaseOffer(offer) {
  const serverTile = serverTileFor(offer?.tileIndex);
  const tile = purchaseOfferTile(offer?.tileIndex);
  state.pendingBuyTile = tile.i;
  const name = purchaseOfferName(serverTile, offer, tile);
  const price = purchaseOfferPrice(serverTile, offer, tile);
  const surface = { ...tile, name, price, canAfford: offer?.canAfford, canSeekSponsorship: offer?.canSeekSponsorship !== false };
  afterPieceMovement(() => {
    if (state.pendingBuyTile !== tile.i) return;
    host.openChoiceModal(surface);
  });
}

function routeActivityNotice(text) {
  host.addActivityNotice(text);
}

function onCardReveal(reveal) {
  const tile = TILES[Number(reveal?.tileIndex) % TILE_COUNT];
  if (!tile) return;
  if (tile.kind !== "chance" && tile.kind !== "chest") return;
  const event = { text: reveal.text || "Card resolved.", action: reveal.action, cash: Number(reveal.cash) || 0 };
  const roomCode = state.roomCode;
  afterPieceMovement(() => {
    if (state.roomCode !== roomCode) return;
    host.openCardReveal(tile, event);
  });
}

function tradeOfferSides(trade) {
  return {
    from: trade.from || trade.fromPlayerId,
    to: trade.to || trade.toPlayerId,
  };
}

function tradeOfferAssets(trade) {
  return {
    giveDeeds: trade.giveDeeds || trade.givePropertyIndexes || [],
    wantDeeds: trade.wantDeeds || trade.requestPropertyIndexes || [],
    giveCash: Number(trade.giveCash) || 0,
    wantCash: Number(trade.wantCash ?? trade.requestCash) || 0,
  };
}

export function normalizeTradeOffer(trade) {
  const sides = tradeOfferSides(trade);
  const assets = tradeOfferAssets(trade);
  return {
    ...trade,
    ...sides,
    fromPlayerId: sides.from,
    toPlayerId: sides.to,
    ...assets,
    givePropertyIndexes: trade.givePropertyIndexes || assets.giveDeeds,
    requestPropertyIndexes: trade.requestPropertyIndexes || assets.wantDeeds,
    requestCash: Number(trade.requestCash ?? assets.wantCash) || 0,
  };
}

function onTradeOffer({ trade }) {
  if (!trade) return;
  const normalized = { ...normalizeTradeOffer(trade), receivedAt: Date.now() };
  state.offers = [
    normalized,
    ...(state.offers || []).filter(offer => offer?.id !== normalized.id),
  ];
  host.renderAll();
  if (!isTradeOfferDismissed(state.roomCode, normalized.id)) host.openOfferModal(normalized);
}

function attachConnectionListeners(socket) {
  socket.on("connect", onSocketConnect);
  socket.on("connect_error", () => host.setConnectionStatus("offline", true));
  socket.on("update-state", (snapshot) => {
    applyServerState(snapshot, host.serverSyncHost);
    host.renderDealDetailsIfOpen();
  });
  socket.on("rooms-updated", applyRoomsUpdated);
  socket.on("maintenance-state", (snapshot) => host.applyMaintenanceState(snapshot));
}

function attachSocialListeners(socket) {
  socket.on("social-update", (social) => {
    if (!canApplyAccountSocialUpdate()) return;
    state.social = social || state.social;
    syncSelectedPlayerRelationship();
    renderSocialSurface("#social-page-content");
    renderSocialSurface("#social-card");
  });
  socket.on("social-notification", (notification) => {
    if (canApplyAccountSocialUpdate()) onSocialNotification(notification);
  });
  socket.on("mythical-achievement", (notification) => {
    onMythicalAchievement(notification, { includePrivate: canApplyAccountSocialUpdate() });
  });
  socket.on("achievement-unlocked", onAchievementUnlocked);
  socket.on("bot-status", onBotStatus);
  socket.on("bot-provider-status", onBotProviderStatus);
}

function attachAccountListeners(socket) {
  socket.on("account-sync", onAccountSync);
  socket.on("account-lifecycle", onAccountLifecycle);
  socket.on("player-contract-offer", ({ contract }) => {
    state.playerContractOffer = contract || null;
    markContractOfferAnnounced(contract);
    announceSocialNotification({ title: "CONTRACT OFFER", body: "A player contract is waiting in Finance." });
    renderRightRail();
    if (contract?.id) host.openDealDetails("contract", contract.id);
  });
  socket.on("player-contract-update", onPlayerContractUpdate);
  socket.on("sponsorship-update", ({ sponsorship } = {}) => onSponsorshipUpdate(sponsorship));
}

function attachChatListeners(socket) {
  socket.on("system-message", ({ text }) => {
    if (text) routeActivityNotice(text);
    host.renderAll();
  });
  socket.on("chat-message", onChatMessage);
}

function attachTableListeners(socket) {
  socket.on("purchase-offer", onPurchaseOffer);
  socket.on("card-reveal", onCardReveal);
  socket.on("trade-offer", onTradeOffer);
  // Registration order preserved: disconnect closed the original block.
  socket.on("disconnect", () => {
    clearBotStatus();
    host.setConnectionStatus("reconnecting", true);
  });
}

export function configureSocketListeners(socket, hooks) {
  host = { ...host, ...hooks };
  if (!storageListenerInstalled && typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("storage", onStorage);
    storageListenerInstalled = true;
  }
  if (!socket) return;
  attachConnectionListeners(socket);
  attachSocialListeners(socket);
  attachAccountListeners(socket);
  attachChatListeners(socket);
  attachTableListeners(socket);
}
