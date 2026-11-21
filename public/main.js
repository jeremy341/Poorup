// ENTRY MODULE: game logic, renderers, and event wiring.
// Shared data and state live in the client*.js modules imported here.
import { $, esc } from "./clientDom.js";
import { hydrateSprites } from "./clientSprites.js";
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
  configureBoardSound,
} from "./clientBoardRender.js";
import { renderHud, configureHudSound, dismissTurnCoach } from "./clientHudRender.js";
import { showDiceRollTotal } from "./clientDiceRollEffect.js";
import { announceSystemLine } from "./clientAnnouncer.js";
import { DICE_SHAKE_CYCLE_MS } from './gamePresentationTiming.js';
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
  MODAL_EXIT_MS,
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
import { configureRailEvents } from "./clientRailEvents.js";
import { configureProfileRender, renderAccountPanel } from "./clientProfileRender.js";
import {
  applyPatrolState,
  configureNightShift,
  handlePatrolDisconnect,
  nightShiftState,
  startNightShift,
  stopNightShift,
} from "./clientNightShift.js";
import { PARLOR_PATROL_ENABLED, syncParlorPatrolAvailability } from "./clientParlorPatrolFlag.js";
import {
  announceSocialNotification,
  configureSocialSurfaces,
  parlorNotice,
  openRulesSurface,
  renderSocialSurface,
} from "./clientSocialSurfaces.js";
import {
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
import { configureComputerProfile, openComputerProfile } from "./clientComputerProfile.js";
import { showComputerProfile } from "./clientProfileBindings.js";
import { friendlyActionError } from "./clientActionErrorCopy.js";
import { createChatSender } from "./clientChatSend.js";
import { createPresenceMonitor } from "./clientPlayerPresence.js";
import { createInactivityUi } from "./clientInactivityUi.js";
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
  refreshHomeDirectory,
  renderHomeSignals,
  renderHome,
  setHomeTab,
  syncGlobalNavigation,
} from "./clientRoomsUi.js";
import { configureSocketListeners, reconcileSignedOutState } from "./clientSocketListeners.js";
import { syncLog } from "./clientStateSync.js";
import { getChatRenderPlan, hasUnrenderedMessages } from "./clientChatView.js";
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
  removeComputerPlayer,
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
import { playSound, resumeSuspendedAudioContext } from "./clientSfx.js";
import {
  configureSocketAdapter,
  emitServer,
  reconnectAccountSocket,
  retryPatrolAfterAuthReady,
  socket,
} from "./clientSocketAdapter.js";
import {
  configureGameActions,
  buyTile,
  primaryTurnAction,
  startGame,
  startRound,
} from "./clientGameActions.js";
import {
  configureHomeNavigation,
  bindHomeNavigation,
  bindRulesPage,
  onHomeTabClick,
  onTopSurfaceClick,
} from "./clientHomeNavigation.js";
import { configureRailBindings, bindRail, openSurfaceFromUrl } from "./clientRailBindings.js";
import { configurePlayerRail, renderPlayers } from "./clientPlayerRail.js";

let musicController = null;
let globalEventVoteTimer = null;
const MODAL_ENTER_MS = 200;
configureSocketAdapter({ setConnectionStatus });

syncLocalAppearance();

// LIVE SOCKET.IO ADAPTER: emit/reconnect live in clientSocketAdapter.js.
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

function updateServerSetting(key, value, onResult) {
  const settled = typeof onResult === "function" ? onResult : null;
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
  if (!serverKey) {
    settled?.({ success: true });
    return;
  }
  const context = { key, value, previousSettings, previousRuleset, previousBoardVariant };
  emitServer("set-setting", { key: serverKey, value }, (settingResult) => {
    handleSettingResult(settingResult, context);
    settled?.(settingResult);
  });
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
  announceDiceRoll: (total) => {
    playSound("thud");
    showDiceRollTotal(total);
  },
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

/* Before the game starts the left rail is the only seat list, so it carries the
   host and computer player markers of the lobby panel. */
function lobbyTagHTML(p) {
  if (state.phase === "playing") return "";
  const isHost = Boolean(p.isHost) || Boolean(p.serverId && p.serverId === state.hostId);
  if (isHost) return `<span class="player-row-tag player-row-tag-host t-micro">HOST</span>`;
  if (p.bot) return `<span class="player-row-tag player-row-tag-computer t-micro">COMPUTER</span>`;
  return "";
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

// Auction bid blip: observable client-side as the highest bid rising inside the same auction.
let lastAuctionBid = { id: null, bid: 0 };
function cueAuctionBid() {
  const auction = state.auction;
  if (!auction?.active) {
    lastAuctionBid = { id: null, bid: 0 };
    return;
  }
  if (lastAuctionBid.id === auction.id && auction.bid > lastAuctionBid.bid) playSound("bid");
  lastAuctionBid = { id: auction.id, bid: auction.bid };
}

function renderAll() {
  renderStep("Auction cue", cueAuctionBid);
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



// GAME LOGIC: turn intents and purchase emits live in clientGameActions.js.
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
  // A computer player's page is only open while the profile view is showing.
  if (name !== "profile") state.profileSubject = null;
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

// Home/rules click routing lives in clientHomeNavigation.js.

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
  $("#topnav-room-copy").addEventListener("click", copyRoomCode);
  $("#hud-cash-action")?.addEventListener("click", (event) => {
    if (event.currentTarget.disabled) return;
    openWalletModal("account", event.currentTarget);
  });
  $("#global-event-choices")?.addEventListener("click", onGlobalEventVoteClick);

  // lobby start round
  $("#lobby-start-btn").addEventListener("click", startGame);
  $("#turn-coach-close")?.addEventListener("click", dismissTurnCoach);
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

// Rail tab/deep-link bindings live in clientRailBindings.js.

function bindEvents() {
  bindHomeNavigation();
  bindRulesPage();

  bindParlorSurfaces({ emitServer, leaveRoomForHome, removeComputerPlayer, openComputerProfile });
  configureComputerProfile({ emit: emitServer, showProfile: showComputerProfile, notice: message => parlorNotice("COMPUTER", message, "error") });

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
configureGameActions({
  emitServer,
  emitWithChatError,
  createRequestId,
  announceActionStatus,
  captureActionStatusNode,
  reportChatError,
  renderHud,
  renderAll,
  serverSyncHost,
});
configureHomeNavigation({ showView, homeProfileEditTarget });
configureRailBindings({ refreshEconomySnapshot });
configurePlayerRail({ currentServerTime, lobbyTagHTML });
document.documentElement.style.setProperty('--dice-shake-cycle', `${DICE_SHAKE_CYCLE_MS}ms`);
// Dialogs rise over 200ms and fall away faster (see clientSurfaces.js MODAL_EXIT_MS); public/css/17-popups-rules-social-and-rankings.css owns the keyframes.
document.documentElement.style.setProperty('--modal-enter-duration', `${MODAL_ENTER_MS}ms`);
document.documentElement.style.setProperty('--modal-exit-duration', `${MODAL_EXIT_MS}ms`);
configureBoardSound(playSound);
configureHudSound(playSound);
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
  startRound,
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
  openRoomsModal,
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
  else if (window.location.pathname === "/rules") {
    // #rules-<chapter> deep links open that chapter; unknown hashes fall back to the first.
    const chapter = window.location.hash.startsWith("#rules-") ? window.location.hash.slice("#rules-".length) : "";
    openRulesSurface(chapter || "start-here");
  }
  else {
    showView("home");
    openCardPreviewFromUrl();
    openSurfaceFromUrl();
  }
}
