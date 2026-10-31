// ENTRY MODULE: game logic, renderers, and event wiring.
// Shared data and state live in the client*.js modules imported here.
import { $, esc, setHtml } from "./clientDom.js";
import {
  hydrateSprites,
  spriteHTML,
  avatarHTML,
} from "./clientSprites.js";
import {
  state,
  syncLocalAppearance,
} from "./clientState.js";
import {
  buildBoard,
  renderBoardState,
  placePieces,
  startPieceWalk,
  cancelPieceWalk,
} from "./clientBoardRender.js";
import { renderHud } from "./clientHudRender.js";
import { showDiceRollTotal } from "./clientDiceRollEffect.js";
import { DICE_SHAKE_CYCLE_MS, MODAL_ENTER_MS } from './gamePresentationTiming.js';
import {
  CONNECTION_COPY,
  renderConnectionStatus,
  renderTopNav,
} from "./clientTopNavRender.js";
import { renderRightRail } from "./clientRailRender.js";
import { bindBankLoanUi, configureBankLoanUi, openBankLoanOffer } from "./clientBankLoanUi.js";
import {
  bindFlightUi,
  closeFlightDesk,
  configureFlightUi,
  openFlightDesk,
  renderFlightDeskIfOpen,
} from "./clientFlightUi.js";
import {
  bindWalletUi,
  closeWalletModal,
  configureWalletUi,
  openWalletModal,
  renderWalletModalIfOpen,
} from "./clientWalletUi.js";
import {
  bindMarketUi,
  closeMarketDesk,
  configureMarketUi,
  openMarketDesk,
  renderMarketDeskIfOpen,
} from "./clientMarketUi.js";
import {
  bindCasinoUi,
  closeCasinoDesk,
  configureCasinoUi,
  openCasinoDesk,
  renderCasinoDeskIfOpen,
} from "./clientCasinoUi.js";
import {
  bindPanelMenu,
  closePanelMenu,
  isPanelMenuOpen,
  renderPanelMenu,
} from "./clientPanelMenu.js";
import { renderGlobalEvent } from "./clientGlobalEventRender.js";
import {
  configureSurfaces,
  syncSurfaceA11y,
  openSurface,
  closeSurface,
  openConfirmModal,
  setSurfaceReturnFocus,
  bindBeforeUnloadGuard,
  hideSurfaceResolved,
} from "./clientSurfaces.js";
import {
  toggleLogDrawerFromButton,
  closeLogDrawer,
  isLogDrawerOpen,
  renderLogDrawer,
} from "./clientLogDrawer.js";
import { renderBoardFeed } from "./clientBoardFeed.js";
import { renderChatDock } from "./clientChatDock.js";
import { bindHomeMenu, closeHeaderMenus } from "./clientHomeMenu.js";
import { bindKeyboard } from "./clientKeyboard.js";
import {
  configureRailEvents,
  onRailClick,
  onRailSubmit,
} from "./clientRailEvents.js";
import { configureProfileRender, renderAccountPanel } from "./clientProfileRender.js";
import {
  applyPatrolState,
  configureNightShift,
  handlePatrolDisconnect,
  handlePatrolReconnect,
  hasPendingPatrolSettlement,
  nightShiftState,
  startNightShift,
  stopNightShift,
} from "./clientNightShift.js";
import { PARLOR_PATROL_ENABLED, syncParlorPatrolAvailability } from "./clientParlorPatrolFlag.js";
import {
  announceSocialNotification,
  configureSocialSurfaces,
  parlorNotice,
  openSocialSurface,
  openInGameSocialSurface,
  openRankingsSurface,
  openRulesSurface,
  renderSocialSurface,
  renderRulesSurface,
} from "./clientSocialSurfaces.js";
import {
  bootstrapAccountCookieSession,
  getAccountAuthGeneration,
  guardAccountAuthCallback,
  markAccountSocialStateFresh,
  configureAccountIdentity,
  renderAchievements,
  closeAchievementModal,
  unlockAchievement,
  closeAccountModal,
} from "./clientAccountIdentity.js";
import {
  configurePopup,
  closePopup,
  onTileClick,
} from "./clientPopupUi.js";
import {
  configureTradeUi,
  openFinancingModal,
  openFinancingNegotiation,
  openFinancingContract,
  closeFinancingModal,
  openTradeModal,
  openTradeNegotiation,
  closeTradeModal,
} from "./clientTradeUi.js";
import { bindParlorSurfaces, syncRoomVoteKickUi } from "./clientParlorBindings.js";
import { friendlyActionError } from "./clientActionErrorCopy.js";
import { createChatSender } from "./clientChatSend.js";
import { createPresenceMonitor } from "./clientPlayerPresence.js";
import { createInactivityUi, inactiveBadgeHTML } from "./clientInactivityUi.js";
import {
  bindDealUi,
  closeDealDetails,
  configureDealUi,
  openDealDetails,
  renderDealDetailsIfOpen,
} from "./clientDealUi.js";
import {
  renderPatrolHud,
  startHomeClock,
  stopHomeClock,
  playPatrolHitSound,
  stopHomeHelicopter,
  scheduleHomeHelicopter,
  hitHomeHelicopter,
} from "./clientHomeAmbient.js";
import {
  configureAuctionUi,
  renderAuction,
  startAuctionTimer,
  stopAuctionTimer,
} from "./clientAuctionUi.js";
import { bindHomeEntry } from "./clientHomeEntryBindings.js";
import { bindAudioControls, syncAudioButtons } from "./clientAudioControls.js";
import { bindShortcutToggles } from "./clientShortcutPrefs.js";
import { copyRoomCode } from "./clientRoomShare.js";
import { configureThemeUi, initThemePreference, bindThemeVisibility } from "./clientTheme.js";
import { renderTheme } from "./clientThemeRender.js";
import { createMusicPlayer } from "./clientMusicPlayer.js";
import { applyMaintenanceState, configureMaintenanceUi } from "./clientMaintenance.js";
import { initAnalytics } from "./clientAnalytics.js";
import { initAdminAiProvider } from "./clientAdminAiProvider.js";
import { configureAccountRights, bindAccountRights } from "./clientAccountRights.js";
import { setDocumentMeta } from "./clientDocumentMeta.js";
import { configureAboutUi, bindAboutUi, openAboutSurface, syncAboutNavigation } from "./clientAboutUi.js";
import {
  bindRoomsUi,
  closeRoomsModal,
  configureRoomsUi,
  openRoomsModal,
  requestRoomsDirectory,
  refreshHomeDirectory,
  renderHomeSignals,
  renderHome,
  setHomeTab,
  syncGlobalNavigation,
} from "./clientRoomsUi.js";
import { configureSocketListeners, reconcileSignedOutState } from "./clientSocketListeners.js";
import { syncLog } from "./clientStateSync.js";
import { getChatRenderPlan, hasUnrenderedMessages } from "./clientChatView.js";
import { TILES } from "./clientBoardData.js";
import {
  bindGameModalSurfaces,
  closeCardGallery,
  closeChoiceModalAsPass,
  configureGameModals,
  openCardReveal,
  openCardPreviewFromUrl,
  openBankruptcyModal,
  presentPurchaseChoice,
  renderInlineChoice,
  openOfferModal,
  closeOfferWithoutResponse,
  closeOfferIfWithdrawn,
  showGameOver,
} from "./clientGameModalsUi.js";
import { emitIntent } from "./clientRequestController.js";
import {
  bindSponsorshipUi,
  closeSponsorshipModal,
  configureSponsorshipUi,
  requestSponsorship,
} from "./clientSponsorshipUi.js";
import {
  bindDeedDetail,
  openDeedDetail,
  closeDeedDetail,
  configureDeedDetail,
  renderDeedDetail,
} from "./clientDeedDetailUi.js";
import {
  addComputerPlayer,
  bindLobbyUi,
  configureLobbyUi,
  enterParlor,
  reconcileParlorEntrySnapshot,
  goHome,
  leaveRoomForHome,
  renderLobbyRail,
  renderSetup,
} from "./clientLobbyUi.js";
import {
  bindProfileUi,
  closeProfileEditor,
  configureProfileBindings,
  openProfileEditor,
} from "./clientProfileBindings.js";
import {
  clearSave,
  configureGameSave,
  handleRestoreSessionResponse,
  loadSavedGame,
  resumeGame,
  saveGame,
} from "./clientGameSave.js";
/* ---- restrained arcade sfx (Web Audio, no assets) ------------------ */
let audioCtx = null;
let musicController = null;
let globalEventVoteTimer = null;

