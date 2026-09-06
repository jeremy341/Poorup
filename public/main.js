/* ============================================================
   ENTRY MODULE: game logic, renderers, and event wiring.
   Shared data and state live in the client*.js modules imported here.
   ============================================================ */
import { $, esc, clamp, REDUCED_MOTION } from "./clientDom.js";
import {
  hydrateSprites,
  spriteHTML,
  spriteFromGrid,
  avatarHTML,
  emptyFaceGrid,
  faceGridFromPreset,
  cloneFaceGrid,
} from "./clientSprites.js";
import {
  GROUP_COLOR,
  RENT_TABLE,
  MAX_HOUSES,
  HOTEL_LEVEL,
  GROUP_TARGETS,
  TILES,
  TILE_COUNT,
  JAIL_TILE_INDEX,
  CHANCE_EVENTS,
  CHEST_EVENTS,
  mortgageValue,
  unmortgageCost,
} from "./clientBoardData.js";
import { ACHIEVEMENTS, achievementIconHTML } from "./clientAchievements.js";
import {
  APPEARANCES,
  MAX_PROFILES,
  profileDesignName,
  loadActiveDesignId,
  saveActiveDesignId,
  saveSoundPreference,
  saveMusicPreference,
  loadGuestAlias,
  saveGuestAlias,
} from "./clientSanitize.js";
import {
  state,
  activeAppearance,
  syncLocalAppearance,
  saveAccountSession,
  buildPlayers,
  getProfileById,
  getAppearanceMeta,
  upsertProfile,
  deleteProfile,
  saveUnlockedAchievements,
} from "./clientState.js";
import { applyServerState, AUCTION_MS } from "./clientStateSync.js";
import {
  SKYLINE,
  paintSkyline,
  tileIconHTML,
  buildBoard,
  renderBoardState,
  placePieces,
  startPieceWalk,
} from "./clientBoardRender.js";
import {
  renderHud,
  startTurnCountdown,
  configureTurnCountdown,
} from "./clientHudRender.js";
import {
  CONNECTION_COPY,
  renderConnectionStatus,
  renderTopNav,
} from "./clientTopNavRender.js";
import { serverTileFor, ownsFullGroup } from "./clientDeedRules.js";
import { cardFaceHTML } from "./clientCardsRender.js";
import { deedLadderHTML, deedCardHTML } from "./clientDeedsRender.js";
import { renderRightRail } from "./clientRailRender.js";
import { renderGlobalEvent } from "./clientGlobalEventRender.js";
import {
  configureSurfaces,
  setSurfaceReturnFocus,
  syncSurfaceA11y,
  openSurface,
  closeSurface,
  closeAllSurfaces,
  focusSurface,
  openConfirmModal,
} from "./clientSurfaces.js";
import {
  toggleLogDrawerFromButton,
  closeLogDrawer,
  applyLogDrawerFilter,
} from "./clientLogDrawer.js";
import { bindKeyboard } from "./clientKeyboard.js";
import {
  configureRailEvents,
  onRailClick,
  onRailSubmit,
} from "./clientRailEvents.js";
import {
  configureProfileRender,
  formatStatDate,
  renderProfileSummary,
  renderAccountPanel,
  renderProfileLibrary,
  renderProfileEditor,
  updateProfilePreview,
  paintFaceCell,
  applyProfileToHomeUI,
  renderGuestAliasField,
  requireGuestAlias,
} from "./clientProfileRender.js";
import {
  configureNightShift,
  nightShiftState,
  startNightShift,
  stopNightShift,
} from "./clientNightShift.js";
import {
  configureSocialSurfaces,
  announceSocialNotification,
  parlorNotice,
  socialPlayerRowHTML,
  openSocialSurface,
  renderSocialSurface,
  openInGameSocialSurface,
  openRankingsSurface,
  renderRankingsSurface,
  openRulesSurface,
  renderRulesSurface,
  openPlayerSurface,
  renderPlayerSurface,
} from "./clientSocialSurfaces.js";
import {
  configureAccountIdentity,
  renderAchievements,
  openAchievementModal,
  closeAchievementModal,
  setAchievementFilter,
  setAchievementDateFilter,
  setAchievementRarityFilter,
  unlockAchievement,
  updateAccountFromResponse,
  openAccountModal,
  closeAccountModal,
  logoutAccount,
} from "./clientAccountIdentity.js";
import {
  configurePopup,
  closePopup,
  onTileClick,
  popRow,
  accentOf,
  popIconHTML,
  kindLabel,
} from "./clientPopupUi.js";
import {
  configureTradeUi,
  openFinancingModal,
  closeFinancingModal,
  openTradeModal,
  closeTradeModal,
  renderTradeModal,
} from "./clientTradeUi.js";
import { bindParlorSurfaces } from "./clientParlorBindings.js";
import {
  renderPatrolHud,
  renderHomeLocalTime,
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
  startAuction,
  startAuctionTimer,
  stopAuctionTimer,
} from "./clientAuctionUi.js";
import { bindHomeEntry } from "./clientHomeEntryBindings.js";
/* ---- restrained arcade sfx (Web Audio, no assets) ------------------ */
let audioCtx = null;
function tone(freq, dur, vol = 0.035, when = 0) {
  if (!state.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
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




function setActiveAppearance(choice) {
  state.appearance = choice;
  state.tableAppearanceOverride = null;
  saveActiveDesignId(choice);
  syncLocalAppearance();
  applyProfileToHomeUI();
  renderAccountPanel();
  renderProfileLibrary();
}

function setTableAppearanceOverride(choice) {
  state.tableAppearanceOverride = choice === state.appearance ? null : choice;
  syncLocalAppearance();
  renderPlayers();
  renderSetup();
  renderLobbyRail();
  syncServerAppearance();
}

function clearTableAppearanceOverride() {
  state.tableAppearanceOverride = null;
  syncLocalAppearance();
  renderPlayers();
  renderSetup();
  renderLobbyRail();
  syncServerAppearance();
}

syncLocalAppearance();

/* ============================================================
   LIVE SOCKET.IO ADAPTER
   The ZIP remains the complete UI source; this small boundary maps its
   renderer state to the existing server-authoritative game protocol.
   ============================================================ */
const socket = typeof window.io === "function" ? window.io() : null;
const SERVER_SETTING_KEYS = {
  maxPlayers: "maxPlayers",
  startingCash: "startingCash",
  vacationPool: "vacationCash",
  auction: "auction",
  noRentInJail: "noRentWhileInPrison",
  trading: "trading",
  doubleGo: "doubleGo",
  houseLimit: "houseLimit",
  hotelLimit: "hotelLimit",
  turnTimer: "turnTimer",
  bankruptMode: "bankruptMode",
  bankLoans: "bankLoans",
  bankLoanSeverity: "bankLoanSeverity",
  globalEvents: "globalEvents",
  casino: "casino",
  market: "market",
  bots: "bots",
  botPersonality: "botPersonality",
};

function emitServer(event, payload = {}, callback) {
  if (!socket) {
    setConnectionStatus("offline", true);
    callback?.({ success: false, error: "Live connection unavailable." });
    return;
  }
  socket.emit(event, {
    ...payload,
    clientId: state.clientId,
    sessionToken: state.account?.sessionToken,
  }, callback);
}

function updateServerSetting(key, value) {
  state.settings[key] = value;
  const serverKey = SERVER_SETTING_KEYS[key];
  if (serverKey) emitServer("set-setting", { key: serverKey, value }, () => {});
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
  startTurnCountdown,
  gameViewVisible: () => !$("#view-game").classList.contains("is-hidden"),
  openAuctionSurface: () => {
    renderAuction();
    openSurface("#auction-modal", "#auction-pass");
    startAuctionTimer();
  },
  closeAuctionSurface: () => {
    stopAuctionTimer();
    closeSurface("#auction-modal");
  },
  retireButton: () => $("#game-retire-btn"),
  bankruptcyHidden: () => Boolean($("#bankruptcy-modal")?.classList.contains("is-hidden")),
  hideBankruptcyModal: () => $("#bankruptcy-modal")?.classList.add("is-hidden"),
  placePiecesSoon: () => requestAnimationFrame(() => placePieces()),
};

configureTurnCountdown({ endTurn });

if (socket) {
  socket.on("connect", () => {
    setConnectionStatus("online", true);
    if (state.account?.sessionToken) {
      socket.emit("account-restore", { sessionToken: state.account.sessionToken }, (response) => {
        if (response?.success) updateAccountFromResponse({ account: response.account, sessionToken: state.account.sessionToken });
        else {
          saveAccountSession(null);
          state.alias = state.profiles[0]?.name || "MARLOWE";
          renderAccountPanel();
          applyProfileToHomeUI();
        }
      });
    }
    emitServer("restore-session", {}, (response) => handleRestoreSessionResponse(response, false));
  });
  socket.on("connect_error", () => setConnectionStatus("offline", true));
  socket.on("update-state", (snapshot) => applyServerState(snapshot, serverSyncHost));
  socket.on("rooms-updated", (payload) => {
    roomsDirectory = Array.isArray(payload?.rooms) ? payload.rooms : roomsDirectory;
    if (!$("#rooms-modal").classList.contains("is-hidden")) renderRoomsList();
  });
  socket.on("social-update", (social) => {
    state.social = social || state.social;
    renderSocialSurface("#social-page-content");
    renderSocialSurface("#social-card");
  });
  socket.on("social-notification", (notification) => {
    const list = state.social.notifications || [];
    state.social.notifications = [notification, ...list.filter(item => item.id !== notification.id)].slice(0, 50);
    if (notification?.kind === "achievement-unlocked") return;
    announceSocialNotification(notification);
    renderSocialSurface("#social-page-content");
    renderSocialSurface("#social-card");
  });
  socket.on("mythical-achievement", (notification) => {
    announceSocialNotification(notification);
    state.social.notifications = [notification, ...(state.social.notifications || [])].slice(0, 50);
    renderSocialSurface("#social-page-content");
  });
  socket.on("achievement-unlocked", (notification) => {
    if (state.account?.account && notification?.achievementId) {
      const account = state.account.account;
      const existing = Array.isArray(account.achievements) ? account.achievements : [];
      if (!existing.some((entry) => entry.id === notification.achievementId)) {
        account.achievements = [{ id: notification.achievementId, unlockedAt: notification.createdAt || new Date().toISOString() }, ...existing].slice(0, 100);
        saveAccountSession(state.account);
      }
    }
    if (notification) {
      announceSocialNotification({ ...notification, title: notification.title || "ACHIEVEMENT UNLOCKED" });
      renderAchievements();
      renderAccountPanel();
    }
  });
  socket.on("account-sync", ({ account } = {}) => {
    if (!state.account?.sessionToken || !account) return;
    updateAccountFromResponse({ account, sessionToken: state.account.sessionToken });
  });
  socket.on("player-contract-offer", ({ contract }) => {
    state.playerContractOffer = contract || null;
    announceSocialNotification({ body: "A player contract is waiting in Finance." });
    renderRightRail();
  });
  socket.on("player-contract-update", ({ contract }) => {
    state.playerContractOffer = null;
    if (contract) {
      state.playerContracts = {
        ...(state.playerContracts || {}),
        active: [...(state.playerContracts?.active || []).filter(entry => entry.id !== contract.id), contract]
      };
    }
    renderRightRail();
  });
  socket.on("system-message", ({ text }) => { say(text); renderChat(); });
  socket.on("chat-message", ({ nickname, text, senderId }) => {
    // senderId is the authoritative server player id; nickname matching stays
    // only as a fallback (A4-F7: duplicate names cross-wire attribution).
    const sender = (senderId != null ? state.players.find((player) => player.serverId === senderId) : null)
      || state.players.find((player) => player.name === String(nickname).toUpperCase());
    say(text, sender || { name: nickname, textColor: "#a79d7d" });
    renderChat();
  });
  socket.on("purchase-offer", (offer) => {
    const serverTile = serverTileFor(offer?.tileIndex);
    const tile = { ...(TILES[Number(offer?.tileIndex) % TILE_COUNT] || TILES[0]), i: Number(offer?.tileIndex) };
    state.pendingBuyTile = tile.i;
    openChoiceModal({ ...tile, name: serverTile?.name || offer?.name || tile.name, price: serverTile?.price ?? offer?.price ?? tile.price });
  });
  socket.on("card-reveal", (reveal) => {
    const tile = TILES[Number(reveal?.tileIndex) % TILE_COUNT];
    if (tile && (tile.kind === "chance" || tile.kind === "chest")) {
      openCardReveal(tile, { text: reveal.text || "Card resolved.", action: reveal.action, cash: Number(reveal.cash) || 0 });
    }
  });
  socket.on("trade-offer", ({ trade }) => {
    if (!trade) return;
    const normalized = {
      ...trade,
      from: trade.from || trade.fromPlayerId,
      to: trade.to || trade.toPlayerId,
      giveDeeds: trade.giveDeeds || trade.givePropertyIndexes || [],
      wantDeeds: trade.wantDeeds || trade.requestPropertyIndexes || [],
      giveCash: Number(trade.giveCash) || 0,
      wantCash: Number(trade.wantCash ?? trade.requestCash) || 0,
    };
    state.offers.push(normalized);
    renderAll();
    openOfferModal(normalized);
  });
  socket.on("disconnect", () => setConnectionStatus("reconnecting", true));
}

const CHAT_ERRORISH = /(?:error|could not|cannot|can't|unable|failed|insufficient|not found|not your turn|must |need \$)/i;
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
  if (!CHAT_ERRORISH.test(String(text))) return;
  const errorAnnouncer = $("#error-announcer");
  if (errorAnnouncer) errorAnnouncer.textContent = String(text);
}
function say(text, who) {
  const message = chatMessage(text, who);
  const previous = state.messages[state.messages.length - 1];
  if (isDuplicateSystem(message, previous)) return;
  state.messages.push(message);
  if (state.messages.length > 80) state.messages.splice(0, state.messages.length - 80);
  if (!message.system) return;
  announceSystemLine(text);
}

function setConnectionStatus(status, announce = false) {
  if (state.connectionStatus === status) {
    renderConnectionStatus();
    return;
  }
  state.connectionStatus = status;
  renderConnectionStatus();
  if (announce) {
    const copy = CONNECTION_COPY[status] || CONNECTION_COPY.offline;
    const message = status === "online" ? "Live table connection restored." : `Table connection ${copy.toLowerCase()}.`;
    if (state.lastConnectionAnnouncement !== message) {
      state.lastConnectionAnnouncement = message;
      say(message);
      renderChat();
    }
  }
}

/* ============================================================
   OPTIONAL ACCOUNT / PROFILE IDENTITY
   Guest play stays local; an account only adds durable identity and stats.
   ============================================================ */

function createRequestId(kind) {
  return String(state.clientId || "client") + ":" + String(kind || "action") + ":" + Date.now() + ":" + Math.random().toString(36).slice(2, 8);
}

function setHomeTab(tab = "play") {
  const next = ["play", "rooms", "profile"].includes(tab) ? tab : "play";
  state.homeTab = next;
  document.querySelectorAll("[data-global-nav] [data-home-tab]").forEach((button) => {
    const active = button.dataset.homeTab === next;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

/** Keep the non-game app shell on one navigation contract. The game view has
 * its own turn-aware topnav, so it intentionally does not participate here. */
function syncGlobalNavigation(surface = "home") {
  const activeHomeTab = surface === "home" ? state.homeTab : surface;
  document.querySelectorAll("[data-global-nav]").forEach((nav) => {
    nav.querySelectorAll("[data-home-tab], [data-top-surface]").forEach((button) => {
      const active = button.dataset.homeTab
        ? surface !== "rankings" && surface !== "social" && button.dataset.homeTab === activeHomeTab
        : button.dataset.topSurface === surface;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  });
}

function setProfileTab(tab = "designs", focus = false) {
  const allowed = ["overview", "stats", "designs", "history", "achievements", "account"];
  const next = allowed.includes(tab) ? tab : "designs";
  state.profileTab = next;
  const root = $("#view-profile");
  if (root) root.dataset.profileTab = next;
  document.querySelectorAll("#profile-tabs [data-profile-tab]").forEach((button) => {
    const active = button.dataset.profileTab === next;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("#view-profile .profile-tab-panel").forEach((panel) => {
    panel.classList.toggle("is-hidden", panel.id !== `profile-panel-${next}`);
  });
  renderProfileSummary();
  if (focus) {
    const panel = $(`#profile-panel-${next}`);
    panel?.focus({ preventScroll: true });
  }
}


function record(text) {
  state.log.unshift(text);
  if (state.log.length > 40) state.log.length = 40;
}

/* ============================================================
   5. HOME SCREEN
   ============================================================ */

function refreshEconomySnapshot() {
  emitServer("get-economy-snapshot", {}, (response) => {
    if (!response?.success || !response.economy) return;
    state.economy = {
      ...state.economy,
      ...response.economy,
      casino: { ...state.economy.casino, ...(response.economy.casino || {}) },
      market: { ...state.economy.market, ...(response.economy.market || {}) }
    };
    renderRightRail();
  });
}



function syncHomeMusic() {
  const music = $("#home-music");
  if (!music) return;
  music.volume = 0.16;
  // The sound preference is global. Keep the same soundtrack running while
  // the player moves from Home into setup, lobby, or the live table.
  if (state.music) {
    const playAttempt = music.play();
    playAttempt?.catch(() => { /* autoplay policy; the next user gesture retries */ });
  } else {
    music.pause();
  }
}

let roomsDirectory = [];
let roomsLoading = false;
let roomsDirectoryTimeout = null;
let roomsFilter = "all";
let roomModalTab = "browse"; // "browse" | "create" | "join"
let createRoomSettings = {
  name: "",
  visibility: "public", // "public" | "private"
  code: "",
};

function roomStateColor(stateName) {
  if (stateName === "live") return "#35a653";
  if (stateName === "full") return "#d9a62f";
  return "#3a382a";
}

function filteredRooms() {
  if (roomsFilter === "open") return roomsDirectory.filter((r) => r.seats < r.cap);
  if (roomsFilter === "live") return roomsDirectory.filter((r) => r.state === "live");
  return roomsDirectory;
}

function roomRowHTML(r) {
  const full = r.seats >= r.cap;
  const open = r.cap - r.seats;
  const isPrivate = r.visibility === "private";
  const visLabel = isPrivate ? "PRIVATE" : "PUBLIC · DIRECT JOIN";
  return `<div class="room-row">
    <div class="room-main">
      <div class="room-top">
        ${isPrivate ? `<span class="t-label f12 room-code">${r.code}</span>` : `<span class="t-label f12 room-code room-code-public">OPEN TABLE</span>`}
        <span class="t-label f13 room-name">${r.name}</span>
        <span class="t-micro g400" style="margin-left:4px">${visLabel}</span>
        <span class="room-meta-item room-state-tag"><span class="st-dot" style="background:${roomStateColor(r.state)}"></span><span class="t-micro ink-3">${r.state}</span></span>
      </div>
      <div class="room-meta">
        <span class="t-micro ink-3 room-meta-item">SEATS ${r.seats}/${r.cap}</span>
        <span class="t-micro ink-3 room-meta-item">OPEN ${open}</span>
        <span class="t-micro ink-3 room-meta-item">BANK ${r.bank}</span>
        <span class="t-micro g-muted room-meta-item">${r.note}</span>
      </div>
    </div>
    <div class="room-actions">
      <button class="btn-dark" data-join="${r.code}" ${full ? "disabled" : ""}>
        <span class="t-label f11">${full ? "FULL" : "JOIN"}</span>
      </button>
      ${isPrivate ? `<button class="btn-dark" data-copy="${r.code}" title="Copy code"><span class="t-label f11">COPY</span></button>` : ""}
    </div>
  </div>`;
}

function renderRoomsList() {
  const list = $("#rooms-list");
  if (!list) return;
  const rooms = filteredRooms();
  list.innerHTML = roomsLoading
    ? `<div class="rooms-empty t-body">CHECKING PUBLIC TABLES…</div>`
    : rooms.length
    ? rooms.map(roomRowHTML).join("")
    : `<div class="rooms-empty t-body">NO PUBLIC TABLES RIGHT NOW. HOST ONE OR ENTER A CODE.</div>`;

  document.querySelectorAll(".rooms-filter").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.filter === roomsFilter);
  });

}

function updateCreateRoomUI() {
  const isPrivate = createRoomSettings.visibility === "private";
  const codeField = $("#rc-private-code-field");
  const codeInput = $("#rc-room-code");
  const codeStatus = $("#rc-code-status");
  const createButton = $("#rc-create-btn");
  if (codeField) codeField.classList.toggle("is-hidden", !isPrivate);
  if (codeInput && codeInput.value !== createRoomSettings.code) codeInput.value = createRoomSettings.code;
  const codeValid = /^[A-Z0-9]{6}$/.test(createRoomSettings.code);
  if (codeStatus) {
    codeStatus.textContent = !isPrivate ? "NOT NEEDED FOR PUBLIC TABLES" : codeValid ? "READY" : `${createRoomSettings.code.length}/6 CHARACTERS`;
    codeStatus.classList.toggle("is-valid", isPrivate && codeValid);
    codeStatus.classList.toggle("is-invalid", isPrivate && !codeValid);
  }
  if (codeInput) codeInput.setAttribute("aria-invalid", String(isPrivate && !codeValid));
  if (createButton) createButton.disabled = isPrivate && !codeValid;

  document.querySelectorAll("#rc-vis-selector .rc-vis-opt").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.vis === createRoomSettings.visibility);
  });
}

function switchRoomModalTab(tab) {
  roomModalTab = tab;
  const isBrowse = tab === "browse";
  const isCreate = tab === "create";
  const isJoin = tab === "join";

  const btnBrowse = $("#rm-tab-browse");
  const btnCreate = $("#rm-tab-create");
  const btnJoin = $("#rm-tab-join");
  if (btnBrowse) {
    btnBrowse.classList.toggle("is-active", isBrowse);
    btnBrowse.setAttribute("aria-selected", String(isBrowse));
  }
  if (btnCreate) {
    btnCreate.classList.toggle("is-active", isCreate);
    btnCreate.setAttribute("aria-selected", String(isCreate));
  }
  if (btnJoin) {
    btnJoin.classList.toggle("is-active", isJoin);
    btnJoin.setAttribute("aria-selected", String(isJoin));
  }

  const panelBrowse = $("#rm-panel-browse");
  const panelCreate = $("#rm-panel-create");
  const panelJoin = $("#rm-panel-join");
  if (panelBrowse) panelBrowse.classList.toggle("is-hidden", !isBrowse);
  if (panelCreate) panelCreate.classList.toggle("is-hidden", !isCreate);
  if (panelJoin) panelJoin.classList.toggle("is-hidden", !isJoin);

  const titleText = $("#rooms-title-text");
  if (titleText) titleText.textContent = isBrowse ? "Available Rooms" : isJoin ? "Join Room" : "Create Custom Room";
  $("#rooms-modal")?.setAttribute("aria-describedby", isJoin ? "join-room-description" : "rooms-description");

  if (isBrowse) {
    renderRoomsList();
  } else if (isCreate) {
    updateCreateRoomUI();
  } else if (isJoin) {
    const code = $("#room-join");
    const nickname = $("#join-nickname");
    const nicknameField = $("#join-nickname-field");
    const signedIn = Boolean(state.account?.account);
    const description = $("#join-room-description");
    if (code) code.value = String(code.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (nickname) {
      nickname.value = signedIn ? state.account.account.displayName : (nickname.value || state.alias || "");
      nickname.required = !signedIn;
      nickname.disabled = signedIn;
    }
    nicknameField?.classList.toggle("is-hidden", signedIn);
    if (description) description.textContent = signedIn
      ? "Enter the room code. Your account display name will be used at the table."
      : "Enter the room code and the name you want to use at the table.";
    $("#join-form-error")?.replaceChildren();
  }
}

function requestRoomsDirectory() {
  roomsLoading = true;
  renderRoomsList();
  clearTimeout(roomsDirectoryTimeout);
  roomsDirectoryTimeout = setTimeout(() => {
    roomsDirectoryTimeout = null;
    if (!roomsLoading) return;
    roomsLoading = false;
    renderRoomsList();
    parlorNotice("BROWSE", "Public tables could not be loaded — try again.");
  }, 5000);
  emitServer("list-rooms", {}, (response) => {
    clearTimeout(roomsDirectoryTimeout);
    roomsDirectoryTimeout = null;
    roomsLoading = false;
    if (response?.success === false) {
      roomsDirectory = [];
      parlorNotice("BROWSE", response.error || "Public tables could not be loaded.");
      say(response.error || "Public tables could not be loaded.");
      renderChat();
    } else {
      roomsDirectory = Array.isArray(response?.rooms) ? response.rooms : [];
    }
    renderRoomsList();
  });
}

function openRoomsModal(tab = "browse") {
  roomsFilter = "all";
  switchRoomModalTab(tab);
  openSurface("#rooms-modal", tab === "join" ? "#room-join" : "#rooms-close");
  if (tab === "browse") requestRoomsDirectory();
}

function closeRoomsModal() {
  closeSurface("#rooms-modal");
  if (state.phase === "home") setHomeTab("play");
}

function renderHome() {
  setHomeTab("play");
  renderHomeLocalTime();
  renderPatrolHud();
  paintSkyline($("#home-skyline"), SKYLINE);
  paintSkyline($("#home-skyline-copy"), SKYLINE);

  // mini board
  const grid = $("#mini-grid");
  if (grid && !grid.dataset.built) {
    const groups = ["#7b5029", "#3e7d7b", "#a04e6f", "#87231e", "#4b853d", "#286ea1"];
    let cells = "";
    for (let i = 0; i < 64; i++) {
      const x = i % 8;
      const y = Math.floor(i / 8);
      const edge = x === 0 || y === 0 || x === 7 || y === 7;
      if (!edge) { cells += "<span></span>"; continue; }
      const corner = (x === 0 || x === 7) && (y === 0 || y === 7);
      cells += `<span class="mini-cell${corner ? " is-corner" : ""}">${
        corner ? spriteHTML("diamond", 2) : `<span class="strip" style="background:${groups[(x + y) % groups.length]}"></span>`
      }</span>`;
    }
    grid.insertAdjacentHTML("afterbegin", cells);
    grid.dataset.built = "1";
  }

  renderRoomsList();
  renderAccountPanel();
  applyProfileToHomeUI();
  renderConnectionStatus();
  hydrateSprites();
}

/* ============================================================
   6. GAME RENDERERS
   ============================================================ */
async function copyRoomCode() {
  if (state.roomVisibility === "public") return;
  const code = String(state.roomCode || "").trim().toUpperCase();
  if (!code) return;
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
      copied = true;
    }
  } catch { /* fall through to the legacy local fallback */ }
  if (!copied) {
    const helper = document.createElement("textarea");
    helper.value = code;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    try { copied = document.execCommand("copy"); } catch { copied = false; }
    helper.remove();
  }
  const badge = $("#tn-room-copy");
  const announcer = $("#system-announcer");
  if (copied) {
    if (announcer) announcer.textContent = `ROOM CODE ${code} COPIED`;
    badge?.classList.add("is-copied");
    window.setTimeout(() => badge?.classList.remove("is-copied"), 1000);
  } else if (announcer) {
    announcer.textContent = "ROOM CODE COULD NOT BE COPIED";
  }
}

function renderPlayers() {
  const seated = state.players.slice(0, state.settings.maxPlayers);
  const existingBots = seated.filter((p) => p.bot).length;
  const previewBots = state.phase === "setup" || state.phase === "lobby"
    ? buildBotPreviewPlayers(Math.max(0, state.settings.bots - existingBots))
    : [];
  const players = [...seated, ...previewBots].slice(0, state.settings.maxPlayers);
  $("#player-list").innerHTML = players
    .map((p, i) => {
      const active = i === state.turnIndex && state.phase === "playing";
      const playerId = p.serverId || p.id;
      return `<button class="player-row player-row-action${active ? " is-active" : ""}" type="button" data-player-id="${esc(playerId)}" aria-label="Open player card for ${esc(p.name)}">
        ${active ? `<span class="pr-arrow">${spriteHTML("arrow", 3)}</span>` : ""}
        <div class="pr-av">${avatarHTML(p, 4, i)}</div>
        <div class="pr-mid">
          <div class="pr-nameline">
            ${active ? spriteHTML("crown", 2) : ""}
            <span class="t-label pr-name" style="color:${p.textColor}">${esc(p.name)}</span>
          </div>
          <div class="t-label pr-cash">$${p.cash.toLocaleString()}</div>
        </div>
        <div class="pr-right">
          <span class="pr-dot" style="background:${p.online ? "#35a653" : "#3a382a"};box-shadow:${p.online ? "0 0 5px rgb(53 166 83 / 60%)" : "none"}"></span>
          <span class="t-micro ink-3">${p.online ? (p.id === "p1" ? "YOU" : p.bot ? `CPU · ${(p.personality || "survivor").toUpperCase()}` : "ONLINE") : "AFK"}</span>
        </div>
      </button>`;
    })
    .join("");
}

function renderChat() {
  const body = $("#chat-body");
  body.innerHTML = state.messages
    .slice(-60)
    .map((m) =>
      m.system
        ? `<p class="t-body chat-line"><span class="ink-3">» </span><span class="g-muted">${esc(m.text)}</span></p>`
        : `<p class="t-body chat-line"><span style="color:${m.color}">${esc(m.who)}:</span> <span class="ink-2">${esc(m.text)}</span></p>`,
    )
    .join("");
  body.scrollTop = body.scrollHeight;

  const joined = (state.phase !== "home" && state.players.length > 0);
  $("#chat-input").disabled = !joined;
  $("#chat-send").disabled = !joined;
  $("#chat-input").placeholder = joined ? "Say something…" : "Join the room to chat…";
}

function buildNextHouse(tile) {
  emitServer("manage-property", { tileIndex: tile.i, action: "build-house" }, () => {});
    return;
}

function houseCount() {
  return Object.values(state.houses).reduce((sum, level) => {
    const n = Number(level) || 0;
    return sum + (n === HOTEL_LEVEL ? 0 : Math.min(n, MAX_HOUSES));
  }, 0);
}

function hotelCount() {
  return Object.values(state.houses).filter((level) => Number(level) === HOTEL_LEVEL).length;
}

function sellHouse(tile) {
  emitServer("manage-property", { tileIndex: tile.i, action: "sell-house" }, () => {});
    return;
}

/** Mirror of canBuildEvenly for selling: no deed may fall 2+ below another. */
function canSellEvenly(tile, targetLevel) {
  if (!tile.group) return true;
  for (const t of TILES) {
    if (t.group !== tile.group || t.i === tile.i) continue;
    const lvl = state.houses[t.i] || 0;
    if (lvl > targetLevel + 1) return false;
  }
  return true;
}

/* ============================================================
   8c. DEED DETAIL / HOUSE MANAGER
   ============================================================ */
function openDeedDetail(tileIdx) {
  state.deedDetail = tileIdx;
  renderDeedDetail();
  openSurface("#deed-modal", "#dd-close");
}

function closeDeedDetail() {
  state.deedDetail = null;
  closeSurface("#deed-modal");
}

/* ============================================================
   CHANCE / CHEST CARD REVEAL
   ============================================================ */
function openCardReveal(tile, ev) {
  $("#card-reveal").innerHTML = cardFaceHTML(tile, ev, { buttonId: "cr-ok" });
  openSurface("#card-modal", "#cr-ok");
  $("#cr-ok").addEventListener("click", () => {
    state.card = null;
    closeSurface("#card-modal");
  });
}

function closeCardGallery() {
  const gallery = $("#card-gallery");
  if (!gallery) return;
  gallery.classList.add("is-hidden");
  gallery.setAttribute("aria-hidden", "true");
  syncSurfaceA11y();
}

function openCardGallery() {
  const gallery = $("#card-gallery");
  const grid = $("#card-gallery-grid");
  if (!gallery || !grid) return;
  const cards = [
    ...CHANCE_EVENTS.map((event) => ({ tile: TILES.find((entry) => entry.kind === "chance"), event, kind: "chance" })),
    ...CHEST_EVENTS.map((event) => ({ tile: TILES.find((entry) => entry.kind === "chest"), event, kind: "chest" })),
  ];
  grid.innerHTML = cards.map(({ tile, event }, index) => cardFaceHTML(tile, event, { index, total: cards.length })).join("");
  gallery.classList.remove("is-hidden");
  gallery.setAttribute("aria-hidden", "false");
  syncSurfaceA11y();
  requestAnimationFrame(() => $("#card-gallery-close")?.focus({ preventScroll: true }));
}

function renderDeedDetail() {
  if (state.deedDetail == null) return;
  const tile = TILES[state.deedDetail];
  const me = state.players[0];
  const mine = state.owners[tile.i] === "p1";
  const isProperty = tile.kind === "property";
  const level = state.houses[tile.i] || 0;
  const isMortgaged = !!state.mortgaged[tile.i];
  const table = isProperty ? RENT_TABLE[tile.group] : null;
  const hasSet = isProperty && ownsFullGroup("p1", tile.group);
  const nextLevel = level + 1;

  // ---- build gating -------------------------------------------------
  let buildBlock = "";
  if (isProperty && mine) {
    const atCapHouses = nextLevel < HOTEL_LEVEL && houseCount() >= state.settings.houseLimit;
    const atCapHotels = nextLevel === HOTEL_LEVEL && hotelCount() >= state.settings.hotelLimit;
    const canAfford = me.cash >= table.housePrice;
    const evenOk = canBuildEvenly(tile, nextLevel);
    const maxed = level >= HOTEL_LEVEL;

    let reason = "";
    if (isMortgaged) reason = "Unmortgage this deed before building on it.";
    else if (!hasSet) reason = `You need every ${tile.group.toUpperCase()} deed to build here.`;
    else if (maxed) reason = "Fully developed — hotel already built.";
    else if (!evenOk) reason = "Build evenly: raise the lower deeds in this set first.";
    else if (atCapHouses) reason = "The bank is out of houses.";
    else if (atCapHotels) reason = "The bank is out of hotels.";
    else if (!canAfford) reason = `You need $${table.housePrice} to build here.`;

    const canBuild = !reason;
    const canSell = level > 0 && canSellEvenly(tile, level - 1);
    const buyLabel = nextLevel === HOTEL_LEVEL ? "BUY HOTEL" : "BUY HOUSE";
    const sellLabel = level === HOTEL_LEVEL ? "SELL HOTEL" : "SELL HOUSE";

    buildBlock = `
      <div class="dd-build">
        <div class="dd-build-actions">
          <button class="cta-red dd-build-btn" id="dd-buy" ${canBuild ? "" : "disabled"}>
            <span class="t-label">${buyLabel}</span>
            <span class="t-micro">$${table.housePrice}</span>
          </button>
          <button class="btn-dark dd-build-btn dd-sell-btn" id="dd-sell" ${canSell ? "" : "disabled"}>
            <span class="t-label">${sellLabel}</span>
            <span class="t-micro">+$${Math.floor(table.housePrice / 2)}</span>
          </button>
        </div>
        ${reason ? `<p class="dd-build-msg" style="margin-top:10px">${esc(reason)}</p>` : ""}
      </div>`;
  } else if (mine) {
    buildBlock = `<div class="dd-build"><p class="dd-build-msg">${tile.kind === "railroad" ? "Railroad rent scales with how many railroads you hold." : "Utility rent scales with how many utilities you hold."}</p></div>`;
  }

  const mortgageBtn = mine
    ? `<button class="btn-dark dd-close" id="dd-mortgage">
        <span class="t-label f11">${isMortgaged ? `UNMORTGAGE $${unmortgageCost(tile)}` : `MORTGAGE +$${mortgageValue(tile)}`}</span>
      </button>`
    : "";

  $("#deed-card-detail").innerHTML = `
    <div class="dd-rail" style="background:${accentOf(tile)}"></div>
    <div class="dd-body">
      <div class="dd-head">
        <div class="dd-icon">${popIconHTML(tile)}</div>
        <div class="pop-headtext">
          <div class="t-micro g400">${kindLabel(tile)}${isMortgaged ? " · MORTGAGED" : ""}</div>
          <h3 class="t-section dd-title" id="deed-card-title">${tile.name}</h3>
        </div>
        <button class="btn-dark dd-close" id="dd-close"><span class="t-label f11">CLOSE</span></button>
      </div>

      <div class="dd-stats">
        ${popRow("PRICE", `$${tile.price}`, "g300")}
        ${popRow("YOUR CASH", `$${me.cash.toLocaleString()}`, "green")}
        ${isProperty ? popRow("COLOR SET", tile.group.toUpperCase(), hasSet ? "green" : "g-muted") : ""}
        ${isProperty ? popRow("HOUSE COST", `$${table.housePrice}`, "g300") : ""}
      </div>

      <div class="dd-ladder">${deedLadderHTML(tile)}</div>

      ${isProperty ? `<div class="supply-strip">
        <div class="supply-cell"><span class="t-micro ink-3">HOUSES</span><span class="t-label f12 g100">${Math.max(0, state.settings.houseLimit - houseCount())}/${state.settings.houseLimit}</span></div>
        <div class="supply-cell"><span class="t-micro ink-3">HOTELS</span><span class="t-label f12 g100">${Math.max(0, state.settings.hotelLimit - hotelCount())}/${state.settings.hotelLimit}</span></div>
      </div>` : ""}

      ${buildBlock}

      <div class="dd-foot">
        <span class="t-micro ink-3">ESC OR CLICK OUTSIDE TO CLOSE</span>
        ${mortgageBtn}
      </div>
    </div>`;

  // these all funnel through renderAll(), which re-renders this modal in place
  $("#dd-close").addEventListener("click", closeDeedDetail);
  $("#dd-buy")?.addEventListener("click", () => buildNextHouse(tile));
  $("#dd-sell")?.addEventListener("click", () => sellHouse(tile));
  $("#dd-mortgage")?.addEventListener("click", () => {
    if (state.mortgaged[tile.i]) unmortgageTile(tile.i);
    else mortgageTile(tile.i);
  });
}

/** Monopoly rule: you can only add a house to a property if doing so keeps
 *  the +1 step in step with every other deed in the group. */
function canBuildEvenly(tile, targetLevel) {
  if (!tile.group) return true;
  for (const t of TILES) {
    if (t.group !== tile.group) continue;
    if (t.i === tile.i) continue;
    const lvl = state.houses[t.i] || 0;
    if (lvl + 1 < targetLevel) return false;
  }
  return true;
}

function renderSetup() {
  const wrap = $("#setup-wrap");
  wrap.classList.toggle("is-hidden", state.phase !== "setup");
  if (state.phase !== "setup") return;

  // Server is authoritative for identity: if the table auto-assigned a
  // different colour than the local design, the picker must show the seat
  // colour as the active row, not the (rejected) design choice.
  const seat = state.players.find((p) => p.clientId === state.clientId);
  const seatColor = String(seat?.color || "").toLowerCase();
  const seatPreset = APPEARANCES.findIndex((a) => String(a.color).toLowerCase() === seatColor);
  const choice = seatPreset >= 0 ? seatPreset : activeAppearance();
  const meta = getAppearanceMeta(choice);
  const takenColors = new Set(
    state.players
      .filter((p) => p.clientId !== state.clientId && p.online !== false && !p.bankrupt)
      .map((p) => String(p.color || "").toLowerCase()),
  );
  const selectedProfile = typeof choice === "string" ? getProfileById(choice) : null;
  const selectedName = selectedProfile ? profileDesignName(selectedProfile) : meta.label;
  const sourceLabel = state.tableAppearanceOverride == null ? "ACTIVE DESIGN" : "THIS TABLE ONLY";
  const activeProfile = typeof state.appearance === "string" ? getProfileById(state.appearance) : null;
  const activeName = activeProfile ? profileDesignName(activeProfile) : getAppearanceMeta(state.appearance).label;
  const activeIsDifferent = state.tableAppearanceOverride != null && state.tableAppearanceOverride !== state.appearance;

  // The active design is the default. The chooser is deliberately opt-in so
  // joining a table never asks the player to make the same identity decision twice.
  const activeCard = $("#su-active-card");
  if (activeCard) {
    activeCard.innerHTML = `<div class="su-active-avatar">${avatarHTML({ color: meta.color, avatarGrid: meta.avatarGrid }, 4, 0)}</div><div class="su-active-copy"><span class="t-micro ${activeIsDifferent ? "g400" : "green"}">${sourceLabel}</span><strong class="t-label f14 su-active-name" style="color:${meta.textColor}">${esc(selectedName)}</strong><span class="t-micro ink-3">${activeIsDifferent ? `ACTIVE DESIGN · ${esc(activeName)}` : "READY TO ENTER THE PARLOR"}</span></div>`;
  }
  $("#su-active-actions")?.classList.toggle("is-hidden", !activeIsDifferent);
  $("#su-reset-btn")?.classList.toggle("is-hidden", !activeIsDifferent);
  $("#su-make-active-btn")?.classList.toggle("is-hidden", !activeIsDifferent);
  $("#su-chooser")?.classList.remove("is-hidden");

  document.querySelectorAll(".su-tab").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.suTab === state.setupTab);
    btn.setAttribute("aria-selected", String(btn.dataset.suTab === state.setupTab));
  });
  $("#su-custom-count").textContent = `${state.profiles.length}/${MAX_PROFILES}`;
  $("#su-grid")?.setAttribute("aria-labelledby", `su-tab-${state.setupTab}`);

  if (state.setupTab === "custom") {
    $("#su-grid").innerHTML = state.profiles.length
      ? state.profiles
          .map((p, i) => {
            const active = choice === p.id;
            const status = active ? (activeIsDifferent ? "THIS TABLE" : "ACTIVE DESIGN") : p.id === state.appearance ? "ACTIVE DESIGN" : "AVAILABLE";
            return `<button type="button" class="su-opt su-opt-profile${active ? " is-active" : ""}" data-app="${p.id}">
              <div class="su-av">${avatarHTML(p, 5, i)}</div>
              <div>
              <div class="t-label f13" style="color:${p.color}">${esc(profileDesignName(p))}</div>
                <div class="t-micro ink-3 su-state">${status}</div>
              </div>
            </button>`;
          })
          .join("")
      : `<p class="su-empty-custom">No custom designs yet. Create one from the home screen, then pick it here.</p>`;
  } else {
    $("#su-grid").innerHTML = APPEARANCES.map((a, i) => {
      const active = choice === i;
      const taken = !active && takenColors.has(String(a.color).toLowerCase());
      const status = active
        ? (activeIsDifferent ? "THIS TABLE" : "ACTIVE DESIGN")
        : taken
          ? "TAKEN"
          : state.appearance === i ? "ACTIVE DESIGN" : "AVAILABLE";
      return `<button type="button" class="su-opt${active ? " is-active" : ""}${taken ? " is-taken" : ""}" data-app="${i}"${taken ? " disabled aria-disabled=\"true\" title=\"This colour is taken at the table\"" : ""}>
      <div class="su-av">${avatarHTML(a, 5, i)}</div>
      <div>
        <div class="t-label f13" style="color:${taken ? "var(--text-muted)" : a.textColor}">${a.label}</div>
        <div class="t-micro ink-3 su-state">${status}</div>
      </div>
    </button>`;
    }).join("");
  }
}

