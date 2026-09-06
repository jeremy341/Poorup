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
/* ---- restrained arcade sfx (Web Audio, no assets) ------------------ */
let audioCtx = null;
function tone(freq, dur, type = "square", vol = 0.035, when = 0) {
  if (!state.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime + when;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  } catch { /* audio blocked */ }
}
function playSound(name) {
  if (!state.sound) return;
  switch (name) {
    case "die": tone(220, 0.05, "square", 0.03); break;
    case "cash": tone(660, 0.06, "square", 0.03); tone(880, 0.07, "square", 0.03, 0.06); break;
    case "house": tone(140, 0.08, "square", 0.04); break;
    case "auction": tone(520, 0.12, "square", 0.03); tone(390, 0.14, "square", 0.03, 0.12); break;
    case "trade": tone(520, 0.08, "square", 0.03); tone(780, 0.1, "square", 0.03, 0.09); break;
    case "step": tone(180, 0.03, "square", 0.02); break;
  }
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
    clearInterval(auctionTimer);
    auctionTimer = setInterval(tickAuction, 60);
  },
  closeAuctionSurface: () => {
    clearInterval(auctionTimer);
    auctionTimer = null;
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

function say(text, who) {
  const message = who
    ? { who: who.name, color: who.textColor, text }
    : { who: "", color: "", text, system: true };
  const previous = state.messages[state.messages.length - 1];
  if (message.system && previous?.system && previous.text === message.text) return;
  state.messages.push(message);
  if (state.messages.length > 80) state.messages.splice(0, state.messages.length - 80);
  if (message.system) {
    const announcer = $("#system-announcer");
    if (announcer) announcer.textContent = String(text);
    if (/(?:error|could not|cannot|can't|unable|failed|insufficient|not found|not your turn|must |need \$)/i.test(String(text))) {
      const errorAnnouncer = $("#error-announcer");
      if (errorAnnouncer) errorAnnouncer.textContent = String(text);
    }
  }
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
let accountModalMode = "register";

function accountRate(stats = {}) {
  const games = Number(stats.gamesPlayed) || 0;
  return games ? `${Math.round(((Number(stats.wins) || 0) / games) * 100)}%` : "0%";
}

function profileDisplaySource() {
  const account = state.account?.account || null;
  const draft = state.profileDraft || null;
  const selected = typeof state.appearance === "string" ? getProfileById(state.appearance) : null;
  const profile = draft || selected || null;
  const activeMeta = getAppearanceMeta(state.appearance);
  const name = account?.displayName || state.alias || "PLAYER";
  // The active saved design drives the avatar; account data only supplies a
  // fallback when no local design exists. Account display name stays separate.
  const color = draft?.color || profile?.color || account?.color || activeMeta.color || "#d74438";
  const grid = draft?.grid || profile?.avatarGrid || account?.avatarGrid || null;
  return { account, profile, name, color, grid, designName: profile ? profileDesignName(profile) : activeMeta.label };
}


function renderProfileSummary() {
  const source = profileDisplaySource();
  const { account, name, color, grid } = source;
  const safeName = String(name || "PLAYER").trim() || "PLAYER";
  const displayName = safeName.toUpperCase();
  const accountStats = account?.stats || {};
  const stats = {
    games: Number(accountStats.gamesPlayed) || 0,
    wins: Number(accountStats.wins) || 0,
    rate: accountRate(accountStats),
    bankruptcies: Number(accountStats.bankruptcies) || 0,
  };
  const avatarMarkup = grid ? spriteFromGrid(grid, 6) : avatarHTML({ color }, 6, 0);

  const heroAvatar = $("#profile-hero-avatar");
  if (heroAvatar) heroAvatar.innerHTML = avatarMarkup;
  const overviewAvatar = $("#profile-overview-avatar");
  if (overviewAvatar) overviewAvatar.innerHTML = grid ? spriteFromGrid(grid, 5) : avatarHTML({ color }, 5, 0);
  $("#profile-hero-name")?.replaceChildren(document.createTextNode(displayName));
  $("#profile-overview-name")?.replaceChildren(document.createTextNode(displayName));
  const handle = $("#profile-hero-handle");
  if (handle) handle.textContent = account ? `@${account.username}` : "GUEST MODE";
  const stateLabel = $("#profile-hero-state");
  if (stateLabel) {
    stateLabel.textContent = account ? "ACCOUNT PLAYER · STATS SYNCED AFTER COMPLETED ROUNDS" : "LOCAL PLAYER · READY FOR THE NEXT TABLE";
    stateLabel.classList.toggle("is-account", Boolean(account));
  }
  const heroAction = $("#profile-hero-account-btn");
  if (heroAction) heroAction.querySelector(".t-label").textContent = account ? "EDIT ACCOUNT" : "CREATE ACCOUNT";
  $("#profile-stat-games")?.replaceChildren(document.createTextNode(String(stats.games)));
  $("#profile-stat-wins")?.replaceChildren(document.createTextNode(String(stats.wins)));
  $("#profile-stat-rate")?.replaceChildren(document.createTextNode(stats.rate));
  $("#profile-stat-bankruptcies")?.replaceChildren(document.createTextNode(String(stats.bankruptcies)));
  const joined = $("#profile-stat-joined");
  if (joined) joined.textContent = account?.createdAt ? new Date(account.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" }).toUpperCase() : "GUEST";
  $("#profile-overview-mode")?.replaceChildren(document.createTextNode(account ? `@${account.username}` : "GUEST MODE"));
  const overviewStatus = $("#profile-overview-status");
  if (overviewStatus) overviewStatus.textContent = state.connectionStatus === "online" ? "READY" : (CONNECTION_COPY[state.connectionStatus] || "OFFLINE").toUpperCase();
  const overviewSync = $("#profile-overview-sync");
  if (overviewSync) overviewSync.textContent = account ? "ACCOUNT SYNC" : "LOCAL ONLY";
  const soundState = $("#profile-sound-state");
  if (soundState) soundState.textContent = state.sound ? "SOUND ON" : "SOUND OFF";
  const musicState = $("#profile-music-state");
  if (musicState) musicState.textContent = state.music ? "MUSIC ON" : "MUSIC OFF";
  renderProfileStatistics();
  renderProfileHistory();
  renderAchievements();
}

function formatStatDate(value) {
  if (!value) return "ROUND";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "ROUND";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase();
}

function renderProfileStatistics() {
  const root = $("#profile-statistics-content");
  if (!root) return;
  const account = state.account?.account || null;
  const stats = account?.stats || {};
  const games = Math.max(0, Number(stats.gamesPlayed) || 0);
  const wins = Math.max(0, Math.min(games, Number(stats.wins) || 0));
  const bankruptcies = Math.max(0, Number(stats.bankruptcies) || 0);
  const history = Array.isArray(account?.matchHistory) && account.matchHistory.length
    ? account.matchHistory.filter((entry) => entry && typeof entry === "object").slice(0, 50)
    : Array.isArray(account?.history)
      ? account.history.filter((entry) => entry && typeof entry === "object").slice(0, 50)
      : [];
  const chronological = [...history].reverse().slice(-12);
  const ownMatchValue = (entry, key, fallback = 0) => {
    const participant = Array.isArray(entry.participants) ? entry.participants.find(item => item.accountId === account?.id) : null;
    return Math.max(0, Number(participant?.[key] ?? entry[key] ?? fallback) || 0);
  };
  const averageCash = history.length
    ? Math.round(history.reduce((sum, entry) => sum + ownMatchValue(entry, "endingCash"), 0) / history.length)
    : null;
  const bestCash = history.length ? Math.max(...history.map((entry) => ownMatchValue(entry, "endingCash"))) : null;
  const bestProperties = history.length ? Math.max(...history.map((entry) => ownMatchValue(entry, "propertyCount", entry.properties))) : null;
  const winShare = games ? Math.round((wins / games) * 100) : 0;
  const sourceLabel = account ? "ACCOUNT SYNC" : "LOCAL ONLY";
  const record = (label, value, tone = "g100") => `<div class="stats-record"><span class="t-micro ink-3">${label}</span><strong class="t-label f16 ${tone}">${value}</strong></div>`;
  const trendBars = chronological.length
    ? chronological.map((entry, index) => {
        const own = Array.isArray(entry.participants) ? entry.participants.find(item => item.accountId === account?.id) : null;
        const won = own ? own.finalPlacement === 1 : String(entry.result || "").toUpperCase() === "WIN" || entry.won === true;
        const height = won ? 100 : 30;
        const label = won ? "WIN" : "ROUND";
        return `<div class="stats-bar-column"><span class="stats-bar-value t-micro ${won ? "green" : "ink-3"}">${label}</span><span class="stats-bar ${won ? "is-win" : "is-loss"}" style="--bar-height:${height}%" title="${formatStatDate(entry.completedAt || entry.playedAt)} · ${label}"></span><span class="stats-bar-label t-micro ink-3">${formatStatDate(entry.completedAt || entry.playedAt)}</span></div>`;
      }).join("")
    : `<div class="stats-chart-empty"><span data-sprite="diamond" data-size="4"></span><strong class="t-label f12 g100">${account ? "NO ROUND HISTORY YET" : "ACCOUNT HISTORY UNAVAILABLE"}</strong><span class="t-micro ink-3">${account ? "Complete a server round to unlock this trend." : "Create an account to sync completed-round statistics."}</span></div>`;
  const trendTable = chronological.length
    ? `<table class="stats-data-table"><caption>Recent round results</caption><thead><tr><th scope="col">ROUND</th><th scope="col">RESULT</th><th scope="col">ENDING CASH</th><th scope="col">PROPERTIES</th></tr></thead><tbody>${chronological.map((entry, index) => { const own = Array.isArray(entry.participants) ? entry.participants.find(item => item.accountId === account?.id) : null; const won = own ? own.finalPlacement === 1 : String(entry.result || "").toUpperCase() === "WIN" || entry.won === true; return `<tr><th scope="row">${formatStatDate(entry.completedAt || entry.playedAt)} · ${String(index + 1).padStart(2, "0")}</th><td class="${won ? "green" : "ink-2"}">${won ? "WIN" : "ROUND"}</td><td>$${ownMatchValue(entry, "endingCash").toLocaleString()}</td><td>${ownMatchValue(entry, "propertyCount", entry.properties)}</td></tr>`; }).join("")}</tbody></table>`
    : "";

  root.innerHTML = `<div class="stats-intro panel noise"><div><div class="t-micro g400">PERFORMANCE DECK</div><h2 class="t-section g100">Player Statistics</h2><p class="t-body ink-2">A readable record of the rounds you have finished, not a live ranking or a promise of future results.</p></div><span class="t-micro stats-source ${account ? "green" : "g300"}">${sourceLabel}</span></div>
    <div class="stats-metric-grid" aria-label="Performance summary">${record("ROUNDS", account ? String(games) : "—")}${record("WINS", account ? String(wins) : "—", "green")}${record("WIN RATE", account ? `${winShare}%` : "—", "g300")}${record("BANKRUPTCIES", account ? String(bankruptcies) : "—", "g-muted")}${record("EVENT SURVIVAL", account ? String(stats.eventSurvival || 0) : "—", "g300")}${record("AUCTION WINS", account ? String(stats.auctionWins || 0) : "—", "g100")}${record("CASINO NET", account ? "$" + Number(stats.casinoNet || 0).toLocaleString() : "—", "green")}${record("MARKET P/L", account ? "$" + Number(stats.marketProfit || 0).toLocaleString() : "—", "g300")}${record("PATROL BEST", account ? String(stats.patrolBest || 0) : "—", "g300")}${record("BANK LOANS REPAID", account ? String(stats.bankLoanRepayments || 0) : "—", "g100")}${record("LOANS GIVEN", account ? String(stats.playerLoansGiven || 0) : "—", "g100")}${record("EQUITY DEALS", account ? String(stats.equityDeals || 0) : "—", "g100")}</div>
    <div class="stats-content-grid"><section class="panel noise pad16 stats-trend-panel" aria-labelledby="stats-trend-heading"><div class="stats-panel-head"><div><div class="t-micro g400">RECENT FORM</div><h3 class="t-section g100" id="stats-trend-heading">Win history</h3></div><span class="t-micro ink-3">LAST ${chronological.length || 0} ROUNDS</span></div><div class="stats-chart" role="img" aria-label="Win history chart showing ${wins} wins across ${games} completed rounds"><div class="stats-chart-y"><span class="t-micro ink-3">WIN</span><span class="t-micro ink-3">ROUND</span></div><div class="stats-chart-plot"><div class="stats-chart-grid" aria-hidden="true"><span></span><span></span><span></span><span></span></div><div class="stats-chart-bars">${trendBars}</div></div></div>${trendTable}</section><section class="panel noise pad16 stats-records-panel" aria-labelledby="stats-records-heading"><div class="stats-panel-head"><div><div class="t-micro g400">PARLOR RECORDS</div><h3 class="t-section g100" id="stats-records-heading">Personal bests</h3></div><span class="t-micro ink-3">VERIFIED ROUNDS</span></div><div class="stats-record-list">${record("AVG ENDING CASH", averageCash == null ? "—" : `$${averageCash.toLocaleString()}`)}${record("BEST CASH STACK", bestCash == null ? "—" : `$${bestCash.toLocaleString()}`, "green")}${record("MOST PROPERTIES", bestProperties == null ? "—" : String(bestProperties), "g300")}${record("DATA WINDOW", account ? (history.length ? `${history.length} ROUNDS` : "NO ROUNDS") : "ACCOUNT ONLY", "g-muted")}</div><p class="t-micro ink-3 stats-method">Values are calculated from completed server rounds. No estimates are shown.</p></section></div>`;
  hydrateSprites(root);
}

function profileHistoryRowHTML(entry, index, total, accountId) {
  const participant = Array.isArray(entry.participants) ? entry.participants.find(item => item.accountId === accountId) : null;
  const won = participant ? participant.finalPlacement === 1 : entry.won === true || entry.result === "WIN";
  const date = formatStatDate(entry.completedAt || entry.playedAt);
  const deeds = participant?.propertyCount ?? entry.properties ?? 0;
  const players = Array.isArray(entry.participants) ? entry.participants.length : "—";
  const events = Array.isArray(entry.globalEvents) ? entry.globalEvents.length : 0;
  const casino = Array.isArray(entry.casino) ? entry.casino.find(item => item.accountId === accountId)?.net || 0 : 0;
  const contracts = Array.isArray(entry.playerContracts) ? entry.playerContracts.length : 0;
  const trades = Number(entry.tradesCompleted) || 0;
  const auctions = Number(entry.auctionsCompleted) || 0;
  const participantNames = Array.isArray(entry.participants) ? entry.participants.map(item => item.displayNameAtMatch).filter(Boolean).slice(0, 4).join(' · ') : '';
  return '<article class="profile-history-row' + (won ? ' is-win' : '') + '"><span class="profile-history-index t-micro ink-3">' + String(total - index).padStart(2, "0") + '</span><div class="profile-history-main"><span class="t-label f12 ' + (won ? 'green' : 'g100') + '">' + (won ? 'WIN' : 'ROUND COMPLETE') + '</span><span class="t-micro ink-3">' + date + ' · ' + players + ' PLAYERS</span>' + (participantNames ? '<span class="t-micro profile-history-participants">' + esc(participantNames) + '</span>' : '') + '</div><div class="profile-history-meta"><span class="t-micro ink-3">DEEDS ' + deeds + '</span><span class="t-micro ' + (events ? 'g300' : 'ink-3') + '">' + events + ' EVENTS</span><span class="t-micro ink-3">TRADES ' + trades + '</span><span class="t-micro ink-3">AUCTIONS ' + auctions + '</span><span class="t-micro ' + (casino >= 0 ? 'green' : 'red') + '">CASINO ' + (casino >= 0 ? '+' : '') + '$' + Number(casino).toLocaleString() + '</span><span class="t-micro ink-3">DEALS ' + contracts + '</span></div></article>';
}

function createRequestId(kind) {
  return String(state.clientId || "client") + ":" + String(kind || "action") + ":" + Date.now() + ":" + Math.random().toString(36).slice(2, 8);
}

function renderProfileHistory() {
  const root = $("#profile-history-content");
  if (!root) return;
  const account = state.account?.account || null;
  const historySource = Array.isArray(account?.matchHistory) && account.matchHistory.length ? account.matchHistory : account?.history;
  const history = Array.isArray(historySource)
    ? historySource.filter((entry) => entry && typeof entry === "object").slice(0, 50)
    : [];
  if (!account || !history.length) {
    root.innerHTML = `<section class="panel noise pad16 profile-empty-panel"><div class="section-title"><span data-sprite="diamond" data-size="3"></span><h2 class="t-section g300">Completed rounds</h2></div><p class="t-body ink-2">${account ? "NO COMPLETED ROUNDS YET. YOUR FIRST FINISH WILL APPEAR HERE." : "SIGN IN TO KEEP A SERVER-SYNCED ROUND HISTORY."}</p><p class="t-micro ink-3">Only completed server rounds appear here. Guest play remains available without an account.</p></section>`;
    hydrateSprites(root);
    return;
  }
  root.innerHTML = `<section class="panel noise pad16"><div class="section-title"><span data-sprite="diamond" data-size="3"></span><h2 class="t-section g300">Completed rounds</h2><span class="t-micro ink-3">${history.length} SAVED</span></div><div class="profile-history-list">${history.map((entry, index) => profileHistoryRowHTML(entry, index, history.length, account.id)).join("")}</div><p class="t-micro ink-3 profile-history-note">History is recorded when a server round finishes. Detailed participants, events, and economy results stay inside your private account record.</p></section>`;
  hydrateSprites(root);
}

function renderAchievements() {
  const root = $("#achievements-grid");
  if (!root) return;
  const unlocked = state.unlockedAchievements || new Set();
  const total = ACHIEVEMENTS.length;
  root.setAttribute("aria-label", "Achievement collection, " + total + " items");
  const unlockedCount = ACHIEVEMENTS.filter((achievement) => unlocked.has(achievement.id)).length;
  $("#profile-achievement-count")?.replaceChildren(document.createTextNode(`${unlockedCount}/${total}`));
  $("#achievements-progress-value")?.replaceChildren(document.createTextNode(`${unlockedCount}/${total}`));
  document.querySelectorAll("#achievements-filters [data-achievement-filter]").forEach((button) => {
    const active = button.dataset.achievementFilter === state.achievementFilter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const dateSelect = $("#achievement-date-filter");
  const raritySelect = $("#achievement-rarity-filter");
  if (dateSelect) dateSelect.value = state.achievementDateFilter;
  if (raritySelect) raritySelect.value = state.achievementRarityFilter;
  const filter = state.achievementFilter;
  const now = Date.now();
  const dateFilter = state.achievementDateFilter;
  const rarityFilter = state.achievementRarityFilter;
  let visible = ACHIEVEMENTS.filter((achievement) => filter === "all" || achievement.category === filter || (filter === "secret" && achievement.secret));
  visible = visible.filter((achievement) => rarityFilter === "all" || achievement.rarity.toLowerCase() === rarityFilter);
  if (dateFilter === "recent" || dateFilter === "month") {
    const windowMs = dateFilter === "recent" ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    visible = visible.filter((achievement) => {
      const recorded = Date.parse(state.achievementRecords?.get(achievement.id) || "");
      return Number.isFinite(recorded) && now - recorded <= windowMs;
    });
  } else if (dateFilter === "newest" || dateFilter === "oldest") {
    visible = [...visible].sort((a, b) => {
      const aDate = Date.parse(state.achievementRecords?.get(a.id) || "") || (dateFilter === "newest" ? 0 : Number.MAX_SAFE_INTEGER);
      const bDate = Date.parse(state.achievementRecords?.get(b.id) || "") || (dateFilter === "newest" ? 0 : Number.MAX_SAFE_INTEGER);
      return dateFilter === "newest" ? bDate - aDate : aDate - bDate;
    });
  }
  root.innerHTML = visible.map((achievement) => {
    const isUnlocked = unlocked.has(achievement.id);
    const isSecretLocked = Boolean(achievement.secret && !isUnlocked);
    const title = isSecretLocked ? "SECRET ACHIEVEMENT" : achievement.title;
    const short = isSecretLocked ? "A hidden parlor record" : achievement.short;
    const stateLabel = isUnlocked ? "UNLOCKED" : isSecretLocked ? "HIDDEN" : "LOCKED";
    return `<button class="achievement-card rarity-${achievement.rarity.toLowerCase()}${isUnlocked ? " is-unlocked" : ""}${isSecretLocked ? " is-secret" : ""}" type="button" data-achievement-id="${esc(achievement.id)}" aria-haspopup="dialog" aria-label="${esc(`${title}, ${stateLabel}. Open details.`)}"><span class="achievement-icon-wrap">${achievementIconHTML(achievement.id)}</span><span class="achievement-card-main"><span class="achievement-card-top"><span class="t-micro achievement-category">${achievement.category.toUpperCase()}</span><span class="t-micro achievement-rarity rarity-${achievement.rarity.toLowerCase()}">${achievement.rarity}</span></span><strong class="t-label f13 achievement-title">${esc(title)}</strong><span class="t-micro ink-3 achievement-short">${esc(short)}</span></span></button>`;
  }).join("");
  if (!visible.length) root.innerHTML = `<p class="t-body ink-3 achievements-empty">NO ACHIEVEMENTS IN THIS FILTER.</p>`;
}

function openAchievementModal(id, trigger = null) {
  const achievement = ACHIEVEMENTS.find((entry) => entry.id === id);
  if (!achievement) return;
  const unlocked = state.unlockedAchievements.has(achievement.id);
  const hidden = Boolean(achievement.secret && !unlocked);
  const title = hidden ? "SECRET ACHIEVEMENT" : achievement.title;
  const copy = hidden ? achievement.clue : achievement.detail;
  const status = unlocked ? "UNLOCKED" : hidden ? "HIDDEN" : "LOCKED";
  const recordedAt = state.achievementRecords?.get(achievement.id);
  const accent = achievement.category === "global" ? "#d74438" : achievement.category === "social" ? "#286ea1" : achievement.category === "minigame" ? "#35a653" : "#d9a62f";
  const card = $("#achievement-detail-card");
  if (!card) return;
  card.innerHTML = `<div class="achievement-modal-rail" style="--achievement-accent:${accent}"></div><div class="achievement-detail-body"><div class="achievement-detail-head"><div class="achievement-detail-icon rarity-${achievement.rarity.toLowerCase()}${hidden ? " is-locked" : ""}">${achievementIconHTML(achievement.id)}</div><div><div class="achievement-detail-kicker"><span class="t-micro g400">${esc(achievement.category.toUpperCase())}</span><span class="t-micro rarity-${achievement.rarity.toLowerCase()}">${esc(achievement.rarity)}</span></div><h2 class="t-section achievement-detail-title" id="achievement-detail-title">${esc(title)}</h2></div><span class="achievement-detail-state t-micro">${status}</span></div><div class="achievement-detail-copy"><p class="t-body ink-2" id="achievement-detail-description">${esc(copy)}</p><p class="t-micro achievement-detail-note">${unlocked ? `RECORDED ${recordedAt ? `· ${formatStatDate(recordedAt)}` : "IN YOUR PARLOR LOG"}` : hidden ? "UNLOCK CONDITION HIDDEN" : "KEEP PLAYING TO UNLOCK"}</p></div><button class="cta-red achievement-detail-close" id="achievement-detail-close" type="button"><span class="cta-text cta-text-sm">CLOSE DETAILS</span></button></div>`;
  if (trigger instanceof HTMLElement) setSurfaceReturnFocus(trigger);
  openSurface("#achievement-modal", "#achievement-detail-close");
  $("#achievement-detail-close")?.addEventListener("click", closeAchievementModal);
}

function closeAchievementModal() {
  closeSurface("#achievement-modal");
}

function setAchievementFilter(filter = "all") {
  const allowed = ["all", "visible", "global", "social", "secret", "minigame"];
  state.achievementFilter = allowed.includes(filter) ? filter : "all";
  renderAchievements();
}

function setAchievementDateFilter(filter = "all") {
  state.achievementDateFilter = ["all", "recent", "month", "newest", "oldest"].includes(filter) ? filter : "all";
  renderAchievements();
}

function setAchievementRarityFilter(filter = "all") {
  const allowed = ["all", "common", "uncommon", "rare", "epic", "legendary", "mythical"];
  state.achievementRarityFilter = allowed.includes(filter) ? filter : "all";
  renderAchievements();
}

function unlockAchievement(id) {
  if (!ACHIEVEMENTS.some((achievement) => achievement.id === id)) return false;
  // Signed-in accounts accept unlocks only from the server evaluator. Guest
  // sessions may keep their temporary local collection.
  if (state.account?.account) return false;
  if (state.unlockedAchievements.has(id)) return false;
  state.unlockedAchievements.add(id);
  state.achievementRecords.set(id, new Date().toISOString());
  saveUnlockedAchievements();
  renderAchievements();
  const achievement = ACHIEVEMENTS.find((entry) => entry.id === id);
  const announcer = $("#system-announcer");
  if (announcer && achievement) announcer.textContent = `ACHIEVEMENT UNLOCKED: ${achievement.title}`;
  return true;
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

function renderAccountPanel() {
  const signedIn = Boolean(state.account?.account);
  const guest = $("#account-guest-state");
  const signed = $("#account-signed-state");
  guest?.classList.toggle("is-hidden", signedIn);
  signed?.classList.toggle("is-hidden", !signedIn);
  const title = $("#account-panel-title");
  const badge = $("#account-panel-badge");
  if (title) title.textContent = signedIn ? `@${state.account.account.username}` : "Guest mode";
  if (badge) badge.textContent = signedIn ? "ACCOUNT ACTIVE" : "LOCAL ONLY";
  renderProfileSummary();
  if (!signedIn) return;
  const account = state.account.account;
  const visual = profileDisplaySource();
  const avatar = $("#account-avatar");
  if (avatar) avatar.innerHTML = visual.grid ? spriteFromGrid(visual.grid, 4) : avatarHTML({ color: visual.color }, 4, 0);
  $("#account-display-name")?.replaceChildren(document.createTextNode(account.displayName));
  $("#account-username")?.replaceChildren(document.createTextNode(`@${account.username}`));
  $("#account-games")?.replaceChildren(document.createTextNode(String(account.stats?.gamesPlayed || 0)));
  $("#account-wins")?.replaceChildren(document.createTextNode(String(account.stats?.wins || 0)));
  $("#account-rate")?.replaceChildren(document.createTextNode(accountRate(account.stats)));
}

function updateAccountFromResponse(response) {
  if (!response?.account) return;
  const token = response.sessionToken || state.account?.sessionToken;
  if (!token) return;
  saveAccountSession({ sessionToken: token, account: response.account });
  state.alias = response.account.displayName;
  state.unlockedAchievements = new Set();
  state.achievementRecords = new Map();
  (response.account.achievements || []).forEach((entry) => {
    if (!ACHIEVEMENTS.some((achievement) => achievement.id === entry.id)) return;
    state.unlockedAchievements.add(entry.id);
    state.achievementRecords.set(entry.id, entry.unlockedAt || null);
  });
  saveUnlockedAchievements();
  renderAccountPanel();
  renderAchievements();
  applyProfileToHomeUI();
}

const ACCOUNT_USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

function accountModalHTML(mode) {
  const register = mode === "register";
  const edit = mode === "edit";
  const account = state.account?.account || null;
  const title = edit ? "Edit Account" : register ? "Create account" : "Sign in";
  const description = edit
    ? "Update the account display name used at every table. Your saved designs keep their own names."
    : register
      ? "Choose a unique username friends can find, then save your player identity and stats across rooms."
      : "Sign in to load your saved display name, face, color, and game record.";
  return `
    <div class="account-modal-body">
      <div class="account-modal-head">
        <div>
          <div class="t-micro g400">POORUP IDENTITY</div>
          <h2 class="t-section g100" id="account-modal-title">${title}</h2>
        </div>
        <button class="btn-dark" id="account-modal-close" type="button"><span class="t-label f11">CLOSE</span></button>
      </div>
      <p class="t-body ink-2" id="account-modal-description">${description}</p>
      ${edit ? "" : `<div class="account-modal-tabs" role="tablist" aria-label="Account actions"><button class="rm-tab${register ? " is-active" : ""}" id="account-tab-register" type="button" role="tab" aria-selected="${register}"><span class="t-label f12">CREATE ACCOUNT</span></button><button class="rm-tab${register ? "" : " is-active"}" id="account-tab-login" type="button" role="tab" aria-selected="${!register}"><span class="t-label f12">SIGN IN</span></button></div>`}
      <form class="account-form" id="account-form">
        ${edit ? `<label class="account-field"><span class="t-label f12 g-muted">Username</span><input class="field" id="account-username-input" value="${esc(account?.username || "")}" readonly aria-readonly="true" /></label>` : `<label class="account-field" id="account-username-field"><span class="t-label f12 g-muted">Username</span><input class="field" id="account-username-input" name="username" maxlength="16" minlength="3" pattern="[A-Za-z0-9_]{3,16}" autocomplete="username"${register ? ` aria-describedby="account-username-status"` : ""} required placeholder="night_player" />${register ? `<span class="account-username-status t-micro ink-3" id="account-username-status" role="status" aria-live="polite">3–16 letters, numbers, or underscores</span>` : ""}</label>`}
       ${(register || edit) ? `<label class="account-field"><span class="t-label f12 g-muted">Display Name</span><input class="field" id="account-display-input" name="displayName" maxlength="18" autocomplete="nickname" required placeholder="Marlowe" value="${edit ? esc(account?.displayName || "") : ""}" /></label>` : ""}
        ${edit ? `<div class="account-privacy-grid"><label class="account-field"><span class="t-label f12 g-muted">Match History</span><select class="setting-select" name="historyVisibility"><option value="public" ${account?.privacy?.history === "public" ? "selected" : ""}>PUBLIC</option><option value="friends" ${account?.privacy?.history !== "public" && account?.privacy?.history !== "private" ? "selected" : ""}>FRIENDS</option><option value="private" ${account?.privacy?.history === "private" ? "selected" : ""}>PRIVATE</option></select></label><label class="account-field"><span class="t-label f12 g-muted">Achievements</span><select class="setting-select" name="achievementsVisibility"><option value="friends" ${account?.privacy?.achievements !== "private" ? "selected" : ""}>FRIENDS</option><option value="private" ${account?.privacy?.achievements === "private" ? "selected" : ""}>PRIVATE</option></select></label><label class="account-field"><span class="t-label f12 g-muted">Friend Requests</span><select class="setting-select" name="friendRequestsVisibility"><option value="everyone" ${account?.privacy?.friendRequests !== "friends" && account?.privacy?.friendRequests !== "nobody" ? "selected" : ""}>EVERYONE</option><option value="friends" ${account?.privacy?.friendRequests === "friends" ? "selected" : ""}>FRIENDS OF FRIENDS</option><option value="nobody" ${account?.privacy?.friendRequests === "nobody" ? "selected" : ""}>NOBODY</option></select></label><label class="account-field"><span class="t-label f12 g-muted">Room Invites</span><select class="setting-select" name="roomInvitesVisibility"><option value="friends" ${account?.privacy?.roomInvites !== "nobody" ? "selected" : ""}>FRIENDS</option><option value="nobody" ${account?.privacy?.roomInvites === "nobody" ? "selected" : ""}>NOBODY</option></select></label></div>` : ""}
        ${edit ? "" : `<label class="account-field"><span class="t-label f12 g-muted">Password</span><input class="field" id="account-password-input" name="password" type="password" minlength="8" maxlength="72" autocomplete="${register ? "new-password" : "current-password"}" required placeholder="8 characters minimum" /></label>`}
        <p class="account-form-error" id="account-form-error" role="alert" aria-live="assertive"></p>
        <button class="cta-red account-submit" type="submit"><span class="cta-text cta-text-sm">${edit ? "Save Account" : register ? "Create Account" : "Sign In"}</span></button>
      </form>
      <p class="t-micro ink-3 account-modal-foot">Guest play remains available without an account. Passwords are never shown in the game UI.</p>
    </div>`;
}

function openAccountModal(mode = "register") {
  accountModalMode = mode;
  const card = $("#account-card");
  if (!card) return;
  card.innerHTML = accountModalHTML(mode);
  openSurface("#account-modal", mode === "edit" ? "#account-display-input" : "#account-username-input");
  $("#account-modal-close")?.addEventListener("click", closeAccountModal);
  $("#account-tab-register")?.addEventListener("click", () => openAccountModal("register"));
  $("#account-tab-login")?.addEventListener("click", () => openAccountModal("login"));
  let usernameCheckTimer = null;
  let usernameCheckVersion = 0;
  let usernameAvailability = mode === "register" ? false : true;
  let usernameCheckPending = false;
  const usernameInput = $("#account-username-input");
  const usernameStatus = $("#account-username-status");
  const accountForm = $("#account-form");
  const submit = accountForm?.querySelector("button[type=submit]");
  const setUsernameStatus = (kind, message) => {
    if (!usernameStatus) return;
    usernameStatus.classList.remove("is-checking", "is-available", "is-taken", "is-invalid");
    if (kind) usernameStatus.classList.add(`is-${kind}`);
    usernameStatus.textContent = message;
    usernameInput?.setAttribute("aria-invalid", String(kind === "taken" || kind === "invalid"));
    usernameInput?.setAttribute("aria-busy", String(kind === "checking"));
  };
  const syncUsernameSubmit = () => {
    if (submit && mode === "register") submit.disabled = usernameCheckPending || usernameAvailability === false;
  };
  const checkUsername = () => {
    if (mode !== "register" || !usernameInput || !usernameStatus) return;
    clearTimeout(usernameCheckTimer);
    const value = usernameInput.value.trim();
    const version = ++usernameCheckVersion;
    if (!value) {
      usernameAvailability = false;
      usernameCheckPending = false;
      setUsernameStatus("invalid", "[!] Enter a username to check.");
      syncUsernameSubmit();
      return;
    }
    if (!ACCOUNT_USERNAME_RE.test(value)) {
      usernameAvailability = false;
      usernameCheckPending = false;
      setUsernameStatus("invalid", "[!] Use 3–16 letters, numbers, or underscores.");
      syncUsernameSubmit();
      return;
    }
    usernameAvailability = null;
    usernameCheckPending = true;
    setUsernameStatus("checking", "[·] Checking username availability…");
    syncUsernameSubmit();
    usernameCheckTimer = window.setTimeout(() => {
      emitServer("check-username", { username: value }, (response) => {
        if (version !== usernameCheckVersion || usernameInput.value.trim() !== value) return;
        usernameCheckPending = false;
        if (!response?.success) {
          usernameAvailability = null;
          setUsernameStatus("checking", "[·] Could not check now. The server will verify it on submit.");
          syncUsernameSubmit();
          return;
        }
        usernameAvailability = response.available === true;
        setUsernameStatus(
          response.available ? "available" : response.reason === "invalid" ? "invalid" : "taken",
          response.available ? "[OK] Username is available." : `[X] ${response.message || "That username is already taken."}`,
        );
        syncUsernameSubmit();
      });
    }, 180);
  };
  usernameInput?.addEventListener("input", checkUsername);
  checkUsername();
  $("#account-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    if (accountModalMode === "edit") {
      payload.privacy = { history: payload.historyVisibility, achievements: payload.achievementsVisibility, friendRequests: payload.friendRequestsVisibility, roomInvites: payload.roomInvitesVisibility };
      delete payload.historyVisibility;
      delete payload.achievementsVisibility;
      delete payload.friendRequestsVisibility;
      delete payload.roomInvitesVisibility;
    }
    const error = $("#account-form-error");
    if (error) error.textContent = "";
    if (accountModalMode === "register" && usernameAvailability === false) {
      if (error) error.textContent = "Choose an available username before creating your account.";
      usernameInput?.focus({ preventScroll: true });
      return;
    }
    if (accountModalMode === "register" && usernameCheckPending) {
      if (error) error.textContent = "Wait for the username availability check to finish.";
      return;
    }
    const eventName = accountModalMode === "register" ? "account-register" : accountModalMode === "edit" ? "account-update" : "account-login";
    if (submit) submit.disabled = true;
    emitServer(eventName, payload, (response) => {
      if (!response?.success) {
        if (error) error.textContent = response?.error || "Account action failed.";
        if (accountModalMode === "register" && /already taken/i.test(String(response?.error || ""))) {
          usernameAvailability = false;
          setUsernameStatus("taken", "[X] That username is already taken.");
        }
        const announcer = $("#error-announcer");
        if (announcer) announcer.textContent = response?.error || "Account action failed.";
        if (submit) submit.disabled = accountModalMode === "register" && usernameAvailability === false;
        return;
      }
      updateAccountFromResponse(response);
      closeAccountModal();
      say(accountModalMode === "register" ? "Account created. Your identity is saved." : accountModalMode === "edit" ? "Account name updated." : "Signed in. Your identity is ready.");
    });
  });
  focusSurface("#account-modal", mode === "edit" ? "#account-display-input" : "#account-username-input");
}

function closeAccountModal() {
  closeSurface("#account-modal");
}

function logoutAccount() {
  const token = state.account?.sessionToken;
  if (token) emitServer("account-logout", { sessionToken: token }, () => {});
  saveAccountSession(null);
  state.unlockedAchievements = new Set();
  state.achievementRecords = new Map();
  saveUnlockedAchievements();
  state.tableAppearanceOverride = null;
  state.appearance = loadActiveDesignId(state.profiles);
  saveActiveDesignId(state.appearance);
  state.alias = loadGuestAlias();
  saveGuestAlias(state.alias);
  state.players = buildPlayers(activeAppearance(), state.alias);
  renderAccountPanel();
  applyProfileToHomeUI();
  renderProfileEditor();
  say("Signed out. Guest mode is active.");
}

function record(text) {
  state.log.unshift(text);
  if (state.log.length > 40) state.log.length = 40;
}

/* ============================================================
   5. HOME SCREEN
   ============================================================ */
const PATROL_BEST_KEY = "poorup.parlor-patrol.best.v1";
let homeHelicopterTimer = null;
let homeHelicopterFlightTimer = null;
let homePatrolStatusTimer = null;
let homeClockTimer = null;
let patrolHitAudio = null;
const patrolState = { score: 0, best: 0, active: false };
try { patrolState.best = Number(localStorage.getItem(PATROL_BEST_KEY)) || 0; } catch { /* storage unavailable */ }

function renderPatrolHud(status = "STANDBY · FLY-BYS OCCASIONAL") {
  const score = $("#home-patrol-score");
  const label = $("#home-patrol-status");
  if (score) score.textContent = String(patrolState.score).padStart(3, "0");
  if (label) label.textContent = status;
}

function renderHomeLocalTime() {
  const clock = $("#home-local-time");
  if (!clock) return;
  const now = new Date();
  clock.textContent = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  clock.dateTime = now.toISOString();
}

function startHomeClock() {
  clearInterval(homeClockTimer);
  renderHomeLocalTime();
  homeClockTimer = setInterval(renderHomeLocalTime, 15000);
}

function stopHomeClock() {
  clearInterval(homeClockTimer);
  homeClockTimer = null;
}

function playPatrolHitSound() {
  if (!state.sound) return;
  try {
    patrolHitAudio = patrolHitAudio || new Audio("/assets/audio/parlor-patrol/pixel-hit-pack-cc0.wav");
    patrolHitAudio.volume = 0.32;
    patrolHitAudio.currentTime = 0;
    patrolHitAudio.play().catch(() => { /* browser gesture policy */ });
  } catch { /* audio unavailable */ }
}

function clearPatrolEffect(selector) {
  const effect = $(selector);
  if (!effect) return;
  effect.classList.remove("is-burst");
  effect.style.removeProperty("left");
  effect.style.removeProperty("top");
}

function hideHomeHelicopter() {
  const helicopter = $("#home-helicopter");
  if (!helicopter) return;
  helicopter.classList.remove("is-flying", "is-hit", "home-helicopter-left");
  const art = $("#home-helicopter-art");
  if (art) art.src = "/assets/parlor-patrol/helicopter-16-frames.svg";
  helicopter.setAttribute("aria-hidden", "true");
  helicopter.tabIndex = -1;
  helicopter.blur();
}

function stopHomeHelicopter() {
  clearTimeout(homeHelicopterTimer);
  clearTimeout(homeHelicopterFlightTimer);
  clearTimeout(homePatrolStatusTimer);
  homeHelicopterTimer = null;
  homeHelicopterFlightTimer = null;
  homePatrolStatusTimer = null;
  patrolState.active = false;
  hideHomeHelicopter();
  clearPatrolEffect("#home-patrol-impact");
  clearPatrolEffect("#home-patrol-smoke");
}

function scheduleHomeHelicopter(delay = 4000) {
  clearTimeout(homeHelicopterTimer);
  homeHelicopterTimer = null;
  if (state.phase !== "home") return;
  homeHelicopterTimer = setTimeout(() => {
    if (state.phase !== "home") return;
    const helicopter = $("#home-helicopter");
    if (!helicopter) return;
    patrolState.active = true;
    const direction = Math.random() < 0.5 ? "left" : "right";
    const art = $("#home-helicopter-art");
    if (art) art.src = direction === "left"
      ? "/assets/parlor-patrol/helicopter-left-16-frames.svg"
      : "/assets/parlor-patrol/helicopter-16-frames.svg";
    helicopter.classList.toggle("home-helicopter-left", direction === "left");
    helicopter.style.top = `${[12, 17, 22, 27, 32][Math.floor(Math.random() * 5)]}%`;
    helicopter.setAttribute("aria-hidden", "false");
    helicopter.tabIndex = 0;
    helicopter.classList.remove("is-hit", "is-flying");
    void helicopter.offsetWidth;
    helicopter.classList.add("is-flying");
    renderPatrolHud("FLY-BY ACTIVE · CLICK TO TAG");
    homeHelicopterFlightTimer = setTimeout(() => {
      if (!patrolState.active) return;
      patrolState.active = false;
      hideHomeHelicopter();
      renderPatrolHud("FLY-BY MISSED · NEXT ONE SOON");
      homePatrolStatusTimer = setTimeout(() => renderPatrolHud(), 2200);
      scheduleHomeHelicopter(12000);
    }, REDUCED_MOTION ? 6000 : 18000);
  }, delay);
}

function hitHomeHelicopter() {
  if (!patrolState.active || state.phase !== "home") return;
  const helicopter = $("#home-helicopter");
  const atmosphere = $(".home-sky-atmosphere");
  if (!helicopter || !atmosphere) return;
  patrolState.active = false;
  clearTimeout(homeHelicopterFlightTimer);
  homeHelicopterFlightTimer = null;
  const targetRect = helicopter.getBoundingClientRect();
  const atmosphereRect = atmosphere.getBoundingClientRect();
  const effectLeft = targetRect.left - atmosphereRect.left + targetRect.width / 2;
  const effectTop = targetRect.top - atmosphereRect.top + targetRect.height / 2;
  const impact = $("#home-patrol-impact");
  const smoke = $("#home-patrol-smoke");
  if (impact) {
    impact.style.left = `${Math.round(effectLeft - 32)}px`;
    impact.style.top = `${Math.round(effectTop - 32)}px`;
    impact.classList.remove("is-burst");
    void impact.offsetWidth;
    impact.classList.add("is-burst");
  }
  if (smoke) {
    smoke.style.left = `${Math.round(effectLeft - 40)}px`;
    smoke.style.top = `${Math.round(effectTop - 30)}px`;
    smoke.classList.remove("is-burst");
    void smoke.offsetWidth;
    smoke.classList.add("is-burst");
  }
  patrolState.score += 100;
  patrolState.best = Math.max(patrolState.best, patrolState.score);
  try { localStorage.setItem(PATROL_BEST_KEY, String(patrolState.best)); } catch { /* storage unavailable */ }
  playPatrolHitSound();
  hideHomeHelicopter();
  renderPatrolHud(`TAGGED +100 · BEST ${String(patrolState.best).padStart(3, "0")}`);
  homePatrolStatusTimer = setTimeout(() => renderPatrolHud(), 2400);
  setTimeout(() => {
    clearPatrolEffect("#home-patrol-impact");
    clearPatrolEffect("#home-patrol-smoke");
  }, 900);
  scheduleHomeHelicopter(9000);
}

const NIGHT_SHIFT_WAVE_MS = 60000;
const NIGHT_SHIFT_START_HEARTS = 3;
const NIGHT_SHIFT_BEST_KEY = "poorup.night-shift.best.v1";
let nightShiftWaveTimer = null;
let nightShiftTickTimer = null;
let nightShiftResultTimer = null;
let nightShiftResultEndsAt = 0;
let nightShiftSpawnTimers = [];
let nightShiftWaveHeld = false;
const nightShiftTargetTimers = new Map();
let nightShiftPausedAt = 0;
const nightShiftState = { active: false, wave: 0, score: 0, best: 0, endsAt: 0, targetSeq: 0, hearts: NIGHT_SHIFT_START_HEARTS, misses: 0, serverRunToken: null, serverRunSubmitted: false };
let nightShiftSuppressSnapshot = false;
try { nightShiftState.best = Number(localStorage.getItem(NIGHT_SHIFT_BEST_KEY)) || 0; } catch { /* storage unavailable */ }

function formatNightCountdown(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function renderNightShiftHud(message = "TAG THE FLY-BYS BEFORE THEY REACH THE BORDER") {
  const wave = $("#night-wave");
  const countdown = $("#home-local-time");
  const score = $("#home-patrol-score");
  const status = $("#night-status");
  const description = $("#night-shift-description");
  const nextWave = String(nightShiftState.wave).padStart(2, "0");
  const nextCountdown = formatNightCountdown(Math.max(0, nightShiftState.endsAt - Date.now()));
  const nextScore = String(nightShiftState.score).padStart(3, "0");
  if (wave && wave.textContent !== nextWave) wave.textContent = nextWave;
  if (countdown && countdown.textContent !== nextCountdown) countdown.textContent = nextCountdown;
  if (score && score.textContent !== nextScore) score.textContent = nextScore;
  if (status && status.textContent !== message) status.textContent = message;
  if (description && !nightShiftState.active) description.textContent = message;
  const hearts = $("#night-hearts");
  if (hearts) {
    const heartsLabel = `${nightShiftState.hearts} heart${nightShiftState.hearts === 1 ? "" : "s"} remaining`;
    if (hearts.getAttribute("aria-label") !== heartsLabel || (nightShiftState.active && hearts.innerHTML === "")) {
      hearts.innerHTML = Array.from({ length: NIGHT_SHIFT_START_HEARTS }, (_, i) => `<img class="night-heart${i >= nightShiftState.hearts ? " is-empty" : ""}" src="/assets/parlor-patrol/heart.svg" alt="">`).join("");
      hearts.setAttribute("aria-label", heartsLabel);
    }
  }
}

function clearNightShiftTimers() {
  clearTimeout(nightShiftWaveTimer);
  clearInterval(nightShiftTickTimer);
  clearTimeout(nightShiftResultTimer);
  nightShiftWaveTimer = null;
  nightShiftTickTimer = null;
  nightShiftResultTimer = null;
  nightShiftSpawnTimers.forEach((entry) => clearTimeout(entry.timer));
  nightShiftSpawnTimers = [];
  nightShiftWaveHeld = false;
  nightShiftTargetTimers.forEach(({ reveal, disable, miss }) => {
    clearTimeout(reveal);
    clearTimeout(disable);
    clearTimeout(miss);
  });
  nightShiftTargetTimers.clear();
}

function scheduleNightShiftResult() {
  clearTimeout(nightShiftResultTimer);
  nightShiftResultTimer = null;
  if (!nightShiftResultEndsAt) return;
  const remaining = nightShiftResultEndsAt - Date.now();
  if (remaining <= 0) {
    nightShiftResultEndsAt = 0;
    stopNightShift();
    return;
  }
  if (document.hidden) return;
  nightShiftResultTimer = setTimeout(() => {
    nightShiftResultTimer = null;
    nightShiftResultEndsAt = 0;
    stopNightShift();
  }, remaining);
}

function clearNightShiftTargets() {
  nightShiftTargetTimers.forEach(({ reveal, disable, miss }) => {
    clearTimeout(reveal);
    clearTimeout(disable);
    clearTimeout(miss);
  });
  nightShiftTargetTimers.clear();
  $("#night-targets")?.replaceChildren();
  const effects = $("#night-effects");
  effects?.querySelectorAll(".night-shift-dynamic").forEach((effect) => effect.remove());
  effects?.querySelectorAll("[data-night-home-effect]").forEach((effect) => {
    effect.classList.remove("is-burst");
    effect.style.removeProperty("left");
    effect.style.removeProperty("top");
  });
}

function announceSocialNotification(n) {
  const kind = String(n?.kind || "");
  const isError = kind === "parlor-error";
  const label = String(n?.title || "Parlor Notice").toUpperCase();
  const detail = String(n?.message || n?.body || "").replace(/\s+/g, " ");
  const systemAnnouncer = $("#system-announcer");
  if (systemAnnouncer) systemAnnouncer.textContent = detail ? `${label}. ${detail}` : label;
  if (isError) {
    const errorAnnouncer = $("#error-announcer");
    if (errorAnnouncer) errorAnnouncer.textContent = detail ? `${label}. ${detail}` : label;
  }
  const stack = $("#toast-stack");
  if (!stack) return;
  const toast = document.createElement("div");
  toast.className = `parlor-toast${kind === "mythical-achievement" ? " is-mythical" : ""}${isError ? " is-error" : ""}`;
  const title = document.createElement("strong");
  title.className = "t-label f11 parlor-toast-title";
  if (isError) {
    const glyph = document.createElement("span");
    glyph.className = "parlor-toast-glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.innerHTML = '<svg viewBox="0 0 12 12" focusable="false" shape-rendering="crispEdges"><path fill="currentColor" fill-rule="evenodd" d="M5 1h2l1 2 1 2 1 2 1 2 1 3H0l1-3 1-2 1-2 1-2zM5 4h2v3H5zm0 4h2v2H5z"/></svg>';
    title.appendChild(glyph);
  }
  title.append(document.createTextNode(label));
  const body = document.createElement("span");
  body.className = "t-body f12 parlor-toast-body";
  body.textContent = detail;
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "parlor-toast-close";
  dismiss.tabIndex = -1;
  dismiss.setAttribute("aria-hidden", "true");
  dismiss.textContent = "\u00d7";
  const dismissToast = () => {
    if (!toast.isConnected || toast.classList.contains("is-leaving")) return;
    clearTimeout(toast._autoTimer);
    toast.classList.add("is-leaving");
    syncToastStack();
    setTimeout(() => toast.remove(), 160);
  };
  toast.append(title, body, dismiss);
  toast.addEventListener("click", dismissToast);
  dismiss.addEventListener("click", (event) => {
    event.stopPropagation();
    dismissToast();
  });
  stack.append(toast);
  while (stack.children.length > 4) stack.firstElementChild.remove();
  syncToastStack();
  toast._autoTimer = setTimeout(dismissToast, isError || kind === "mythical-achievement" ? 6500 : 4200);
}

function syncToastStack() {
  const stack = $("#toast-stack");
  if (!stack) return;
  Array.from(stack.children)
    .filter((toast) => !toast.classList.contains("is-leaving"))
    .forEach((toast, index) => toast.style.setProperty("--toasts-before", String(index)));
}

function parlorNotice(title, message) {
  announceSocialNotification({ kind: "parlor-error", title, message });
}

function socialPlayerRowHTML(player, actionLabel = "VIEW") {
  if (!player) return "";
  const id = player.id || player.accountId;
  const mutual = Number(player.mutualFriends) || 0;
  return `<div class="social-player-row"><div class="social-player-avatar">${avatarHTML(player, 3, 0)}</div><div class="social-player-main"><strong class="t-label f12 g100">${esc(player.displayName || player.name || "PLAYER")}</strong><span class="t-micro ink-3">@${esc(player.username || "guest")}${mutual ? ` · ${mutual} MUTUAL` : ""}</span></div><button class="btn-dark social-player-open" type="button" data-social-player="${esc(id)}"><span class="t-label f11">${actionLabel}</span></button></div>`;
}

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

function socialRoomRosterHTML() {
  const activeRoom = state.phase !== "home" && state.players?.length;
  if (!activeRoom) return `<div class="social-context-empty"><span class="t-micro g400">NO ACTIVE ROOM</span><span class="t-body ink-2">Join a table to see the people currently sharing it.</span></div>`;
  const roster = state.players.filter((player) => player.id !== "p1").slice(0, 8);
  return roster.length ? roster.map((player) => socialPlayerRowHTML({ ...player, id: player.serverId || player.id }, player.bot ? "BOT" : "VIEW")).join("") : `<div class="social-context-empty"><span class="t-micro ink-3">ONLY YOU AT THE TABLE</span></div>`;
}

function openSocialSurface(tab = "friends") {
  state.socialTab = ["friends", "requests", "invites", "recent", "notifications"].includes(tab) ? tab : "friends";
  showView("social");
  renderSocialSurface("#social-page-content");
  emitServer("get-social-data", {}, (response) => {
    if (response?.success && response.social) {
      state.social = response.social;
      renderSocialSurface("#social-page-content");
    }
  });
}

function renderSocialSurface(target = "#social-card") {
  const card = $(target) || $("#social-card");
  if (!card) return;
  const social = state.social || {};
  const signedIn = Boolean(state.account?.account);
  const pageSurface = card.id === "social-page-content";
  const surfaceKey = pageSurface ? "page" : "modal";
  const tabs = [["friends", "FRIENDS"], ["requests", "REQUESTS"], ["invites", "INVITES"], ["recent", "RECENT"], ["notifications", "INBOX"]];
  const count = (social.requests?.length || 0) + (social.invites?.length || 0);
  const pending = (social.requests?.length || 0) + (social.outgoing?.length || 0);
  let body = "";
  if (!signedIn) {
    body = `<div class="social-signin-note"><span class="t-label f13 g100">ACCOUNT REQUIRED</span><p class="t-body ink-2">Create an account to keep friends, invitations, and social history across rooms.</p><button class="cta-red" type="button" data-social-action="account"><span class="cta-text cta-text-sm">CREATE ACCOUNT</span></button></div>`;
  } else if (state.socialTab === "friends") {
    body = social.friends?.length ? social.friends.map((player) => socialPlayerRowHTML(player)).join("") : `<p class="t-body ink-3 social-empty">NO FRIENDS YET. Search by username or open someone from the table.</p>`;
  } else if (state.socialTab === "requests") {
    const incoming = social.requests?.map((request) => `<div class="social-request-row">${socialPlayerRowHTML(request.from, "VIEW")}<div class="social-request-actions"><button class="cta-red" type="button" data-social-request="accept" data-friendship-id="${esc(request.id)}"><span class="cta-text cta-text-sm">ACCEPT</span></button><button class="btn-dark" type="button" data-social-request="decline" data-friendship-id="${esc(request.id)}"><span class="t-label f11">DECLINE</span></button></div></div>`).join("") || "";
    const outgoing = social.outgoing?.map((request) => `<div class="social-request-row">${socialPlayerRowHTML(request.to, "VIEW")}<div class="social-request-actions"><span class="t-micro ink-3">REQUEST SENT</span><button class="btn-dark" type="button" data-social-request-cancel data-friendship-id="${esc(request.id)}"><span class="t-label f11">CANCEL</span></button></div></div>`).join("") || "";
    body = incoming || outgoing ? `${incoming}${outgoing}` : `<p class="t-body ink-3 social-empty">NO PENDING REQUESTS.</p>`;
  } else if (state.socialTab === "invites") {
    body = social.invites?.length ? social.invites.map((invite) => `<div class="social-invite-row"><div><strong class="t-label f12 g100">${esc(invite.roomName || "AFTER HOURS")}</strong><span class="t-micro ink-3">${String(invite.visibility || "public").toUpperCase()} ROOM · EXPIRES ${esc(String(invite.expiresAt || "").slice(0, 16))}</span></div><div class="social-request-actions"><button class="cta-red" type="button" data-social-invite="accept" data-invite-id="${esc(invite.id)}"><span class="cta-text cta-text-sm">JOIN</span></button><button class="btn-dark" type="button" data-social-invite="decline" data-invite-id="${esc(invite.id)}"><span class="t-label f11">DECLINE</span></button></div></div>`).join("") : `<p class="t-body ink-3 social-empty">NO ROOM INVITES.</p>`;
  } else if (state.socialTab === "recent") {
    body = social.recentPlayers?.length
      ? social.recentPlayers.map((player) => socialPlayerRowHTML(player, "REVISIT")).join("")
      : `<p class="t-body ink-3 social-empty">NO RECENT PLAYERS YET. COMPLETE A MATCH TO BUILD YOUR TABLE HISTORY.</p>`;
    body = `<div class="recent-players-wrap"><div class="recent-players-actions"><span class="t-micro ink-3">LAST 30 DAYS · 20 PLAYERS MAX</span><button class="btn-dark" type="button" data-social-clear-recent><span class="t-label f11">CLEAR RECENT</span></button></div>${body}</div>`;
  } else {
    body = social.notifications?.length ? social.notifications.map((notification) => `<div class="social-notification-row${notification.readAt ? "" : " is-unread"}"><div><strong class="t-label f12 g100">${esc(notification.title)}</strong><span class="t-body ink-2">${esc(notification.body)}</span><span class="t-micro ink-3">${esc(String(notification.createdAt || "").slice(0, 16))}</span></div>${notification.readAt ? "" : `<button class="btn-dark" type="button" data-notification-read="${esc(notification.id)}"><span class="t-label f11">READ</span></button>`}</div>`).join("") : `<p class="t-body ink-3 social-empty">NO NOTIFICATIONS.</p>`;
  }
  const activeLabel = tabs.find(([id]) => id === state.socialTab)?.[1] || "FRIENDS";
  const searchResults = state.socialSearchResults?.length
    ? state.socialSearchResults.map((player) => socialPlayerRowHTML(player, "VIEW")).join("")
    : "";
  card.innerHTML = `<div class="social-page-shell ${pageSurface ? "is-page" : "is-modal"}"><section class="social-hero panel noise"><div class="social-hero-mark"><img src="/assets/social-network.svg" alt="" width="32" height="32"></div><div class="social-hero-copy"><span class="t-micro g400">PARLOR SOCIAL · PLAYER INDEX</span><h2 class="t-section g100" id="social-${surfaceKey}-title">People who keep the table moving</h2><p class="t-body ink-2" id="social-${surfaceKey}-description">Find people by their unique username, then manage friends and room invites without leaving the parlor.</p></div><div class="social-hero-stats"><div><span class="t-micro ink-3">FRIENDS</span><strong class="t-label f20 g100">${social.friends?.length || 0}</strong></div><div><span class="t-micro ink-3">PENDING</span><strong class="t-label f20 g300">${pending}</strong></div><div><span class="t-micro ink-3">INBOX</span><strong class="t-label f20 green">${social.notifications?.filter((item) => !item.readAt).length || 0}</strong></div></div>${pageSurface ? "" : `<button class="btn-dark social-close" id="social-close" type="button"><span class="t-label f11">CLOSE</span></button>`}</section><div class="social-search-band panel noise"><form class="social-search" data-social-search-form id="social-${surfaceKey}-search-form"><label class="social-search-label" for="social-${surfaceKey}-search-input"><span class="t-micro g400">FIND A PLAYER</span><input class="field" id="social-${surfaceKey}-search-input" data-social-search-input name="username" autocomplete="off" placeholder="SEARCH USERNAME…" maxlength="16" pattern="[A-Za-z0-9_]{3,16}" value="${esc(state.socialSearchQuery || "")}" aria-describedby="social-${surfaceKey}-search-help"><span class="t-micro ink-3" id="social-${surfaceKey}-search-help">Unique usernames only · 3–16 characters</span></label><button class="btn-dark social-search-submit" type="submit"><span class="t-label f11">FIND</span></button><div class="social-search-results" data-social-search-results id="social-${surfaceKey}-search-results">${searchResults}</div></form></div><div class="social-network-grid"><aside class="social-network-rail panel noise"><div class="social-rail-head"><span class="t-micro g400">NETWORK</span><span class="t-micro ink-3">${signedIn ? "ACCOUNT SYNC" : "GUEST VIEW"}</span></div><nav class="social-rail-nav" role="tablist" aria-label="Social views">${tabs.map(([id, label]) => `<button class="social-tab${state.socialTab === id ? " is-active" : ""}" type="button" role="tab" aria-selected="${state.socialTab === id}" data-social-tab="${id}"><span class="t-label f11">${label}</span><span class="social-tab-count">${id === "friends" ? social.friends?.length || 0 : id === "requests" ? count : id === "invites" ? social.invites?.length || 0 : id === "recent" ? social.recentPlayers?.length || 0 : social.notifications?.filter((item) => !item.readAt).length || 0}</span></button>`).join("")}</nav></aside><section class="social-feed panel noise" aria-labelledby="social-${surfaceKey}-feed-title"><div class="social-feed-head"><div><span class="t-micro g400">ACTIVE FEED</span><h3 class="t-section g100" id="social-${surfaceKey}-feed-title">${activeLabel}</h3></div><span class="t-micro ink-3">${signedIn ? "SERVER-SYNCED" : "READ-ONLY SEARCH"}</span></div><div class="social-surface-body thin-scroll">${body}</div></section><aside class="social-context panel noise" aria-labelledby="social-${surfaceKey}-context-title"><div class="social-context-head"><div><span class="t-micro g400">TABLE CONTEXT</span><h3 class="t-section g100" id="social-${surfaceKey}-context-title">People nearby</h3></div><span class="t-micro ink-3">${state.phase === "home" ? "NO ROOM" : "IN ROOM"}</span></div><div class="social-context-stats"><div><span class="t-micro ink-3">ROOM</span><strong class="t-label f11 g100">${state.phase === "home" ? "—" : esc(state.roomCode || "PUBLIC")}</strong></div><div><span class="t-micro ink-3">SEATED</span><strong class="t-label f11 green">${state.phase === "home" ? "—" : state.players.length}</strong></div></div><div class="social-context-roster">${socialRoomRosterHTML()}</div><div class="social-context-foot"><span class="t-micro g400">PRIVACY</span><span class="t-body ink-2">Only public identity and relationship actions are shown here. Cash, loans, and hidden match details stay private.</span></div></aside></div></div>`;
}

function openInGameSocialSurface(kind) {
  if (!["setup", "lobby", "playing"].includes(state.phase)) return false;
  if (kind === "rankings") {
    renderRankingsSurface("#rankings-card");
    openSurface("#rankings-modal", "#rankings-close");
  } else if (kind === "social") {
    renderSocialSurface("#social-card");
    openSurface("#social-modal", "#social-close");
    emitServer("get-social-data", {}, (response) => {
      if (response?.success && response.social) {
        state.social = response.social;
        renderSocialSurface("#social-card");
      }
    });
  } else {
    return false;
  }
  return true;
}

function openRankingsSurface(metric = "wins", scope = state.leaderboard.scope || "all") {
  state.leaderboard.metric = ["wins", "games", "rate", "achievements", "mythical", "bankruptcies", "events", "auctions", "rent", "casino", "market", "playerloans", "equity", "loans", "patrol"].includes(metric) ? metric : "wins";
  state.leaderboard.scope = ["all", "month", "friends"].includes(scope) ? scope : "all";
  showView("rankings");
  renderRankingsSurface("#rankings-page-content");
  state.leaderboard.loading = true;
    emitServer("get-leaderboard-snapshot", { scope: state.leaderboard.scope }, (snapshot) => {
      state.leaderboard.loading = false;
      if (snapshot?.success) {
        state.leaderboard.snapshots = snapshot.metrics || {};
        state.leaderboard.generatedAt = snapshot.generatedAt || null;
        state.leaderboard.scope = snapshot.scope || state.leaderboard.scope;
        state.leaderboard.rows = state.leaderboard.snapshots[state.leaderboard.metric] || state.leaderboard.rows;
      }
      renderRankingsSurface("#rankings-page-content");
    });
}

const RANKING_LABELS = { wins: "WINS", rate: "WIN RATE", games: "GAMES", achievements: "ACHIEVEMENT SCORE", mythical: "MYTHICAL", bankruptcies: "BANKRUPTCIES", events: "EVENT SURVIVAL", auctions: "AUCTION WINS", rent: "RENT COLLECTED", casino: "CASINO NET", market: "MARKET PROFIT", playerloans: "PLAYER LOANS", equity: "EQUITY DEALS", loans: "LOAN DISCIPLINE", patrol: "PATROL BEST" };

function rankingValueLabel(metric, value) {
  if (metric === "rate") return `${Number(value) || 0}%`;
  if (["rent", "casino", "market"].includes(metric)) return `$${(Number(value) || 0).toLocaleString()}`;
  return String(Number(value) || 0);
}

function rankingMetricColumnHTML(metric, rows) {
  const label = RANKING_LABELS[metric];
  const topRows = rows.slice(0, 3);
  return `<section class="ranking-metric-column" aria-labelledby="ranking-column-${metric}"><div class="ranking-column-head"><div><span class="t-micro g400">${label}</span><strong class="t-label f12 g100" id="ranking-column-${metric}">${topRows.length ? `TOP ${topRows.length}` : "NO VERIFIED PLAYERS"}</strong></div><button class="btn-dark ranking-column-action" type="button" data-ranking-metric="${metric}" aria-label="View full ${label.toLowerCase()} ranking"><span class="t-label f11">VIEW</span></button></div><div class="ranking-column-list">${topRows.length ? topRows.map((row, index) => `<button class="ranking-mini-row" type="button" data-ranking-player="${esc(row.accountId)}"><span class="ranking-mini-place">${String(index + 1).padStart(2, "0")}</span><span class="ranking-mini-avatar">${avatarHTML(row, 2, index)}</span><span class="ranking-mini-name"><strong class="t-label f11 g100">${esc(row.displayName)}</strong><span class="t-micro ink-3">@${esc(row.username)}</span></span><strong class="ranking-mini-value t-label f12 ${metric === "rate" ? "g300" : "green"}">${rankingValueLabel(metric, row.value)}</strong></button>`).join("") : `<span class="ranking-column-empty t-micro ink-3">NO VERIFIED DATA</span>`}</div></section>`;
}

function renderRankingsSurface(target = "#rankings-card") {
  const card = $(target) || $("#rankings-card");
  if (!card) return;
  const pageSurface = card.id === "rankings-page-content";
  const surfaceKey = pageSurface ? "page" : "modal";
  const snapshots = state.leaderboard.snapshots || {};
  const currentRows = snapshots[state.leaderboard.metric] || state.leaderboard.rows || [];
  const selfId = state.account?.account?.id;
  const selfIndex = selfId ? currentRows.findIndex((row) => row.accountId === selfId) : -1;
  const selfRow = selfIndex >= 0 ? currentRows[selfIndex] : null;
  const selfRank = selfRow ? `#${selfIndex + 1}` : "—";
  const metrics = Object.entries(RANKING_LABELS).map(([id, label]) => `<button class="ranking-metric${state.leaderboard.metric === id ? " is-active" : ""}" type="button" data-ranking-metric="${id}" aria-pressed="${state.leaderboard.metric === id}"><span class="t-label f11">${label}</span></button>`).join("");  const scopes = [["all", "ALL TIME"], ["month", "30 DAYS"], ["friends", "FRIENDS"]].map(([id, label]) => `<button class="ranking-scope${state.leaderboard.scope === id ? " is-active" : ""}" type="button" data-ranking-scope="${id}" aria-pressed="${state.leaderboard.scope === id}"><span class="t-label f11">${label}</span></button>`).join("");
  const rows = state.leaderboard.loading ? `<p class="t-body ink-3 social-empty">LOADING VERIFIED RANKINGS…</p>` : currentRows.length ? currentRows.map((row, index) => `<button class="ranking-row" type="button" data-ranking-player="${esc(row.accountId)}"><span class="ranking-place t-label f13">${String(index + 1).padStart(2, "0")}</span><span class="ranking-avatar">${avatarHTML(row, 3, index)}</span><span class="ranking-player"><strong class="t-label f12 g100">${esc(row.displayName)}</strong><span class="t-micro ink-3">@${esc(row.username)} · ${row.games} GAMES · ${row.wins} WINS</span></span><strong class="ranking-value t-label f16 ${state.leaderboard.metric === "rate" ? "g300" : "green"}">${rankingValueLabel(state.leaderboard.metric, row.value)}</strong></button>`).join("") : `<p class="t-body ink-3 social-empty">NO VERIFIED PLAYERS YET.</p>`;
  const syncLabel = state.leaderboard.generatedAt ? `SYNCED ${new Date(state.leaderboard.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "WAITING FOR SERVER";
  card.innerHTML = `<div class="rankings-page-shell ${pageSurface ? "is-page" : "is-modal"}"><section class="rankings-hero panel noise"><div class="rankings-hero-mark"><img src="/assets/rankings-podium.svg" alt="" width="32" height="32"></div><div class="rankings-hero-copy"><span class="t-micro g400">PARLOR RECORDS · VERIFIED</span><h2 class="t-section g100" id="rankings-${surfaceKey}-title">Global Rankings</h2><p class="t-body ink-2" id="rankings-${surfaceKey}-description">A wide standings ledger for the people who keep finishing the table.</p></div><div class="rankings-hero-stats"><div class="rankings-hero-stat"><span class="t-micro ink-3">YOUR RANK</span><strong class="t-label f20 ${selfRow ? "green" : "g-muted"}">${selfRank}</strong><span class="t-micro ink-3">${selfRow ? `${rankingValueLabel(state.leaderboard.metric, selfRow.value)} · ${RANKING_LABELS[state.leaderboard.metric]}` : "SIGN IN TO TRACK"}</span></div><div class="rankings-hero-stat"><span class="t-micro ink-3">PLAYERS</span><strong class="t-label f20 g100">${currentRows.length}</strong><span class="t-micro ink-3">VERIFIED ROWS</span></div><div class="rankings-hero-stat"><span class="t-micro ink-3">DATA</span><strong class="t-label f12 g300">${syncLabel}</strong><span class="t-micro ink-3">SERVER SNAPSHOT</span></div></div>${pageSurface ? "" : `<button class="btn-dark social-close" id="rankings-close" type="button"><span class="t-label f11">CLOSE</span></button>`}</section><section class="rankings-metric-deck" aria-label="Top players across every ranking">${Object.keys(RANKING_LABELS).map((metric) => rankingMetricColumnHTML(metric, snapshots[metric] || (metric === state.leaderboard.metric ? currentRows : []))).join("")}</section><div class="rankings-main-grid"><section class="rankings-ledger panel noise" aria-labelledby="rankings-${surfaceKey}-ledger-title"><div class="rankings-ledger-head"><div><span class="t-micro g400">FULL PLAYER LEDGER</span><h3 class="t-section g100" id="rankings-${surfaceKey}-ledger-title">${RANKING_LABELS[state.leaderboard.metric]} standings</h3></div><span class="t-micro ink-3">SORTED DESCENDING · ${state.leaderboard.scope === "all" ? "ALL TIME" : state.leaderboard.scope === "month" ? "30 DAYS" : "FRIENDS"}</span></div><div class="ranking-scopes" role="tablist" aria-label="Ranking scope">${scopes}</div><div class="ranking-metrics" role="tablist" aria-label="Primary ranking metric">${metrics}</div><div class="ranking-list thin-scroll">${rows}</div></section><aside class="rankings-context panel noise" aria-labelledby="rankings-${surfaceKey}-context-title"><div class="t-micro g400">HOW TO READ THE LEDGER</div><h3 class="t-section g100" id="rankings-${surfaceKey}-context-title">The table remembers</h3><p class="t-body ink-2">Only completed server rounds count. Win rate needs five completed games; achievement score uses rarity-weighted points. Rankings use verified server records only.</p><div class="rankings-context-list"><div><span class="t-micro ink-3">TIE BREAK</span><strong class="t-label f12 g100">WINS, THEN NAME</strong></div><div><span class="t-micro ink-3">PRIVACY</span><strong class="t-label f12 g100">PUBLIC STATS ONLY</strong></div><div><span class="t-micro ink-3">ECONOMY</span><strong class="t-label f12 g300">OPTIONAL ADD-ONS</strong></div></div><div class="rankings-context-foot"><span class="t-micro g400">DATA WINDOW</span><span class="t-body ink-2">${state.leaderboard.scope === "month" ? "Last 30 days of completed matches." : state.leaderboard.scope === "friends" ? "You and accepted friends only." : "All verified completed matches."}</span></div></aside></div></div>`;
  const rankingResults = Array.isArray(state.rankingSearchResults) && state.rankingSearchResults.length
    ? state.rankingSearchResults.map((player) => `<button class="ranking-search-result" type="button" data-ranking-player="${esc(player.id)}"><span class="t-label f12 g100">${esc(player.displayName)}</span><span class="t-micro ink-3">@${esc(player.username)}</span><span class="t-label f11 g300">VIEW</span></button>`).join("")
    : state.rankingSearchQuery ? `<span class="t-micro ink-3">NO EXACT USERNAME MATCH.</span>` : "";
  const rankingSearch = document.createElement("section");
  rankingSearch.className = "rankings-search-band panel noise";
  rankingSearch.innerHTML = `<form class="rankings-search" data-ranking-search-form><label class="rankings-search-label" for="rankings-${surfaceKey}-search"><span class="t-micro g400">FIND A PLAYER</span><input class="field" id="rankings-${surfaceKey}-search" data-ranking-search-input autocomplete="off" maxlength="16" pattern="[A-Za-z0-9_]{3,16}" placeholder="EXACT USERNAME…" value="${esc(state.rankingSearchQuery || "")}"><span class="t-micro ink-3">Exact username lookup · public identity only</span></label><button class="btn-dark rankings-search-submit" type="submit"><span class="t-label f11">FIND</span></button><div class="rankings-search-results">${rankingResults}</div></form>`;
  card.querySelector(".rankings-hero")?.insertAdjacentElement("afterend", rankingSearch);
}

const RULES_SECTIONS = [
  {
    id: "start-here",
    label: "START HERE",
    kicker: "01 · QUICK BRIEF",
    title: "One table. Forty spaces. Last wallet standing.",
    status: "LIVE",
    summary: "Poorup is a real-time property game for two to four players. Roll, move clockwise, make the next legal decision, and keep the table moving.",
    content: `<div class="rules-callout"><strong class="t-label f13 g100">THE SHORT VERSION</strong><p class="t-body ink-2">Start on GO at space 0. Salvador is space 1. Every player takes a turn in order. Buy useful property, charge rent, manage cash, and survive the table longer than everyone else.</p></div><h3 class="t-section g300">A complete turn</h3><ol class="rules-steps"><li><span class="rules-step-number">01</span><div><strong class="t-label f12 g100">ROLL</strong><p class="t-body ink-2">The active player rolls the dice once. The server moves the token one space at a time.</p></div></li><li><span class="rules-step-number">02</span><div><strong class="t-label f12 g100">RESOLVE</strong><p class="t-body ink-2">Resolve the landed space, card, rent, tax, purchase, auction, or prison rule before ending the turn.</p></div></li><li><span class="rules-step-number">03</span><div><strong class="t-label f12 g100">CHOOSE</strong><p class="t-body ink-2">Buy, build, mortgage, trade, accept a loan, place a legal market action, or pass when the game allows it.</p></div></li><li><span class="rules-step-number">04</span><div><strong class="t-label f12 g100">END</strong><p class="t-body ink-2">Press End Turn only after every required decision is complete. The next player then becomes active.</p></div></li></ol><div class="rules-inline-note"><span class="t-micro g400">SOURCE OF TRUTH</span><span class="t-body ink-2">The server owns balances, movement, ownership, event outcomes, and settlement. The browser renders the latest snapshot.</span></div>`,
  },
  {
    id: "board-tiles",
    label: "BOARD & TILES",
    kicker: "02 · THE MAP",
    title: "Read the board clockwise",
    status: "LIVE",
    summary: "The board has forty spaces. The visual order and server index are the same, starting at GO space 0 and moving right across the top edge.",
    content: `<div class="rules-board-order"><div><span class="t-micro g400">CLOCKWISE INDEX</span><strong class="t-label f20 g100">0 → 39</strong></div><div><span class="t-micro g400">CORNERS</span><strong class="t-label f12 g100">GO · PASSING BY / PRISON · VACATION · GO TO PRISON</strong></div></div><h3 class="t-section g300">Space families</h3><div class="rules-term-grid"><div><strong class="t-label f12 g100">PROPERTY</strong><p class="t-body ink-2">Buy deeds, collect rent, build evenly, and group properties by their color strip.</p></div><div><strong class="t-label f12 g100">SUPPORT</strong><p class="t-body ink-2">Airports, Electric Company, and Water Company use their own settlement rules.</p></div><div><strong class="t-label f12 g100">CARD</strong><p class="t-body ink-2">Surprise and Treasure draw from separate decks. Each card resolves on the server.</p></div><div><strong class="t-label f12 g100">TAX</strong><p class="t-body ink-2">Earnings Tax and Premium Tax remove cash. The active event can add a disclosed modifier.</p></div><div><strong class="t-label f12 g100">CORNER</strong><p class="t-body ink-2">GO pays on passage, Passing By has an outside lane and prison lane, Vacation uses the optional pool, and Go to Prison sends you to prison.</p></div><div><strong class="t-label f12 g100">NEUTRAL</strong><p class="t-body ink-2">Treasure, Surprise, and Vacation do not belong to a country group.</p></div></div>`,
  },
  {
    id: "turn-flow",
    label: "TURN FLOW",
    kicker: "03 · TABLE RHYTHM",
    title: "The next legal action is always the priority",
    status: "LIVE",
    summary: "Poorup uses a small state machine so movement never skips a purchase, card, auction, or payment decision.",
    content: `<div class="rules-code-flow"><span>ROLL</span><i>→</i><span>MOVE</span><i>→</i><span>LAND</span><i>→</i><span>RESOLVE</span><i>→</i><span>END TURN</span></div><h3 class="t-section g300">Blocking decisions</h3><ul class="rules-bullets"><li>A purchase decision must be accepted, passed, or sent to auction before the turn can end.</li><li>A card choice, debt payment, trade confirmation, or bankruptcy decision temporarily owns the focus.</li><li>Only the active player can roll or perform turn-scoped actions. The server rejects stale or out-of-turn requests.</li><li>The turn timer, when enabled, advances through the same legal resolution path rather than skipping settlement.</li></ul><div class="rules-inline-note"><span class="t-micro g400">ROUND</span><span class="t-body ink-2">A round completes when every active player has received one turn. Global-event timing uses this round counter.</span></div>`,
  },
  {
    id: "cash-bank",
    label: "CASH & BANK",
    kicker: "04 · THE LEDGER",
    title: "Every dollar has a reason",
    status: "LIVE",
    summary: "Cash is server-authoritative. The bank pays rewards, collects taxes, settles purchases, and records every important transfer in the log.",
    content: `<h3 class="t-section g300">Cash rules</h3><ul class="rules-bullets"><li>Each player starts with the lobby's Starting Cash value.</li><li>Passing GO pays $200. Landing exactly on GO pays the configured Double GO amount when enabled.</li><li>Cash can move through rent, cards, taxes, prizes, trades, loans, builds, mortgages, and the Vacation pool.</li><li>Payments settle atomically. If available cash is insufficient, the game opens the legal debt or bankruptcy path instead of silently going negative.</li></ul><h3 class="t-section g300">Vacation pool</h3><p class="t-body ink-2">When Vacation Pool is on, configured taxes and penalties feed the center pool. Landing on Vacation claims the pool. The setting does not change the tile order or movement index.</p><div class="rules-warning"><span class="t-micro red">DO NOT ASSUME</span><span class="t-body ink-2">A visual cash number is not a permission to spend. The server checks current cash again when an action settles.</span></div>`,
  },
  {
    id: "properties",
    label: "PROPERTIES",
    kicker: "05 · DEEDS",
    title: "Build a group, then make it work",
    status: "LIVE",
    summary: "Properties are grouped by their color strip. The strip is the association; the name, price, and rotation are presentation only.",
    content: `<h3 class="t-section g300">Buying</h3><p class="t-body ink-2">When you land on an unowned property, you can buy it at the printed price. If Auction is on and you pass, the deed can go to a server-run auction.</p><h3 class="t-section g300">Rent</h3><ul class="rules-bullets"><li>Rent depends on the deed, group ownership, and building level.</li><li>Owning every deed in a group activates the group's monopoly multiplier.</li><li>Mortgaged deeds do not collect normal rent until redeemed.</li><li>No Rent In Jail prevents an owner in prison from collecting rent during the configured turn.</li></ul><h3 class="t-section g300">Building</h3><p class="t-body ink-2">Build evenly across a complete group. Houses use the shared house bank. Four houses can become a hotel when a hotel is available. House and hotel limits are lobby settings.</p>`,
  },
  {
    id: "support-spaces",
    label: "SUPPORT SPACES",
    kicker: "06 · AIRPORTS & UTILITIES",
    title: "Support tiles amplify the table",
    status: "LIVE",
    summary: "Airports and utilities are independent support tiles. They are not country properties and do not change the board's physical dimensions.",
    content: `<div class="rules-term-grid"><div><strong class="t-label f12 g100">AIRPORTS</strong><p class="t-body ink-2">ACC, BKK, AMS, and MB Airport are separate deeds priced at $200. Airport effects and rent are resolved by the server.</p></div><div><strong class="t-label f12 g100">ELECTRIC COMPANY</strong><p class="t-body ink-2">A utility deed whose charge is calculated from the dice result and ownership state.</p></div><div><strong class="t-label f12 g100">WATER COMPANY</strong><p class="t-body ink-2">A utility deed with the same support-tile settlement contract and its own printed price.</p></div><div><strong class="t-label f12 g100">COLOR STRIPS</strong><p class="t-body ink-2">Only property strips define country groups. Airports and utilities never inherit a country group.</p></div></div>`,
  },
  {
    id: "cards",
    label: "SURPRISE & TREASURE",
    kicker: "07 · CARD DECKS",
    title: "A draw is a decision, not decoration",
    status: "LIVE",
    summary: "Surprise and Treasure are separate decks with classic-style movement, cash, repairs, jail, and player interaction effects.",
    content: `<h3 class="t-section g300">When a card appears</h3><p class="t-body ink-2">Landing on Surprise draws from the Surprise deck. Landing on Treasure draws from the Treasure deck. The server removes the card, resolves its action, and records the result.</p><h3 class="t-section g300">Card result patterns</h3><ul class="rules-bullets"><li>Move to a named space, with GO payment when the move passes GO.</li><li>Collect or pay a cash amount.</li><li>Collect from every player or pay every player.</li><li>Pay a repair amount per house or hotel based on your current buildings.</li><li>Go directly to prison or receive a Get Out of Prison card.</li><li>Return the card to the bottom of its deck after settlement.</li></ul><div class="rules-inline-note"><span class="t-micro g400">RESULT COPY</span><span class="t-body ink-2">Dynamic card results show the actual amount paid or received, not only the card's formula.</span></div>`,
  },
  {
    id: "trade-auction",
    label: "TRADES & AUCTIONS",
    kicker: "08 · NEGOTIATION",
    title: "Make deals without losing the ledger",
    status: "LIVE",
    summary: "Trading is player-driven, while auctions are server-timed. Both systems lock the assets they are settling before cash changes hands.",
    content: `<h3 class="t-section g300">Trades</h3><ul class="rules-bullets"><li>Trading must be enabled in the room settings.</li><li>Choose deeds and cash, send the offer, and wait for the recipient's decision.</li><li>Both players must still own the offered deeds and have the offered cash when accepted.</li><li>Houses and hotels must be resolved according to the deed rules before a property can move.</li></ul><h3 class="t-section g300">Auctions</h3><ul class="rules-bullets"><li>An auction starts when a buyer passes an unowned deed and Auction is enabled.</li><li>Players bid with available cash. The timer and leading bid are visible to the table.</li><li>The winner pays the final bid atomically or the server advances to the next valid bidder.</li><li>Disconnects and late bids cannot create a second winner.</li></ul>`,
  },
  {
    id: "build-mortgage",
    label: "BUILD & MORTGAGE",
    kicker: "09 · ASSET CONTROL",
    title: "Liquidity has a cost",
    status: "LIVE",
    summary: "Build when a group is complete and mortgage only when you understand the recovery cost. The deed manager keeps both actions visible.",
    content: `<h3 class="t-section g300">Houses and hotels</h3><p class="t-body ink-2">Construction is even across a group, limited by the shared bank, and blocked when a global event freezes building. A hotel replaces four houses on the same deed.</p><h3 class="t-section g300">Mortgage</h3><ul class="rules-bullets"><li>Mortgage releases emergency cash but disables normal rent.</li><li>Redeeming a mortgage costs the mortgage value plus the configured interest.</li><li>Bank-loan collateral locks cannot be mortgaged or traded until the loan is settled.</li><li>Bankruptcy settlement liquidates or transfers assets through the server's declared order.</li></ul>`,
  },
  {
    id: "prison-vacation",
    label: "PRISON & CORNERS",
    kicker: "10 · CORNER RULES",
    title: "Passing by is two lanes in one corner",
    status: "LIVE",
    summary: "The Passing By / Prison corner is one board space with an outside lane and an interior prison lane. Landing on it and passing it are different outcomes.",
    content: `<div class="rules-callout"><strong class="t-label f13 g100">PASSING BY LANE</strong><p class="t-body ink-2">A player who simply passes the corner continues around the outside lane. They are not in prison.</p><strong class="t-label f13 g100">PRISON LANE</strong><p class="t-body ink-2">A player sent to prison or landing on the prison area is shown inside the bars. Their movement and rent rules follow the prison state.</p></div><h3 class="t-section g300">Leaving prison</h3><ul class="rules-bullets"><li>Pay the configured fine.</li><li>Use a Get Out of Prison card.</li><li>Roll the required doubles path when the rules allow it.</li></ul><p class="t-body ink-2">Go to Prison sends the player directly to prison without collecting a passage reward. Vacation is a neutral corner and can hold the optional pool.</p>`,
  },
  {
    id: "loans",
    label: "LOANS & BANKRUPTCY",
    kicker: "11 · FINANCING",
    title: "Borrow only when the table can carry it",
    status: "LIVE",
    summary: "Player loans and bank loans are separate contracts. Both are recorded, visible, and resolved before a player can quietly spend beyond their means.",
    content: `<h3 class="t-section g300">Bank loans</h3><ul class="rules-bullets"><li>Bank loans are optional and use a maturity date, premium, and collateral lock.</li><li>Collateral cannot be traded or mortgaged while pledged.</li><li>Global events may add a disclosed surcharge or pause new offers, but cannot rewrite a settled payment.</li><li>Default enters the server bankruptcy path and liquidates the declared collateral.</li></ul><h3 class="t-section g300">Player loans</h3><p class="t-body ink-2">A player-to-player loan or equity deal is a social contract recorded in the room history. The server validates the transfer, but players negotiate the terms.</p><h3 class="t-section g300">Bankruptcy</h3><p class="t-body ink-2">Elimination removes a busted player from the active turn order. Debt Deal mode can transfer assets and keep the player in the table when the room setting allows it.</p>`,
  },
  {
    id: "global-events",
    label: "GLOBAL EVENTS",
    kicker: "12 · HEADLINES",
    title: "Rare headlines change the weather",
    status: "LIVE",
    summary: "Global Events are optional, server-authoritative, and shared by the whole table. They scale with round progress instead of exposing a pile of tuning sliders.",
    content: `<h3 class="t-section g300">Lifecycle</h3><div class="rules-code-flow"><span>ELIGIBLE</span><i>→</i><span>WARNING</span><i>→</i><span>ACTIVE</span><i>→</i><span>RECOVERY</span><i>→</i><span>ENDED</span></div><ul class="rules-bullets"><li>Early rounds establish the economy. Negative crises are not eligible immediately.</li><li>A warning appears before a negative modifier activates.</li><li>One event normally runs at a time. Curated combinations are capped and named.</li><li>Duration, rarity, and severity derive from round progress and event tier.</li><li>The banner, event log, and reconnect snapshot show the same remaining-round count.</li></ul><h3 class="t-section g300">What events can touch</h3><p class="t-body ink-2">Events may affect rent, construction, taxes, loans, support tiles, casino limits, market prices, volatility, and recovery. They never silently change a committed transaction.</p><div class="rules-warning"><span class="t-micro red">FAIRNESS RULE</span><span class="t-body ink-2">A casino event can change a disclosed limit or fee. It cannot secretly change the red, black, or green odds.</span></div>`,
  },
  {
    id: "casino-market",
    label: "CASINO & MARKET",
    kicker: "13 · ECONOMY ADD-ONS",
    title: "Optional systems, clearly marked",
    status: "LIVE",
    summary: "The Casino and fictional Market are optional, server-settled room add-ons. They use board money only and remain off in classic rooms.",
    content: `<h3 class="t-section g300">Casino</h3><p class="t-body ink-2">European roulette uses red, black, and green/0 with fixed disclosed odds. It uses fictional board money only. Bets are escrowed, resolved once by the server, and logged. Players cannot use loan-funded cash for wagers.</p><h3 class="t-section g300">Market</h3><p class="t-body ink-2">The fictional exchange starts with country, airport, utilities, and property indexes. Players buy and sell without margin, shorting, options, or real-world securities. Prices update at round boundaries and event settlement.</p><h3 class="t-section g300">Shared guardrails</h3><ul class="rules-bullets"><li>Both systems are OFF by default in classic rooms.</li><li>Global Events can alter limits, fees, prices, and volatility, not hidden casino odds.</li><li>Transactions use server idempotency keys so retries cannot duplicate money.</li><li>Positions and bets appear in match history as aggregate results, without exposing other players' private details.</li></ul><div class="rules-planned"><span class="t-micro g400">OPTIONAL · VIRTUAL ECONOMY ONLY</span><span class="t-body ink-2">No deposits, withdrawals, cash-out, or cash-value prizes are part of this design.</span></div>`,
  },
  {
    id: "bots",
    label: "BOTS",
    kicker: "14 · DECISIONS",
    title: "CPU seats follow the same contracts",
    status: "LIVE",
    summary: "Bots are reserved seats in the lobby and use the same server rules as human players. They are not allowed to bypass turn gates or money checks.",
    content: `<ul class="rules-bullets"><li>Bots buy, pass, build, mortgage, trade, and bid according to a bounded risk profile.</li><li>A bot preserves a cash buffer for rent, taxes, and known obligations.</li><li>Bots never borrow money to gamble and cannot see private player information.</li><li>Bot decisions are resolved through the same action events, making them visible in the log and replayable in tests.</li><li>Future AI decision providers remain behind a deterministic fallback so a provider outage cannot stall a table.</li></ul>`,
  },
  {
    id: "social-profile",
    label: "SOCIAL & PROFILES",
    kicker: "15 · PARLOR PEOPLE",
    title: "Stay in the table while you connect",
    status: "LIVE",
    summary: "Social and profile surfaces are independent top-level pages, while in-game player cards keep friend actions inside the game shell.",
    content: `<h3 class="t-section g300">Profiles</h3><p class="t-body ink-2">A profile contains public identity, selected design, statistics, match history, and achievements. Passwords and private account data never appear on another player's public card.</p><h3 class="t-section g300">Friends</h3><ul class="rules-bullets"><li>Search uses the unique username, not the display name.</li><li>Friend requests, blocks, reports, and room invites are server records.</li><li>Clicking an in-game player opens a read-only card with social actions. The player stays in the lobby or round.</li><li>Match history is private to its owner and accepted friends by default; the owner can opt into a public summary.</li></ul><h3 class="t-section g300">Rankings</h3><p class="t-body ink-2">Rankings are global, read-only projections of completed server games, wins, five-game-qualified win rate, rarity-weighted achievement score, loan discipline, and bankruptcies.</p>`,
  },
  {
    id: "achievements",
    label: "ACHIEVEMENTS",
    kicker: "16 · RECORDS",
    title: "Badges remember the strange plays",
    status: "LIVE",
    summary: "Achievements are grouped by tablecraft, global events, social play, secrets, and Patrol. Mythical achievements are rare and announced globally.",
    content: `<ul class="rules-bullets"><li>Click an achievement to open its readable detail dialog.</li><li>Filter by category, when earned, and rarity without leaving the Profile page.</li><li>Rarity uses text and color: Common, Uncommon, Rare, Epic, Legendary, and Mythical.</li><li>Mythical unlocks create one generic server-wide announcement for every currently connected player. The title stays private until the owner reveals it.</li><li>Achievement progress is never a hidden cash requirement and does not change the rules of a live match.</li></ul>`,
  },
  {
    id: "lobby-settings",
    label: "LOBBY SETTINGS",
    kicker: "17 · HOST CONTROL",
    title: "Every switch has a consequence",
    status: "LIVE",
    summary: "Hosts configure the table before the first round. The active rules snapshot stays visible in the lobby so nobody has to guess what changed.",
    content: `<div class="rules-settings-table"><div><strong class="t-label f12 g100">Max Players</strong><span class="t-body ink-2">2–4 seats at the table.</span></div><div><strong class="t-label f12 g100">Bots</strong><span class="t-body ink-2">Reserve CPU seats up to the available capacity.</span></div><div><strong class="t-label f12 g100">Starting Cash</strong><span class="t-body ink-2">Bank handout when the round begins.</span></div><div><strong class="t-label f12 g100">Room Visibility</strong><span class="t-body ink-2">Public tables are joined from the directory and do not expose an invite code. Private tables use a six-character code.</span></div><div><strong class="t-label f12 g100">Vacation Pool</strong><span class="t-body ink-2">Taxes feed the Vacation pool when on.</span></div><div><strong class="t-label f12 g100">Double GO</strong><span class="t-body ink-2">Landing exactly on GO pays the configured bonus.</span></div><div><strong class="t-label f12 g100">Trading</strong><span class="t-body ink-2">Allow player-to-player offers.</span></div><div><strong class="t-label f12 g100">Auction</strong><span class="t-body ink-2">Send passed unowned deeds to auction.</span></div><div><strong class="t-label f12 g100">No Rent In Jail</strong><span class="t-body ink-2">Stop an imprisoned owner collecting rent that turn.</span></div><div><strong class="t-label f12 g100">Bank Loans</strong><span class="t-body ink-2">Allow emergency bank credit with collateral.</span></div><div><strong class="t-label f12 g100">Loan Severity</strong><span class="t-body ink-2">Fair, Predatory, or Extreme premium tier.</span></div><div><strong class="t-label f12 g100">Global Events</strong><span class="t-body ink-2">A single ON/OFF switch. The server derives rarity, duration, and severity from round progress.</span></div><div><strong class="t-label f12 g100">House / Hotel Limit</strong><span class="t-body ink-2">Shared bank supply for construction.</span></div><div><strong class="t-label f12 g100">Turn Timer</strong><span class="t-body ink-2">Off, 30 seconds, 60 seconds, or 2 minutes.</span></div><div><strong class="t-label f12 g100">Bankruptcy</strong><span class="t-body ink-2">Eliminate a busted player or resolve a debt deal.</span></div></div>`,
  },
  {
    id: "reconnect-accessibility",
    label: "RECONNECT & ACCESS",
    kicker: "18 · TRUST",
    title: "The table should survive the real world",
    status: "LIVE",
    summary: "Poorup is designed for a remote game night: reconnects, clear announcements, keyboard navigation, and reduced motion are part of the rules surface.",
    content: `<h3 class="t-section g300">Reconnect</h3><p class="t-body ink-2">A reconnect receives the latest server snapshot, room membership, turn stage, open obligation, event banner, and player appearance. It does not replay settled cash or card transactions.</p><h3 class="t-section g300">Accessibility</h3><ul class="rules-bullets"><li>All actions use native buttons, links, inputs, or selects.</li><li>Focus rings remain visible and blocking surfaces manage keyboard focus.</li><li>State is not communicated by color alone. Labels, symbols, and status text accompany color.</li><li>Reduced-motion preferences disable decorative movement while preserving state changes.</li><li>Audio effects and music are independent, global toggles with accessible names.</li></ul>`,
  },
];

function rulesSectionById(id) {
  return RULES_SECTIONS.find((section) => section.id === id) || RULES_SECTIONS[0];
}

function openRulesSurface(section = "start-here") {
  state.rulesSection = rulesSectionById(section).id;
  showView("rules");
  renderRulesSurface("#rules-page-content");
  requestAnimationFrame(() => {
    const target = $("#rules-book-page-scroll");
    const heading = $("#rules-book-page-heading");
    if (!target) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    heading?.focus({ preventScroll: true });
  });
}

function renderRulesSurface(target = "#rules-page-content") {
  const root = $(target);
  if (!root) return;
  const query = String(state.rulesQuery || "").trim().toLowerCase();
  const matches = (section) => !query || [section.label, section.title, section.summary, section.content].join(" ").toLowerCase().includes(query);
  const filteredSections = RULES_SECTIONS.filter(matches);
  const requested = rulesSectionById(state.rulesSection);
  const active = matches(requested) ? requested : (filteredSections[0] || null);
  if (active) state.rulesSection = active.id;
  const activeIndex = active ? RULES_SECTIONS.findIndex((section) => section.id === active.id) : -1;
  const previous = activeIndex > 0 ? RULES_SECTIONS[activeIndex - 1] : null;
  const next = activeIndex >= 0 && activeIndex < RULES_SECTIONS.length - 1 ? RULES_SECTIONS[activeIndex + 1] : null;
  const article = active
    ? `<article class="rules-book-page noise" aria-labelledby="rules-book-page-heading"><div class="rules-book-page-scroll thin-scroll" id="rules-book-page-scroll"><div class="rules-article-head"><div><span class="t-micro g400">${active.kicker}</span><h2 class="t-section g100" id="rules-book-page-heading" tabindex="-1">${active.title}</h2><p class="t-body ink-2 rules-article-summary">${active.summary}</p></div><div class="rules-article-meta"><span class="rules-status rules-status-${active.status.toLowerCase()}">${active.status}</span><span class="t-micro ink-3">${String(activeIndex + 1).padStart(2, "0")} / ${String(RULES_SECTIONS.length).padStart(2, "0")}</span></div></div><div class="rules-article-body">${active.content}</div></div><footer class="rules-book-page-footer"><button class="btn-dark rules-page-turn" type="button" data-rules-section="${previous?.id || ""}" ${previous ? "" : "disabled"} aria-label="Previous chapter"><span aria-hidden="true">‹</span><span class="t-label f11">${previous ? `PREVIOUS · ${previous.label}` : "FIRST CHAPTER"}</span></button><span class="t-micro ink-3">CHAPTER ${String(activeIndex + 1).padStart(2, "0")} · FIELD MANUAL</span><button class="btn-dark rules-page-turn" type="button" data-rules-section="${next?.id || ""}" ${next ? "" : "disabled"} aria-label="Next chapter"><span class="t-label f11">${next ? `NEXT · ${next.label}` : "LAST CHAPTER"}</span><span aria-hidden="true">›</span></button></footer></article>`
    : `<article class="rules-book-page"><div class="rules-book-page-scroll"><div class="rules-empty"><span class="t-micro g400">NO MATCH IN THIS MANUAL</span><strong class="t-label f13 g100">Try another phrase.</strong></div></div></article>`;
  root.innerHTML = `<div class="rules-shell">
    <div class="rules-intro panel noise">
      <div class="rules-intro-icon"><img src="/assets/rules-book.svg" alt="" width="36" height="36"></div>
      <div class="rules-intro-copy"><div class="t-micro g400">AFTER-HOURS FIELD MANUAL</div><h1 class="t-section g100" id="rules-page-title">Poorup Rules</h1><p class="t-body ink-2">A readable guide to the board, the economy, the people, and the systems that keep a table fair.</p></div>
      <div class="rules-intro-meta"><span class="t-micro ink-3">REFERENCE BUILD</span><strong class="t-label f12 g100">v2.4 · LIVE CONTRACTS</strong></div>
    </div>
    <div class="rules-toolbar panel noise" role="search"><label class="rules-search-label" for="rules-search"><span class="t-micro g400">FIND IN RULES</span><input class="field" id="rules-search" type="search" value="${esc(state.rulesQuery || "")}" placeholder="SEARCH THE FIELD MANUAL…" autocomplete="off"></label><span class="t-micro ink-3 rules-search-count" id="rules-search-count">${matches(RULES_SECTIONS).length} SECTIONS</span></div>
    <div class="rules-book-spread">
      <aside class="rules-index panel noise" aria-label="Rules sections"><div class="rules-index-head"><span class="t-micro g400">CONTENTS</span><span class="t-micro ink-3">${RULES_SECTIONS.length} CHAPTERS</span></div><nav class="rules-index-nav" aria-label="Rules chapters">${RULES_SECTIONS.map((section, index) => `<button class="rules-index-link${section.id === active?.id ? " is-active" : ""}${matches(section) ? "" : " is-filtered"}" type="button" data-rules-section="${section.id}" aria-current="${section.id === active?.id ? "page" : "false"}"><span class="rules-index-number">${String(index + 1).padStart(2, "0")}</span><span>${section.label}</span><span class="rules-status rules-status-${section.status.toLowerCase()}">${section.status}</span></button>`).join("")}</nav></aside>
      ${article}
    </div>
  </div>`;
  hydrateSprites(root);
  const count = root.querySelector("#rules-search-count");
  if (count) count.textContent = `${filteredSections.length} SECTIONS`;
}

function openPlayerSurface(playerId) {
  const player = state.players.find((candidate) => String(candidate.serverId || candidate.id) === String(playerId));
  state.selectedPlayer = player ? { ...player } : { id: playerId, accountId: playerId, displayName: "PLAYER", color: "#cfa75f" };
  state.selectedPlayerRelationship = "none";
  state.selectedPlayerView = "profile";
  state.selectedPlayerHistory = null;
  state.selectedPlayerHistoryScope = "all";
  renderPlayerSurface();
  openSurface("#player-modal", "#player-modal-close");
  if (state.selectedPlayer.accountId) emitServer("get-public-player-card", { accountId: state.selectedPlayer.accountId }, (response) => {
    if (response?.success && response.player) {
      state.selectedPlayer = { ...state.selectedPlayer, ...response.player };
      state.selectedPlayerRelationship = response.relationship;
      renderPlayerSurface();
    }
  });
}

function playerHistoryHTML(history, player) {
  const scope = state.selectedPlayerHistoryScope || "all";
  const filtered = history.filter(entry => {
    if (scope === "global") return Array.isArray(entry.globalEvents) && entry.globalEvents.length > 0;
    if (scope === "with-me") {
      if (Array.isArray(entry.participants)) return entry.participants.some(item => item.sharedWithViewer === true || item.accountId === (state.account?.account?.id || "__owner__"));
      return false;
    }
    return true;
  });
  if (!filtered.length) return '<p class="t-body ink-3 social-empty">NO MATCHES IN THIS HISTORY VIEW.</p>';
  return filtered.map((entry, index) => {
    const participant = Array.isArray(entry.participants)
      ? entry.participants.find(item => item.isViewedPlayer === true || item.accountId === (player.accountId || player.id))
      : null;
    const won = participant ? participant.finalPlacement === 1 : entry.won === true || entry.result === 'WIN';
    const date = String(entry.completedAt || entry.playedAt || '').slice(0, 10) || 'UNKNOWN DATE';
    const participants = Array.isArray(entry.participants) ? entry.participants.length : '—';
    const events = Array.isArray(entry.globalEvents) ? entry.globalEvents.length : 0;
    const combos = Array.isArray(entry.eventCombinations) ? entry.eventCombinations.length : 0;
    const deeds = participant?.propertyCount ?? entry.properties ?? 0;
    return '<article class="player-history-row' + (won ? ' is-win' : '') + '"><div class="player-history-main"><span class="t-micro ink-3">' + date + ' · MATCH ' + String(history.length - index).padStart(2, '0') + '</span><strong class="t-label f12 ' + (won ? 'green' : 'g100') + '">' + (won ? 'WIN' : 'ROUND COMPLETE') + '</strong></div><div class="player-history-meta"><span class="t-micro ink-3">' + participants + ' PLAYERS</span><span class="t-micro ink-3">' + deeds + ' DEEDS</span><span class="t-micro ' + (events ? 'g300' : 'ink-3') + '">' + events + ' EVENTS</span><span class="t-micro ' + (combos ? 'g300' : 'ink-3') + '">' + combos + ' COMBOS</span></div></article>';
  }).join('');
}

function renderPlayerSurface() {
  const card = $("#player-card");
  const player = state.selectedPlayer;
  if (!card || !player) return;
  const accountId = player.accountId || player.id;
  if (state.selectedPlayerView === "history") {
    const history = state.selectedPlayerHistory || [];
    const scopes = [["all", "ALL"], ["with-me", "WITH ME"], ["global", "GLOBAL EVENTS"]].map(([id, label]) => `<button class="player-history-scope${state.selectedPlayerHistoryScope === id ? " is-active" : ""}" type="button" data-player-history-scope="${id}" aria-pressed="${state.selectedPlayerHistoryScope === id}"><span class="t-label f11">${label}</span></button>`).join("");
    card.innerHTML = `<div class="social-surface-head"><div><div class="t-micro g400">PLAYER RECORD · SHARED VIEW</div><h2 class="t-section g100" id="player-modal-title">${esc(player.displayName || player.name)}</h2><p class="t-body ink-2" id="player-modal-description">Recent completed matches visible to you.</p></div><button class="btn-dark social-close" id="player-modal-close" type="button"><span class="t-label f11">CLOSE</span></button></div><div class="player-history-scopes" role="tablist" aria-label="Match history scope">${scopes}</div><div class="player-history-list thin-scroll">${playerHistoryHTML(history, player)}</div><button class="btn-dark social-back" id="player-modal-back" type="button"><span class="t-label f11">BACK TO PLAYER</span></button>`;
    return;
  }
  const friendStatus = state.selectedPlayerRelationship !== "none"
    ? state.selectedPlayerRelationship
    : (state.social.friends || []).some(friend => friend.id === accountId) ? "accepted" : "none";
  const isSelf = player.id === "p1";
  const canSocial = Boolean(player.accountId && !isSelf);
  const friendLabel = friendStatus === "accepted" ? "FRIENDS" : friendStatus === "requested" ? "REQUEST SENT" : "SEND FRIEND REQUEST";
  card.innerHTML = `<div class="social-surface-head"><div><div class="t-micro g400">PLAYER CARD · IN THIS ROOM</div><h2 class="t-section g100" id="player-modal-title">${esc(player.displayName || player.name)}</h2><p class="t-body ink-2" id="player-modal-description">Public details only. Private cash, loans, and hidden records stay hidden.</p></div><button class="btn-dark social-close" id="player-modal-close" type="button"><span class="t-label f11">CLOSE</span></button></div><div class="player-profile-head"><div class="player-profile-avatar">${avatarHTML(player, 6, 0)}</div><div><strong class="t-label f14 g100">${esc(player.displayName || player.name)}</strong><span class="t-micro ink-3">${player.online === false ? "OFFLINE" : "IN THIS ROOM"}</span></div></div><div class="player-profile-facts"><div><span class="t-micro ink-3">GAMES</span><strong class="t-label f13 g100">${player.stats?.gamesPlayed ?? "—"}</strong></div><div><span class="t-micro ink-3">WINS</span><strong class="t-label f13 green">${player.stats?.wins ?? "—"}</strong></div><div><span class="t-micro ink-3">ACHIEVEMENTS</span><strong class="t-label f13 g300">${player.achievementsPrivate ? "PRIVATE" : (player.achievements?.length ?? "—")}</strong></div><div><span class="t-micro ink-3">MUTUAL FRIENDS</span><strong class="t-label f13 g300">${player.mutualFriends ?? "—"}</strong></div></div><div class="player-profile-actions"><button class="cta-red" type="button" data-player-action="friend" ${canSocial && friendStatus !== "accepted" && friendStatus !== "requested" ? "" : "disabled"}><span class="cta-text cta-text-sm">${friendLabel}</span></button><button class="btn-dark" type="button" data-player-action="invite" ${canSocial ? "" : "disabled"}><span class="t-label f11">INVITE TO ROOM</span></button><button class="btn-dark" type="button" data-player-action="history" ${canSocial && !player.historyPrivate ? "" : "disabled"}><span class="t-label f11">MATCH HISTORY</span></button><button class="btn-dark" type="button" data-player-action="block" ${canSocial ? "" : "disabled"}><span class="t-label f11">BLOCK</span></button><button class="btn-dark" type="button" data-player-action="report" ${canSocial ? "" : "disabled"}><span class="t-label f11">REPORT</span></button></div>`;
  if (Array.isArray(player.recentMatches)) {
    const recent = player.recentMatches.slice(0, 3).map((match) => {
      const participant = (match.participants || []).find((entry) => entry.displayNameAtMatch === player.displayName);
      const placement = participant?.finalPlacement === 1 ? "WIN" : participant?.finalPlacement ? "PLACE " + participant.finalPlacement : "MATCH";
      return '<div class="player-profile-match"><span class="t-micro ink-3">' + esc(String(match.completedAt || "").slice(0, 10)) + '</span><strong class="t-label f11 ' + (placement === "WIN" ? "green" : "g100") + '">' + placement + '</strong><span class="t-micro ink-3">' + (match.participants || []).length + ' PLAYERS · ' + (match.globalEvents || []).length + ' EVENTS</span></div>';
    }).join("");
    card.insertAdjacentHTML("beforeend", '<section class="player-profile-recent"><div class="t-micro g400">RECENT MATCHES</div>' + (recent || '<span class="t-micro ink-3">NO PUBLIC MATCHES YET.</span>') + '</section>');
  }
}

function clearNightShiftTargetTimer(target) {
  const id = target?.dataset?.targetId;
  if (!id) return;
  const timers = nightShiftTargetTimers.get(id);
  if (!timers) return;
  clearTimeout(timers.reveal);
  clearTimeout(timers.disable);
  clearTimeout(timers.miss);
  nightShiftTargetTimers.delete(id);
}

function triggerNightShiftHomeEffect(x, y, kind) {
  const effects = $("#night-effects");
  if (!effects) return;
  const smoke = kind === "home-smoke";
  const selector = `[data-night-home-effect="${kind}"]`;
  let effect = effects.querySelector(selector);
  if (!effect) {
    effect = document.createElement("span");
    effect.className = `night-shift-effect night-shift-home-${smoke ? "smoke" : "impact"}`;
    effect.dataset.nightHomeEffect = kind;
    effect.innerHTML = smoke
      ? '<img src="/assets/parlor-patrol/smoke-6-frames.svg" alt="" width="80" height="64">'
      : '<img src="/assets/parlor-patrol/impact-8-frames.svg" alt="" width="64" height="64">';
    effects.appendChild(effect);
  }
  const width = smoke ? 80 : 64;
  const height = 64;
  const maxX = Math.max(width / 2, effects.clientWidth - width / 2);
  const maxY = Math.max(height / 2, effects.clientHeight - height / 2);
  const visibleX = Math.max(width / 2, Math.min(maxX, x));
  const visibleY = Math.max(height / 2, Math.min(maxY, y));
  effect.style.left = `${Math.round(visibleX - (smoke ? 40 : 32))}px`;
  effect.style.top = `${Math.round(visibleY - (smoke ? 30 : 32))}px`;
  effect.classList.remove("is-burst");
  // Match Home exactly: reset the class, force layout, then restart it.
  void effect.offsetWidth;
  effect.classList.add("is-burst");
}

function scheduleNightShiftTarget(target, duration) {
  if (!target || REDUCED_MOTION) {
    if (target) target.style.pointerEvents = "auto";
    return;
  }
  const id = target.dataset.targetId;
  const timers = { reveal: null, disable: null, miss: null, settle: null, backstop: duration + 80, missElapsed: 0, missStartedAt: 0, endedWhileHidden: false };
  const settle = () => {
    if (document.hidden) {
      // The tab froze mid-flight: remember that this animation finished
      // while we were away and let the resume coordinator settle it
      // immediately instead of silently dropping the event.
      timers.endedWhileHidden = true;
      return;
    }
    if (target.isConnected && !target.dataset.hit) missNightShiftTarget(target);
    nightShiftTargetTimers.delete(id);
  };
  timers.settle = settle;
  target.style.pointerEvents = "none";
  timers.reveal = setTimeout(() => {
    if (target.isConnected && !target.dataset.hit) target.style.pointerEvents = "auto";
  }, Math.round(duration * 0.16));
  timers.disable = setTimeout(() => {
    if (target.isConnected && !target.dataset.hit) target.style.pointerEvents = "none";
  }, Math.round(duration * 0.94));
  target.addEventListener("animationend", settle, { once: true });
  timers.missStartedAt = Date.now();
  timers.miss = setTimeout(settle, timers.backstop);
  nightShiftTargetTimers.set(id, timers);
}

function spawnNightShiftEffect(x, y, kind = "impact") {
  const effects = $("#night-effects");
  if (!effects) return;
  if (kind === "home-impact" || kind === "home-smoke") {
    triggerNightShiftHomeEffect(x, y, kind);
    return;
  }
  const effect = document.createElement("span");
  const isHomeImpact = kind === "home-impact";
  const isHomeSmoke = kind === "home-smoke";
  const isAircraftBurst = kind === "drone" || kind === "airplane";
  effect.className = `night-shift-effect night-shift-dynamic ${isHomeImpact ? "night-shift-home-impact" : isHomeSmoke ? "night-shift-home-smoke" : isAircraftBurst ? "night-shift-aircraft-burst" : "is-burst"}`;
  const size = kind === "airplane" ? 128 : isAircraftBurst ? 112 : 64;
  const homeSize = isHomeSmoke ? [80, 64] : [64, 64];
  const width = isHomeImpact || isHomeSmoke ? homeSize[0] : size;
  const height = isHomeImpact || isHomeSmoke ? homeSize[1] : kind === "airplane" ? 112 : size;
  effect.style.width = `${width}px`;
  effect.style.height = `${height}px`;
  effect.style.left = `${Math.round(x - width / 2)}px`;
  effect.style.top = `${Math.round(y - height / 2)}px`;
  const src = kind === "airplane"
    ? "/assets/parlor-patrol/airplane-explosion-10-frames.svg"
    : kind === "drone"
      ? "/assets/parlor-patrol/drone-explosion-10-frames.svg"
      : isHomeSmoke
        ? "/assets/parlor-patrol/smoke-6-frames.svg"
      : "/assets/parlor-patrol/impact-8-frames.svg";
  effect.innerHTML = `<img src="${src}" alt="" width="${width}" height="${height}">`;
  effects.appendChild(effect);
  setTimeout(() => effect.remove(), isAircraftBurst ? 900 : isHomeSmoke ? 820 : isHomeImpact ? 600 : 720);
}

function spawnNightShiftTarget() {
  if (!nightShiftState.active || state.phase !== "home") return;
  if (document.hidden) return; // frozen queue: the resume coordinator re-arms
  const layer = $("#night-targets");
  if (!layer) return;
  // Alternate lanes so a short play session always exercises both edges.
  const direction = nightShiftState.targetSeq % 2 === 0 ? "left" : "right";
  const spawnNumber = nightShiftState.targetSeq;
  const roll = Math.random();
  const kind = nightShiftState.wave === 1 && spawnNumber === 2
    ? "drone"
    : nightShiftState.wave >= 4 && roll < 0.12
    ? "airplane"
    : nightShiftState.wave >= 3 && roll < 0.24
      ? "beacon"
      : nightShiftState.wave >= 2 && roll < 0.44
        ? "drone"
        : "helicopter";
  const lane = [18, 25, 32, 39, 46, 53, 60][Math.floor(Math.random() * 7)];
  const duration = kind === "airplane"
    ? Math.max(2800, 5000 - nightShiftState.wave * 180)
    : kind === "drone"
      ? Math.max(3400, 5900 - nightShiftState.wave * 220)
      : Math.max(4200, 7600 - nightShiftState.wave * 260);
  const target = document.createElement("button");
  target.type = "button";
  const isDrop = kind === "beacon" || kind === "airplane";
  target.className = isDrop ? "night-target night-target-drop night-target-beacon is-flight" : `night-target night-target-${direction} night-target-${kind} is-flight`;
  if (kind === "airplane") target.classList.replace("night-target-beacon", "night-target-airplane");
  if (isDrop) target.style.setProperty("--night-drop-left", `${[18, 32, 48, 64, 78][Math.floor(Math.random() * 5)]}%`);
  else target.style.top = `${lane}%`;
  target.style.setProperty("--night-flight-duration", `${duration}ms`);
  target.dataset.direction = direction;
  target.dataset.kind = kind;
  target.dataset.targetId = String(++nightShiftState.targetSeq);
  target.setAttribute("aria-label", `Tag Night Shift ${kind}, wave ${nightShiftState.wave}`);
  const src = kind === "beacon"
    ? "/assets/parlor-patrol/beacon-6-frames.svg"
    : kind === "drone"
      ? "/assets/parlor-patrol/drone-8-frames.svg"
      : kind === "airplane"
        ? "/assets/parlor-patrol/airplane-10-frames.svg"
      : direction === "left"
        ? "/assets/parlor-patrol/helicopter-left-16-frames.svg"
        : "/assets/parlor-patrol/helicopter-16-frames.svg";
  const size = kind === "beacon" ? [48, 48] : kind === "drone" ? [96, 64] : kind === "airplane" ? [112, 64] : [128, 64];
  target.style.width = `${size[0]}px`;
  target.style.height = `${size[1]}px`;
  target.innerHTML = `<img src="${src}" alt="" width="${size[0]}" height="${size[1]}">`;
  if (kind === "airplane" && direction === "left") target.querySelector("img")?.style.setProperty("transform", "scaleX(-1)");
  // Pointer-down gives the arcade target immediate feedback before a moving
  // button can travel between pointer press and the browser's click release.
  target.addEventListener("pointerdown", (event) => hitNightShiftTarget(target, event));
  target.addEventListener("click", (event) => hitNightShiftTarget(target, event));
  layer.appendChild(target);
  scheduleNightShiftTarget(target, duration);
}

// Spawn timers live as { due, timer } queue entries: hiding the tab freezes
// them in place and the visibilitychange coordinator re-arms each pending
// entry exactly once, so the staggered wave cadence survives a background tab.
function armNightShiftSpawn(entry) {
  entry.timer = setTimeout(() => {
    entry.timer = null;
    if (document.hidden) return;
    const index = nightShiftSpawnTimers.indexOf(entry);
    if (index !== -1) nightShiftSpawnTimers.splice(index, 1);
    spawnNightShiftTarget();
  }, Math.max(0, entry.due - Date.now()));
}

function queueNightShiftSpawn(delay) {
  const entry = { due: Date.now() + delay, timer: null };
  nightShiftSpawnTimers.push(entry);
  armNightShiftSpawn(entry);
}

function advanceNightShiftWave() {
  nightShiftWaveTimer = null;
  if (!nightShiftState.active) return;
  if (document.hidden) {
    // Do not advance waves while hidden; resume re-arms from endsAt.
    nightShiftWaveHeld = true;
    return;
  }
  nightShiftState.wave += 1;
  beginNightShiftWave();
}

function beginNightShiftWave() {
  if (!nightShiftState.active) return;
  clearNightShiftTargets();
  nightShiftState.endsAt = Date.now() + NIGHT_SHIFT_WAVE_MS;
  renderNightShiftHud(`WAVE ${String(nightShiftState.wave).padStart(2, "0")} · CLEAR THE SKYLINE`);
  const banner = $("#night-wave-banner");
  if (banner) {
    banner.textContent = `WAVE ${String(nightShiftState.wave).padStart(2, "0")}`;
    banner.classList.remove("is-announcing");
    void banner.offsetWidth;
    banner.classList.add("is-announcing");
  }
  const targetCount = Math.min(6 + nightShiftState.wave * 2, 24);
  const interval = nightShiftState.wave === 1
    ? 3000
    : Math.max(850, 5000 - nightShiftState.wave * 220);
  for (let i = 0; i < targetCount; i += 1) {
    queueNightShiftSpawn(i * interval);
  }
  nightShiftWaveTimer = setTimeout(advanceNightShiftWave, NIGHT_SHIFT_WAVE_MS);
}

function missNightShiftTarget(target) {
  if (!target?.isConnected || target.dataset.hit || target.dataset.missed) return;
  clearNightShiftTargetTimer(target);
  target.dataset.missed = "1";
  target.remove();
  if (["helicopter", "drone", "airplane"].includes(target.dataset.kind)) {
    nightShiftState.misses += 1;
    nightShiftState.hearts = Math.max(0, nightShiftState.hearts - 1);
    renderNightShiftHud(`${String(target.dataset.kind).toUpperCase()} ESCAPED · ${nightShiftState.hearts} HEART${nightShiftState.hearts === 1 ? "" : "S"} LEFT`);
    if (nightShiftState.hearts <= 0) endNightShift("SHIFT LOST · NO HEARTS LEFT");
  }
}

function submitNightShiftRun() {
  if (!nightShiftState.serverRunToken || nightShiftState.serverRunSubmitted) return;
  nightShiftState.serverRunSubmitted = true;
  emitServer("finish-patrol-run", {
    runToken: nightShiftState.serverRunToken,
    score: nightShiftState.score,
    misses: nightShiftState.misses,
  }, (response) => {
    if (response?.success === false) {
      // Surface the rejection and keep the run submittable so the next
      // start-of-run reset (or a re-issued token) can retry it.
      nightShiftState.serverRunSubmitted = false;
      parlorNotice("NIGHT SHIFT", String(response?.error || "The parlor could not verify that patrol run."));
      return;
    }
    if (response?.best != null) nightShiftState.best = Math.max(nightShiftState.best, Number(response.best) || 0);
    if (response?.score != null) {
      const score = Number(response.score) || 0;
      if (score >= 10) unlockAchievement("patrol-rookie");
      if (score >= 50) unlockAchievement("patrol-regular");
      if (score > 0 && Number(response.misses) === 0) unlockAchievement("clean-run");
      if (Number(response.aceRuns) >= 3) unlockAchievement("patrol-ace");
    }
  });
}

function endNightShift(message) {
  if (!nightShiftState.active) return;
  nightShiftState.active = false;
  clearNightShiftTimers();
  clearNightShiftTargets();
  nightShiftState.best = Math.max(nightShiftState.best, nightShiftState.score);
  if (!state.account?.account) {
    if (nightShiftState.score >= 10) unlockAchievement("patrol-rookie");
    if (nightShiftState.score >= 50) unlockAchievement("patrol-regular");
    if (nightShiftState.score > 0 && nightShiftState.misses === 0) unlockAchievement("clean-run");
  }
  submitNightShiftRun();
  try { localStorage.setItem(NIGHT_SHIFT_BEST_KEY, String(nightShiftState.best)); } catch { /* storage unavailable */ }
  renderNightShiftHud(`${message} · FINAL ${String(nightShiftState.score).padStart(4, "0")} · ESC TO EXIT`);
  const banner = $("#night-wave-banner");
  if (banner) {
    banner.textContent = message.includes("LOST") ? "SHIFT LOST" : "SHIFT CLEAR";
    banner.classList.remove("is-announcing");
    void banner.offsetWidth;
    banner.classList.add("is-announcing");
  }
  nightShiftResultEndsAt = Date.now() + 2600;
  scheduleNightShiftResult();
}

function hitNightShiftTarget(target, event) {
  if (!nightShiftState.active || state.phase !== "home" || !target?.isConnected || target.dataset.hit) return;
  // Measure the transformed, live position before clearing the flight class.
  // This mirrors Home's hit path and prevents effects from snapping back to
  // the left/right/top spawn edge.
  const rect = target.getBoundingClientRect();
  const atmosphere = $("#night-shift");
  const area = atmosphere?.getBoundingClientRect();
  if (!area) return;
  const pointerX = Number(event?.clientX) > 0 ? Number(event.clientX) : rect.left + rect.width / 2;
  const pointerY = Number(event?.clientY) > 0 ? Number(event.clientY) : rect.top + rect.height / 2;
  const hitX = pointerX - area.left;
  const hitY = pointerY - area.top;
  target.dataset.hit = "1";
  clearNightShiftTargetTimer(target);
  target.classList.remove("is-flight");
  const direction = target.dataset.direction === "left" ? -1 : 1;
  const kind = target.dataset.kind || "helicopter";
  if (kind !== "helicopter") target.classList.add("is-popping");
  const crashArt = target.querySelector("img");
  if (kind !== "helicopter") {
    if (crashArt) crashArt.style.transform = ["drone", "airplane"].includes(kind) && direction === -1 ? "scaleX(-1)" : "";
    if (REDUCED_MOTION) {
      target.style.opacity = "0";
      spawnNightShiftEffect(hitX, hitY, kind);
      setTimeout(() => target.remove(), 160);
    } else {
      target.animate([
        { transform: "translate3d(0, 0, 0) scale(0.96)", opacity: 0.9 },
        { transform: `translate3d(0, -8px, 0) scale(1.04)`, opacity: 0.95 },
        { transform: "translate3d(0, 0, 0) scale(1.02)", opacity: 0 },
      ], { duration: 360, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" });
      setTimeout(() => {
        if (!target.isConnected) return;
        spawnNightShiftEffect(hitX, hitY, kind);
        target.remove();
      }, 280);
    }
  } else {
    target.remove();
    // Match the Home patrol feedback: a compact impact flash and a short
    // stepped smoke trail begin at the exact point of the shot.
    spawnNightShiftEffect(hitX, hitY, "home-impact");
    spawnNightShiftEffect(hitX, hitY + 8, "home-smoke");
  }
  const points = kind === "helicopter"
    ? 100 + nightShiftState.wave * 25
    : kind === "drone"
      ? 75 + nightShiftState.wave * 10
      : kind === "airplane"
        ? 180 + nightShiftState.wave * 20
        : 50 + nightShiftState.wave * 5;
  nightShiftState.score += points;
  nightShiftState.best = Math.max(nightShiftState.best, nightShiftState.score);
  try { localStorage.setItem(NIGHT_SHIFT_BEST_KEY, String(nightShiftState.best)); } catch { /* storage unavailable */ }
  playPatrolHitSound();
  renderNightShiftHud(`TAGGED +${points} · WAVE ${String(nightShiftState.wave).padStart(2, "0")}`);
}

function startNightShift() {
  if (state.phase !== "home" || nightShiftState.active) return;
  // A stale room session may still emit snapshots while the player is Home.
  // Keep this local arcade layer isolated until the player explicitly joins again.
  clearNightShiftTimers();
  nightShiftSuppressSnapshot = state.suppressRoomUpdates;
  state.suppressRoomUpdates = true;
  stopHomeHelicopter();
  stopHomeClock();
  nightShiftState.active = true;
  nightShiftState.wave = 1;
  nightShiftState.score = 0;
  nightShiftState.hearts = NIGHT_SHIFT_START_HEARTS;
  nightShiftState.targetSeq = 0;
  nightShiftState.misses = 0;
  nightShiftState.serverRunToken = null;
  nightShiftState.serverRunSubmitted = false;
  if (state.account?.account) {
    emitServer("start-patrol-run", {}, (response) => {
      if (response?.success) {
        nightShiftState.serverRunToken = response.runToken;
        if (!nightShiftState.active) submitNightShiftRun();
      }
    });
  }
  renderPatrolHud("NIGHT SHIFT ACTIVE · CLEAR THE SKYLINE");
  document.body.classList.add("night-shift-open");
  const surface = $("#night-shift");
  surface?.classList.remove("is-hidden");
  surface?.setAttribute("aria-hidden", "false");
  hydrateSprites(surface || document);
  $("#night-exit")?.focus({ preventScroll: true });
  nightShiftTickTimer = setInterval(() => renderNightShiftHud(), 200);
  beginNightShiftWave();
}

function stopNightShift() {
  clearNightShiftTimers();
  nightShiftPausedAt = 0;
  nightShiftState.active = false;
  state.suppressRoomUpdates = nightShiftSuppressSnapshot;
  clearNightShiftTargets();
  nightShiftResultEndsAt = 0;
  document.body.classList.remove("night-shift-open");
  document.body.classList.remove("night-shift-paused");
  $("#night-wave-banner")?.classList.remove("is-announcing");
  $("#night-shift")?.classList.add("is-hidden");
  $("#night-shift")?.setAttribute("aria-hidden", "true");
  renderNightShiftHud("TAG THE FLY-BYS BEFORE THEY REACH THE BORDER");
  if (state.phase === "home") {
    startHomeClock();
    renderPatrolHud();
    scheduleHomeHelicopter(4000);
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    nightShiftPausedAt = Date.now();
    if (!nightShiftState.active) {
      clearTimeout(nightShiftResultTimer);
      nightShiftResultTimer = null;
      return;
    }
    // Freeze the run: cancel every armed cadence timer but keep the queue
    // entries and the wave deadline so play resumes from the exact pause.
    if (nightShiftWaveTimer !== null) {
      clearTimeout(nightShiftWaveTimer);
      nightShiftWaveTimer = null;
      nightShiftWaveHeld = true;
    }
    nightShiftSpawnTimers.forEach((entry) => {
      if (entry.timer !== null) { clearTimeout(entry.timer); entry.timer = null; }
    });
    document.body.classList.add("night-shift-paused");
    nightShiftTargetTimers.forEach((timers) => {
      if (timers.miss !== null) {
        timers.missElapsed = Date.now() - timers.missStartedAt;
        clearTimeout(timers.miss);
        timers.miss = null;
      }
    });
    return;
  }
  if (!nightShiftState.active) {
    // Result countdown parked while hidden — re-arm for its remaining time.
    if (nightShiftResultEndsAt) scheduleNightShiftResult();
    return;
  }
  if (nightShiftPausedAt) {
    const paused = Date.now() - nightShiftPausedAt;
    nightShiftPausedAt = 0;
    nightShiftState.endsAt += paused;
    // Resume with at most one pending step each, then the normal cadence.
    if (nightShiftWaveHeld) {
      nightShiftWaveHeld = false;
      nightShiftWaveTimer = setTimeout(advanceNightShiftWave, Math.max(0, nightShiftState.endsAt - Date.now()));
    }
    nightShiftSpawnTimers.forEach((entry) => {
      if (entry.timer === null) { entry.due += paused; armNightShiftSpawn(entry); }
    });
    nightShiftTargetTimers.forEach((timers) => {
      if (!timers.settle) return;
      if (timers.endedWhileHidden) {
        // The flight truly finished while we were away: settle it now, on
        // the player's terms, instead of after a full random backstop delay.
        timers.settle();
        return;
      }
      if (timers.miss === null) {
        const remaining = Math.max(250, timers.backstop - timers.missElapsed);
        timers.missStartedAt = Date.now();
        timers.missElapsed = 0;
        timers.miss = setTimeout(timers.settle, remaining);
      }
    });
    document.body.classList.remove("night-shift-paused");
    renderNightShiftHud("NIGHT SHIFT RESUMED · CLEAR THE SKYLINE");
  }
});

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

function renderProfileLibrary() {
  const list = $("#pl-list");
  const newBtn = $("#pl-new-btn");
  const saveBtn = $("#pl-save-btn");
  const atCap = state.profiles.length >= MAX_PROFILES;
  if (newBtn) {
    newBtn.disabled = atCap;
    newBtn.querySelector(".t-label").textContent = atCap ? `MAX ${MAX_PROFILES} DESIGNS` : "+ NEW DESIGN";
  }
  if (saveBtn) {
    saveBtn.disabled = !state.profileDraft || atCap;
    saveBtn.querySelector(".cta-text").textContent = atCap ? `MAX ${MAX_PROFILES} DESIGNS` : "SAVE DESIGN";
  }
  if (!list) return;
  if (!state.profiles.length) {
    if (!state.profileDraft) {
      list.innerHTML = `<p class="pl-empty">No custom designs yet — press <strong style="color:var(--gold-300)">+ NEW DESIGN</strong> to draw your first player.</p>`;
      return;
    }
  }
  const activeId = typeof state.appearance === "string" ? state.appearance : null;
  const draft = state.profileDraft;
  const draftCard = draft && !state.editingProfileId
    ? { id: "draft", designName: draft.designName || "UNTITLED DESIGN", color: draft.color, avatarGrid: draft.grid, isDraft: true }
    : null;
  const cards = state.profiles.map((profile, i) => {
    const editing = draft && state.editingProfileId === profile.id;
    return {
      ...profile,
      designName: editing ? (draft.designName || "UNTITLED DESIGN") : profileDesignName(profile),
      color: editing ? draft.color : profile.color,
      avatarGrid: editing ? draft.grid : profile.avatarGrid,
      isEditing: Boolean(editing),
      seed: i,
    };
  });
  if (draftCard) cards.unshift(draftCard);
  list.innerHTML = cards.map((p, i) => {
    const isDraft = Boolean(p.isDraft);
    const selected = !isDraft && p.id === activeId;
    const editing = Boolean(p.isEditing);
    const entity = { color: p.color, avatarGrid: p.avatarGrid };
    return `<div class="pl-tile${selected ? " is-active" : ""}${isDraft ? " is-draft" : ""}${editing ? " is-editing" : ""}">
      ${isDraft ? `<div class="pl-tile-select pl-tile-draft" aria-label="Unsaved design preview"><span class="pl-tile-av">${avatarHTML(entity, 3, i)}</span><span class="pl-tile-info"><span class="t-label pl-tile-name" style="color:${p.color}">${esc(p.designName)}</span><span class="t-micro g400">UNSAVED DRAFT · LIVE PREVIEW</span></span></div>` : `<button class="pl-tile-select" type="button" data-profile-select="${p.id}" aria-pressed="${selected}"><span class="pl-tile-av">${avatarHTML(entity, 3, i)}</span><span class="pl-tile-info"><span class="t-label pl-tile-name" style="color:${p.color}">${esc(p.designName)}</span><span class="t-micro ink-3">${editing ? "EDITING · LIVE PREVIEW" : selected ? "ACTIVE DESIGN" : "TAP TO SELECT"}</span></span></button>`}
      <div class="pl-tile-actions">${isDraft ? `<span class="t-micro g400 pl-draft-badge">DRAFT</span>` : `<button class="btn-dark" type="button" data-profile-edit="${p.id}"><span class="t-label">EDIT</span></button><button class="btn-dark pl-delete" type="button" data-profile-delete="${p.id}"><span class="t-label">DELETE</span></button>`}</div>
    </div>`;
  }).join("");
}

/** Reflect the saved profile (or the default guest identity) across the home screen. */
function applyProfileToHomeUI() {
  const p = typeof state.appearance === "string" ? getProfileById(state.appearance) : null;
  const account = state.account?.account || null;
  const name = account?.displayName || state.alias || "PLAYER";
  const preset = getAppearanceMeta(state.appearance);
  const color = p?.color || account?.color || preset.color || "#d74438";
  const avatarSource = p || account;

  document.querySelectorAll("[data-global-you-name]").forEach((nameNode) => {
    nameNode.textContent = name;
  });
  document.querySelectorAll("[data-global-you-avatar]").forEach((avatarNode) => {
    avatarNode.innerHTML = avatarSource?.avatarGrid ? spriteFromGrid(avatarSource.avatarGrid, 3) : avatarHTML({ color }, 3, 0);
  });

  const chairName = $("#chair-name");
  if (chairName) chairName.textContent = `that's you, ${name}`;
  const chairAv = $("#chair-avatar");
  if (chairAv) chairAv.innerHTML = avatarSource?.avatarGrid ? spriteFromGrid(avatarSource.avatarGrid, 4) : avatarHTML({ color }, 4, 0);

  const resumeBtn = $("#resume-btn");
  if (resumeBtn) resumeBtn.classList.toggle("is-hidden", !loadSavedGame());
  renderGuestAliasField();
}

function renderGuestAliasField(errorText = "") {
  const field = $("#home-alias-form");
  const input = $("#home-alias");
  const error = $("#home-alias-error");
  const signedIn = Boolean(state.account?.account);
  field?.classList.toggle("is-hidden", signedIn);
  if (input && !signedIn && input.value !== state.alias) input.value = state.alias;
  if (error) error.textContent = errorText;
}

function requireGuestAlias() {
  if (state.account?.account) return true;
  const alias = String(state.alias || "").trim();
  if (alias) return true;
  renderGuestAliasField("CREATE AN ALIAS BEFORE JOINING A TABLE.");
  $("#home-alias")?.focus({ preventScroll: true });
  return false;
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

let financingPreviewMode = "loan";
let financingSurfaceMode = "offer";
const financingPreviewDraft = {
  propertyIndex: 21,
  amount: 150,
  loanRate: 20,
  loanDuration: 20,
  loanSchedule: "checkpoints",
  equityShare: 10,
  equityDuration: "permanent",
  equityControl: "passive",
  hybridRate: 10,
  hybridDuration: 20,
  hybridConversion: 25,
};

function dropdownHTML({ id, label, value, options, className = "" }) {
  const selected = options.find((option) => String(option.value) === String(value)) || options[0];
  return `<div class="parlor-dropdown ${className}" data-dropdown="${esc(id)}"><span class="t-label f11 g-muted">${esc(label)}</span><button class="parlor-dropdown-trigger field" id="${esc(id)}-trigger" type="button" aria-label="${esc(label)}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${esc(id)}-menu"><span data-dropdown-value>${esc(selected?.label || "SELECT")}</span><span class="parlor-dropdown-caret" aria-hidden="true">▾</span></button><div class="parlor-dropdown-menu" id="${esc(id)}-menu" role="listbox" tabindex="-1" hidden>${options.map((option) => `<button class="parlor-dropdown-option" type="button" role="option" aria-selected="${String(option.value) === String(selected?.value)}" data-dropdown-value-option="${esc(option.value)}">${esc(option.label)}</button>`).join("")}</div></div>`;
}

function bindDropdowns(root, onSelect) {
  if (!root) return;
  const closeMenus = (except = null) => root.querySelectorAll(".parlor-dropdown").forEach((dropdown) => {
    if (dropdown !== except) {
      const trigger = dropdown.querySelector(".parlor-dropdown-trigger");
      const menu = dropdown.querySelector(".parlor-dropdown-menu");
      trigger?.setAttribute("aria-expanded", "false");
      if (menu) menu.hidden = true;
    }
  });
  root.querySelectorAll(".parlor-dropdown").forEach((dropdown) => {
    const id = dropdown.dataset.dropdown;
    const trigger = dropdown.querySelector(".parlor-dropdown-trigger");
    const menu = dropdown.querySelector(".parlor-dropdown-menu");
    if (!trigger || !menu) return;
    const open = () => {
      closeMenus(dropdown);
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      menu.querySelector("[aria-selected=true]")?.focus({ preventScroll: true });
    };
    const close = () => {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    };
    trigger.addEventListener("click", () => (menu.hidden ? open() : close()));
    trigger.addEventListener("keydown", (event) => {
      if (["Enter", " ", "ArrowDown"].includes(event.key)) { event.preventDefault(); open(); }
    });
    menu.addEventListener("click", (event) => {
      const option = event.target.closest("[data-dropdown-value-option]");
      if (!option) return;
      const value = option.dataset.dropdownValueOption;
      dropdown.querySelectorAll("[data-dropdown-value-option]").forEach((candidate) => candidate.setAttribute("aria-selected", String(candidate === option)));
      const valueEl = dropdown.querySelector("[data-dropdown-value]");
      if (valueEl) valueEl.textContent = option.textContent;
      close();
      onSelect?.(id, value);
      trigger.focus({ preventScroll: true });
    });
    menu.addEventListener("keydown", (event) => {
      const options = [...menu.querySelectorAll("[data-dropdown-value-option]")];
      const current = options.indexOf(document.activeElement);
      if (event.key === "Escape") { event.preventDefault(); close(); trigger.focus({ preventScroll: true }); return; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); options[(current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus({ preventScroll: true }); }
      if (event.key === "Home" || event.key === "End") { event.preventDefault(); options[event.key === "Home" ? 0 : options.length - 1]?.focus({ preventScroll: true }); }
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); document.activeElement?.click(); }
    });
  });
  if (!root.dataset.dropdownOutsideBound) {
    root.addEventListener("click", (event) => { if (!event.target.closest(".parlor-dropdown")) closeMenus(); });
    root.dataset.dropdownOutsideBound = "true";
  }
}

function financingPropertyOptions() {
  return TILES.filter((tile) => tile.kind === "property").map((tile) => ({ value: tile.i, label: `${tile.name} · $${tile.price}` }));
}

function financingPreviewCopy(mode = financingPreviewMode) {
  const tile = TILES[Number(financingPreviewDraft.propertyIndex)] || TILES[21];
  const amount = Math.max(1, Math.min(Number(financingPreviewDraft.amount) || 0, Number(tile.price) || 1));
  const rent = Number(tile.rent) || Number(RENT_TABLE[tile.group]?.base) || 0;
  if (mode === "equity") {
    const share = Math.max(5, Math.min(100, Number(financingPreviewDraft.equityShare) || 10));
    const lenderRent = Math.floor((rent * share) / 100);
    const duration = financingPreviewDraft.equityDuration === "permanent" ? "FOREVER" : `${financingPreviewDraft.equityDuration} TURNS`;
    const control = String(financingPreviewDraft.equityControl || "passive").toUpperCase();
    return {
      title: `${share}% OF ${tile.name}`,
      metrics: [
        ["CONTRIBUTION", `$${amount}`],
        ["RENT SHARE", `${share}%`],
        ["BASE RENT", `$${lenderRent} OF $${rent}`],
        ["DURATION", duration],
      ],
      copy: `${share}% economic share in ${tile.name}. The investor receives ${share}% of collected rent and sale proceeds. Control: ${control}.`,
      note: share === 100 ? "100% becomes a direct transfer or buyout. No hidden loan remains." : "Passive equity does not block building. Shared control requires the group consent rules.",
    };
  }
  if (mode === "hybrid") {
    const rate = Math.max(0, Math.min(100, Number(financingPreviewDraft.hybridRate) || 0));
    const duration = Number(financingPreviewDraft.hybridDuration) || 20;
    const conversion = Math.max(5, Math.min(100, Number(financingPreviewDraft.hybridConversion) || 25));
    const maturity = amount + Math.round((amount * rate) / 100);
    return {
      title: `CONVERTIBLE NOTE · ${tile.name}`,
      metrics: [
        ["ADVANCE", `$${amount}`],
        ["PREMIUM", `${rate}%`],
        ["MATURITY", `$${maturity}`],
        ["CONVERSION", `${conversion}%`],
      ],
      copy: `$${amount} at a ${rate}% premium for ${duration} turns. If the note defaults after its cure turn, the lender may convert the outstanding balance into ${conversion}% of ${tile.name}.`,
      note: "Repayment and conversion are mutually exclusive. Interest stops when conversion happens.",
    };
  }
  const rate = Math.max(0, Math.min(100, Number(financingPreviewDraft.loanRate) || 0));
  const duration = Number(financingPreviewDraft.loanDuration) || 20;
  const premium = Math.round((amount * rate) / 100);
  const total = amount + premium;
  const schedule = financingPreviewDraft.loanSchedule === "upfront" ? "UPFRONT" : financingPreviewDraft.loanSchedule === "maturity" ? "MATURITY" : "CHECKPOINTS";
  return {
    title: `SECURED LOAN · ${tile.name}`,
    metrics: [
      ["ADVANCE", `$${amount}`],
      ["PREMIUM", `${rate}%`],
      ["TOTAL DUE", `$${total}`],
      ["TERM", `${duration} TURNS`],
    ],
    copy: `$${amount} advanced at a ${rate}% total premium for ${duration} turns. Repayment: ${schedule.toLowerCase()}. The named deed is collateral after the cure turn.`,
    note: "The lender receives a fixed return. No rent or ownership share is attached to this mode.",
  };
}

function financingPreviewHTML() {
  const preview = financingPreviewCopy();
  return `<div class="financing-preview-head"><span class="t-micro g400">CONTRACT PREVIEW</span><span class="t-label f12 g100">${esc(preview.title)}</span></div>
    <div class="financing-metrics">${preview.metrics.map(([label, value]) => `<div><span class="t-micro ink-3">${label}</span><strong class="t-label f13 g100">${esc(value)}</strong></div>`).join("")}</div>
    <p class="t-body ink-2 financing-preview-copy">${esc(preview.copy)}</p>
    <p class="t-micro ink-3 financing-preview-note">${esc(preview.note)}</p>`;
}

function financingModeFieldsHTML() {
  if (financingPreviewMode === "equity") {
    const permanent = financingPreviewDraft.equityDuration === "permanent";
    const equityTurns = permanent ? 20 : Math.max(1, Number(financingPreviewDraft.equityDuration) || 20);
    return `<div class="financing-field"><label class="t-label f11 g-muted" for="finance-equity-share">Economic share <output id="finance-equity-share-output">${financingPreviewDraft.equityShare}%</output></label><div class="financing-range"><input id="finance-equity-share" type="range" min="5" max="100" step="5" value="${financingPreviewDraft.equityShare}" /></div></div>
      <div class="financing-field-grid"><label class="financing-field"><span class="t-label f11 g-muted">Duration in turns</span><div class="financing-number"><input class="field" id="finance-equity-duration" type="number" min="1" max="100" step="1" value="${equityTurns}" ${permanent ? "disabled" : ""} /><span aria-hidden="true">TURNS</span></div></label>${dropdownHTML({ id: "finance-equity-control", label: "Control", value: financingPreviewDraft.equityControl, options: [{ value: "passive", label: "PASSIVE" }, { value: "shared", label: "SHARED" }, { value: "controlling", label: "CONTROLLING" }] })}</div><label class="financing-check"><input id="finance-equity-permanent" type="checkbox" ${permanent ? "checked" : ""} /><span class="t-label f11 g-muted">PERMANENT EQUITY</span></label>`;
  }
  if (financingPreviewMode === "hybrid") {
    return `<div class="financing-field-grid"><label class="financing-field"><span class="t-label f11 g-muted">Premium %</span><input class="field" id="finance-hybrid-rate" type="number" min="0" max="100" step="1" value="${financingPreviewDraft.hybridRate}" /></label><label class="financing-field"><span class="t-label f11 g-muted">Duration in turns</span><div class="financing-number"><input class="field" id="finance-hybrid-duration" type="number" min="1" max="100" step="1" value="${financingPreviewDraft.hybridDuration}" /><span aria-hidden="true">TURNS</span></div></label></div><div class="financing-field"><label class="t-label f11 g-muted" for="finance-hybrid-conversion">Default conversion share <output id="finance-hybrid-conversion-output">${financingPreviewDraft.hybridConversion}%</output></label><div class="financing-range"><input id="finance-hybrid-conversion" type="range" min="5" max="100" step="5" value="${financingPreviewDraft.hybridConversion}" /></div></div>`;
  }
  return `<div class="financing-field-grid"><label class="financing-field"><span class="t-label f11 g-muted">Total premium %</span><input class="field" id="finance-loan-rate" type="number" min="0" max="100" step="1" value="${financingPreviewDraft.loanRate}" /></label><label class="financing-field"><span class="t-label f11 g-muted">Duration in turns</span><div class="financing-number"><input class="field" id="finance-loan-duration" type="number" min="1" max="100" step="1" value="${financingPreviewDraft.loanDuration}" /><span aria-hidden="true">TURNS</span></div></label></div>${dropdownHTML({ id: "finance-loan-schedule", label: "Repayment schedule", value: financingPreviewDraft.loanSchedule, options: [{ value: "upfront", label: "UPFRONT" }, { value: "checkpoints", label: "CHECKPOINTS" }, { value: "maturity", label: "MATURITY" }] })}`;
}

function financingSurfaceTabsHTML() {
  const tabs = [
    ["offer", "OFFER"],
    ["contract", "CONTRACT"],
    ["ownership", "CO-OWNERSHIP"],
    ["default", "DEFAULT"],
  ];
  return `<div class="financing-surface-tabs" id="financing-surface-tabs" role="tablist" aria-label="Financing surfaces">${tabs.map(([value, label]) => `<button class="financing-surface-tab${financingSurfaceMode === value ? " is-active" : ""}" type="button" role="tab" aria-selected="${financingSurfaceMode === value}" data-financing-surface="${value}"><span class="t-label f11">${label}</span></button>`).join("")}</div>`;
}

function financingSurfaceBodyHTML() {
  if (financingSurfaceMode === "contract") {
    return `<section class="financing-surface-body" aria-labelledby="financing-contract-heading"><div class="financing-surface-kicker"><span class="t-micro g400">CONTRACT REFERENCE · LIVE TERMS</span><span class="t-label f11 green">ACTIVE · 12 TURNS LEFT</span></div><h3 class="t-section g100" id="financing-contract-heading">Secured loan · Eindhoven</h3><div class="financing-contract-grid"><div><span class="t-micro ink-3">BORROWER</span><strong class="t-label f13 g100">PLAYER</strong></div><div><span class="t-micro ink-3">LENDER</span><strong class="t-label f13 g100">PARTNER</strong></div><div><span class="t-micro ink-3">ADVANCE</span><strong class="t-label f13 g100">$150</strong></div><div><span class="t-micro ink-3">MATURITY</span><strong class="t-label f13 g100">$180</strong></div></div><div class="financing-checkpoints" aria-label="Repayment checkpoints"><span class="is-paid">TURN 5 · PAID</span><span class="is-paid">TURN 10 · PAID</span><span>TURN 15 · $38</span><span>TURN 20 · $105</span></div><p class="t-body ink-2 financing-surface-copy">The borrower keeps the deed while payments are current. The lender receives the agreed premium and the named deed remains collateral after the cure turn.</p><div class="financing-surface-actions"><button class="btn-dark" type="button" data-finance-surface="offer"><span class="t-label f11">OPEN OFFER</span></button><button class="btn-dark" type="button" disabled><span class="t-label f11">BUYOUT · FINANCE RAIL</span></button></div></section>`;
  }
  if (financingSurfaceMode === "ownership") {
    return `<section class="financing-surface-body" aria-labelledby="financing-ownership-heading"><div class="financing-surface-kicker"><span class="t-micro g400">CAP TABLE REFERENCE · LIVE TERMS</span><span class="t-label f11 g300">PASSIVE CONTROL</span></div><h3 class="t-section g100" id="financing-ownership-heading">Eindhoven · shared economics</h3><div class="financing-ownership-bar"><span class="financing-ownership-primary" style="width:70%"></span><span class="financing-ownership-secondary" style="width:30%"></span></div><div class="financing-owner-list"><div><span class="ownership-avatar ownership-avatar-primary"></span><span class="t-label f12 g100">PLAYER · 70%</span><span class="t-micro ink-3">CONTROL + RENT</span></div><div><span class="ownership-avatar ownership-avatar-secondary"></span><span class="t-label f12 g100">PARTNER · 30%</span><span class="t-micro ink-3">RENT + SALE SHARE</span></div></div><div class="financing-rights-grid"><div><span class="t-micro ink-3">BASE RENT $18</span><strong class="t-label f13 g100">$13 / $5</strong></div><div><span class="t-micro ink-3">BUILDING RIGHTS</span><strong class="t-label f13 green">OWNER CONTROL</strong></div><div><span class="t-micro ink-3">SALE PROCEEDS</span><strong class="t-label f13 g100">70% / 30%</strong></div><div><span class="t-micro ink-3">DURATION</span><strong class="t-label f13 g100">FOREVER</strong></div></div><p class="t-body ink-2 financing-surface-copy">A passive minority share does not block a complete street. Shared control is an explicit contract choice, not an accidental side effect of buying equity.</p><div class="financing-surface-actions"><button class="btn-dark" type="button" data-financing-surface="offer"><span class="t-label f11">OPEN OFFER</span></button><button class="btn-dark" type="button" disabled><span class="t-label f11">TRANSFER · FINANCE RAIL</span></button></div></section>`;
  }
  if (financingSurfaceMode === "default") {
    return `<section class="financing-surface-body" aria-labelledby="financing-default-heading"><div class="financing-surface-kicker"><span class="t-micro red">CURE WINDOW · LIVE REFERENCE</span><span class="t-label f11 red">1 TURN LEFT</span></div><h3 class="t-section g100" id="financing-default-heading">Payment due · Eindhoven</h3><div class="financing-default-amount"><span class="t-micro ink-3">OUTSTANDING BALANCE</span><strong class="t-money red">$105</strong></div><div class="financing-default-actions"><button class="btn-dark" type="button" disabled><span class="t-label f11">PAY OUTSTANDING BALANCE</span></button><button class="btn-dark" type="button" disabled><span class="t-label f11">TAKE COLLATERAL</span></button><button class="btn-dark" type="button" disabled><span class="t-label f11">BANK AUCTION</span></button></div><p class="t-body ink-2 financing-surface-copy">If the cure turn expires, the lender chooses collateral transfer or bank auction. Interest stops when the contract resolves.</p></section>`;
  }
  return `<section class="financing-surface-body" aria-labelledby="financing-offer-heading"><div class="financing-mode-tabs" id="financing-mode-tabs" role="tablist" aria-label="Financing mode"><button class="financing-mode-tab${financingPreviewMode === "loan" ? " is-active" : ""}" type="button" role="tab" aria-selected="${financingPreviewMode === "loan"}" data-financing-mode="loan"><span class="t-label f11">LOAN</span><span class="t-micro">FIXED RETURN</span></button><button class="financing-mode-tab${financingPreviewMode === "equity" ? " is-active" : ""}" type="button" role="tab" aria-selected="${financingPreviewMode === "equity"}" data-financing-mode="equity"><span class="t-label f11">EQUITY</span><span class="t-micro">RENT + SALE SHARE</span></button><button class="financing-mode-tab${financingPreviewMode === "hybrid" ? " is-active" : ""}" type="button" role="tab" aria-selected="${financingPreviewMode === "hybrid"}" data-financing-mode="hybrid"><span class="t-label f11">HYBRID</span><span class="t-micro">CONVERT ON DEFAULT</span></button></div><h3 class="sr-only" id="financing-offer-heading">Financing offer builder</h3><div class="financing-form">${dropdownHTML({ id: "finance-property", label: "Property", value: financingPreviewDraft.propertyIndex, options: financingPropertyOptions() })}<label class="financing-field"><span class="t-label f11 g-muted">Cash advanced / contributed</span><input class="field" id="finance-amount" type="number" min="1" step="1" value="${financingPreviewDraft.amount}" /></label><div id="financing-mode-fields">${financingModeFieldsHTML()}</div></div><section class="financing-preview" id="financing-preview" aria-live="polite">${financingPreviewHTML()}</section><div class="financing-actions"><button class="btn-dark" id="financing-cancel" type="button"><span class="t-label f11">CLOSE PREVIEW</span></button><button class="cta-red" id="financing-live-rail" type="button"><span class="cta-text cta-text-sm">OPEN LIVE FINANCE</span></button></div></section>`;
}

function syncFinancingRanges(root = $("#financing-card")) {
  root?.querySelectorAll(".financing-range input[type=range]").forEach((input) => {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const value = Number(input.value) || min;
    const progress = max > min ? ((value - min) / (max - min)) * 100 : 0;
    input.parentElement?.style.setProperty("--range-progress", `${Math.max(0, Math.min(100, progress))}%`);
  });
}

function renderFinancingModal() {
  const card = $("#financing-card");
  if (!card) return;
  const modeLabels = { loan: "LOAN", equity: "EQUITY", hybrid: "HYBRID" };
  const header = `<div class="financing-head"><div><div class="t-micro g400">PARLOR DEAL BUILDER · LIVE TERMS</div><h2 class="t-section g100" id="financing-card-title">Shape a ${modeLabels[financingPreviewMode]} deal</h2></div><span class="t-micro financing-badge">LIVE FINANCE RAIL</span><button class="btn-dark financing-close" id="financing-close" type="button"><span class="t-label f11">CLOSE</span></button></div><p class="t-body ink-2 financing-description" id="financing-card-description">Use the Finance rail to send this contract to an active player. Every accepted term settles through the server ledger.</p>`;
  card.innerHTML = `<div class="financing-body">${header}${financingSurfaceTabsHTML()}${financingSurfaceBodyHTML()}</div>`;
  syncFinancingRanges(card);
  const updatePreview = () => {
    const preview = $("#financing-preview");
    if (preview) preview.innerHTML = financingPreviewHTML();
  };
 $("#financing-close")?.addEventListener("click", closeFinancingModal);
 $("#financing-cancel")?.addEventListener("click", closeFinancingModal);
  $("#financing-live-rail")?.addEventListener("click", () => { closeFinancingModal(); state.tab = "finance"; renderRightRail(); });
  $("#financing-surface-tabs")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-financing-surface]");
    if (!button) return;
    financingSurfaceMode = button.dataset.financingSurface;
    renderFinancingModal();
  });
  if (!card.dataset.financingSurfaceBound) {
    card.addEventListener("click", (event) => {
      const button = event.target.closest("[data-financing-surface]");
      if (!button || event.target.closest("#financing-surface-tabs")) return;
      financingSurfaceMode = button.dataset.financingSurface;
      renderFinancingModal();
    });
    card.dataset.financingSurfaceBound = "true";
  }
  if (financingSurfaceMode === "offer") {
    $("#financing-mode-tabs")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-financing-mode]");
      if (!button) return;
      financingPreviewMode = button.dataset.financingMode;
      renderFinancingModal();
    });
    if (!card.dataset.financingInputBound) {
      card.addEventListener("input", (event) => {
        const { id, value } = event.target;
        if (id === "finance-amount") financingPreviewDraft.amount = Number(value) || 0;
        if (id === "finance-loan-rate") financingPreviewDraft.loanRate = Number(value) || 0;
        if (id === "finance-loan-duration") financingPreviewDraft.loanDuration = Number(value) || 20;
        if (id === "finance-equity-share") { financingPreviewDraft.equityShare = Number(value) || 10; $("#finance-equity-share-output").textContent = `${financingPreviewDraft.equityShare}%`; }
        if (id === "finance-equity-duration") financingPreviewDraft.equityDuration = value;
        if (id === "finance-hybrid-rate") financingPreviewDraft.hybridRate = Number(value) || 0;
        if (id === "finance-hybrid-duration") financingPreviewDraft.hybridDuration = Number(value) || 20;
        if (id === "finance-hybrid-conversion") { financingPreviewDraft.hybridConversion = Number(value) || 25; $("#finance-hybrid-conversion-output").textContent = `${financingPreviewDraft.hybridConversion}%`; }
        if (event.target.matches("input[type=range]")) syncFinancingRanges(card);
        updatePreview();
      });
      card.dataset.financingInputBound = "true";
    }
    bindDropdowns(card, (id, value) => {
      if (id === "finance-property") financingPreviewDraft.propertyIndex = Number(value);
      if (id === "finance-loan-schedule") financingPreviewDraft.loanSchedule = value;
      if (id === "finance-equity-control") financingPreviewDraft.equityControl = value;
      updatePreview();
    });
  }
  $("#finance-equity-permanent")?.addEventListener("change", (event) => {
    const turnsInput = $("#finance-equity-duration");
    financingPreviewDraft.equityDuration = event.target.checked ? "permanent" : Math.max(1, Number(turnsInput?.value) || 20);
    renderFinancingModal();
  });
}