function announceSoundMessage(message) {
  const status = $("#music-status");
  if (status && status.textContent !== message) status.textContent = message;
}

function tone(freq, dur, vol = 0.035, when = 0) {
  if (!state.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume()?.catch(() => announceSoundMessage("Sound is blocked. Activate a control to retry."));
    const t0 = audioCtx.currentTime + when;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  } catch { /* audio blocked */ }
}
const SOUND_TRACKS = {
  die: [{ freq: 220, dur: 0.05, vol: 0.03 }],
  cash: [{ freq: 660, dur: 0.06, vol: 0.03 }, { freq: 880, dur: 0.07, vol: 0.03, when: 0.06 }],
  house: [{ freq: 140, dur: 0.08, vol: 0.04 }],
  auction: [{ freq: 520, dur: 0.12, vol: 0.03 }, { freq: 390, dur: 0.14, vol: 0.03, when: 0.12 }],
  trade: [{ freq: 520, dur: 0.08, vol: 0.03 }, { freq: 780, dur: 0.1, vol: 0.03, when: 0.09 }],
  step: [{ freq: 180, dur: 0.03, vol: 0.02 }],
};
function playSound(name) {
  if (!state.sound) return;
  const track = SOUND_TRACKS[name];
  if (!track) return;
  track.forEach((note) => tone(note.freq, note.dur, note.vol, note.when || 0));
}





syncLocalAppearance();

// LIVE SOCKET.IO ADAPTER
// The ZIP remains the complete UI source; this small boundary maps its
// renderer state to the existing server-authoritative game protocol.
const socket = typeof window.io === "function" ? window.io() : null;
function isPatrolRetryCurrent(ready, accountId) {
  return Boolean(ready && socket?.connected && state.account?.account?.id === accountId);
}
function retryPatrolAfterAuthReady() {
  const accountId = state.account?.account?.id;
  if (!hasPendingPatrolSettlement() || !accountId) return;
  bootstrapAccountCookieSession().then((ready) => {
    if (isPatrolRetryCurrent(ready, accountId)) handlePatrolReconnect();
  }).catch(() => {});
}
function reconnectAccountSocket() {
  if (!socket) return;
  if (socket.connected) socket.disconnect();
  socket.connect();
}
const SERVER_SETTING_KEYS = {
  rulesProfile: "rulesProfile",
  playerFinance: "playerFinance",
  maxPlayers: "maxPlayers",
  startingCash: "startingCash",
  vacationPool: "vacationCash",
  auction: "auction",
  noRentInJail: "noRentWhileInPrison",
  trading: "trading",
  doubleGo: "doubleGo",
  bankruptMode: "bankruptMode",
  bankLoans: "bankLoans",
  bankLoanSeverity: "bankLoanSeverity",
  globalEvents: "globalEvents",
  casino: "casino",
  flights: "flights",
  bankAccountUpgrades: "bankAccountUpgrades",
  itemRewards: "itemRewards",
  market: "market",
  bots: "bots",
  botBrain: "botBrain",
  botDifficulty: "botDifficulty",
  rulesetOverrides: "rulesetOverrides",
  boardVariant: "boardVariant",
  marketComplexity: "marketComplexity",
};

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