function renderAll() {
  renderTopNav();
  renderPlayers();
  renderChat();
  renderBoardState();
  placePieces();
  renderGlobalEvent();
  renderHud();
  renderRightRail();
  renderSetup();
  renderLobbyRail();
  if (state.deedDetail != null) renderDeedDetail();
  if (state.phase === "playing") saveGame();
  syncSurfaceA11y();
}

/* ============================================================
   6b. LOBBY SETTINGS RENDERER
   ============================================================ */

function tog(id, value) {
  const label = id.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  return `<button class="tog${value ? " is-on" : ""}" data-setting="${id}" aria-label="${label}" aria-pressed="${value}" title="${label}"></button>`;
}

function stepper(id, value, min, max) {
  return `<div class="stepper">
    <button class="stepper-btn" data-step="${id}" data-dir="-1" ${value <= min ? "disabled" : ""}>−</button>
    <div class="stepper-val">${value}</div>
    <button class="stepper-btn" data-step="${id}" data-dir="1" ${value >= max ? "disabled" : ""}>+</button>
  </div>`;
}

function sel(id, value, options) {
  return `<select class="setting-select" data-setting="${id}">
    ${options.map(([v, l]) => `<option value="${v}" ${String(v) === String(value) ? "selected" : ""}>${l}</option>`).join("")}
  </select>`;
}

