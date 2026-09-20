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
import { applyServerState } from "./clientStateSync.js";
import { TILES, TILE_COUNT } from "./clientBoardData.js";
import { serverTileFor } from "./clientDeedRules.js";
import { renderRightRail } from "./clientRailRender.js";
import {
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
import { clearLocalPlayerData, loadGuestAlias } from "./clientSanitize.js";
import { DEFAULT_THEME_ID } from "./clientThemeData.js";

let host = {
  setConnectionStatus: noop,
  emitServer: noop,
  handleRestoreSessionResponse: noop,
  say: noop,
  renderChat: noop,
  renderAll: noop,
  openChoiceModal: noop,
  openCardReveal: noop,
  openOfferModal: noop,
  openDealDetails: noop,
  renderDealDetailsIfOpen: noop,
  applyMaintenanceState: noop,
  syncAudioButtons: noop,
  syncHomeMusic: noop,
  serverSyncHost: {},
};
let storageListenerInstalled = false;

function noop() {}

export function reconcileSignedOutState(message = "This account session ended in another tab.") {
  clearLocalPlayerData();
  saveAccountSession(null);
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
  state.selectedPlayer = null;
  state.selectedPlayerRelationship = "none";
  state.selectedPlayerHistory = null;
  state.social = { friends: [], requests: [], outgoing: [], invites: [], notifications: [], recentPlayers: [] };
  renderAccountPanel();
  applyProfileToHomeUI();
  renderProfileLibrary();
  host.syncAudioButtons();
  host.syncHomeMusic();
  host.renderAll();
  // A live-room render can persist a guest save; ensure account-owned local
  // data stays cleared after the render hook has completed.
  clearLocalPlayerData();
  host.say(message);
}

export function onStorage(event) {
  if (event?.key !== "poorup.account.session.v1" || event.newValue !== null) return;
  if (!state.account?.sessionToken) return;
  reconcileSignedOutState();
}

export function isExplicitSessionInvalidation(response) {
  const code = String(response?.code || response?.errorCode || response?.reason || "").toLowerCase();
  const message = String(response?.error || "").toLowerCase();
  return /expired|invalid|revoked|sign in again|not found/.test(`${code} ${message}`);
}

function onSocketConnect(socket) {
  host.setConnectionStatus("online", true);
  if (state.account?.sessionToken) restoreAccountSession(socket);
  host.emitServer("restore-session", {}, (response) => host.handleRestoreSessionResponse(response, false));
}

function restoreAccountSession(socket) {
  socket.emit("account-restore", { sessionToken: state.account.sessionToken }, (response) => {
    if (response?.success) updateAccountFromResponse({ account: response.account, sessionToken: state.account.sessionToken });
    else if (isExplicitSessionInvalidation(response)) reconcileSignedOutState(response.error || "Account session expired. Sign in again.");
    else host.say("Account restore is temporarily unavailable. We will retry when the connection returns.");
  });
}

function onSocialNotification(notification) {
  const list = state.social.notifications || [];
  state.social.notifications = [notification, ...list.filter(item => item.id !== notification.id)].slice(0, 50);
  if (notification?.kind === "achievement-unlocked") return;
  announceSocialNotification(notification);
  renderSocialSurface("#social-page-content");
  renderSocialSurface("#social-card");
}

function onMythicalAchievement(notification) {
  announceSocialNotification(notification);
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
    label.textContent = `${status.nickname} · CPU THINKING · ${String(status.brain || "auto").toUpperCase()}`;
    return;
  }
  const brainLabel = status.fallback ? "HOUSE BRAIN" : "AI ADVISOR";
  const actionLabel = status.actionId ? String(status.actionId).toUpperCase() : "ACTION COMPLETE";
  label.textContent = `${status.nickname} · ${brainLabel} · ${actionLabel}`;
  label._hideTimer = setTimeout(() => label.classList.add("is-hidden"), 3200);
  if (status.actionId) {
    host.say(`${status.nickname} chose ${status.actionId}${status.fallback ? " (house fallback)" : " (AI advisor)"}.`);
    host.renderChat();
  }
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
    $("#error-announcer").textContent = "AI credits are exhausted. Bots are now using No-AI mode.";
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
  if (!state.account?.sessionToken) return;
  if (!account) return;
  updateAccountFromResponse({ account, sessionToken: state.account.sessionToken });
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
  host.openChoiceModal({ ...tile, name, price, canAfford: offer?.canAfford, canSeekSponsorship: offer?.canSeekSponsorship !== false });
}

function onCardReveal(reveal) {
  const tile = TILES[Number(reveal?.tileIndex) % TILE_COUNT];
  if (!tile) return;
  if (tile.kind !== "chance" && tile.kind !== "chest") return;
  const event = { text: reveal.text || "Card resolved.", action: reveal.action, cash: Number(reveal.cash) || 0 };
  host.openCardReveal(tile, event);
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

function normalizeTradeOffer(trade) {
  return { ...trade, ...tradeOfferSides(trade), ...tradeOfferAssets(trade) };
}

function onTradeOffer({ trade }) {
  if (!trade) return;
  const normalized = normalizeTradeOffer(trade);
  state.offers = [
    normalized,
    ...(state.offers || []).filter(offer => offer?.id !== normalized.id),
  ];
  host.renderAll();
  host.openOfferModal(normalized);
}

function attachConnectionListeners(socket) {
  socket.on("connect", () => onSocketConnect(socket));
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
    state.social = social || state.social;
    syncSelectedPlayerRelationship();
    renderSocialSurface("#social-page-content");
    renderSocialSurface("#social-card");
  });
  socket.on("social-notification", onSocialNotification);
  socket.on("mythical-achievement", onMythicalAchievement);
  socket.on("achievement-unlocked", onAchievementUnlocked);
  socket.on("bot-status", onBotStatus);
  socket.on("bot-provider-status", onBotProviderStatus);
}

function attachAccountListeners(socket) {
  socket.on("account-sync", onAccountSync);
  socket.on("player-contract-offer", ({ contract }) => {
    state.playerContractOffer = contract || null;
    announceSocialNotification({ body: "A player contract is waiting in Finance." });
    renderRightRail();
    if (contract?.id) host.openDealDetails("contract", contract.id);
  });
  socket.on("player-contract-update", onPlayerContractUpdate);
  socket.on("sponsorship-update", ({ sponsorship } = {}) => onSponsorshipUpdate(sponsorship));
}

function attachChatListeners(socket) {
  socket.on("system-message", ({ text }) => { host.say(text); host.renderChat(); });
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