function emitServer(event, payload = {}, callback) {
  if (!socket) {
    setConnectionStatus("offline", true);
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

function updateServerSetting(key, value) {
  const previousSettings = {
    ...state.settings,
    rulesetOverrides: Array.isArray(state.settings.rulesetOverrides)
      ? state.settings.rulesetOverrides.map(entry => ({ ...entry }))
      : [],
  };
  const previousRuleset = state.ruleset;
  const previousBoardVariant = state.boardVariant;
  state.settings[key] = value;
  const serverKey = SERVER_SETTING_KEYS[key];
  if (!serverKey) return;
  const context = { key, value, previousSettings, previousRuleset, previousBoardVariant };
  emitServer("set-setting", { key: serverKey, value }, (settingResult) => handleSettingResult(settingResult, context));
}

function handleSettingResult(settingResult, context) {
  if (settingResult?.success !== false) return;
  if (!Object.is(state.settings[context.key], context.value)) return;
  restoreRejectedServerSetting(context.key, context.previousSettings, context.previousRuleset, context.previousBoardVariant);
  parlorNotice("TABLE SETTINGS", settingResult.error || "That table setting was rejected.", "error");
  renderLobbyRail();
}

function restoreRejectedServerSetting(key, previousSettings, previousRuleset, previousBoardVariant) {
  state.settings[key] = previousSettings[key];
  const rulesetKey = ["rulesetOverrides"].includes(key);
  if (rulesetKey) {
    state.settings.rulesetOverrides = previousSettings.rulesetOverrides;
    state.ruleset = previousRuleset;
  }
  if (key === "boardVariant") state.boardVariant = previousBoardVariant;
}

/* Host callbacks that keep DOM, timers, and rendering owned by main.js while
   the pure snapshot syncers live in clientStateSync.js. */
const serverSyncHost = {
  setConnectionStatus,
  showView,
  renderAll,
  startPieceWalk,
  openBankruptcyModal,
  showGameOver,
  gameViewVisible: () => !$("#view-game").classList.contains("is-hidden"),
  openAuctionSurface: () => {
    renderAuction();
    openSurface("#auction-modal", "#auction-close");
    startAuctionTimer();
  },
  closeAuctionSurface: () => {
    stopAuctionTimer();
    closeSurface("#auction-modal");
  },
  retireButton: () => $("#game-retire-btn"),
  bankruptcyHidden: () => Boolean($("#bankruptcy-modal")?.classList.contains("is-hidden")),
  hideBankruptcyModal: () => hideSurfaceResolved("#bankruptcy-modal"),
  syncOfferSurface: closeOfferIfWithdrawn,
  placePiecesSoon: () => requestAnimationFrame(() => placePieces()),
  rebuildBoard: () => buildBoard(onTileClick),
  announceDiceRoll: showDiceRollTotal,
  // Polite toast only: no modal, no focus move. The offer waits under Finance.
  noticeContractOffer: (offer, proposerName) => announceSocialNotification({
    title: "CONTRACT OFFER",
    body: `${proposerName} sent you a contract offer. Open Finance, then Needs You, to respond.`,
  }),
  cancelPieceMovement: () => state.players.forEach(player => cancelPieceWalk(player.id)),
};


function renderAccountSocialSurfaces() {
  renderSocialSurface("#social-page-content");
  renderSocialSurface("#social-card");
}

configureSocketListeners(socket, {
  setConnectionStatus,
  emitServer,
  notice: parlorNotice,
  handleRestoreSessionResponse,
  say,
  renderChat,
  renderAll,
  addActivityNotice,
  openChoiceModal: presentPurchaseChoice,
  openCardReveal,
  openOfferModal,
  renderDealDetailsIfOpen,
  openDealDetails,
  applyMaintenanceState,
  syncAudioButtons,
  syncHomeMusic,
  renderSocialSurfaces: renderAccountSocialSurfaces,
  closePlayerSurface: () => closeSurface("#player-modal"),
  reconnectSocket: reconnectAccountSocket,
  serverSyncHost,
});

function systemMessage(text) {
  return { who: "", color: "", text, system: true };
}
function chatMessage(text, who) {
  if (!who) return systemMessage(text);
  return { who: who.name, color: who.textColor, text };
}
function isDuplicateSystem(message, previous) {
  if (!message.system) return false;
  if (!previous?.system) return false;
  return previous.text === message.text;
}
function announceSystemLine(text) {
  const announcer = $("#system-announcer");
  if (announcer) announcer.textContent = String(text);
}
function say(text, who) {
  if (!who) return;
  const message = chatMessage(text, who);
  const previous = state.messages[state.messages.length - 1];
  if (isDuplicateSystem(message, previous)) return;
  state.messages.push(message);
  if (state.messages.length > 80) state.messages.splice(0, state.messages.length - 80);
  if (!message.system) return;
  announceSystemLine(text);
}

function announceActionStatus(message, statusNode = null) {
  const text = friendlyActionError(message || "Action could not be completed.");
  if (statusNode) {
    statusNode.textContent = text;
    statusNode.hidden = false;
  }
  const announcer = $("#error-announcer");
  if (announcer) announcer.textContent = text;
}

function reusableActionStatusNode(control) {
  const statusNode = control._actionStatusNode;
  if (!statusNode?.isConnected) return null;
  statusNode.textContent = "";
  statusNode.hidden = true;
  return statusNode;
}

function createActionStatusNode(control, host) {
  const statusNode = document.createElement("p");
  statusNode.className = "action-status t-micro";
  statusNode.setAttribute("aria-live", "off");
  statusNode.setAttribute("aria-atomic", "true");
  statusNode.hidden = true;
  host.append(statusNode);
  control._actionStatusNode = statusNode;
  return statusNode;
}

function captureActionStatusNode(control = document.activeElement) {
  if (!control || typeof control.closest !== "function") return null;
  const host = control.closest('[role="dialog"], .modal, .panel') || control.form || control.parentElement;
  if (!host) return null;
  return reusableActionStatusNode(control) || createActionStatusNode(control, host);
}

function addActivityNotice(text) {
  const value = String(text || "").trim();
  if (!value) return;
  if (state.activityRoomCode !== state.roomCode) {
    state.activityRoomCode = state.roomCode;
    state.activityNotices = [];
  }
  state.activityNotices.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: value, timestamp: Date.now() });
  state.activityNotices = state.activityNotices.slice(0, 40);
  syncLog({ feed: state.lastGameFeed });
}

function recordActivity(text) {
  addActivityNotice(text);
}

function setConnectionStatus(status, announce = false) {
  if (state.connectionStatus === status) {
    renderConnectionStatus();
    renderHomeSignals();
    refreshHomeDirectory();
    return;
  }
  state.connectionStatus = status;
  renderConnectionStatus();
  renderHomeSignals();
  refreshHomeDirectory();
  if (announce) {
    const copy = CONNECTION_COPY[status] || CONNECTION_COPY.offline;
    const message = status === "online" ? "Live table connection restored." : `Table connection ${copy.toLowerCase()}.`;
    if (state.lastConnectionAnnouncement !== message) {
      state.lastConnectionAnnouncement = message;
      announceSystemLine(message);
    }
  }
}

// OPTIONAL ACCOUNT / PROFILE IDENTITY
// Guest play stays local; an account only adds durable identity and stats.

function createRequestId(kind) {
  return String(state.clientId || "client") + ":" + String(kind || "action") + ":" + Date.now() + ":" + Math.random().toString(36).slice(2, 8);
}




function record(text) {
  state.log.unshift(text);
  if (state.log.length > 40) state.log.length = 40;
}

// HOME SCREEN

function refreshEconomySnapshot() {
  emitServer("get-economy-snapshot", {}, (response) => {
    if (!response?.success || !response.economy) {
      state.economySnapshotStatus = "stale";
      renderRightRail();
      return;
    }
    state.economySnapshotStatus = "fresh";
    state.economy = {
      ...state.economy,
      ...response.economy,
      casino: { ...state.economy.casino, ...(response.economy.casino || {}) },
      market: { ...state.economy.market, ...(response.economy.market || {}) }
    };
    renderRightRail();
  });
}
function ensureMusicController() {
  if (musicController) return musicController;
  if (globalThis.__poorupThemeMusicController) {
    musicController = globalThis.__poorupThemeMusicController;
    return musicController;
  }
  const root = document.querySelector("[data-music-runtime]");
  if (!root) return null;
  musicController = createMusicPlayer({
    audioA: root.querySelector('audio[data-music-audio="a"]'),
    audioB: root.querySelector('audio[data-music-audio="b"]'),
    getThemeId: () => state.themeId,
    announce: message => {
      const status = root.querySelector("[data-music-status]");
      const globalStatus = $("#music-status");
      if (status && status.textContent !== message) status.textContent = message;
      if (globalStatus && globalStatus.textContent !== message) globalStatus.textContent = message;
    },
  });
  globalThis.__poorupThemeMusicController = musicController;
  return musicController;
}

function setMusicEnabled(enabled, { userGesture = false } = {}) {
  const controller = ensureMusicController();
  if (!controller) return;
  if (!enabled) {
    controller.stop?.();
    return;
  }
  if (userGesture || state.music) controller.resetToThemeTrack?.();
}

function syncHomeMusic({ force = false, userGesture = false } = {}) {
  const controller = ensureMusicController();
  if (controller) {
    if (!state.music) setMusicEnabled(false);
    else if (force || userGesture) setMusicEnabled(true, { userGesture });
    return;
  }
  // The dock controller is canonical; no single-track fallback.
}