function settingRow(label, desc, control) {
  return `<div class="setting-row">
    <div class="setting-label">
      <span class="t-label f12 g100">${label}</span>
      <span class="setting-desc">${desc}</span>
    </div>
    ${control}
  </div>`;
}

function settingRowNum(label, desc, control) {
  return `<div class="setting-row-num">
    <div class="setting-label">
      <span class="t-label f12 g100">${label}</span>
      <span class="setting-desc">${desc}</span>
    </div>
    ${control}
  </div>`;
}

function lobbySection(title, rows) {
  return `<div class="lobby-section">
    <div class="lobby-section-head">
      <span class="t-label">${title}</span>
    </div>
    ${rows.join("")}
  </div>`;
}

function lobbyPlayerRowHTML(p, seed) {
  const isYou = p.id === "p1" || p.id === "preview";
  // deterministic per-player "ready" flag instead of Math.random(), so the
  // dot doesn't flicker on every unrelated re-render (typing, toggling, etc.)
  const ready = isYou || !!p.online;
  return `<div class="lobby-player-row${isYou ? " lobby-player-you" : ""}">
    <div class="lobby-av">${avatarHTML(p, 3, seed)}</div>
    <div class="lobby-player-info">
      <div class="t-label lobby-player-name" style="color:${p.textColor}">${esc(p.name)}</div>
      <div class="lobby-player-sub">${isYou ? "you" : p.bot ? `cpu · ${(p.personality || "survivor").toUpperCase()}` : "player"} · $${p.cash.toLocaleString()}</div>
    </div>
    <span class="lobby-ready-dot" style="background:${ready ? "#35a653" : "#3a382a"};box-shadow:${ready ? "0 0 5px rgb(53 166 83/60%)" : "none"}"></span>
  </div>`;
}

