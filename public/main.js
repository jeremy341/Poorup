/* ============================================================
   ENTRY MODULE: game logic, renderers, and event wiring.
   Shared data and state live in the client*.js modules imported here.
   ============================================================ */
import { $, esc, REDUCED_MOTION } from "./clientDom.js";
import {
  hydrateSprites,
  spriteHTML,
  spriteFromGrid,
  avatarHTML,
} from "./clientSprites.js";
import {
  GROUP_COLOR,
  GROUP_TARGETS,
  JAIL_TILE_INDEX,
} from "./clientBoardData.js";
import { ACHIEVEMENTS, achievementIconHTML } from "./clientAchievements.js";
import {
  loadActiveDesignId,
  saveSoundPreference,
  saveMusicPreference,
  loadGuestAlias,
  saveGuestAlias,
} from "./clientSanitize.js";
import {
  state,
  syncLocalAppearance,
  saveUnlockedAchievements,
} from "./clientState.js";
import { AUCTION_MS } from "./clientStateSync.js";
import {
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
import { renderRightRail } from "./clientRailRender.js";
import { renderGlobalEvent } from "./clientGlobalEventRender.js";
import {
  configureSurfaces,
  setSurfaceReturnFocus,
  syncSurfaceA11y,
  openSurface,
  closeSurface,
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
  applyProfileToHomeUI,
  renderGuestAliasField,
} from "./clientProfileRender.js";
import {
  configureNightShift,
  nightShiftState,
  startNightShift,
  stopNightShift,
} from "./clientNightShift.js";
import {
  configureSocialSurfaces,
  parlorNotice,
  socialPlayerRowHTML,
  openSocialSurface,
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
  closeFinancingModal,
  openTradeModal,
  closeTradeModal,
} from "./clientTradeUi.js";
import { bindParlorSurfaces } from "./clientParlorBindings.js";
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
import { bindAudioControls } from "./clientAudioControls.js";
import { copyRoomCode } from "./clientRoomShare.js";
import {
  bindRoomsUi,
  closeRoomsModal,
  configureRoomsUi,
  openRoomsModal,
  renderHome,
  setHomeTab,
  syncGlobalNavigation,
} from "./clientRoomsUi.js";
import { configureSocketListeners } from "./clientSocketListeners.js";
import {
  bindGameModalSurfaces,
  closeCardGallery,
  closeChoiceModalAsPass,
  configureGameModals,
  openCardReveal,
  openCardPreviewFromUrl,
  openBankruptcyModal,
  openChoiceModal,
  openOfferModal,
  rejectOpenOffer,
  showGameOver,
} from "./clientGameModalsUi.js";
import {
  bindDeedDetail,
  closeDeedDetail,
  configureDeedDetail,
  renderDeedDetail,
} from "./clientDeedDetailUi.js";
import {
  bindLobbyUi,
  buildBotPreviewPlayers,
  configureLobbyUi,
  enterParlor,
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

configureSocketListeners(socket, {
  setConnectionStatus,
  emitServer,
  handleRestoreSessionResponse,
  say,
  renderChat,
  renderAll,
  openChoiceModal,
  openCardReveal,
  openOfferModal,
  serverSyncHost,
});

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


/* ============================================================
   6. GAME RENDERERS
   ============================================================ */

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






/* Deed detail/house manager + card reveal now live in
   clientDeedDetailUi.js / clientGameModalsUi.js. */
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

/* Lobby settings rail + profile editor/identity bindings now live in
   clientLobbyUi.js / clientProfileBindings.js. */



/* ============================================================
   8. GAME LOGIC
   ============================================================ */


async function runTurn(idx) {
  if (state.phase !== "playing") return;
  if (state.turnIndex !== idx) return;
  if (state.busy) return;
  if (state.turnStage !== "roll") return;
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
}



function endTurn(idx) {
  if (state.phase !== "playing") return;
  if (state.turnIndex !== idx) return;
  if (state.busy) return;
  if (state.turnStage !== "end") return;
  emitServer("end-turn", {}, (response) => {
    if (response?.success === false) {
      say(response.error || "The turn could not be ended.");
      renderChat();
    }
  });
}

function mustResolveAcquisition() {
  if (state.auction) return true;
  return state.pendingBuyTile != null && state.settings.auction;
}

function primaryTurnAction() {
  if (state.phase !== "playing") return;
  if (state.busy) return;
  if (state.turnIndex !== 0) return;
  if (mustResolveAcquisition()) return; // must resolve first
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

/** After a buy/auction decision the human's turn continues normally. */



/* ============================================================
   8b. TRADING
   ============================================================ */



/** Bots occasionally propose a cash-for-deed trade when they need one last lot. */



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






/** Build a ranked summary and show the round-over modal. */



/* Voluntary retirement: the same locked surface, different copy. The topbar
   control routes here when the player is not mid-debt; in-debt players keep
   the existing CAN'T COVER IT card. Focus starts on Keep Playing. */

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
    if (!s) return null;
    if (![1, SAVE_VERSION].includes(s.v)) return null;
    if (!Array.isArray(s.players)) return null;
    if (!s.players.length) return null;
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

  // rooms browser & creator (clientRoomsUi.js)
  bindRoomsUi();

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
  // buy/decline choice card, trade offer inbox, bankruptcy + round-over
  // cards, and the card reveal/gallery (clientGameModalsUi.js)
  bindGameModalSurfaces();
  bindDeedDetail();

  // profile editor, account and achievements surfaces (clientProfileBindings.js)
  bindProfileUi();

  // Global effects/music toggles (main + every surface) live in clientAudioControls.js.
  bindAudioControls({ playSound, syncHomeMusic });
  $("#home-helicopter")?.addEventListener("click", hitHomeHelicopter);
  $("#night-exit")?.addEventListener("click", stopNightShift);

  // setup overlay + quick table + lobby settings rail (clientLobbyUi.js)
  bindLobbyUi();

  // game → home
  $("#brand-home").addEventListener("click", goHome);
  $("#tn-room-copy").addEventListener("click", copyRoomCode);

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
configureGameModals({ emitServer, say, renderChat, renderAll, buyTile, startGame });
configureDeedDetail({ emitServer });
configureProfileBindings({ showView, emitServer });
configureRoomsUi({ emitServer, say, renderChat, enterParlor });
configureLobbyUi({
  emitServer,
  updateServerSetting,
  showView,
  renderAll,
  say,
  renderChat,
  clearSave,
  renderPlayers,
  closeRoomsModal,
});
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