function resumeSuspendedAudioContext() {
  if (audioCtx?.state !== "suspended") return;
  audioCtx.resume()?.catch(() => announceSoundMessage("Sound is blocked. Activate a control to retry."));
}

function retryThemeTrackAfterGesture() {
  const snapshot = ensureMusicController()?.snapshot?.();
  if (!snapshot) return;
  if (snapshot.status === "playing") return;
  syncHomeMusic({ userGesture: true });
}

function retryAudioAfterGesture() {
  resumeSuspendedAudioContext();
  if (!state.music) return;
  retryThemeTrackAfterGesture();
}

// The hidden theme runtime owns playback and status announcements.


// GAME RENDERERS

function renderPlayers() {
  const seated = state.players.slice(0, state.settings.maxPlayers);
  const serverNow = currentServerTime();
  const rows = seated.map((p, i) => playerRowHTML(p, i, serverNow));
  if (lobbyAddSeatAvailable(seated.length)) rows.push(lobbyAddSeatHTML());
  setHtml($("#player-list"), rows.join(""));
}

// Before the round starts, the host can add a computer player straight from the empty seat.
function lobbyAddSeatAvailable(seatedCount) {
  const me = state.players[0];
  const isHost = Boolean(me && (me.isHost || (me.serverId && me.serverId === state.hostId)));
  return state.phase === "lobby" && isHost && seatedCount < state.settings.maxPlayers;
}

function lobbyAddSeatHTML() {
  return `<button class="player-row player-row-add" type="button" data-add-computer>
    <span class="pr-av" aria-hidden="true">+</span>
    <span class="t-label">Add computer player</span>
  </button>`;
}

function playerRowHTML(p, i, serverNow = currentServerTime()) {
  const active = i === state.turnIndex && state.phase === "playing";
  const spectating = isSpectatingPlayer(p);
  const eliminated = Boolean(p.bankrupt);
  const playerId = p.serverId || p.id;
  const status = spectating ? "SPECTATING" : playerStatusLabel(p);
  return `<button class="player-row player-row-action${active ? " is-active" : ""}${spectating ? " is-spectating" : ""}${eliminated ? " is-eliminated" : ""}" type="button" data-player-id="${esc(playerId)}" aria-label="Open player card for ${esc(p.name)}${spectating ? ", spectating" : eliminated ? ", bankrupt" : ""}">
        ${active ? `<span class="pr-arrow">${spriteHTML("arrow", 3)}</span>` : ""}
        <div class="pr-av${spectating ? " pr-av-spectating" : ""}">${avatarHTML(p, 4, i)}</div>
        <div class="pr-mid">
          <div class="pr-nameline">
            ${active ? spriteHTML("crown", 2) : ""}
            <span class="t-label pr-name" style="color:${p.textColor}">${esc(p.name)}</span>
            ${lobbyTagHTML(p)}
            ${state.phase === "playing" ? inactiveBadgeHTML(p, serverNow) : ""}
          </div>
          ${spectating ? `<span class="t-micro pr-spectating-label">SPECTATING</span>` : ""}
          <div class="t-label pr-cash numeric">$${Number(p.visualCash ?? p.cash ?? 0).toLocaleString()}</div>
        </div>
        <div class="pr-right">
          ${playerDotHTML(p)}
          <span class="t-micro ink-3">${status}</span>
        </div>
      </button>`;
}

/* Before the game starts the left rail is the only seat list, so it carries the
   host and computer player markers of the lobby panel. */
function lobbyTagHTML(p) {
  if (state.phase === "playing") return "";
  const isHost = Boolean(p.isHost) || Boolean(p.serverId && p.serverId === state.hostId);
  if (isHost) return `<span class="pr-tag pr-tag-host t-micro">HOST</span>`;
  if (p.bot) return `<span class="pr-tag pr-tag-computer t-micro">COMPUTER</span>`;
  return "";
}

function playerDotHTML(p) {
  if (p.bankrupt) return `<span class="pr-dot pr-dot-spectating"></span>`;
  const on = Boolean(p.online);
  const background = on ? "#35a653" : "#3a382a";
  const boxShadow = on ? "0 0 5px rgb(53 166 83 / 60%)" : "none";
  return `<span class="pr-dot" style="background:${background};box-shadow:${boxShadow}"></span>`;
}

function isSpectatingPlayer(p) {
  if (p.spectating) return true;
  if (!p.bankrupt) return false;
  return !p.bot;
}

function playerStatusLabel(p) {
  if (isSpectatingPlayer(p)) return "SPECTATING";
  if (p.bankrupt) return "BANKRUPT";
  if (!p.online) return "AFK";
  if (p.id === "p1") return "YOU";
  if (p.bot) return `COMPUTER · ${(p.botBrain || "ai").toUpperCase()} · ${(p.botDifficulty || "table").toUpperCase()}`;
  return "ONLINE";
}

let hasRenderedChat = false;
let lastRenderedChatRoomCode = "";
let lastRenderedChatCount = 0;
let lastRenderedChatTail = null;

function hasUnrenderedChatMessages() {
  return hasUnrenderedMessages(state.messages, lastRenderedChatCount, lastRenderedChatTail);
}

function chatRenderPlan(body) {
  const wasNearBottom = body.scrollHeight - body.scrollTop - body.clientHeight <= 32;
  const roomChanged = hasRenderedChat && state.roomCode !== lastRenderedChatRoomCode;
  return getChatRenderPlan({
    isFirstRender: !hasRenderedChat,
    isNearBottom: wasNearBottom,
    roomChanged,
    hasNewMessages: hasUnrenderedChatMessages(),
  });
}

function chatMessageHTML(message) {
  if (message.system) {
    return `<p class="t-body chat-line"><span class="ink-3">» </span><span class="g-muted">${esc(message.text)}</span></p>`;
  }
  return `<p class="t-body chat-line"><span style="color:${message.color}">${esc(message.who)}:</span> <span class="ink-2">${esc(message.text)}</span></p>`;
}

// A role="log" region must only receive the new rows. Appending (and trimming the oldest)
// keeps the reader's selection and avoids re-announcing the whole buffer; a first render, room
// change or unknown tail falls back to one full render.
function renderChatMessages(body) {
  const recent = state.messages.slice(-60);
  const tailIndex = hasRenderedChat && state.roomCode === lastRenderedChatRoomCode && lastRenderedChatTail
    ? recent.lastIndexOf(lastRenderedChatTail)
    : -1;
  if (tailIndex >= 0) {
    const fresh = recent.slice(tailIndex + 1);
    if (fresh.length) body.insertAdjacentHTML("beforeend", fresh.map(chatMessageHTML).join(""));
    while (body.childElementCount > recent.length) body.firstElementChild.remove();
  } else {
    body.innerHTML = recent.map(chatMessageHTML).join("");
  }
  hasRenderedChat = true;
  lastRenderedChatRoomCode = state.roomCode;
  lastRenderedChatCount = state.messages.length;
  lastRenderedChatTail = state.messages.at(-1) || null;
}