function renderLobbyRail() {
  // the settings rail owns the right column for both "setup" (choosing
  // appearance) and "lobby" (configuring rules) — the in-game Holdings
  // rail should only ever appear once a round is actually live.
  const preGame = state.phase === "setup" || state.phase === "lobby";
  const locked = state.phase === "setup";
  $("#right-rail-game").classList.toggle("is-hidden", preGame);
  $("#right-rail-lobby").classList.toggle("is-hidden", !preGame);
  if (!preGame) return;

  const s = state.settings;
  const seated = locked ? [buildPreviewSelf()] : state.players.slice(0, s.maxPlayers);
  const existingBots = seated.filter((p) => p.bot).length;
  const botPreviews = buildBotPreviewPlayers(Math.max(0, s.bots - existingBots));
  const previewPlayers = [...seated, ...botPreviews].slice(0, s.maxPlayers);

  $("#lobby-settings-body").innerHTML = [
    locked
      ? `<div class="settings-rule lobby-lock-note">
          <strong style="color:var(--gold-300)">FINISH SETUP TO CONTINUE</strong><br>
          Your active design is ready. Press "Enter Parlor" on the left to seat the table, or change it there for this table only.
        </div>`
      : "",
    lobbySection("Players At Table", previewPlayers.map((p, i) => lobbyPlayerRowHTML(p, i))),
    lobbySection("Table Rules", [
      settingRowNum("Max Players", "Seats at the table.", stepper("maxPlayers", s.maxPlayers, 2, 4)),
      settingRowNum("Bots", "Reserve CPU seats for Solo Dev Mode.", stepper("bots", s.bots, 0, Math.max(0, s.maxPlayers - 1))),
      settingRow("Bot Personality", "Choose the table instinct used by every CPU seat.", sel("botPersonality", s.botPersonality, [["survivor","SURVIVOR"],["builder","BUILDER"],["shark","SHARK"],["speculator","SPECULATOR"],["diplomat","DIPLOMAT"],["chaos","CHAOS"]])),
      settingRowNum("Starting Cash", "Bank hands this to each player at start.", sel("startingCash", s.startingCash, [["500","$500"],["1000","$1,000"],["1500","$1,500"],["2000","$2,000"],["2500","$2,500"],["3000","$3,000"]])),
      settingRow("Vacation Pool", "Taxes fill free parking. First to land claims it.", tog("vacationPool", s.vacationPool)),
      settingRow("Double GO", "Landing exactly on GO pays $400 instead of $200.", tog("doubleGo", s.doubleGo)),
    ]),
    lobbySection("Economy", [
      settingRow("Trading", "Players may propose trades.", tog("trading", s.trading)),
      settingRow("Auction", "Unowned deeds go to auction if buyer passes.", tog("auction", s.auction)),
      settingRow("No Rent In Jail", "Owner in jail can't collect rent that turn.", tog("noRentInJail", s.noRentInJail)),
      settingRow("Bankruptcy", "How to handle a bust player.", sel("bankruptMode", s.bankruptMode, [["elim","ELIMINATE"],["debt","DEBT DEAL"]])),
      settingRow("Bank Loans", "Emergency credit with collateral and a hard maturity.", tog("bankLoans", s.bankLoans)),
      settingRow("Loan Severity", "Premium applied to emergency bank credit.", sel("bankLoanSeverity", s.bankLoanSeverity, [["fair","FAIR"],["predatory","PREDATORY"],["extreme","EXTREME"]])),
      settingRow("Casino Access", "Virtual-money European roulette. No cash-out or loan-funded bets.", tog("casino", s.casino)),
      settingRow("Market Access", "Fictional indexes with visible prices and a small trading fee.", tog("market", s.market)),
    ]),
    lobbySection("Global Events", [
      settingRow("Global Events", "Rare, escalating headlines. Timing and severity scale with the round.", tog("globalEvents", Boolean(s.globalEvents))),
    ]),
    lobbySection("Building", [
      settingRowNum("House Limit", "Total houses in the bank.", sel("houseLimit", s.houseLimit, [["10","10 HOUSES"],["20","20 HOUSES"],["32","32 HOUSES"]])),
      settingRowNum("Hotel Limit", "Total hotels in the bank.", sel("hotelLimit", s.hotelLimit, [["6","6 HOTELS"],["12","12 HOTELS"]])),
    ]),
    lobbySection("Turn Timer", [
      settingRow("Timer Per Turn", "Seconds allowed per move (0 = off).", sel("turnTimer", s.turnTimer, [["0","OFF"],["30","30 SEC"],["60","60 SEC"],["120","2 MIN"]])),
    ]),
    `<div class="settings-rule">
      <strong style="color:var(--gold-300)">Active rules snapshot</strong><br>
      ${s.maxPlayers} players · $${Number(s.startingCash).toLocaleString()} start ·
      ${s.vacationPool ? "pool on" : "no pool"} ·
      ${s.trading ? "trading on" : "no trades"} ·
      ${s.auction ? "auction on" : "no auction"} ·
      ${s.bankLoans ? `${String(s.bankLoanSeverity).toLowerCase()} bank loans` : "bank loans off"} ·
      ${s.globalEvents ? "global events on" : "global events off"} ·
     ${s.casino ? "casino on" : "casino off"} ·
     ${s.market ? "market on" : "market off"} ·
      ${s.bots ? `bot instinct ${String(s.botPersonality || "survivor").toLowerCase()}` : "no bots"} ·
      ${s.turnTimer ? s.turnTimer + "s timer" : "no timer"} ·
      ${s.bankruptMode === "elim" ? "eliminate busted" : "debt deals"}
    </div>`,
  ].join("");

  const startBtn = $("#lobby-start-btn");
  startBtn.disabled = locked;
  startBtn.querySelector(".cta-text").textContent = locked ? "Finish Setup First" : "Start Round";
}

/** A lightweight, live preview of "you" while the setup overlay is still open,
 *  so the sidebar reflects the color/alias currently being chosen. */
function buildPreviewSelf() {
  const a = getAppearanceMeta(activeAppearance());
  return {
    id: "preview",
    name: (state.alias.trim() || a.baseName).toUpperCase(),
    color: a.color,
    textColor: a.textColor,
    cash: Number(state.settings.startingCash),
    bot: false,
    avatarGrid: a.avatarGrid || undefined,
  };
}

/* ============================================================
   6b. PROFILE EDITOR
   ============================================================ */
/** Open editor. Pass a profile id to edit, or nothing to create a new one. */
function draftFromSource(source) {
  return {
    designName: profileDesignName(source),
    color: source.color,
    grid: cloneFaceGrid(source.avatarGrid),
    tool: "paint",
    paintColor: source.color,
  };
}

function draftFromAccount(account) {
  const color = account?.color || "#d74438";
  const grid = account?.avatarGrid
    ? cloneFaceGrid(account.avatarGrid)
    : faceGridFromPreset(0, color);
  return { designName: "", color, grid, tool: "paint", paintColor: "#f0d9ac" };
}