function openFinancingModal(mode = "loan", propertyIndex = null, trigger = null, surface = "offer") {
  financingPreviewMode = ["loan", "equity", "hybrid"].includes(mode) ? mode : "loan";
  financingSurfaceMode = ["offer", "contract", "ownership", "default"].includes(surface) ? surface : "offer";
  if (propertyIndex != null && TILES[Number(propertyIndex)]?.kind === "property") financingPreviewDraft.propertyIndex = Number(propertyIndex);
  renderFinancingModal();
  openSurface("#financing-modal", "#financing-close");
  if (trigger instanceof HTMLElement) setSurfaceReturnFocus(trigger);
}

function closeFinancingModal() {
  closeSurface("#financing-modal");
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
const PROFILE_SWATCHES = ["#d74438", "#286ea1", "#d9a62f", "#35a653", "#a04e6f", "#3e7d7b", "#7b5029", "#cfa75f"];
const FACE_PALETTE = ["#f0d9ac", "#e8d3ab", "#cfa75f", "#c88f2e", "#9b783d", "#5c5033", "#01070a", "#ffffff", "#d74438", "#35a653", "#286ea1", "#d9a62f"];

/** Open editor. Pass a profile id to edit, or nothing to create a new one. */
function openProfileEditor(fromPhase, profileId) {
  closeRoomsModal();
  state.homeReturnView = fromPhase === "setup" ? "setup-return" : "home";
  state.editingProfileId = profileId || null;
  const existing = profileId ? getProfileById(profileId) : null;
  const account = state.account?.account;
  const source = existing;
  state.profileDraft = source
    ? { designName: profileDesignName(source), color: source.color, grid: cloneFaceGrid(source.avatarGrid), tool: "paint", paintColor: source.color }
    : { designName: "", color: account?.color || "#d74438", grid: account?.avatarGrid ? cloneFaceGrid(account.avatarGrid) : faceGridFromPreset(0, account?.color || "#d74438"), tool: "paint", paintColor: "#f0d9ac" };
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

function saveProfileDesign({ asNew = false, stay = false } = {}) {
  const d = state.profileDraft;
  if (!d) return null;
  const designName = String(d.designName || "").trim().slice(0, 12).toUpperCase() || "UNTITLED DESIGN";
  const hasInk = d.grid.some((row) => row.some((c) => c));
  const draftProfile = {
    id: !asNew && state.editingProfileId ? state.editingProfileId : `pf_${Math.random().toString(36).slice(2, 9)}`,
    designName,
    color: d.color,
    avatarGrid: hasInk ? d.grid : faceGridFromPreset(0, d.color),
  };
  const saved = upsertProfile(draftProfile);
  if (saved === "limit") {
    announceProfileSave(`You can only save up to ${MAX_PROFILES} designs. Delete one to make room.`);
    return saved;
  }
  if (!saved) return null;
  setActiveAppearance(saved.id);
  if (state.account?.sessionToken) {
    emitServer("account-update", {
      sessionToken: state.account.sessionToken,
      color: saved.color,
      avatarGrid: saved.avatarGrid,
    }, (response) => {
      if (response?.success) updateAccountFromResponse(response);
      else if (response?.error) {
        const announcer = $("#error-announcer");
        if (announcer) announcer.textContent = response.error;
      }
    });
  }
  if (stay) {
    state.editingProfileId = saved.id;
    state.profileDraft = { designName: profileDesignName(saved), color: saved.color, grid: cloneFaceGrid(saved.avatarGrid), tool: "paint", paintColor: saved.color };
    renderProfileEditor();
    renderProfileLibrary();
    setProfileTab("designs");
    announceProfileSave(`Saved "${designName}" as a new design.`);
  }
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

function renderProfileEditor() {
  const d = state.profileDraft;
  if (!d) return;
  const deleteBtn = $("#profile-delete-btn");
  if (deleteBtn) deleteBtn.classList.toggle("is-hidden", !state.editingProfileId);
  const saveLabel = $("#profile-save-btn")?.querySelector(".cta-text");
  if (saveLabel) saveLabel.textContent = state.editingProfileId ? "Save Changes" : "Save Design";
  const modeLabel = $("#profile-editor-mode");
  if (modeLabel) modeLabel.textContent = state.editingProfileId ? "EDIT PLAYER DESIGN" : "NEW PLAYER DESIGN";

  // identity swatches
  $("#profile-swatches").innerHTML = PROFILE_SWATCHES.map(
    (c) => `<button type="button" class="profile-swatch${c.toLowerCase() === d.color.toLowerCase() ? " is-active" : ""}" style="background:${c}" data-color="${c}" title="${c}"></button>`,
  ).join("");
  $("#profile-color-picker").value = d.color;
  $("#profile-name").value = d.designName;

  // face palette
  $("#face-palette").innerHTML = FACE_PALETTE.map(
    (c) => `<button type="button" class="face-swatch${d.tool === "paint" && c.toLowerCase() === d.paintColor.toLowerCase() ? " is-active" : ""}" style="background:${c}" data-ink="${c}" title="${c}"></button>`,
  ).join("");
  $("#face-color-picker").value = d.paintColor;
  $("#face-tool-paint").classList.toggle("is-active", d.tool === "paint");
  $("#face-tool-erase").classList.toggle("is-active", d.tool === "erase");

  // pixel canvas
  const canvas = $("#face-canvas");
  canvas.innerHTML = d.grid
    .map((row, y) =>
      row
        .map((c, x) => `<span class="face-cell" data-x="${x}" data-y="${y}" style="${c ? `background-color:${c};background-image:none` : ""}"></span>`)
        .join(""),
    )
    .join("");

  updateProfilePreview();
  renderProfileSummary();
}

function updateProfilePreview() {
  const d = state.profileDraft;
  if (!d) return;
  const av = $("#profile-preview-av");
  if (av) av.innerHTML = spriteFromGrid(d.grid, 6);
  const nameEl = $("#profile-preview-name");
  if (nameEl) {
    nameEl.textContent = (d.designName || "UNTITLED DESIGN").toUpperCase();
    nameEl.style.color = d.color;
  }
  renderProfileLibrary();
  renderProfileSummary();
}

function paintFaceCell(x, y) {
  const d = state.profileDraft;
  if (!d) return;
  const color = d.tool === "erase" ? null : d.paintColor;
  if (d.grid[y][x] === color) return;
  d.grid[y][x] = color;
  const cell = $(`#face-canvas .face-cell[data-x="${x}"][data-y="${y}"]`);
  if (cell) {
    cell.style.backgroundColor = color || "";
    cell.style.backgroundImage = color ? "none" : "";
  }
  updateProfilePreview();
}

/* ============================================================
   7. TILE POPUP
   ============================================================ */
function kindLabel(tile) {
  const map = {
    property: "PROPERTY DEED", railroad: "RAILROAD DEED", utility: "UTILITY DEED",
    chance: "CHANCE TILE", chest: "CHEST TILE", tax: "TAX TILE",
  };
  return map[tile.kind] || "CORNER TILE";
}

function accentOf(tile) {
  if (tile.group) return GROUP_COLOR[tile.group];
  const map = {
    chance: "#d74438", chest: "#cfa75f", utility: "#3e7d7b",
    railroad: "#9b783d", "corner-vacation": "#78894f", "corner-go": "#d74438", "corner-go-jail": "#d74438",
  };
  return map[tile.kind] || "#5c5033";
}

function effectText(tile) {
  switch (tile.kind) {
    case "property": return "If this deed is unowned, you may buy it from the bank. If another player owns it, you pay the listed rent.";
    case "railroad": return "Transit deed. In this parlor ruleset, landing here charges the listed rent when owned by another player.";
    case "utility": return "Utility deed. If unowned, it can be purchased. If owned by another player, landing here charges the listed rent.";
    case "chance": return "Draw a Chance card and resolve it immediately.";
    case "chest": return "Draw a Chest card and resolve it immediately.";
    case "tax": return `Pay $${tile.price ?? 200} into the vacation pool.`;
    case "corner-go": return "Collect $200 when you pass or land on GO.";
    case "corner-jail": return "Just visiting. No penalty is applied on this square.";
    case "corner-go-jail": return "Move directly to Prison. Do not pass Start or collect $200.";
    case "corner-parking": return "Collect the full vacation pool jackpot if any cash has built up there.";
    case "corner-vacation": return "Vacation is a resting space. Collect the vacation pool when enabled.";
    default: return "Board effect unavailable.";
  }
}

function popIconHTML(tile) {
  switch (tile.kind) {
    case "railroad": return tile.name.includes("AIRPORT")
      ? `<img class="airport-mark airport-mark-popup" src="/assets/airport-plane.svg" alt="Airport">`
      : spriteHTML("train", 4);
    case "utility": return tile.name === "ELECTRIC COMPANY" ? spriteHTML("bulb", 4) : spriteHTML("faucet", 4);
    case "chance": return `<img class="board-icon-mark board-icon-popup board-icon-surprise" src="/assets/board-icons/surprise.svg" alt="Surprise">`;
    case "chest": return `<img class="board-icon-mark board-icon-popup board-icon-chest" src="/assets/board-icons/treasure-chest.svg" alt="Treasure">`;
    case "tax": return "";
    case "corner-go": return `<span class="go-big" style="font-size:28px">GO</span>`;
    case "corner-go-jail": return `<span class="q-mark" style="font-size:22px;color:#d74438">PRISON</span>`;
    case "corner-parking": return spriteHTML("car", 5);
    case "corner-vacation": return spriteHTML("palm", 5);
    default: return spriteHTML("diamond", 5);
  }
}

const popRow = (label, value, cls = "ink") =>
  `<div class="pop-row"><span class="t-label f12 g-muted">${label}</span><span class="t-label f12 v ${cls}">${value}</span></div>`;

function rentScheduleHTML(tile) {
  const table = RENT_TABLE[tile.group || tile.kind];
  if (!table) return "";
  if (tile.kind === "property") {
    const rows = [
      ["BASE", `$${table.rents[0]}`],
      ["1 HOUSE", `$${table.rents[1]}`],
      ["2 HOUSES", `$${table.rents[2]}`],
      ["3 HOUSES", `$${table.rents[3]}`],
      ["4 HOUSES", `$${table.rents[4]}`],
      ["HOTEL", `$${table.rents[5]}`],
    ];
    return `<div class="rent-grid">${rows.map(([k, v]) => `<div class="rent-grid-row"><span class="t-label f11 g-muted">${k}</span><span class="t-label f11 green">${v}</span></div>`).join("")}</div>`;
  }
  if (tile.kind === "railroad") {
    return `<div class="rent-grid">${[1, 2, 3, 4].map((n) => `<div class="rent-grid-row"><span class="t-label f11 g-muted">${n} RAIL${n === 1 ? "" : "S"}</span><span class="t-label f11 green">$${table.rents[n - 1]}</span></div>`).join("")}</div>`;
  }
  if (tile.kind === "utility") {
    return `<div class="rent-grid">${[1, 2].map((n) => `<div class="rent-grid-row"><span class="t-label f11 g-muted">${n} UTIL${n === 1 ? "" : "S"}</span><span class="t-label f11 green">$${table.rents[n - 1]}</span></div>`).join("")}<p class="t-micro ink-3">* Multiplied by dice roll in classic rules</p></div>`;
  }
  return "";
}

function openPopup(tile) {
  state.selectedTile = tile;
  const ownerId = state.owners[tile.i];
  const owner = state.players.find((p) => p.id === ownerId);
  const buyable = ["property", "railroad", "utility"].includes(tile.kind);
  const unowned = buyable && !owner;
  const rent = tile.rent != null ? `$${tile.rent}` : tile.kind === "tax" ? `PAY $${tile.price ?? 200}` : "—";
  const price = tile.price != null && tile.kind !== "tax" ? `$${tile.price}` : "—";
  const ownerLabel = owner ? owner.name : buyable ? "UNOWNED" : "BANK";
  const level = state.houses[tile.i] || 0;
  const buildTag = buyable && level > 0 ? ` <span class="t-label f11 g300">${level === HOTEL_LEVEL ? "— HOTEL" : `— ${level} HOUSE${level === 1 ? "" : "S"}`}</span>` : "";

  const me = state.players[0];
  // when auction rules are on, buying only happens through the forced
  // buy/auction prompt shown when you land — not from the info popup.
  const showBuy = unowned && !state.settings.auction;
  const canBuyNow = showBuy && state.phase === "playing" && state.turnIndex === 0 && !state.busy && me.cash >= (tile.price ?? 0);
  const buyLabel =
    state.phase !== "playing" ? "JOIN TO BUY" : state.turnIndex !== 0 ? "NOT YOUR TURN" : me.cash < (tile.price ?? 0) ? "INSUFFICIENT FUNDS" : "BUY DEED";

  $("#popup-card").innerHTML = `
    <div class="pop-rail" style="background:${accentOf(tile)}"></div>
    <div class="pop-body">
      <div class="pop-head">
        <div class="pop-icon">${popIconHTML(tile)}</div>
        <div class="pop-headtext">
          <div class="t-micro g400">${kindLabel(tile)}</div>
          <h3 class="t-section pop-title" id="popup-card-title">${tile.name}${buildTag}</h3>
        </div>
        <button class="btn-dark pop-close" id="pop-close"><span class="t-label f11">CLOSE</span></button>
      </div>
      <div class="pop-rows">
        ${popRow("PURCHASE", price, "g300")}
        ${popRow("BASE RENT", rent, "green")}
        ${popRow("OWNER", ownerLabel, owner ? "ink" : "g-muted")}
        ${tile.group ? popRow("COLOR SET", tile.group.toUpperCase()) : ""}
        ${tile.group ? popRow("HOUSE COST", `$${RENT_TABLE[tile.group].housePrice}`, "g300") : ""}
      </div>
      ${
        buyable
          ? `<div class="pop-effect-head">${spriteHTML("diamond", 3)}<span class="t-label f12 g300">RENT SCHEDULE</span></div>${rentScheduleHTML(tile)}`
          : ""
      }
      <div class="pop-effect-head">${spriteHTML("diamond", 3)}<span class="t-label f12 g300">SPECIAL EFFECT</span></div>
      <div class="pop-effect"><p class="t-body ink-2">${effectText(tile)}</p></div>
      ${
        showBuy
          ? `<div class="pop-buy-row">
              <button class="cta-red pop-buy" id="pop-buy" ${canBuyNow ? "" : "disabled"}>
                <span class="cta-text cta-text-sm">${buyLabel}</span>
              </button>
            </div>`
          : unowned && state.settings.auction
            ? `<div class="pop-buy-row"><p class="t-micro ink-3" style="text-align:center">AUCTION RULES ON — BUY WHEN YOU LAND HERE</p></div>`
            : ""
      }
      <div class="pop-foot">
        <span class="t-micro ink-3">PRESS ESC OR CLICK OUTSIDE TO CLOSE</span>
        ${owner ? `<span class="t-label f12" style="color:${owner.color}">OWNED BY ${esc(owner.name)}</span>` : ""}
      </div>
    </div>`;

  openSurface("#popup", "#pop-close");
  $("#pop-close").addEventListener("click", closePopup);
  const buyBtn = $("#pop-buy");
  if (buyBtn) buyBtn.addEventListener("click", () => { buyTile(tile); openPopup(tile); });
}

function closePopup() {
  state.selectedTile = null;
  state.highlight = null;
  closeSurface("#popup");
  renderBoardState();
}

function onTileClick(tile) {
  state.highlight = tile.i;
  const owner = state.players.find((p) => p.id === state.owners[tile.i]);
  record(`INSPECTED ${tile.name}${tile.price ? ` — $${tile.price}` : ""}${owner ? ` — OWNED BY ${owner.name}` : ""}`);
  openPopup(tile);
  renderBoardState();
  if (state.tab === "log") renderRightRail();
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
const BID_STEPS = [1, 20, 100];
// Audit #18: single clock for auction deadlines. Matches the server's frame
// once a snapshot has arrived (offset 0 before the first one).
function serverNow() { return Date.now() + (state.serverTimeOffset || 0); }
let auctionTimer = null;

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

function startAuction(tile) {
  emitServer("decline-property", { tileIndex: tile.i }, (response) => {
      if (response?.success === false) {
        say(response.error || "The auction could not be opened.");
        renderChat();
      }
    });
    return;
}


function humanBid(inc) {
  const a = state.auction;
  if (!a) return;
  const me = state.players[0];
  if (a.passed.p1) return;
  if (me.cash < a.bid + inc) return; // can't cover the raise
  emitServer("auction-bid", { amount: a.bid + inc }, (response) => {
      if (response?.success === false) {
        say(response.error || "Bid rejected.");
        renderChat();
      }
    });
    return;
}

function humanPassAuction() {
  const a = state.auction;
  if (!a) return;
  emitServer("auction-pass", {}, (response) => {
      if (response?.success === false) {
        say(response.error || "You cannot pass this auction.");
        renderChat();
      }
    });
    return;
}


function tickAuction() {
  const a = state.auction;
  if (!a) return;
  const remaining = a.deadline - serverNow();

  // Live auctions are finalized by the server. The client only keeps the
  // countdown visually current until the authoritative update arrives.
  updateAuctionLive();
    if (remaining <= 0) {
      clearInterval(auctionTimer);
      auctionTimer = null;
    }
    return;
}


function renderAuction() {
  const a = state.auction;
  if (!a) return;
  const tile = TILES[a.tileIndex];
  $("#auction-card").innerHTML = `
    <div class="auction-rail" style="background:${accentOf(tile)}"></div>
    <div class="auction-body">
      <div class="auction-head">
        <div class="auction-icon">${popIconHTML(tile)}</div>
        <div class="pop-headtext">
          <div class="t-micro g400">AUCTION · ${kindLabel(tile)}</div>
          <h3 class="t-section auction-title" id="auction-card-title">${tile.name}</h3>
        </div>
      </div>

      <div class="auction-bid-box">
        <div>
          <div class="t-micro ink-3">HIGH BID</div>
          <div class="auction-bid-val" id="auction-bid">$0</div>
        </div>
        <div class="auction-leader">
          <div class="t-micro ink-3">LEADER</div>
          <div class="t-label auction-leader-name" id="auction-leader">NO BIDS YET</div>
        </div>
      </div>

      <div class="auction-timer-wrap">
        <div class="auction-timer-top">
          <span class="t-micro g400">TIME LEFT</span>
          <span class="t-label f12 g-muted" id="auction-timer">5.0s</span>
        </div>
        <div class="auction-bar-track"><div class="auction-bar-fill" id="auction-bar"></div></div>
      </div>

      <div class="auction-bids">
        ${BID_STEPS.map((inc) => `
          <button class="cta-red auction-bid-btn" data-bid="${inc}">
            <span class="t-label">+${inc}</span>
            <span class="t-micro">RAISE</span>
          </button>`).join("")}
      </div>

      <div class="auction-pass">
        <button class="btn-dark auction-pass-btn" id="auction-pass"><span class="t-label f12">PASS — STAND DOWN</span></button>
      </div>

      <div class="auction-players" id="auction-players"></div>

      <p class="t-micro ink-3 auction-foot">EACH BID RESETS THE 5s CLOCK · LAST BIDDER WINS</p>
    </div>`;

  $("#auction-card").querySelectorAll("[data-bid]").forEach((btn) => {
    btn.addEventListener("click", () => humanBid(Number(btn.dataset.bid)));
  });
  $("#auction-pass").addEventListener("click", humanPassAuction);
  updateAuctionLive();
}

function updateAuctionLive() {
  const a = state.auction;
  if (!a) return;
  const me = state.players[0];
  const remaining = Math.max(0, a.deadline - serverNow());
  const pct = Math.max(0, Math.min(100, (remaining / AUCTION_MS) * 100));

  const bar = $("#auction-bar");
  if (bar) {
    bar.style.transform = `scaleX(${pct / 100})`;
    bar.classList.toggle("is-low", remaining <= 2000);
  }
  const timerEl = $("#auction-timer");
  if (timerEl) timerEl.textContent = `${(remaining / 1000).toFixed(1)}s`;

  const bidEl = $("#auction-bid");
  if (bidEl) bidEl.textContent = `$${a.bid}`;

  const leaderEl = $("#auction-leader");
  if (leaderEl) {
    const leader = a.leaderId ? state.players.find((p) => p.id === a.leaderId) : null;
    leaderEl.textContent = leader ? leader.name : "NO BIDS YET";
    leaderEl.style.color = leader ? leader.textColor : "var(--text-muted)";
  }

  $("#auction-card")?.querySelectorAll("[data-bid]").forEach((btn) => {
    const inc = Number(btn.dataset.bid);
    btn.disabled = me.cash < a.bid + inc;
  });
  const passBtn = $("#auction-pass");
  if (passBtn) passBtn.disabled = !!a.passed?.p1;

  const listEl = $("#auction-players");
  if (listEl) {
    listEl.innerHTML = state.players.map((p) => {
      let status = "BIDDING";
      let cls = "green";
      if (p.id === a.leaderId) { status = "LEADING"; cls = "g300"; }
      else if (a.passed[p.id]) { status = "PASSED"; cls = "ink-3"; }
      else if (p.cash < BID_STEPS[0] || p.id !== "p1" && p.cash < a.bid + BID_STEPS[0]) { status = "BROKE"; cls = "red"; }
      return `<div class="auction-player${p.id === a.leaderId ? " is-leading" : ""}">
        <span class="ap-av">${avatarHTML(p, 2, state.players.indexOf(p))}</span>
        <span class="t-label ap-name" style="color:${p.textColor}">${esc(p.name)}</span>
        <span class="t-micro ap-st ${cls}">${status}</span>
      </div>`;
    }).join("");
  }
}

/* ============================================================
   8b. TRADING
   ============================================================ */
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function tradeDeedRowHTML(tile, side, selected) {
  const rail = tile.group ? GROUP_COLOR[tile.group] : tile.kind === "railroad" ? "#5c5033" : "#3e7d7b";
  const mortgaged = !!state.mortgaged[tile.i];
  return `<button type="button" class="trade-deed${selected ? " is-selected" : ""}${mortgaged ? " is-mortgaged" : ""}" data-side="${side}" data-deed="${tile.i}" ${mortgaged ? "disabled" : ""}>
    <span class="trade-deed-rail" style="background:${rail}"></span>
    <span class="trade-deed-name">${tile.name}</span>
    <span class="trade-deed-price">$${tile.price}</span>
    <span class="trade-deed-check"></span>
  </button>`;
}

function tradeSummaryText(deedSet, cash) {
  return `${deedSet.size} deed${deedSet.size === 1 ? "" : "s"} + $${cash}`;
}

function updateTradeSummary() {
  const sendEl = $("#trade-send-summary");
  const receiveEl = $("#trade-receive-summary");
  if (sendEl) sendEl.textContent = tradeSummaryText(state.tradeMyDeeds, state.tradeMyCash);
  if (receiveEl) receiveEl.textContent = tradeSummaryText(state.tradeTheirDeeds, state.tradeTheirCash);
}

function renderTradeModal() {
  if (!state.tradeWith) return;
  const me = state.players[0];
  const other = state.players.find((p) => p.id === state.tradeWith);
  if (!other) { closeTradeModal(); return; }

  const myDeeds = TILES.filter((t) => state.owners[t.i] === "p1");
  const theirDeeds = TILES.filter((t) => state.owners[t.i] === other.id);
  const otherSeed = state.players.indexOf(other);

  $("#trade-card").innerHTML = `
    <div class="trade-body">
      <div class="trade-head">
        <div class="section-title" style="margin-bottom:0">
          ${spriteHTML("diamond", 3)}
          <h2 class="t-section g300" id="trade-card-title">Propose Trade</h2>
        </div>
        <button class="btn-dark" id="trade-close"><span class="t-label f11">CLOSE</span></button>
      </div>
      <p class="t-body ink-2 trade-copy">Select who should receive the offer, then choose deeds from each side and set a cash amount to include.</p>
      ${dropdownHTML({ id: "trade-recipient", label: "Send trade to", value: state.tradeWith, className: "trade-recipient-dropdown", options: state.players.filter((p) => p.id !== "p1").map((p) => ({ value: p.id, label: p.name })) })}

      <div class="trade-cols">
        <div class="trade-side">
          <div class="trade-side-head">
            <div class="tp-av">${avatarHTML(me, 4, 0)}</div>
            <div>
              <span class="t-label f13" style="color:${me.textColor}">${esc(me.name)}</span>
              <span class="t-micro ink-3 trade-cash-label">CASH ON HAND $${me.cash.toLocaleString()}</span>
            </div>
          </div>
          <div class="trade-deed-list thin-scroll">
            ${
              myDeeds.length
                ? myDeeds.map((t) => tradeDeedRowHTML(t, "me", state.tradeMyDeeds.has(t.i))).join("")
                : `<p class="t-body trade-empty">NO DEEDS TO OFFER</p>`
            }
          </div>
          <label class="trade-cash-field">
            <span class="t-label f11 g-muted">CASH TO OFFER</span>
            <input type="number" min="0" max="${me.cash}" step="10" class="field" id="trade-my-cash" value="${state.tradeMyCash}" />
          </label>
        </div>

        <div class="trade-side">
          <div class="trade-side-head">
            <div class="tp-av">${avatarHTML(other, 4, otherSeed)}</div>
            <div>
              <span class="t-label f13" style="color:${other.textColor}">${esc(other.name)}</span>
              <span class="t-micro ink-3 trade-cash-label">CASH ON HAND $${other.cash.toLocaleString()}</span>
            </div>
          </div>
          <div class="trade-deed-list thin-scroll">
            ${
              theirDeeds.length
                ? theirDeeds.map((t) => tradeDeedRowHTML(t, "them", state.tradeTheirDeeds.has(t.i))).join("")
                : `<p class="t-body trade-empty">NO DEEDS TO REQUEST</p>`
            }
          </div>
          <label class="trade-cash-field">
            <span class="t-label f11 g-muted">CASH TO REQUEST</span>
            <input type="number" min="0" max="${other.cash}" step="10" class="field" id="trade-their-cash" value="${state.tradeTheirCash}" />
          </label>
        </div>
      </div>

      <div class="trade-summary">
        <span class="t-micro ink-3">YOU SEND</span>
        <span class="t-label f12 g300" id="trade-send-summary">${tradeSummaryText(state.tradeMyDeeds, state.tradeMyCash)}</span>
        <span class="trade-arrow">⇄</span>
        <span class="t-micro ink-3">YOU RECEIVE</span>
        <span class="t-label f12 green" id="trade-receive-summary">${tradeSummaryText(state.tradeTheirDeeds, state.tradeTheirCash)}</span>
      </div>

      <div class="trade-actions">
        <button class="cta-red trade-send" id="trade-send"><span class="cta-text cta-text-sm">Send Trade</span></button>
        <button class="btn-dark trade-cancel" id="trade-cancel"><span class="t-label f12">Cancel</span></button>
      </div>
    </div>`;

  $("#trade-close").addEventListener("click", closeTradeModal);
  $("#trade-cancel").addEventListener("click", closeTradeModal);
  $("#trade-send").addEventListener("click", sendTrade);

  bindDropdowns($("#trade-card"), (id, value) => {
    if (id !== "trade-recipient" || !state.players.some((p) => p.id === value && p.id !== "p1")) return;
    state.tradeWith = value;
    state.tradeMyDeeds = new Set();
    state.tradeTheirDeeds = new Set();
    state.tradeMyCash = 0;
    state.tradeTheirCash = 0;
    renderTradeModal();
    $("#trade-recipient-trigger")?.focus({ preventScroll: true });
  });

  $("#trade-my-cash").addEventListener("input", (e) => {
    let v = Math.round(Number(e.target.value) || 0);
    v = clamp(v, 0, me.cash);
    if (String(v) !== e.target.value) e.target.value = String(v);
    state.tradeMyCash = v;
    updateTradeSummary();
  });
  $("#trade-their-cash").addEventListener("input", (e) => {
    let v = Math.round(Number(e.target.value) || 0);
    v = clamp(v, 0, other.cash);
    if (String(v) !== e.target.value) e.target.value = String(v);
    state.tradeTheirCash = v;
    updateTradeSummary();
  });

  $("#trade-card").querySelectorAll(".trade-deed").forEach((btn) => {
    btn.addEventListener("click", () => {
      const side = btn.dataset.side;
      const idx = Number(btn.dataset.deed);
      const set = side === "me" ? state.tradeMyDeeds : state.tradeTheirDeeds;
      if (set.has(idx)) set.delete(idx);
      else set.add(idx);
      btn.classList.toggle("is-selected");
      updateTradeSummary();
    });
  });
}

function openTradeModal(playerId) {
  if (state.phase !== "playing") return;
  if (!state.settings.trading) {
    say("Trading is disabled for this round.");
    renderChat();
    return;
  }
  const other = state.players.find((p) => p.id === playerId);
  if (!other) return;
  state.tradeWith = playerId;
  state.tradeMyDeeds = new Set();
  state.tradeTheirDeeds = new Set();
  state.tradeMyCash = 0;
  state.tradeTheirCash = 0;
  renderTradeModal();
  openSurface("#trade-modal", "#trade-close");
}

function closeTradeModal() {
  state.tradeWith = null;
  closeSurface("#trade-modal");
}

function sendTrade() {
  if (!state.tradeWith) return;
  const me = state.players[0];
  const other = state.players.find((p) => p.id === state.tradeWith);
  if (!other) return;

  const myCash = clamp(state.tradeMyCash, 0, me.cash);
  const theirCash = clamp(state.tradeTheirCash, 0, other.cash);

  if (state.tradeMyDeeds.size === 0 && state.tradeTheirDeeds.size === 0 && myCash === 0 && theirCash === 0) {
    say("Add at least one deed or cash amount before sending a trade.");
    renderChat();
    return;
  }

  for (const i of state.tradeMyDeeds) {
    if ((state.houses[i] || 0) > 0) {
      say("You must sell all houses on a property before trading it.");
      renderChat();
      return;
    }
    if (state.mortgaged[i]) {
      say("You must unmortgage a property before trading it.");
      renderChat();
      return;
    }
  }
  for (const i of state.tradeTheirDeeds) {
    if (state.mortgaged[i]) {
      say("That property is mortgaged and can't be traded yet.");
      renderChat();
      return;
    }
  }

  const offer = {
    from: "p1",
    to: other.id,
    giveDeeds: [...state.tradeMyDeeds],
    wantDeeds: [...state.tradeTheirDeeds],
    giveCash: myCash,
    wantCash: theirCash,
  };
  emitServer("propose-trade", {
      toPlayerId: other.serverId || other.id,
      givePropertyIndexes: offer.giveDeeds,
      requestPropertyIndexes: offer.wantDeeds,
      giveCash: offer.giveCash,
      requestCash: offer.wantCash,
    }, (response) => {
      if (response?.success === false) {
        say(response.error || "Trade could not be sent.");
        renderChat();
        return;
      }
      record(`OFFER SENT TO ${other.name}`);
      say(`Offer sent to ${other.name}.`, me);
      renderChat();
    });
    closeTradeModal();
    return;
}



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
function handleRestoreSessionResponse(response, explicit = false) {
  if (response?.success === false) {
    if (explicit || state.phase !== "home") {
      parlorNotice("CONNECTION", response.error || "No active room session was found.");
      setConnectionStatus("offline", true);
    }
    if (explicit) {
      clearSave();
      applyProfileToHomeUI();
    }
    return;
  }
  if (!response?.success) return;
  state.suppressRoomUpdates = false;
  if (Object.prototype.hasOwnProperty.call(response, "roomCode")) state.roomCode = response.roomCode || state.roomCode;
  if (response.visibility) state.roomVisibility = response.visibility === "public" ? "public" : "private";
  // An explicit "Resume round" click always returns to the parlor — it is the
  // documented escape from a stuck mute; a background reconnect only re-asserts
  // the view when the player never left the room session.
  if (explicit || state.phase !== "home") showView("game");
  renderAll();
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
  clearInterval(auctionTimer);
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
  clearInterval(auctionTimer);
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

  $("#player-list")?.addEventListener("click", (event) => {
    const player = event.target.closest("[data-player-id]");
    if (player) openPlayerSurface(player.dataset.playerId);
  });
  const handleRankingClick = (event) => {
    const scope = event.target.closest("[data-ranking-scope]");
    const inGameModal = event.currentTarget?.id === "rankings-card" && ["setup", "lobby", "playing"].includes(state.phase);
    if (scope) { if (inGameModal) { state.leaderboard.scope = scope.dataset.rankingScope; renderRankingsSurface("#rankings-card"); } else openRankingsSurface(state.leaderboard.metric, scope.dataset.rankingScope); return; }
    const metric = event.target.closest("[data-ranking-metric]");
    if (metric) { if (inGameModal) { state.leaderboard.metric = metric.dataset.rankingMetric; renderRankingsSurface("#rankings-card"); } else openRankingsSurface(metric.dataset.rankingMetric); return; }
    const player = event.target.closest("[data-ranking-player]");
    if (player) openPlayerSurface(player.dataset.rankingPlayer);
    if (event.target.closest(".rankings-close, #rankings-close")) event.currentTarget?.id === "rankings-page-content" ? leaveRoomForHome() : closeSurface("#rankings-modal");
  };
  $("#rankings-card")?.addEventListener("click", handleRankingClick);
  $("#rankings-page-content")?.addEventListener("click", handleRankingClick);
  const handleRankingSubmit = (event) => {
    if (!event.target.matches("[data-ranking-search-form]")) return;
    event.preventDefault();
    const input = event.target.querySelector("[data-ranking-search-input]");
    state.rankingSearchQuery = String(input?.value || "").trim();
    state.rankingSearchResults = [];
    const surface = event.currentTarget?.id === "rankings-page-content" ? "#rankings-page-content" : "#rankings-card";
    if (state.rankingSearchQuery.length < 3) {
      renderRankingsSurface(surface);
      return;
    }
    emitServer("search-players", { query: state.rankingSearchQuery, exact: true }, (response) => {
      state.rankingSearchResults = response?.players || [];
      renderRankingsSurface(surface);
    });
  };
  $("#rankings-card")?.addEventListener("submit", handleRankingSubmit);
  $("#rankings-page-content")?.addEventListener("submit", handleRankingSubmit);
  const handleSocialClick = (event) => {
    const tab = event.target.closest("[data-social-tab]");
    if (tab) { state.socialTab = tab.dataset.socialTab; renderSocialSurface(event.currentTarget?.id === "social-page-content" ? "#social-page-content" : "#social-card"); return; }
    const accountAction = event.target.closest("[data-social-action=account]");
    if (accountAction) { openAccountModal("register"); return; }
    const player = event.target.closest("[data-social-player]");
    if (player) { openPlayerSurface(player.dataset.socialPlayer); return; }
    const request = event.target.closest("[data-social-request]");
    if (request) {
      emitServer("respond-friend-request", { friendshipId: request.dataset.friendshipId, accept: request.dataset.socialRequest === "accept" }, () => {});
      return;
    }
    const invite = event.target.closest("[data-social-invite]");
    if (invite) {
      emitServer("respond-room-invite", { inviteId: invite.dataset.inviteId, accept: invite.dataset.socialInvite === "accept" }, () => {});
      return;
    }
    const notification = event.target.closest("[data-notification-read]");
    if (notification) { emitServer("mark-notification-read", { notificationId: notification.dataset.notificationRead }, () => {}); return; }
    const clearRecent = event.target.closest("[data-social-clear-recent]");
    if (clearRecent) {
      emitServer("clear-recent-players", {}, (response) => {
        if (response?.success === false) {
          announceSocialNotification({ body: response.error || "Recent players could not be cleared." });
          return;
        }
        state.social.recentPlayers = [];
        renderSocialSurface(event.currentTarget?.id === "social-page-content" ? "#social-page-content" : "#social-card");
      });
      return;
    }
    const cancelRequest = event.target.closest("[data-social-request-cancel]");
    if (cancelRequest) {
      emitServer("cancel-friend-request", { friendshipId: cancelRequest.dataset.friendshipId }, () => {});
      return;
    }
    if (event.target.closest(".social-close, #social-close")) event.currentTarget?.id === "social-page-content" ? leaveRoomForHome() : closeSurface("#social-modal");
  };
  $("#social-card")?.addEventListener("click", handleSocialClick);
  $("#social-page-content")?.addEventListener("click", handleSocialClick);
  const handleSocialSubmit = (event) => {
    if (!event.target.matches("[data-social-search-form]")) return;
    event.preventDefault();
    const form = event.target;
    const input = form.querySelector("[data-social-search-input]");
    state.socialSearchQuery = input?.value || "";
    if (input) input.setAttribute("value", state.socialSearchQuery);
    emitServer("search-players", { query: input?.value || "" }, (response) => {
      state.socialSearchResults = response?.players || [];
      const results = form.querySelector("[data-social-search-results]");
      if (results) results.innerHTML = state.socialSearchResults.length ? state.socialSearchResults.map(player => socialPlayerRowHTML(player, "VIEW")).join("") : `<p class="t-micro ink-3 social-empty">NO PLAYERS FOUND.</p>`;
      if (input) {
        input.value = state.socialSearchQuery;
        input.setAttribute("value", state.socialSearchQuery);
      }
      const surface = form.closest("#social-page-content") ? "#social-page-content" : "#social-card";
      renderSocialSurface(surface);
    });
  };
  $("#social-card")?.addEventListener("submit", handleSocialSubmit);
  $("#social-page-content")?.addEventListener("submit", handleSocialSubmit);
  $("#player-card")?.addEventListener("click", (event) => {
    if (event.target.closest("#player-modal-close")) { closeSurface("#player-modal"); return; }
    if (event.target.closest("#player-modal-back")) { state.selectedPlayerView = "profile"; renderPlayerSurface(); return; }
    const historyScope = event.target.closest("[data-player-history-scope]");
    if (historyScope) { state.selectedPlayerHistoryScope = historyScope.dataset.playerHistoryScope || "all"; renderPlayerSurface(); return; }
    const action = event.target.closest("[data-player-action]");
    if (!action || action.disabled || !state.selectedPlayer) return;
    const targetId = state.selectedPlayer.accountId;
    if (action.dataset.playerAction === "friend") emitServer("send-friend-request", { targetAccountId: targetId }, (response) => { if (response?.success === false) announceSocialNotification({ body: response.error || "Friend request could not be sent." }); });
    if (action.dataset.playerAction === "invite") emitServer("send-room-invite", { targetAccountId: targetId }, (response) => { if (response?.success === false) announceSocialNotification({ body: response.error || "Room invite could not be sent." }); });
    if (action.dataset.playerAction === "history") emitServer("get-match-history", { accountId: targetId }, (response) => { if (response?.success === false) { announceSocialNotification({ body: response.error || "Match history is unavailable." }); return; } state.selectedPlayerHistory = response?.history || []; state.selectedPlayerView = "history"; renderPlayerSurface(); });
    if (action.dataset.playerAction === "block") emitServer("block-player", { otherAccountId: targetId }, (response) => { if (response?.success !== false) closeSurface("#player-modal"); });
    if (action.dataset.playerAction === "report") emitServer("report-player", { otherAccountId: targetId, reason: "player report from in-room card" }, (response) => { if (response?.success !== false) { announceSocialNotification({ body: "Report submitted to the parlor moderators." }); closeSurface("#player-modal"); } });
  });
  $("#social-scrim")?.addEventListener("click", () => closeSurface("#social-modal"));
  $("#rankings-scrim")?.addEventListener("click", () => closeSurface("#rankings-modal"));
  $("#player-scrim")?.addEventListener("click", () => closeSurface("#player-modal"));

  // Home actions are bound to their explicit controls below. Keeping the
  // entry points named avoids accidental duplicate Create/Browse triggers.
  $("#join-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const codeInput = $("#room-join");
    const nicknameInput = $("#join-nickname");
    const error = $("#join-form-error");
    const code = String(codeInput?.value || "").trim().toUpperCase();
    const nickname = String(state.account?.account?.displayName || nicknameInput?.value || "").trim().toUpperCase().replace(/[^A-Z0-9 _-]/g, "").slice(0, 12);
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      if (error) error.textContent = "ENTER A 6-CHARACTER ROOM CODE.";
      codeInput?.focus({ preventScroll: true });
      return;
    }
    if (!nickname) {
      if (error) error.textContent = "ENTER THE PLAYER NAME FOR THIS ROOM.";
      nicknameInput?.focus({ preventScroll: true });
      return;
    }
    if (error) error.textContent = "";
    state.alias = state.account?.account ? state.account.account.displayName : saveGuestAlias(nickname);
    applyProfileToHomeUI();
    closeRoomsModal();
    enterParlor(code);
  });
  $("#room-join")?.addEventListener("input", (e) => {
    const cleaned = String(e.target.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    e.target.value = cleaned.slice(0, 6);
    const error = $("#join-form-error");
    if (!error) return;
    if (cleaned.length > 6) {
      error.textContent = "ROOM CODES ARE 6 CHARACTERS — EXTRA CHARACTERS REMOVED.";
    } else if (error.textContent.startsWith("ROOM CODES ARE 6")) {
      error.textContent = "";
    }
  });
  $("#join-nickname")?.addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9 _-]/g, "").slice(0, 12);
    if ($("#join-form-error")) $("#join-form-error").textContent = "";
  });
  $("#home-alias-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#home-alias");
    state.alias = saveGuestAlias(input?.value || "");
    renderGuestAliasField(state.alias ? "" : "CREATE AN ALIAS BEFORE JOINING A TABLE.");
    if (state.alias) $("#open-join-btn")?.focus({ preventScroll: true });
  });
  $("#home-alias")?.addEventListener("input", (e) => {
    state.alias = String(e.target.value || "").toUpperCase().replace(/[^A-Z0-9 _-]/g, "").slice(0, 12);
    e.target.value = state.alias;
    saveGuestAlias(state.alias);
    renderGuestAliasField("");
    applyProfileToHomeUI();
  });

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
  $("#rr-body").addEventListener("click", (e) => {
    const contractCancel = e.target.closest("[data-player-contract-cancel]");
    if (contractCancel) {
      emitServer("cancel-player-contract", { requestId: createRequestId("contract-cancel") }, (response) => {
        if (response?.success === false) {
          say(response.error || "The pending contract could not be canceled.");
          renderChat();
        } else {
          renderRightRail();
        }
      });
      return;
    }
    const contractAction = e.target.closest("[data-player-contract-action]");
    if (contractAction) {
      const accept = contractAction.dataset.playerContractAction === "accept";
      emitServer("respond-player-contract", { accept, requestId: createRequestId("contract-response") }, (response) => {
        if (response?.success === false) {
          say(response.error || "The player contract could not be updated.");
          renderChat();
        } else {
          state.playerContractOffer = null;
          renderRightRail();
        }
      });
      return;
    }
    const contractRepay = e.target.closest("[data-player-contract-repay]");
    if (contractRepay) {
      emitServer("repay-player-contract", { contractId: contractRepay.dataset.playerContractRepay, requestId: createRequestId("contract-repay") }, (response) => {
        if (response?.success === false) {
          say(response.error || "The player loan could not be repaid.");
          renderChat();
        } else {
          renderRightRail();
        }
      });
      return;
    }
    const marketButton = e.target.closest("[data-market-order]");
    if (marketButton && !marketButton.disabled) {
      const quantity = Math.max(1, Math.min(1000, Math.floor(Number($("#market-quantity")?.value) || 1)));
      emitServer("market-order", { instrumentId: marketButton.dataset.marketId, side: marketButton.dataset.marketSide, quantity, requestId: createRequestId("market") }, (response) => {
        if (response?.success === false) {
          say(response.error || "Market order could not be completed.");
          renderChat();
          return;
        }
        if (response?.economy) {
          state.economy = { ...state.economy, ...response.economy, market: { ...state.economy.market, ...(response.economy.market || {}) }, casino: { ...state.economy.casino, ...(response.economy.casino || {}) } };
        }
        renderRightRail();
      });
      return;
    }
    const bankAction = e.target.closest("[data-bank-action]");
    if (bankAction) {
      const eventName = bankAction.dataset.bankAction === "take" ? "take-bank-loan" : "repay-bank-loan";
      emitServer(eventName, { requestId: createRequestId(eventName) }, (response) => {
        if (response?.success === false) {
          say(response.error || "The bank transaction could not be completed.");
          renderChat();
        }
      });
      return;
    }
    const financeButton = e.target.closest("[data-finance-open], [data-finance-surface]");
    if (financeButton) {
      openFinancingModal(financeButton.dataset.financeOpen || "loan", null, financeButton, financeButton.dataset.financeSurface || "offer");
      return;
    }
    const buyBtn = e.target.closest("[data-buy]");
    if (buyBtn && !buyBtn.disabled) { buyTile(TILES[Number(buyBtn.dataset.buy)]); return; }
    const tradeBtn = e.target.closest("[data-trade]");
    if (tradeBtn && !tradeBtn.disabled) openTradeModal(tradeBtn.dataset.trade);
  });
  $("#rr-body").addEventListener("submit", (e) => {
    const contractForm = e.target.closest("[data-player-contract-form]");
    if (contractForm) {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(contractForm).entries());
      payload.amount = Number(payload.amount) || 0;
      payload.premiumRate = Number(payload.premiumRate) || 0;
      payload.durationRounds = Number(payload.durationRounds) || 3;
      payload.propertyIndex = payload.propertyIndex === "" ? null : Number(payload.propertyIndex);
      payload.collateralTileIndex = payload.collateralTileIndex === "" ? null : Number(payload.collateralTileIndex);
      payload.requestId = createRequestId("contract-proposal");
      emitServer("propose-player-contract", payload, (response) => {
        if (response?.success === false) {
          say(response.error || "The player contract could not be sent.");
          renderChat();
        } else {
          say("Contract sent for review.");
          renderChat();
          renderRightRail();
        }
      });
      return;
    }
    const form = e.target.closest("[data-casino-form]");
    if (!form) return;
    e.preventDefault();
    const color = form.querySelector("input[name=casino-color]:checked")?.value || "red";
    const stake = Math.max(1, Math.floor(Number(form.querySelector("[name=stake]")?.value) || 0));
    emitServer("place-casino-bet", { color, stake, requestId: createRequestId("casino") }, (response) => {
      if (response?.success === false) {
        say(response.error || "Casino bet could not be completed.");
        renderChat();
        return;
      }
      if (response?.economy) {
        state.economy = { ...state.economy, ...response.economy, market: { ...state.economy.market, ...(response.economy.market || {}) }, casino: { ...state.economy.casino, ...(response.economy.casino || {}) } };
      }
      renderRightRail();
    });
  });

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
renderHome();
buildBoard(onTileClick);
hydrateSprites();
bindEvents();
renderAll();
showView("home");
openCardPreviewFromUrl();