function syncChatScroll(body, affordance, renderPlan) {
  if (renderPlan.followBottom) {
    body.scrollTop = body.scrollHeight;
  }
  if (renderPlan.showNewMessages) {
    affordance?.classList.remove("is-hidden");
  } else {
    affordance?.classList.add("is-hidden");
  }
}

function syncChatInput() {
  const joined = (state.phase !== "home" && state.players.length > 0);
  $("#chat-input").disabled = !joined;
  $("#chat-send").disabled = !joined;
  $("#chat-input").placeholder = joined ? "Say something…" : "Join the room to chat…";
}

function renderChat() {
  const body = $("#chat-body");
  const renderPlan = chatRenderPlan(body);
  if (renderPlan.updateContent) renderChatMessages(body);
  syncChatScroll(body, $("#chat-new-message"), renderPlan);
  syncChatInput();
  renderChatDock();
}






/* Deed detail/house manager + card reveal live in
   clientDeedDetailUi.js / clientGameModalsUi.js. */
function renderStep(label, render) {
  try {
    render();
  } catch (error) {
    console.error(`Poorup render step failed: ${label}`, error);
    const announcer = $("#error-announcer");
    if (announcer) announcer.textContent = `${label} is temporarily unavailable.`;
  }
}

function renderAll() {
  renderStep("Top bar", renderTopNav);
  renderStep("Players", renderPlayers);
  renderStep("Room presence", syncRoomPresenceUi);
  renderStep("Chat", renderChat);
  if (isLogDrawerOpen()) renderStep("Event log", renderLogDrawer);
  renderStep("Board feed", renderBoardFeed);
  renderStep("Board", renderBoardState);
  renderStep("Player pieces", placePieces);
  renderStep("Global event", renderGlobalEvent);
  renderStep("HUD", renderHud);
  renderStep("Purchase choice", renderInlineChoice);
  renderStep("Right rail", renderRightRail);
  renderStep("Wallet", renderWalletModalIfOpen);
  renderStep("Flight desk", renderFlightDeskIfOpen);
  renderStep("Market desk", renderMarketDeskIfOpen);
  renderStep("Casino desk", renderCasinoDeskIfOpen);
  renderStep("Panel menu", renderPanelMenu);
  renderStep("Setup", renderSetup);
  renderStep("Lobby", renderLobbyRail);
  if (state.deedDetail != null) renderStep("Deed detail", renderDeedDetail);
  if (state.phase === "playing") renderStep("Save game", saveGame);
  renderStep("Surface accessibility", syncSurfaceA11y);
}

let roomPresenceMonitor = null;
let roomInactivityUi = null;

function stopRoomPresence() {
  roomPresenceMonitor?.destroy();
  roomPresenceMonitor = null;
  roomInactivityUi?.destroy();
  roomInactivityUi = null;
  syncRoomVoteKickUi(null, [], Date.now());
}

function hasCurrentRoomSeat() {
  return state.phase !== "home" && Boolean(state.roomCode) && Boolean(state.roomPlayerId);
}

function ensureRoomPresenceMonitor() {
  if (!roomPresenceMonitor) {
    roomPresenceMonitor = createPresenceMonitor({
      emit: (eventName, payload) => emitServer(eventName, payload),
    });
  }
}

function ensureRoomInactivityUi() {
  if (!roomInactivityUi) {
    roomInactivityUi = createInactivityUi({
      listHost: $("#player-list"),
    });
  }
}

function currentServerTime() {
  return Date.now() + (Number(state.serverTimeOffset) || 0);
}

function syncRoomPresenceUi() {
  if (!hasCurrentRoomSeat()) {
    if (roomPresenceMonitor || roomInactivityUi) stopRoomPresence();
    return;
  }
  ensureRoomPresenceMonitor();
  ensureRoomInactivityUi();
  const serverTime = currentServerTime();
  // Nobody times out in the lobby, so the countdown only shows once a game runs.
  roomInactivityUi.update(state.phase === "playing" ? state.players : [], serverTime);
  syncRoomVoteKickUi(state.voteKick || null, state.players, serverTime);
}

/* Lobby settings rail + profile editor/identity bindings live in
   clientLobbyUi.js / clientProfileBindings.js. */



// GAME LOGIC

function isLocalPlayerBlocked() {
  const localPlayer = state.players[0];
  return Boolean(localPlayer?.bankrupt || localPlayer?.spectating);
}

function canActForStage(idx, expectedStage) {
  if (state.phase !== "playing" || isLocalPlayerBlocked()) return false;
  if (state.turnIndex !== idx || state.busy || state.presentationBusy) return false;
  return state.turnStage === expectedStage;
}

function createTurnRequest(kind) {
  const requestId = createRequestId(kind);
  state.pendingAction = { kind, requestId };
  return requestId;
}

function executeTurnEmit({ kind, requestId, event, errorMessage, timeoutMessage }) {
  const statusNode = captureActionStatusNode();
  renderHud();
  let settled = false;
  const finish = () => {
    if (state.pendingAction?.requestId !== requestId) return;
    state.pendingAction = null;
    state.busy = false;
    if (kind === "roll" && !state.presentationBusy) state.rolling = false;
  };
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    finish();
    announceActionStatus(timeoutMessage, statusNode);
    renderAll();
  }, 8000);
  emitServer(event, { requestId }, (response) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    finish();
    reportChatError(response, errorMessage, statusNode);
    renderAll();
  });
}

async function runTurn(idx) {
  if (!canActForStage(idx, "roll")) return;
  state.busy = true;
  state.rolling = true;
  const requestId = createTurnRequest("roll");
  executeTurnEmit({
    kind: "roll",
    requestId,
    event: "roll-dice",
    errorMessage: "The roll could not be completed.",
    timeoutMessage: "Roll could not be confirmed. Try again.",
  });
}



function endTurn(idx) {
  if (!canActForStage(idx, "end")) return;
  state.busy = true;
  const requestId = createTurnRequest("end-turn");
  executeTurnEmit({
    kind: "end-turn",
    requestId,
    event: "end-turn",
    errorMessage: "The turn could not be ended.",
    timeoutMessage: "The turn could not be confirmed. Try again.",
  });
}

function mustResolveAcquisition() {
  return Boolean(state.auction || state.pendingBuyTile != null || state.sponsorship);
}

function canUsePrimaryTurnAction() {
  if (state.phase !== "playing") return false;
  if (isLocalPlayerBlocked()) return false;
  if (state.busy || state.presentationBusy) return false;
  return state.turnIndex === 0;
}

function openPendingPurchaseChoice() {
  if (state.pendingBuyTile == null) return false;
  const tile = TILES[state.pendingBuyTile];
  if (!tile) return true;
  presentPurchaseChoice(tile);
  return true;
}

/* A live auction whose card was dismissed is reopened from the HUD button
   (labelled "Resolve Auction"); any seated player may bid, turn or not. */
function reopenDismissedAuction() {
  if (!state.auction || state.phase !== "playing") return false;
  const me = state.players[0];
  if (me?.bankrupt || me?.spectating) return false;
  if (!$("#auction-modal").classList.contains("is-hidden")) return true;
  serverSyncHost.openAuctionSurface();
  return true;
}