function openProfileEditor(fromPhase, profileId) {
  closeRoomsModal();
  state.homeReturnView = fromPhase === "setup" ? "setup-return" : "home";
  state.editingProfileId = profileId || null;
  const existing = profileId ? getProfileById(profileId) : null;
  state.profileDraft = existing ? draftFromSource(existing) : draftFromAccount(state.account?.account);
  state.profileTab = "designs";
  renderProfileEditor();
  renderAccountPanel();
  renderProfileLibrary();
  showView("profile");
  setProfileTab(state.profileTab);
}

function buildBotPreviewPlayers(count) {
  const localBots = buildPlayers(activeAppearance(), state.alias).slice(1, 4);
  return localBots.slice(0, Math.max(0, count)).map((bot, index) => ({
    ...bot,
    id: `bot-preview-${index + 1}`,
    name: `BOT ${index + 1}`,
   online: true,
   bot: true,
    personality: state.settings.botPersonality || "survivor",
 }));
}

function announceProfileSave(message) {
  const status = $("#profile-save-status");
  if (status) status.textContent = message;
}

function draftProfilePayload(d, asNew) {
  const hasInk = d.grid.some((row) => row.some((c) => c));
  return {
    id: !asNew && state.editingProfileId ? state.editingProfileId : `pf_${Math.random().toString(36).slice(2, 9)}`,
    designName: String(d.designName || "").trim().slice(0, 12).toUpperCase() || "UNTITLED DESIGN",
    color: d.color,
    avatarGrid: hasInk ? d.grid : faceGridFromPreset(0, d.color),
  };
}

function accountUpdateAck(response) {
  if (response?.success) {
    updateAccountFromResponse(response);
    return;
  }
  const error = response?.error;
  if (!error) return;
  const announcer = $("#error-announcer");
  if (announcer) announcer.textContent = error;
}

function syncSavedDesignToAccount(saved) {
  if (!state.account?.sessionToken) return;
  emitServer("account-update", {
    sessionToken: state.account.sessionToken,
    color: saved.color,
    avatarGrid: saved.avatarGrid,
  }, accountUpdateAck);
}

function stayAfterSave(saved) {
  state.editingProfileId = saved.id;
  state.profileDraft = draftFromSource(saved);
  renderProfileEditor();
  renderProfileLibrary();
  setProfileTab("designs");
  announceProfileSave(`Saved "${profileDesignName(saved)}" as a new design.`);
}

function saveProfileDesign({ asNew = false, stay = false } = {}) {
  const d = state.profileDraft;
  if (!d) return null;
  const designName = String(d.designName || "").trim().slice(0, 12).toUpperCase() || "UNTITLED DESIGN";
  const saved = upsertProfile(draftProfilePayload(d, asNew));
  if (saved === "limit") {
    announceProfileSave(`You can only save up to ${MAX_PROFILES} designs. Delete one to make room.`);
    return saved;
  }
  if (!saved) return null;
  setActiveAppearance(saved.id);
  syncSavedDesignToAccount(saved);
  if (stay) stayAfterSave(saved);
  return saved;
}

function closeProfileEditor(save) {
  if (save) {
    const saved = saveProfileDesign({ asNew: !state.editingProfileId });
    if (saved === "limit" || !saved) return;
  }
  state.profileDraft = null;
  state.editingProfileId = null;
  if (state.homeReturnView === "setup-return") showView("game");
  else leaveRoomForHome();
  if (state.homeReturnView === "setup-return") {
    renderSetup();
    renderLobbyRail();
  } else {
    renderHome();
  }
}

function deleteCurrentProfile() {
  if (!state.editingProfileId) { closeProfileEditor(false); return; }
  deleteProfile(state.editingProfileId);
  state.profileDraft = null;
  state.editingProfileId = null;
  if (state.homeReturnView === "setup-return") showView("game");
  else leaveRoomForHome();
  if (state.homeReturnView === "setup-return") {
    renderSetup();
    renderLobbyRail();
  } else {
    renderHome();
  }
}

/* ============================================================
   8. GAME LOGIC
   ============================================================ */


async function runTurn(idx) {
  if (state.phase !== "playing" || state.turnIndex !== idx || state.busy || state.turnStage !== "roll") return;
    state.busy = true;
    state.rolling = true;
    renderHud();
    emitServer("roll-dice", {}, (response) => {
      state.busy = false;
      state.rolling = false;
      if (response?.success === false) {
        say(response.error || "The roll could not be completed.");
        renderChat();
      }
      renderAll();
    });
    return;
}



function endTurn(idx) {
  if (state.phase !== "playing" || state.turnIndex !== idx || state.busy || state.turnStage !== "end") return;
    emitServer("end-turn", {}, (response) => {
      if (response?.success === false) {
        say(response.error || "The turn could not be ended.");
        renderChat();
      }
    });
    return;
}

function primaryTurnAction() {
  if (state.phase !== "playing" || state.busy || state.turnIndex !== 0) return;
  if ((state.pendingBuyTile != null && state.settings.auction) || state.auction) return; // must resolve first
  if (state.turnStage === "end") endTurn(0);
  else runTurn(0);
}


function startGame() {
  emitServer("start-game", {}, (response) => {
      if (response?.success === false) {
        say(response.error || "Only the host can start the game.");
        renderChat();
      }
    });
    return;
}

function buyTile(tile) {
  if (tile?.i == null) return;
    emitServer("purchase-property", { tileIndex: tile.i }, (response) => {
      if (response?.success === false) {
        say(response.error || "That deed is no longer available.");
        renderChat();
      }
    });
    state.pendingBuyTile = null;
    $("#choice-modal")?.classList.add("is-hidden");
    closePopup();
    return;
}

/* ============================================================
   8a. FORCED CHOICE + AUCTION
   ============================================================ */

/** Human landed on a vacant lot: auto-show choice modal.
 *  - Auction mode: locked, BUY or AUCTION only.
 *  - Normal mode: dismissible, BUY or PASS.
 */
function openChoiceModal(tile) {
  const me = state.players[0];
  const price = tile.price ?? 0;
  const canAfford = me.cash >= price;
  const auctionMode = state.settings.auction;

  $("#choice-card").innerHTML = `
    <div class="pop-rail" style="background:${accentOf(tile)}"></div>
    <div class="choice-body">
      <div class="choice-head">
        <div class="choice-icon">${popIconHTML(tile)}</div>
        <div class="pop-headtext">
          <div class="t-micro g400">${kindLabel(tile)}</div>
          <h3 class="t-section choice-title" id="choice-card-title">${tile.name}</h3>
        </div>
      </div>
      <p class="t-body ink-2 choice-copy">${auctionMode ? "You landed on an unowned lot. Buy it at the listed price, or send it to auction." : "You landed on an unowned lot. Buy it or pass."}</p>
      <div class="choice-rows">
        ${popRow("PRICE", `$${price}`, "g300")}
        ${popRow("YOUR CASH", `$${me.cash.toLocaleString()}`, canAfford ? "green" : "red")}
      </div>
      <div class="choice-actions">
        <button class="cta-red choice-btn choice-buy" id="choice-buy" ${canAfford ? "" : "disabled"}>
          <span class="t-label">BUY</span>
          <span class="t-micro">${auctionMode ? "BUY DEED" : `$${price}`}</span>
        </button>
        ${auctionMode
          ? `<button class="btn-dark choice-btn" id="choice-auction">
              <span class="t-label">AUCTION</span>
              <span class="t-micro">OPEN BIDDING</span>
            </button>`
          : `<button class="btn-dark choice-btn" id="choice-pass">
              <span class="t-label">PASS</span>
              <span class="t-micro">DECLINE</span>
            </button>`
        }
      </div>
      <p class="t-micro ink-3 choice-note">${auctionMode ? (canAfford ? "YOU MUST CHOOSE ONE TO CONTINUE" : "TOO POOR TO BUY — MUST AUCTION") : "Click outside or press ESC to revisit this choice."}</p>
    </div>`;

  openSurface("#choice-modal", "#choice-buy");
  const scrim = $("#choice-scrim");
  if (scrim) {
    scrim.classList.toggle("popup-scrim-locked", auctionMode);
    scrim.onclick = auctionMode ? null : closeChoiceModalAsPass;
  }
  const buyBtn = $("#choice-buy");
  if (buyBtn) buyBtn.addEventListener("click", () => {
    buyTile(tile);
    state.pendingBuyTile = null;
    closeSurface("#choice-modal");
    afterLandingResolved();
  });

  if (auctionMode) {
    $("#choice-auction").addEventListener("click", () => {
      state.pendingBuyTile = null;
      closeSurface("#choice-modal");
      startAuction(tile);
    });
  } else {
    $("#choice-pass").addEventListener("click", closeChoiceModalAsPass);
  }
}

/** After a buy/auction decision the human's turn continues normally. */
function afterLandingResolved() {
  renderAll();
}

function closeChoiceModalAsPass() {
  if (state.settings.auction) return;
  const tile = state.pendingBuyTile != null ? TILES[state.pendingBuyTile] : null;
  const me = state.players[0];
  if (tile) {
    emitServer("decline-property", { tileIndex: tile.i }, (response) => {
      if (response?.success === false) {
        say(response.error || "The deed could not be declined.");
        renderChat();
      }
    });
    state.pendingBuyTile = null;
    closeSurface("#choice-modal");
    return;
  }
  state.pendingBuyTile = null;
  closeSurface("#choice-modal");
  afterLandingResolved();
}


/* ============================================================
   8b. TRADING
   ============================================================ */



/** Bots occasionally propose a cash-for-deed trade when they need one last lot. */

function openOfferModal(offer) {
  const from = state.players.find((p) => p.id === offer.from || p.serverId === offer.from);
  if (!from) return;
  const wantNames = offer.wantDeeds.map((i) => TILES[i].name).join(", ") || "nothing";
  $("#offer-card").innerHTML = `
    <div class="offer-rail" style="background:${from.color}"></div>
    <div class="offer-body">
      <div class="offer-head">
        <div class="offer-av">${avatarHTML(from, 4, state.players.indexOf(from))}</div>
        <div>
          <div class="t-micro g400">TRADE OFFER</div>
          <h3 class="t-section offer-title" id="offer-card-title" style="color:${from.textColor}">${esc(from.name)}</h3>
        </div>
      </div>
      <p class="t-body ink-2 offer-rows" style="margin-top:14px">
        ${from.name} will give you <span class="green">$${offer.giveCash.toLocaleString()}</span>
        and wants <span class="g300">${esc(wantNames)}</span>.
      </p>
      <div class="offer-actions">
        <button class="cta-red offer-btn" id="offer-accept"><span class="cta-text cta-text-sm">Accept</span></button>
        <button class="btn-dark offer-btn" id="offer-counter"><span class="t-label f12">Counter</span></button>
        <button class="btn-dark offer-btn" id="offer-reject"><span class="t-label f12">Reject</span></button>
      </div>
      <p class="t-micro ink-3 offer-note">Trades only transfer cash or deeds offered here.</p>
    </div>`;
  openSurface("#offer-modal", "#offer-accept");
  $("#offer-accept").addEventListener("click", () => {
    const o = state.offers.find((x) => x === offer);
    if (o) state.offers.splice(state.offers.indexOf(o), 1);
    emitServer("respond-trade", { tradeId: offer.id, accept: true }, (response) => {
        if (response?.success === false) {
          say(response.error || "Trade could not be accepted.");
          renderChat();
          return;
        }
      });
      closeSurface("#offer-modal");
      return;
  });
  $("#offer-counter").addEventListener("click", () => {
    // swap into the trade editor pre-loaded with the bot's proposal
    state.tradeWith = offer.from;
    state.tradeMyDeeds = new Set(offer.wantDeeds);
    state.tradeTheirDeeds = new Set(offer.giveDeeds);
    state.tradeMyCash = offer.wantCash;
    state.tradeTheirCash = offer.giveCash;
    const o = state.offers.find((x) => x === offer);
    if (o) state.offers.splice(state.offers.indexOf(o), 1);
    closeSurface("#offer-modal");
    renderTradeModal();
    openSurface("#trade-modal", "#trade-close");
  });
  $("#offer-reject").addEventListener("click", rejectOpenOffer);
}

function rejectOpenOffer() {
  const offer = state.offers.shift();
  if (offer) {
    emitServer("respond-trade", { tradeId: offer.id, accept: false }, () => {});
    closeSurface("#offer-modal");
    return;
  }
  closeSurface("#offer-modal");
  renderChat();
}

/* ============================================================
   8d. MORTGAGE · BANKRUPTCY · SAVE · CPU
   ============================================================ */
const SAVE_KEY = "poorup.save.v1";
const SAVE_VERSION = 2;
const LEGACY_TILE_INDEX_MAP = Object.freeze({ 0: 20, 10: 30, 20: 0, 30: 10 });

function migrateSavedBoardLayout(saved) {
  if (!saved || saved.v !== 1) return saved;
  const remapIndexMap = (value) => Object.fromEntries(
    Object.entries(value || {}).map(([key, entry]) => [LEGACY_TILE_INDEX_MAP[key] ?? key, entry]),
  );
  return {
    ...saved,
    v: SAVE_VERSION,
    players: saved.players.map((player) => ({
      ...player,
      pos: LEGACY_TILE_INDEX_MAP[player.pos] ?? player.pos,
    })),
    owners: remapIndexMap(saved.owners),
    houses: remapIndexMap(saved.houses),
    mortgaged: remapIndexMap(saved.mortgaged),
  };
}


function mortgageTile(tileIdx) {
  emitServer("manage-property", { tileIndex: tileIdx, action: "mortgage" }, () => {});
    return;
}

function unmortgageTile(tileIdx) {
  emitServer("manage-property", { tileIndex: tileIdx, action: "unmortgage" }, () => {});
    return;
}


function bankruptPlayer(idx, creditorId) {
  emitServer("declare-bankruptcy", {}, (response) => {
      if (response?.success === false) {
        say(response.error || "Bankruptcy could not be declared.");
        renderChat();
      }
    });
    return;
}

/** Build a ranked summary and show the round-over modal. */
function showGameOver(winnerName, winnerId) {
  state.gameOver = { winnerName, winnerId };
  const ranking = state.players
    .slice()
    .sort((x, y) => (y.cash + totalAssets(y)) - (x.cash + totalAssets(x)));
  const summary = ranking
    .map((p, i) => {
      const deeds = TILES.filter((t) => state.owners[t.i] === p.id).length;
      const crown = p.id === winnerId || i === 0 ? ' <span class="t-micro g300">★ WINNER</span>' : "";
      return `<div class="go-summary-row${p.id === winnerId ? " is-winner" : ""}">
        <span class="go-kicker">${String(i + 1).padStart(2, "0")}</span>
        <span class="t-label f13" style="color:${p.textColor};flex:1">${esc(p.name)}${crown}</span>
        <span class="t-label f12 g-muted">${deeds} DEED${deeds === 1 ? "" : "S"}</span>
        <span class="t-label f13 green">$${p.cash.toLocaleString()}</span>
      </div>`;
    })
    .join("");

  $("#gameover-card").innerHTML = `
    <div class="bank-body">
      <div class="bank-head" style="justify-content:center;text-align:center">
        <div>
          <div class="go-kicker g400">ROUND OVER</div>
          <h3 class="go-name" id="gameover-card-title">${esc(winnerName)} WINS</h3>
        </div>
      </div>
      <div class="go-summary">${summary}</div>
      <div class="go-actions">
        <button class="cta-red bank-btn" id="go-rematch"><span class="cta-text cta-text-sm">Rematch</span></button>
        <button class="btn-dark bank-btn" id="go-home"><span class="t-label f13">Back to Lobby</span></button>
      </div>
    </div>`;
  openSurface("#gameover-modal", "#go-rematch");
  $("#go-rematch").addEventListener("click", () => {
    closeSurface("#gameover-modal");
    state.gameOver = null;
    startGame();
  });
  $("#go-home").addEventListener("click", () => {
    closeSurface("#gameover-modal");
    state.gameOver = null;
    goHome();
  });
}

function totalAssets(p) {
  return TILES.filter((t) => state.owners[t.i] === p.id)
    .reduce((sum, t) => sum + (state.mortgaged[t.i] ? 0 : t.price || 0), 0);
}

function openBankruptcyModal(idx, amount, creditorId, label) {
  const p = state.players[idx];
  const creditor = creditorId ? state.players.find((x) => x.id === creditorId) : null;
  $("#bankruptcy-card").innerHTML = `
    <div class="bank-body">
      <div class="bank-head">
        <span class="bank-icon">!</span>
        <div>
          <div class="t-micro red">CAN'T COVER IT</div>
          <h3 class="t-section bank-title" id="bankruptcy-card-title">$${amount} due</h3>
        </div>
      </div>
      <p class="t-body ink-2 bank-copy">${esc(label)}. You're $${amount - p.cash} short. Sell houses and mortgage deeds — or hand everything to ${creditor ? esc(creditor.name) : "the bank"} and bow out.</p>
      <div class="bank-actions">
        <button class="cta-red bank-btn" id="bank-liquidate"><span class="cta-text cta-text-sm">Liquidate & Pay</span></button>
        <button class="btn-dark bank-btn" id="bank-declare"><span class="t-label f12">Declare Bankruptcy</span></button>
      </div>
    </div>`;
  openSurface("#bankruptcy-modal", "#bank-liquidate");
  $("#bank-liquidate").addEventListener("click", () => {
    closeSurface("#bankruptcy-modal");
      say("Use Holdings to sell houses or mortgage deeds, then the debt will settle automatically.");
      renderChat();
      return;
  });
  $("#bank-declare").addEventListener("click", () => bankruptPlayer(idx, creditorId));
}

/* Voluntary retirement: the same locked surface, different copy. The topbar
   control routes here when the player is not mid-debt; in-debt players keep
   the existing CAN'T COVER IT card. Focus starts on Keep Playing. */
function openVoluntaryExitModal() {
  const me = state.players[0];
  if (!me) return;
  const heldDeeds = TILES.filter((tile) => (state.owners || {})[tile.i] === me.id).length;
  const deedLabel = `${heldDeeds} deed${heldDeeds === 1 ? "" : "s"}`;
  $("#bankruptcy-card").innerHTML = `
    <div class="bank-body">
      <div class="bank-head">
        <span class="bank-icon">!</span>
        <div>
          <div class="t-micro red">VOLUNTARY EXIT</div>
          <h3 class="t-section bank-title" id="bankruptcy-card-title">Leave the table?</h3>
        </div>
      </div>
      <p class="t-body ink-2 bank-copy">You hold ${deedLabel} and $${me.cash.toLocaleString()}. Retiring hands everything back to the market unencumbered and ends your round — it cannot be undone. You can still raise funds instead by selling, mortgaging, trading, or taking a loan.</p>
      <div class="bank-actions">
        <button class="cta-red bank-btn" id="bank-retire-confirm"><span class="cta-text cta-text-sm">Declare Bankruptcy</span></button>
        <button class="btn-dark bank-btn" id="bank-retire-cancel"><span class="t-label f12">Keep Playing</span></button>
      </div>
    </div>`;
  openSurface("#bankruptcy-modal", "#bank-retire-cancel");
  $("#bank-retire-cancel").addEventListener("click", () => closeSurface("#bankruptcy-modal"));
  $("#bank-retire-confirm").addEventListener("click", () => {
    closeSurface("#bankruptcy-modal");
    bankruptPlayer(0, null);
  });
}

/** Central payment helper: returns true when paid, false when unpayable. */

/* ---- CPU round management ---- */

/* ---- persist / resume ---- */
function saveGame() {
  if (state.phase !== "playing") return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: SAVE_VERSION,
      roomCode: state.roomCode,
      players: state.players,
      owners: state.owners,
      houses: state.houses,
      mortgaged: state.mortgaged,
      pool: state.pool,
      turnIndex: state.turnIndex,
      dice: state.dice,
      settings: state.settings,
      log: state.log,
      messages: state.messages,
    }));
  } catch { /* ignore */ }
}

function loadSavedGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || ![1, SAVE_VERSION].includes(s.v) || !Array.isArray(s.players) || !s.players.length) return null;
    return s.v === 1 ? migrateSavedBoardLayout(s) : s;
  } catch { return null; }
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

/** Shared restore-session ack (A4-F2): report real failures visibly, clear the
    room mute, and only return to the parlor view when the player is mid-room. */
function reportRestoreFailure(response, explicit) {
  if (!explicit && state.phase === "home") return;
  parlorNotice("CONNECTION", response.error || "No active room session was found.");
  setConnectionStatus("offline", true);
}
function applyRestoredVisibility(visibility) {
  state.roomVisibility = visibility === "public" ? "public" : "private";
}
function applyRestoredSession(response, explicit) {
  state.suppressRoomUpdates = false;
  if (Object.prototype.hasOwnProperty.call(response, "roomCode")) state.roomCode = response.roomCode || state.roomCode;
  if (response.visibility) applyRestoredVisibility(response.visibility);
  // An explicit "Resume round" click always returns to the parlor — it is the
  // documented escape from a stuck mute; a background reconnect only re-asserts
  // the view when the player never left the room session.
  if (explicit || state.phase !== "home") showView("game");
  renderAll();
}

function handleRestoreSessionResponse(response, explicit = false) {
  if (response?.success === false) {
    reportRestoreFailure(response, explicit);
    if (explicit) {
      clearSave();
      applyProfileToHomeUI();
    }
    return;
  }
  if (!response?.success) return;
  applyRestoredSession(response, explicit);
}

function resumeGame() {
  // Clear the room mute before asking for the session so the restored
    // snapshots can render again ("Resume round" was a dead no-op, A6-F2).
    state.suppressRoomUpdates = false;
    emitServer("restore-session", {}, (response) => handleRestoreSessionResponse(response, true));
    return;
}

/* ============================================================
   9. ROUTING + EVENTS
   ============================================================ */