function primaryTurnAction() {
  if (reopenDismissedAuction()) return;
  if (!canUsePrimaryTurnAction()) return;
  if (openPendingPurchaseChoice()) return;
  if (mustResolveAcquisition()) return;
  if (state.turnStage === "end") endTurn(0);
  else runTurn(0);
}


function startGame() {
  emitWithChatError("start-game", {}, "Only the host can start the game.");
}

function buyTile(tile, submittedStatusNode = null, onSuccess = null) {
  if (tile?.i == null) return;
  const statusNode = submittedStatusNode || captureActionStatusNode();
  // One BUY per intent: a double click / Enter repeat must not double-charge.
  emitIntent(emitServer, `purchase-property:${tile.i}`, "purchase-property", { tileIndex: tile.i }, {
    onResponse: (response) => {
      reportChatError(response, "That deed is no longer available.", statusNode);
      if (response?.success === false) return;
      if (onSuccess) {
        onSuccess();
        closePopup();
      }
      else {
        state.pendingBuyTile = null;
        $("#choice-modal")?.classList.add("is-hidden");
        closePopup();
      }
    },
    onTimeout: () => announceActionStatus("The purchase could not be confirmed. Try again.", statusNode),
  });
}
/* Forced choice/auction, trading modals and the persist/resume cluster
   live in clientGameModalsUi.js / clientGameSave.js. */

// ROUTING + EVENTS
function syncViewVisibility(name) {
  $("#view-home").classList.toggle("is-hidden", name !== "home");
  $("#view-game").classList.toggle("is-hidden", name !== "game");
  $("#view-profile").classList.toggle("is-hidden", name !== "profile");
  const optionalViews = [
    ["#view-rankings", "rankings"],
    ["#view-social", "social"],
    ["#view-rules", "rules"],
    ["#view-about", "about"],
    ["#view-admin-analytics", "analytics"],
  ];
  optionalViews.forEach(([selector, view]) => $(selector)?.classList.toggle("is-hidden", name !== view));
}

function prepareViewExit(name) {
  closeHeaderMenus();
  if (name !== "home" && nightShiftState.active) stopNightShift();
  if (name !== "game") closePanelMenu({ restore: false });
}

function syncViewMetadata(name) {
  syncGlobalNavigation(name);
  syncAboutNavigation(name);
  setDocumentMeta({ view: name, roomCode: state.roomCode });
  window.scrollTo(0, 0);
  syncSurfaceA11y();
}

function syncHomeViewLifecycle(name) {
  if (name === "home") {
    startHomeClock();
    scheduleHomeHelicopter();
    syncHomeMusic();
  } else {
    stopHomeClock();
    stopHomeHelicopter();
    syncHomeMusic();
  }
}

function showView(name) {
  prepareViewExit(name);
  syncViewVisibility(name);
  syncViewMetadata(name);
  syncHomeViewLifecycle(name);
  syncRoomPresenceUi();
}


function reportChatError(response, message, statusNode = null) {
  if (response?.success === false) {
    const text = response.error || message;
    announceActionStatus(text, statusNode);
  }
}

function emitWithChatError(event, payload, message, statusNode = captureActionStatusNode()) {
  emitServer(event, payload, (response) => reportChatError(response, message, statusNode));
}

function homeProfileEditTarget() {
  return typeof state.appearance === "string" ? state.appearance : null;
}

function onHomeNavClick(e) {
  const button = e.target.closest("[data-home-tab]");
  if (!button) return;
  const tab = button.dataset.homeTab;
  setHomeTab(tab);
  if (tab === "rooms") openRoomsModal("browse");
  if (tab === "profile") openProfileEditor("home", homeProfileEditTarget());
}

function onTopSurfaceClick(button) {
  const surface = button.dataset.topSurface;
  if (openInGameSocialSurface(surface)) return;
  if (surface === "rankings") openRankingsSurface();
  else if (surface === "social") openSocialSurface();
  else if (surface === "rules") openRulesSurface();
}

function onTopBackClick(button) {
  const target = button.dataset.topBack || "home";
  if (target === "home" && window.location.pathname === "/admin/analytics") {
    window.history.replaceState(null, "", "/");
    leaveRoomForHome();
  }
  else if (target === "home") leaveRoomForHome();
  else showView(target);
}

function onHomeTabClick(button) {
  const tab = button.dataset.homeTab;
  if (tab === "profile") {
    openProfileEditor("home", homeProfileEditTarget());
  } else if (tab === "rooms") {
    leaveRoomForHome();
    setHomeTab("rooms");
    openRoomsModal("browse");
  } else if (tab === "play") {
    leaveRoomForHome();
    setHomeTab("play");
    renderHome();
  }
}

function onHomeSignalClick(event) {
  const signal = event.target.closest("[data-home-signal]");
  if (!signal) return;
  const kind = signal.dataset.homeSignal;
  if (kind === "entry") {
    openProfileEditor("home", homeProfileEditTarget());
    return;
  }
  if (kind === "sync") {
    requestRoomsDirectory();
    return;
  }
  if (kind === "lobbies") openRoomsModal("browse");
}

function onRulesSectionClick(event) {
  const chaptersToggle = event.target.closest("[data-rules-chapters-toggle]");
  if (chaptersToggle) {
    state.rulesIndexExpanded = !state.rulesIndexExpanded;
    renderRulesSurface("#rules-page-content");
    requestAnimationFrame(() => $("[data-rules-chapters-toggle]")?.focus({ preventScroll: true }));
    return;
  }
  const chapter = event.target.closest("[data-rules-section]");
  if (chapter) {
    state.rulesIndexExpanded = false;
    openRulesSurface(chapter.dataset.rulesSection);
  }
}

function bindHomeNavigation() {
  // Home destinations. Play stays in the stage; rooms uses the existing
  // server-backed directory surface; profile keeps the current editor flow.
  $("#home-nav")?.addEventListener("click", onHomeNavClick);
  $("#home-signal-line")?.addEventListener("click", onHomeSignalClick);
  document.querySelectorAll("[data-top-surface]").forEach((button) => {
    if (button.closest("#about-page-content")) return;
    button.addEventListener("click", () => onTopSurfaceClick(button));
  });
  document.querySelectorAll("[data-top-back]").forEach((button) => {
    button.addEventListener("click", () => onTopBackClick(button));
  });
  document.querySelectorAll("[data-home-tab]").forEach((button) => {
    if (button.closest("#home-nav")) return;
    if (button.closest("#about-page-content")) return;
    button.addEventListener("click", () => onHomeTabClick(button));
  });
}

function bindRulesPage() {
  $("#rules-page-content")?.addEventListener("click", onRulesSectionClick);
}

function bindDrawerAndBoardModes() {
  $("#resume-btn")?.addEventListener("click", () => resumeGame());

  $("#log-toggle-btn")?.addEventListener("click", toggleLogDrawerFromButton);
  $("#drawer-close")?.addEventListener("click", closeLogDrawer);

  // panel visibility controls
  bindPanelMenu();
}