function showView(name) {
  if (name !== "home" && nightShiftState.active) stopNightShift();
  $("#view-home").classList.toggle("is-hidden", name !== "home");
  $("#view-game").classList.toggle("is-hidden", name !== "game");
  $("#view-profile").classList.toggle("is-hidden", name !== "profile");
  $("#view-rankings")?.classList.toggle("is-hidden", name !== "rankings");
  $("#view-social")?.classList.toggle("is-hidden", name !== "social");
  $("#view-rules")?.classList.toggle("is-hidden", name !== "rules");
  syncGlobalNavigation(name);
  window.scrollTo(0, 0);
  syncSurfaceA11y();
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

function syncServerAppearance() {
  const meta = getAppearanceMeta(activeAppearance());
  emitServer("set-player-appearance", {
    nickname: state.alias.trim() || meta.baseName,
    color: meta.color,
    avatarGrid: meta.avatarGrid || null,
  }, (response) => {
    if (response?.success === false) {
      // Audit #24: the rejection also has to reach players stuck on the home
      // screen, where the chat transcript is invisible.
      parlorNotice("APPEARANCE", response.error || "Appearance could not be updated.");
      say(response.error || "Appearance could not be updated.");
      renderChat();
    }
  });
}

function enterParlor(code) {
  if (!requireGuestAlias()) return;
  const requestedCode = String(code || "").trim().toUpperCase();
  state.suppressRoomUpdates = false;
  state.roomCode = requestedCode;
  state.roomVisibility = state.pendingRoomMeta?.visibility || (requestedCode ? "private" : "public");
  state.phase = "setup";
  state.tableAppearanceOverride = null;
  state.setupTab = typeof state.appearance === "string" ? "custom" : "preset";
  // always start the setup/lobby screens from a clean board — otherwise a
  // finished game's deed ownership, houses and token positions would still
  // be visible behind the setup overlay after going home and rejoining.
  state.players = buildPlayers(activeAppearance(), state.alias);
  state.owners = {};
  state.houses = {};
  state.pool = 0;
  state.turnIndex = 0;
  state.dice = [3, 5];
  state.rolling = false;
  state.busy = false;
  state.turnStage = "roll";
  state.highlight = null;
  state.selectedTile = null;
  state.tradeWith = null;
  state.profileDraft = null;
  state.pendingBuyTile = null;
  state.auction = null;
  state.mortgaged = {};
  state.offers = [];
  state.deedDetail = null;
  stopAuctionTimer();
  clearSave();
  closeAllSurfaces();
  state.log = ["ACTIVE DESIGN READY — ENTER THE PARLOR."];
  showView("game");
  renderAll();
  focusSurface("#setup-wrap", "#su-start");
  requestAnimationFrame(() => placePieces());

  const meta = getAppearanceMeta(activeAppearance());
    const event = requestedCode ? "join-room" : "create-room";
    emitServer(event, {
      roomCode: requestedCode || undefined,
      nickname: state.alias.trim() || meta.baseName,
      color: meta.color,
      avatarGrid: meta.avatarGrid || null,
      ...(event === "create-room" && state.pendingRoomMeta ? state.pendingRoomMeta : {}),
    }, (response) => {
      if (response?.success === false) {
        // Surface the rejection on the visible toast stack before bouncing
        // home — say() alone lands in the hidden chat panel (A1/A3).
        parlorNotice("TABLE NOTICE", response.error || "Room could not be entered.");
        say(response.error || "Room could not be entered.");
        state.phase = "home";
        showView("home");
        renderAll();
        return;
      }
      if (Object.prototype.hasOwnProperty.call(response || {}, "roomCode")) state.roomCode = response.roomCode || "";
      if (response?.visibility) state.roomVisibility = response.visibility === "public" ? "public" : "private";
      state.phase = "setup";
      renderAll();
      renderTopNav();
      syncServerAppearance();
      if (state.pendingRoomSettings) {
        Object.entries(state.pendingRoomSettings).forEach(([key, value]) => updateServerSetting(key, value));
        state.pendingRoomSettings = null;
      }
      state.pendingRoomMeta = null;
    });
}

function enterLobby() {
  // called from the setup overlay "Enter Parlor" button
  if (!requireGuestAlias()) return;
  syncServerAppearance();
    state.phase = "lobby";
    renderAll();
    requestAnimationFrame(() => placePieces());
    return;
}

function goHome() {
  // Release the seat on the server so the room can GC and peers stop
  // counting a home-screen player as online (A4-F3: ghost seats).
  if (state.phase !== "home") emitServer("leave-room", {}, () => {});
  stopAuctionTimer();
  state.busy = false;
  state.rolling = false;
  state.turnStage = "roll";
  state.selectedTile = null;
  state.highlight = null;
  state.tradeWith = null;
  state.profileDraft = null;
  state.pendingBuyTile = null;
  state.auction = null;
  state.offers = [];
  state.deedDetail = null;
  state.jail = {};
  state.card = null;
  state.gameOver = null;
  // Audit #16: home must not keep the previous room's transcript or activity
  // log. Rejoining a room re-seeds both from the server's next snapshot, so
  // emptying here never leaves stale content behind.
  state.messages = [];
  state.log = [];
  clearInterval(turnTimerInterval);
  turnTimerInterval = null;
  state.phase = "home";
  state.roomVisibility = "private";
  state.suppressRoomUpdates = true;
  closeAllSurfaces();
  $("#log-drawer").classList.remove("is-open");
  $("#view-game").classList.remove("is-focus");
  closeRoomsModal();
  // reset right rail visibility to game mode
  $("#right-rail-game").classList.remove("is-hidden");
  $("#right-rail-lobby").classList.add("is-hidden");
  showView("home");
}

// Audit 7.5: one door back to the homescreen. goHome() releases the room
// seat; a raw showView("home") from a page/rail handler used to leave the
// seat (and the room's stale transcript) behind when the user was mid-room.
function leaveRoomForHome() {
  if (state.phase === "setup" || state.phase === "lobby" || state.phase === "playing") goHome();
  else showView("home");
}

function bindEvents() {
  // Home destinations. Play stays in the stage; rooms uses the existing
  // server-backed directory surface; profile keeps the current editor flow.
  $("#home-nav")?.addEventListener("click", (e) => {
    const button = e.target.closest("[data-home-tab]");
    if (!button) return;
    const tab = button.dataset.homeTab;
    setHomeTab(tab);
    if (tab === "rooms") openRoomsModal("browse");
    if (tab === "profile") openProfileEditor("home", typeof state.appearance === "string" ? state.appearance : null);
  });
  document.querySelectorAll("[data-top-surface]").forEach((button) => {
    button.addEventListener("click", () => {
      const surface = button.dataset.topSurface;
      if (openInGameSocialSurface(surface)) return;
      if (surface === "rankings") openRankingsSurface();
      else if (surface === "social") openSocialSurface();
      else if (surface === "rules") openRulesSurface();
    });
  });
  document.querySelectorAll("[data-top-back]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.topBack || "home";
      if (target === "home") leaveRoomForHome();
      else showView(target);
    });
  });
  document.querySelectorAll("[data-home-tab]").forEach((button) => {
    if (button.closest("#home-nav")) return;
    button.addEventListener("click", () => {
      const tab = button.dataset.homeTab;
      if (tab === "profile") {
        openProfileEditor("home", typeof state.appearance === "string" ? state.appearance : null);
      } else if (tab === "rooms") {
        leaveRoomForHome();
        setHomeTab("rooms");
        openRoomsModal("browse");
      } else if (tab === "play") {
        leaveRoomForHome();
        setHomeTab("play");
        renderHome();
      }
    });
  });
  $("#rules-page-content")?.addEventListener("click", (event) => {
    const chapter = event.target.closest("[data-rules-section]");
    if (chapter) openRulesSurface(chapter.dataset.rulesSection);
  });
  $("#rules-page-content")?.addEventListener("input", (event) => {
    if (event.target.id !== "rules-search") return;
    const value = event.target.value;
    state.rulesQuery = value;
    renderRulesSurface("#rules-page-content");
    requestAnimationFrame(() => {
      const input = $("#rules-search");
      input?.focus({ preventScroll: true });
      input?.setSelectionRange(value.length, value.length);
    });
  });

  bindParlorSurfaces({ emitServer, leaveRoomForHome });

  // Home actions are bound to their explicit controls below. Keeping the
  // entry points named avoids accidental duplicate Create/Browse triggers.
  bindHomeEntry({ closeRoomsModal, enterParlor });

  // rooms browser & creator
  $("#browse-rooms-btn")?.addEventListener("click", () => openRoomsModal("browse"));
  $("#open-rooms-btn")?.addEventListener("click", () => openRoomsModal("browse"));
  $("#create-room-btn")?.addEventListener("click", () => openRoomsModal("create"));
  $("#open-create-btn")?.addEventListener("click", () => openRoomsModal("create"));
  $("#open-join-btn")?.addEventListener("click", () => openRoomsModal("join"));
  $("#rooms-close")?.addEventListener("click", closeRoomsModal);
  $("#rooms-scrim")?.addEventListener("click", closeRoomsModal);

  // modal tab switching
  $("#rm-tabs")?.addEventListener("click", (e) => {
    const tabBtn = e.target.closest("[data-rm-tab]");
    if (!tabBtn) return;
    const tab = tabBtn.dataset.rmTab;
    switchRoomModalTab(tab);
    // Re-selecting BROWSE inside an open modal must re-fetch, not replay the
    // cached directory (A2-1: the list only loaded on modal open).
    if (tab === "browse") requestRoomsDirectory();
  });

  // rooms directory list interactions
  $("#rooms-list")?.addEventListener("click", (e) => {
    const copyBtn = e.target.closest("[data-copy]");
    if (copyBtn) {
      try { navigator.clipboard?.writeText(copyBtn.dataset.copy); } catch { /* no clipboard */ }
      copyBtn.querySelector("span").textContent = "COPIED";
      setTimeout(() => { copyBtn.querySelector("span").textContent = "COPY"; }, 900);
      return;
    }
    const btn = e.target.closest("[data-join]");
    if (btn && !btn.disabled) {
      closeRoomsModal();
      enterParlor(btn.dataset.join);
    }
  });

  document.querySelectorAll(".rooms-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      roomsFilter = btn.dataset.filter || "all";
      renderRoomsList();
    });
  });

  // room creation form interactions
  $("#rc-vis-selector")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-vis]");
    if (!btn) return;
    const vis = btn.dataset.vis;
    if (createRoomSettings.visibility !== vis) {
      createRoomSettings.visibility = vis;
      createRoomSettings.code = "";
      updateCreateRoomUI();
    }
  });

  $("#rc-room-code")?.addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    createRoomSettings.code = e.target.value;
    updateCreateRoomUI();
  });

  $("#rc-create-btn")?.addEventListener("click", () => {
    const nameInput = $("#rc-name");
    const name = (nameInput?.value || "").trim().toUpperCase().slice(0, 18) || "AFTER HOURS #12";
    const vis = createRoomSettings.visibility;
    const code = createRoomSettings.code || "";
    if (!state.account?.account && !String(state.alias || "").trim()) {
      closeRoomsModal();
      requireGuestAlias();
      return;
    }
    if (vis === "private" && !/^[A-Z0-9]{6}$/.test(code)) {
      updateCreateRoomUI();
      $("#rc-room-code")?.focus();
      return;
    }

    state.alias = (state.account?.account?.displayName || state.alias || state.profiles[0]?.name || "").slice(0, 12);
      state.pendingRoomMeta = {
        roomName: name,
        visibility: vis,
        ...(vis === "private" ? { roomCode: code } : {}),
      };
      closeRoomsModal();
      // The backend generates the authoritative room code; the ZIP's local
      // preview code remains a visual hint until the room is created.
      enterParlor();
      return;

  });

  // resume round
  $("#resume-btn")?.addEventListener("click", () => resumeGame());

  // log drawer
  $("#log-toggle-btn")?.addEventListener("click", toggleLogDrawerFromButton);
  $("#drawer-close")?.addEventListener("click", closeLogDrawer);
  document.querySelectorAll(".drawer-filter").forEach((btn) => {
    btn.addEventListener("click", () => applyLogDrawerFilter(btn));
  });

  // focus / mobile board mode
  $("#focus-btn")?.addEventListener("click", () => $("#view-game").classList.toggle("is-focus"));
  $("#panels-btn")?.addEventListener("click", () => $(".rail-left")?.classList.toggle("is-open"));
  $("#game-retire-btn")?.addEventListener("click", () => {
    const debt = state.pendingDebt;
    const meServerId = state.players[0]?.serverId;
    if (debt && debt.playerId === meServerId) {
      openBankruptcyModal(0, Number(debt.amountRemaining) || 0, debt.creditorId, debt.reason || "This payment is due.");
      return;
    }
    openVoluntaryExitModal();
  });

  // open the deed / house manager from a MY DEEDS card
  $("#rr-body")?.addEventListener("click", (e) => {
    if (e.target.closest("[data-buy]") || e.target.closest("[data-trade]")) return;
    const card = e.target.closest("[data-deed-open]");
    if (card) openDeedDetail(Number(card.dataset.deedOpen));
  });
  $("#deed-scrim")?.addEventListener("click", closeDeedDetail);

  // trade offer inbox
  $("#offer-scrim")?.addEventListener("click", rejectOpenOffer);

  // profile editor — entry points
  const openActiveProfileForEdit = () => {
    const activeId = typeof state.appearance === "string" ? state.appearance : null;
    openProfileEditor("home", activeId);
  };
  document.querySelectorAll("[data-global-profile-trigger]").forEach((button) => {
    button.addEventListener("click", openActiveProfileForEdit);
  });
  $("#profile-hero-account-btn")?.addEventListener("click", () => {
    if (state.account?.account) openAccountModal("edit");
    else openAccountModal("register");
  });
  $("#profile-overview-edit-btn")?.addEventListener("click", () => {
    setProfileTab("designs");
    $("#profile-name")?.focus({ preventScroll: true });
  });
  $("#profile-tabs")?.addEventListener("click", (e) => {
    const button = e.target.closest("[data-profile-tab]");
    if (button) setProfileTab(button.dataset.profileTab);
  });
  $("#profile-tabs")?.addEventListener("keydown", (e) => {
    const tabs = [...document.querySelectorAll("#profile-tabs [data-profile-tab]")];
    const current = tabs.indexOf(e.target.closest("[data-profile-tab]"));
    if (current < 0 || !["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const nextIndex = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (current + (["ArrowRight", "ArrowDown"].includes(e.key) ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    setProfileTab(next.dataset.profileTab);
    next.focus();
  });
  $("#chair-edit-btn")?.addEventListener("click", () => {
    const activeId = typeof state.appearance === "string" ? state.appearance : null;
    openProfileEditor("home", activeId);
  });
  $("#pl-new-btn")?.addEventListener("click", () => {
    if (state.profiles.length >= MAX_PROFILES) {
      alert(`You can only save up to ${MAX_PROFILES} custom designs. Delete one to make room.`);
      return;
    }
    openProfileEditor("home");
  });
  $("#achievements-filters")?.addEventListener("click", (e) => {
    const button = e.target.closest("[data-achievement-filter]");
    if (button) setAchievementFilter(button.dataset.achievementFilter);
  });
  $("#achievement-date-filter")?.addEventListener("change", (e) => setAchievementDateFilter(e.target.value));
  $("#achievement-rarity-filter")?.addEventListener("change", (e) => setAchievementRarityFilter(e.target.value));
  $("#achievements-grid")?.addEventListener("click", (e) => {
    const card = e.target.closest("[data-achievement-id]");
    if (card) openAchievementModal(card.dataset.achievementId, card);
  });
  $("#achievement-scrim")?.addEventListener("click", closeAchievementModal);
  $("#pl-save-btn")?.addEventListener("click", () => {
    saveProfileDesign({ asNew: true, stay: true });
  });
  $("#pl-list")?.addEventListener("click", (e) => {
    const deleteBtn = e.target.closest("[data-profile-delete]");
    if (deleteBtn) {
      e.stopPropagation();
      const id = deleteBtn.dataset.profileDelete;
      const profile = getProfileById(id);
      if (!profile) return;
      openConfirmModal({
        title: "Delete saved design?",
        message: `Delete “${profileDesignName(profile)}”? This cannot be undone.`,
        confirmLabel: "DELETE DESIGN",
        onConfirm: () => {
          if (state.editingProfileId === id) deleteCurrentProfile();
          else {
            deleteProfile(id);
            renderProfileLibrary();
            renderProfileSummary();
          }
        },
      });
      return;
    }
    const editBtn = e.target.closest("[data-profile-edit]");
    if (editBtn) { e.stopPropagation(); openProfileEditor("home", editBtn.dataset.profileEdit); return; }
    const tile = e.target.closest("[data-profile-select]");
    if (tile) {
      const p = getProfileById(tile.dataset.profileSelect);
      if (p) {
        setActiveAppearance(p.id);
      }
    }
  });
  $("#account-register-btn")?.addEventListener("click", () => openAccountModal("register"));
  $("#account-login-btn")?.addEventListener("click", () => openAccountModal("login"));
  $("#account-edit-btn")?.addEventListener("click", () => openAccountModal("edit"));
  $("#account-logout-btn")?.addEventListener("click", logoutAccount);
  $("#account-scrim")?.addEventListener("click", closeAccountModal);

  // profile editor — delete
  $("#profile-delete-btn")?.addEventListener("click", () => {
    if (!state.editingProfileId) return;
    const p = getProfileById(state.editingProfileId);
    if (!p) return;
    openConfirmModal({
      title: "Delete saved design?",
      message: `Delete “${profileDesignName(p)}”? This cannot be undone.`,
      confirmLabel: "DELETE DESIGN",
      onConfirm: () => deleteCurrentProfile(),
    });
  });

  // profile editor — identity
  $("#profile-name")?.addEventListener("input", (e) => {
    state.profileDraft.designName = e.target.value.toUpperCase().slice(0, 12);
    updateProfilePreview();
  });
  $("#profile-swatches")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-color]");
    if (!btn) return;
    state.profileDraft.color = btn.dataset.color;
    renderProfileEditor();
  });
  $("#profile-color-picker")?.addEventListener("input", (e) => {
    state.profileDraft.color = e.target.value;
    renderProfileEditor();
  });

  // profile editor — face canvas painting (click + drag)
  let isPainting = false;
  const faceCanvasEl = $("#face-canvas");
  faceCanvasEl?.addEventListener("mousedown", (e) => {
    const cell = e.target.closest(".face-cell");
    if (!cell) return;
    isPainting = true;
    paintFaceCell(Number(cell.dataset.x), Number(cell.dataset.y));
  });
  faceCanvasEl?.addEventListener("mouseover", (e) => {
    if (!isPainting) return;
    const cell = e.target.closest(".face-cell");
    if (!cell) return;
    paintFaceCell(Number(cell.dataset.x), Number(cell.dataset.y));
  });
  window.addEventListener("mouseup", () => { isPainting = false; });
  faceCanvasEl?.addEventListener("dragstart", (e) => e.preventDefault());

  // profile editor — ink palette + tools
  $("#face-palette")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-ink]");
    if (!btn) return;
    state.profileDraft.tool = "paint";
    state.profileDraft.paintColor = btn.dataset.ink;
    renderProfileEditor();
  });
  $("#face-color-picker")?.addEventListener("input", (e) => {
    state.profileDraft.tool = "paint";
    state.profileDraft.paintColor = e.target.value;
    renderProfileEditor();
  });
  $("#face-tool-paint")?.addEventListener("click", () => {
    state.profileDraft.tool = "paint";
    renderProfileEditor();
  });
  $("#face-tool-erase")?.addEventListener("click", () => {
    state.profileDraft.tool = "erase";
    renderProfileEditor();
  });
  $("#face-clear-btn")?.addEventListener("click", () => {
    state.profileDraft.grid = emptyFaceGrid();
    renderProfileEditor();
  });
  $("#face-default-btn")?.addEventListener("click", () => {
    state.profileDraft.grid = faceGridFromPreset(0, state.profileDraft.color);
    renderProfileEditor();
  });

  // profile editor — save / cancel / back
  $("#profile-save-btn")?.addEventListener("click", () => closeProfileEditor(true));
  $("#profile-cancel-btn")?.addEventListener("click", () => closeProfileEditor(false));
  $("#profile-back-btn")?.addEventListener("click", () => closeProfileEditor(false));

  // Independent global audio controls: effects and soundtrack can be muted
  // separately while the preference remains consistent across every view.
  const syncAudioButtons = () => {
    const soundSrc = state.sound ? "/assets/sound-on.svg" : "/assets/sound-off.svg";
    const musicSrc = state.music ? "/assets/music-on.svg" : "/assets/music-off.svg";
    [$("#sound-toggle-btn"), $("#game-sound-toggle-btn"), $("#profile-sound-toggle-btn"), $("#rankings-sound-toggle-btn"), $("#social-sound-toggle-btn"), $("#rules-sound-toggle-btn")].forEach((button) => {
      if (!button) return;
      button.setAttribute("aria-pressed", String(state.sound));
      button.setAttribute("aria-label", state.sound ? "Turn sound effects off" : "Turn sound effects on");
      const icon = button.querySelector("img");
      if (icon) icon.src = soundSrc;
    });
    [$("#music-toggle-btn"), $("#game-music-toggle-btn"), $("#profile-music-toggle-btn"), $("#rankings-music-toggle-btn"), $("#social-music-toggle-btn"), $("#rules-music-toggle-btn")].forEach((button) => {
      if (!button) return;
      button.setAttribute("aria-pressed", String(state.music));
      button.setAttribute("aria-label", state.music ? "Turn parlor music off" : "Turn parlor music on");
      const icon = button.querySelector("img");
      if (icon) icon.src = musicSrc;
    });
  };
  syncAudioButtons();
  $("#sound-toggle-btn")?.addEventListener("click", () => {
    state.sound = !state.sound;
    saveSoundPreference(state.sound);
    if (state.sound) playSound("trade");
    syncAudioButtons();
    syncHomeMusic();
    renderProfileSummary();
  });
  $("#music-toggle-btn")?.addEventListener("click", () => {
    state.music = !state.music;
    saveMusicPreference(state.music);
    syncAudioButtons();
    syncHomeMusic();
    renderProfileSummary();
  });
  $("#game-sound-toggle-btn")?.addEventListener("click", () => {
    $("#sound-toggle-btn")?.click();
  });
  $("#game-music-toggle-btn")?.addEventListener("click", () => {
    $("#music-toggle-btn")?.click();
  });
  $("#profile-sound-toggle-btn")?.addEventListener("click", () => $("#sound-toggle-btn")?.click());
  $("#profile-music-toggle-btn")?.addEventListener("click", () => $("#music-toggle-btn")?.click());
  $("#rankings-sound-toggle-btn")?.addEventListener("click", () => $("#sound-toggle-btn")?.click());
  $("#rankings-music-toggle-btn")?.addEventListener("click", () => $("#music-toggle-btn")?.click());
  $("#social-sound-toggle-btn")?.addEventListener("click", () => $("#sound-toggle-btn")?.click());
  $("#social-music-toggle-btn")?.addEventListener("click", () => $("#music-toggle-btn")?.click());
  $("#rules-sound-toggle-btn")?.addEventListener("click", () => $("#sound-toggle-btn")?.click());
  $("#rules-music-toggle-btn")?.addEventListener("click", () => $("#music-toggle-btn")?.click());
  $("#home-helicopter")?.addEventListener("click", hitHomeHelicopter);
  $("#night-exit")?.addEventListener("click", stopNightShift);

  // quick table: starts a default-rules round immediately
  $("#quick-table-btn")?.addEventListener("click", () => {
    if (!requireGuestAlias()) return;
    state.quickJoin = true;
    state.settings.vacationPool = true;
    state.settings.trading = true;
    state.settings.auction = false;
    state.pendingRoomSettings = { vacationPool: true, trading: true, auction: false };
      enterParlor();
      return;
  });

  // game → home
  $("#brand-home").addEventListener("click", goHome);
  $("#tn-room-copy").addEventListener("click", copyRoomCode);

  // setup overlay
  $("#su-tabs")?.addEventListener("click", (e) => {
    const tabBtn = e.target.closest("[data-su-tab]");
    if (!tabBtn) return;
    state.setupTab = tabBtn.dataset.suTab;
    renderSetup();
  });
  $("#su-reset-btn")?.addEventListener("click", () => {
    clearTableAppearanceOverride();
    focusSurface("#setup-wrap", "#su-start");
  });
  $("#su-make-active-btn")?.addEventListener("click", () => {
    const choice = activeAppearance();
    state.appearance = choice;
    saveActiveDesignId(choice);
    state.tableAppearanceOverride = null;
    applyProfileToHomeUI();
    renderAccountPanel();
    renderProfileLibrary();
    renderSetup();
    renderLobbyRail();
    syncServerAppearance();
    focusSurface("#setup-wrap", "#su-start");
  });
  $("#su-grid").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-app]");
    if (!btn) return;
    if (btn.disabled) return;
    const raw = btn.dataset.app;
    // preset appearance = "0".."3"; custom profile ids look like "pf_xxxx"
    const choice = /^\d+$/.test(raw) ? Number(raw) : raw;
    setTableAppearanceOverride(choice);
  });
  $("#su-start").addEventListener("click", enterLobby);

  // lobby settings interactions
  $("#lobby-settings-body").addEventListener("click", (e) => {
    // toggle buttons
    const togBtn = e.target.closest("[data-setting]");
    if (togBtn && togBtn.classList.contains("tog")) {
      const key = togBtn.dataset.setting;
      state.settings[key] = !state.settings[key];
      updateServerSetting(key, state.settings[key]);
      renderLobbyRail();
      return;
    }
    // stepper buttons
    const stepBtn = e.target.closest("[data-step]");
    if (stepBtn && !stepBtn.disabled) {
      const key = stepBtn.dataset.step;
      const dir = Number(stepBtn.dataset.dir);
      const limits = {
        maxPlayers: [2, 4],
        bots: [0, Math.max(0, Number(state.settings.maxPlayers) - 1)],
      };
      const [mn, mx] = limits[key] || [0, 999];
      state.settings[key] = clamp((Number(state.settings[key]) || 0) + dir, mn, mx);
      if (key === "maxPlayers") {
        state.settings.bots = clamp(Number(state.settings.bots) || 0, 0, Math.max(0, state.settings.maxPlayers - 1));
      }
      updateServerSetting(key, state.settings[key]);
      renderLobbyRail();
      return;
    }
  });
  const applySettingField = (e) => {
    const sel = e.target.closest("[data-setting]");
    if (sel && (sel.tagName === "SELECT" || sel.matches("input[data-setting]"))) {
      const key = sel.dataset.setting;
      const numericKeys = ["startingCash", "houseLimit", "hotelLimit", "turnTimer"];
      if (numericKeys.includes(key)) {
        if (sel.value.trim() === "") return;
        const parsed = Number(sel.value);
        if (!Number.isFinite(parsed) || parsed < 0) return;
        state.settings[key] = Math.floor(parsed);
      } else {
        state.settings[key] = sel.matches("input[type=checkbox]") ? sel.checked : sel.value;
      }
      updateServerSetting(key, state.settings[key]);
      renderLobbyRail();
    }
  };
  $("#lobby-settings-body").addEventListener("change", applySettingField);

  $("#global-event-choices")?.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-global-choice]");
    if (!choice || choice.disabled) return;
    emitServer("vote-global-event", { choiceId: choice.dataset.globalChoice }, (response) => {
      if (response?.success === false) {
        say(response.error || "Your vote could not be recorded.");
        renderChat();
      }
    });
  });

  // lobby start round
  $("#lobby-start-btn").addEventListener("click", startGame);
  $("#pay-jail-fine")?.addEventListener("click", () => {
    emitServer("pay-jail-fine", {}, (response) => {
      if (response?.success === false) {
        say(response.error || "The jail fine could not be paid.");
        renderChat();
      }
    });
  });
  $("#use-jail-free")?.addEventListener("click", () => {
    emitServer("use-jail-free", {}, (response) => {
      if (response?.success === false) {
        say(response.error || "The card could not be used.");
        renderChat();
      }
    });
  });

  // chat
  $("#chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#chat-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    emitServer("send-chat", { text }, (response) => {
        if (response?.success === false) {
          say(response.error || "Message could not be sent.");
          renderChat();
        }
      });
      return;
  });

  // keep tokens glued to tiles when the board resizes
  if (window.ResizeObserver) {
    const frame = $("#board-frame");
    if (frame) new ResizeObserver(() => placePieces()).observe(frame);
  }
  window.addEventListener("resize", () => placePieces());

  // the main arcade button rolls first, then ends the resolved turn
  $("#roll-btn").addEventListener("click", primaryTurnAction);

  // tabs
  $("#tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (!tab) return;
    state.tab = tab.dataset.tab;
    renderRightRail();
    if (state.tab === "casino" || state.tab === "market") refreshEconomySnapshot();
  });

  // deeds tab: buy a vacant tile directly (kept for any future action buttons)
  // trade tab: open a trade with another player
  $("#rr-body").addEventListener("click", onRailClick);
  $("#rr-body").addEventListener("submit", onRailSubmit);

  // popup
  $("#popup-scrim").addEventListener("click", closePopup);
  $("#trade-scrim").addEventListener("click", closeTradeModal);
  $("#financing-scrim").addEventListener("click", closeFinancingModal);
  $("#card-scrim").addEventListener("click", () => {
    state.card = null;
    closeSurface("#card-modal");
  });
  $("#card-gallery-close")?.addEventListener("click", closeCardGallery);
  $("#card-gallery .card-gallery-scrim")?.addEventListener("click", closeCardGallery);

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
    closeCardGallery,
    closeChoiceModalAsPass,
    closeRoomsModal,
    closeProfileEditor,
    rejectOpenOffer,
    closeDeedDetail,
    closeTradeModal,
    closePopup,
    primaryTurnAction,
  });
}

// Visual-only card preview for design review. It never changes game state and
// is enabled only with ?preview=surprise (or ?preview=treasure).
function openCardPreviewFromUrl() {
  const preview = new URLSearchParams(window.location.search).get("preview");
  if (preview === "cards") {
    requestAnimationFrame(openCardGallery);
    return;
  }
  if (preview !== "surprise" && preview !== "treasure") return;
  const kind = preview === "surprise" ? "chance" : "chest";
  const tile = TILES.find((entry) => entry.kind === kind);
  const deck = kind === "chance" ? CHANCE_EVENTS : CHEST_EVENTS;
  const event = deck.find((entry) => entry.action === "moveTo") || deck[0];
  if (!tile || !event) return;
  requestAnimationFrame(() => openCardReveal(tile, { ...event, cash: Number(event.cash) || 0 }));
}

/* ============================================================
   10. INIT
   ============================================================ */
configureSurfaces({ notice: parlorNotice });
configureSocialSurfaces({ emitServer, showView });
configureAccountIdentity({ emitServer, say });
configureRailEvents({ emitServer, say, renderChat, renderRightRail, createRequestId, buyTile, openTradeModal, openFinancingModal });
configureTradeUi({ emitServer, say, renderChat, record });
configureAuctionUi({ emitServer, say, renderChat });
configurePopup({ buyTile, record });
configureProfileRender({ renderAchievements, loadSavedGame });
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
});
renderHome();
buildBoard(onTileClick);
hydrateSprites();
bindEvents();
renderAll();
showView("home");
openCardPreviewFromUrl();