function bindAmbientExits() {
  // Keep Patrol controls synchronized with the client feature flag.
  syncParlorPatrolAvailability();
  if (!PARLOR_PATROL_ENABLED) return;
  $("#home-helicopter")?.addEventListener("click", hitHomeHelicopter);
  $("#home-night-shift-start")?.addEventListener("click", startNightShift);
  $("#night-exit")?.addEventListener("click", stopNightShift);
}

function onGlobalEventVoteClick(event) {
  const choice = event.target.closest("[data-global-choice]");
  if (!choice) return;
  if (choice.disabled) return;
  if (state.globalEventVotePending) return;
  const statusNode = captureActionStatusNode(choice);
  state.globalEventVotePending = true;
  choice.disabled = true;
  clearTimeout(globalEventVoteTimer);
  globalEventVoteTimer = setTimeout(() => {
    state.globalEventVotePending = false;
    if (state.phase !== "playing") return;
    parlorNotice("GLOBAL EVENT", "Vote timed out. The table state will refresh when the connection returns.", "warning");
    renderGlobalEvent();
  }, 8000);
  emitServer("vote-global-event", { choiceId: choice.dataset.globalChoice }, (response) => {
    clearTimeout(globalEventVoteTimer);
    globalEventVoteTimer = null;
    state.globalEventVotePending = false;
    reportChatError(response, "Your vote could not be recorded.", statusNode);
    renderGlobalEvent();
  });
}

function bindGameActions() {
  // game to home
  $("#brand-home").addEventListener("click", leaveRoomForHome);
  $("#tn-room-copy").addEventListener("click", copyRoomCode);
  $("#hud-cash-action")?.addEventListener("click", (event) => {
    if (event.currentTarget.disabled) return;
    openWalletModal("account", event.currentTarget);
  });
  $("#global-event-choices")?.addEventListener("click", onGlobalEventVoteClick);

  // lobby start round
  $("#lobby-start-btn").addEventListener("click", startGame);
  $("#player-list").addEventListener("click", (e) => {
    if (e.target.closest("[data-add-computer]")) addComputerPlayer();
  });
  $("#pay-jail-fine")?.addEventListener("click", () => {
    emitWithChatError("pay-jail-fine", {}, "The jail fine could not be paid.");
  });
  $("#use-jail-free")?.addEventListener("click", () => {
    emitWithChatError("use-jail-free", {}, "The card could not be used.");
  });
}

const onChatFormSubmit = createChatSender({
  getInput: () => $("#chat-input"),
  canSend: () => state.players.some(player => player.clientId === state.clientId),
  send: (text, done) => {
    const statusNode = captureActionStatusNode();
    emitServer("send-chat", { text }, (response) => {
      reportChatError(response, "Message could not be sent.", statusNode);
      done(response);
    });
  },
});

$("#chat-new-message")?.addEventListener("click", () => {
  const body = $("#chat-body");
  body.scrollTop = body.scrollHeight;
  renderChat();
});
$("#chat-body")?.addEventListener("scroll", () => {
  const body = $("#chat-body");
  if (body.scrollHeight - body.scrollTop - body.clientHeight <= 32) {
    if (hasUnrenderedChatMessages()) renderChat();
    else $("#chat-new-message")?.classList.add("is-hidden");
  }
});

function bindBoardLayout() {
  // keep tokens glued to tiles when the board resizes
  if (window.ResizeObserver) {
    const frame = $("#board-frame");
    if (frame) new ResizeObserver(() => placePieces()).observe(frame);
  }
  window.addEventListener("resize", () => placePieces());

  // the main arcade button rolls first, then ends the resolved turn
  $("#roll-btn").addEventListener("click", primaryTurnAction);
  $("#open-flight-desk")?.addEventListener("click", event => openFlightDesk(event.currentTarget));
}

function tabNeedsEconomySnapshot() {
  return state.tab === "activity";
}

function openSurfaceFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const route = params.get("rules") || params.get("surface");
  if (route === "book" || route === "rules") openRulesSurface();
  else if (route === "rankings") openRankingsSurface();
  else if (route === "social") openSocialSurface();
}

function onRailTabClick(e) {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  state.tab = tab.dataset.tab;
  renderRightRail();
  if (tabNeedsEconomySnapshot()) refreshEconomySnapshot();
}

function railTabIndex(key, index, length) {
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % length;
  if (key === "ArrowLeft" || key === "ArrowUp") return (index - 1 + length) % length;
  return -1;
}

function onRailTabKeyDown(event) {
  const tab = event.target.closest('[role="tab"]');
  if (!tab) return;
  const list = tab.parentElement;
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  if (!tabs.length) return;
  const index = railTabIndex(event.key, tabs.indexOf(tab), tabs.length);
  if (index < 0) return;
  event.preventDefault();
  tabs[index].focus({ preventScroll: true });
  tabs[index].click();
}

function bindRail() {
  $("#tabs").addEventListener("click", onRailTabClick);
  $("#tabs").addEventListener("keydown", onRailTabKeyDown);

  // Holdings, Deals, and Activity actions are delegated from the rail body.
  $("#rr-body").addEventListener("click", onRailClick);
  $("#rr-body").addEventListener("keydown", onRailTabKeyDown);
  $("#rr-body").addEventListener("submit", onRailSubmit);
  $("#rr-body").addEventListener("toggle", (event) => {
    if (event.target.matches("details.finance-bank")) state.financeBankOpen = event.target.open;
  }, true);

  $("#popup-scrim").addEventListener("click", closePopup);
  $("#trade-scrim").addEventListener("click", closeTradeModal);
  $("#financing-scrim").addEventListener("click", closeFinancingModal);
}

function bindEvents() {
  bindHomeNavigation();
  bindRulesPage();

  bindParlorSurfaces({ emitServer, leaveRoomForHome });

  // Home actions are bound to their explicit controls below. Keeping the
  // entry points named avoids accidental duplicate Create/Browse triggers.
  bindHomeEntry({ closeRoomsModal, enterParlor });

  // rooms browser & creator (clientRoomsUi.js)
  bindRoomsUi();

  bindDrawerAndBoardModes();

  // buy/decline choice card, trade offer inbox, bankruptcy + round-over
  // cards, and the card reveal/gallery (clientGameModalsUi.js)
  bindGameModalSurfaces();
  bindDealUi();
  bindWalletUi();
  bindFlightUi();
  bindMarketUi();
  bindCasinoUi();
  bindSponsorshipUi();
  bindDeedDetail();
  bindHomeMenu();

  // profile editor, account and achievements surfaces (clientProfileBindings.js)
  bindProfileUi();
  bindAccountRights();

  // Global effects/music toggles (main + every surface) live in clientAudioControls.js.
  bindAudioControls({ playSound, syncHomeMusic, musicController, setMusicEnabled });
  bindShortcutToggles();
  window.addEventListener("pointerdown", retryAudioAfterGesture, { passive: true });
  window.addEventListener("keydown", retryAudioAfterGesture);
  bindAmbientExits();

  // setup overlay + quick table + lobby settings rail (clientLobbyUi.js)
  bindLobbyUi();

  bindGameActions();

  $("#chat-form").addEventListener("submit", onChatFormSubmit);

  bindBoardLayout();
  bindRail();

  // keyboard (controller lives in clientKeyboard.js)
  bindKeyboard({
    startNightShift,
    stopNightShift,
    isNightShiftActive: () => nightShiftState.active,
    goHome,
    setHomeTab,
    openRoomsModal,
    openProfileEditor,
    closeAccountModal,
    closeAchievementModal,
    closeFinancingModal,
    closeWalletModal,
    closeFlightDesk,
    closeMarketDesk,
    closeCasinoDesk,
    closePanelMenu,
    isPanelMenuOpen,
    closeSponsorshipModal,
    closeCardGallery,
    closeChoiceModalAsPass,
    closeRoomsModal,
    closeProfileEditor,
    closeOfferWithoutResponse,
    closeDeedDetail,
    closeTradeModal,
    closeDealDetails,
    closePopup,
    primaryTurnAction,
  });
}


// INIT
document.documentElement.style.setProperty('--dice-shake-cycle', `${DICE_SHAKE_CYCLE_MS}ms`);
document.documentElement.style.setProperty('--modal-enter-duration', `${MODAL_ENTER_MS}ms`);
configureSurfaces({ notice: parlorNotice });
bindBeforeUnloadGuard();
configureSocialSurfaces({ emitServer, showView });
configureAboutUi({ showView, openHomeTab: onHomeTabClick, openTopSurface: onTopSurfaceClick });
bindAboutUi();
configureDealUi({ emitServer, say, recordActivity, captureActionStatusNode, announceActionStatus, renderChat, renderRightRail, openTradeNegotiation, openFinancingNegotiation, openConfirmModal });
configureAccountIdentity({
  emitServer,
  say,
  notice: parlorNotice,
  announceActionStatus,
  syncAudioButtons,
  syncHomeMusic,
  renderSocialSurfaces: renderAccountSocialSurfaces,
  closePlayerSurface: () => closeSurface("#player-modal"),
  reconnectSocket: reconnectAccountSocket,
  reconcileSignedOutState,
});
configureAccountRights({ state, emitServer, announce: say, refresh: renderAccountPanel, setSurfaceReturnFocus });
configureRailEvents({ emitServer, say, recordActivity, captureActionStatusNode, announceActionStatus, renderChat, renderRightRail, createRequestId, buyTile, openTradeModal, openFinancingModal, openFinancingNegotiation, openFinancingContract, openDealDetails, openWalletModal, openMarketDesk, openCasinoDesk, openBankLoanOffer, refreshEconomySnapshot, leaveRoomForHome });
configureBankLoanUi({ getOffer: () => state.players[0]?.bankLoanOffer, openSurface, closeSurface, emitServer, createRequestId, announceActionStatus, captureActionStatusNode, refreshEconomySnapshot });
bindBankLoanUi();
configureWalletUi({ emitServer, renderRightRail, renderHud, createRequestId, refreshWalletSnapshot: () => emitServer("restore-session", {}, response => handleRestoreSessionResponse(response, false)), notice: message => parlorNotice("WALLET", message) });
configureFlightUi({ emitServer, renderAll, notice: message => parlorNotice("FLIGHTS", message) });
configureMarketUi({ emitServer, renderRightRail, createRequestId, say, recordActivity, captureActionStatusNode, announceActionStatus, renderChat });
configureCasinoUi({ emitServer, renderRightRail, createRequestId, say, recordActivity, captureActionStatusNode, announceActionStatus, renderChat, playSound, refreshEconomySnapshot });
configureTradeUi({ emitServer, say, recordActivity, captureActionStatusNode, announceActionStatus, renderChat, record, createRequestId, renderRightRail });
configureAuctionUi({ emitServer, say, recordActivity, captureActionStatusNode, announceActionStatus, renderChat });
configurePopup({ buyTile, record, openDeedDetail });
configureProfileRender({ renderAchievements, loadSavedGame, renderHomeSignals });
configureGameModals({ emitServer, say, recordActivity, captureActionStatusNode, announceActionStatus, renderChat, renderAll, buyTile,
  openHoldings: () => { state.tab = "holdings"; renderRightRail(); },
  openTradeForDebt: () => {
    const partner = state.players.find(player => player.id !== 'p1' && !player.bankrupt && !player.spectating && player.online !== false);
    if (partner) openTradeModal(partner.id);
    else parlorNotice('TRADE', 'No active trade partner is available.', 'warning');
  },
  openFinancingForDebt: () => openFinancingModal('loan'),
  openSponsorshipRequest: requestSponsorship, openTradeNegotiation, startGame });
configureSponsorshipUi({ emitServer, say, recordActivity, captureActionStatusNode, announceActionStatus, renderChat });
configureDeedDetail({ emitServer, say, captureActionStatusNode, announceActionStatus, renderAll });
configureProfileBindings({ showView, emitServer, notice: (message, severity) => parlorNotice("PROFILE", message, severity) });
configureGameSave({ emitServer, setConnectionStatus, showView, renderAll });
configureRoomsUi({ emitServer, say, captureActionStatusNode, announceActionStatus, renderChat, enterParlor, createRequestId });
configureLobbyUi({
  emitServer,
  updateServerSetting,
  showView,
  renderAll,
  say,
  captureActionStatusNode,
  announceActionStatus,
  renderChat,
  clearSave,
  renderPlayers,
  rebuildBoard: () => buildBoard(onTileClick),
  closeRoomsModal,
  goHome,
  openConfirmModal,
  createRequestId,
});
socket?.on("update-state", reconcileParlorEntrySnapshot);
socket?.on("patrol-state", applyPatrolState);
socket?.on("disconnect", handlePatrolDisconnect);
socket?.on("connect", retryPatrolAfterAuthReady);
configureNightShift({
  emitServer,
  parlorNotice,
  unlockAchievement,
  playPatrolHitSound,
  renderPatrolHud,
  startHomeClock,
  stopHomeClock,
  stopHomeHelicopter,
  scheduleHomeHelicopter,
  retryPendingSettlement: retryPatrolAfterAuthReady,
});
if (socket?.connected) retryPatrolAfterAuthReady();
configureThemeUi({ applyTheme: renderTheme, onThemeChange: (themeId) => ensureMusicController()?.setTheme(themeId, { play: state.music }) });
// The operator cookie is read only at the Socket.IO handshake, so sign-in and sign-out reconnect.
configureMaintenanceUi({ emitServer, reconnectSocket: () => { if (!socket) return; socket.disconnect(); socket.connect(); } });
bindThemeVisibility();
initThemePreference();
ensureMusicController();
renderHome();
buildBoard(onTileClick);
renderTheme(state.themeId, { animate: false });
hydrateSprites();
bindEvents();
const analyticsRouteActive = globalThis.window?.location?.pathname === "/admin/analytics";
setDocumentMeta({ view: analyticsRouteActive ? "analytics" : "home" });
renderAll();
const analyticsPathActive = initAnalytics();
if (analyticsPathActive) initAdminAiProvider();
if (!analyticsPathActive) {
  if (window.location.pathname === "/about") openAboutSurface({ history: false });
  else {
    showView("home");
    openCardPreviewFromUrl();
    openSurfaceFromUrl();
  }
}
