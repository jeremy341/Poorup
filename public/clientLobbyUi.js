// LOBBY UI BARREL: parlor entry/lobby orchestration and the public lobby UI API.
// Pure rendering, wire and settings helpers live in the clientLobby* sibling modules.
import { $, esc, clamp } from "./clientDom.js";
import {
  state,
  activeAppearance,
  syncLocalAppearance,
  buildPlayers,
  getAppearanceMeta,
} from "./clientState.js";
import { saveActiveDesignId, hasSavedActiveDesign } from "./clientSanitize.js";
import { accountAppearancePayload, saveFaceToAccount } from "./clientAccountAppearance.js";
import { placePieces } from "./clientBoardRender.js";
import { setBoardVariant } from "./clientBoardData.js";
import { renderTopNav } from "./clientTopNavRender.js";
import {
  applyProfileToHomeUI,
  renderAccountPanel,
  renderProfileLibrary,
  requireGuestAlias,
} from "./clientProfileRender.js";
import { closeAllSurfaces, focusSurface } from "./clientSurfaces.js";
import { parlorNotice } from "./clientSocialSurfaces.js";
import { stopAuctionTimer } from "./clientAuctionUi.js";
import { sendRoomEntryWithRetries, roomEntryAckFromSnapshot, chooseQuickTableRoom } from "./clientLobbyWire.js";
import { renderSetup } from "./clientLobbyAppearance.js";
import { normalizeSettingValue, isSettingField, stepperLimits, clampBotsToSeats, isStepperEnabled } from "./clientLobbySettings.js";

let host = {
  emitServer: noop,
  updateServerSetting: noop,
  startRound: noop,
  showView: noop,
  renderAll: noop,
  say: noop,
  renderChat: noop,
  clearSave: noop,
  renderPlayers: noop,
  closeRoomsModal: noop,
  rebuildBoard: noop,
  goHome: noop,
  openConfirmModal: noop,
  createRequestId: () => "",
  captureActionStatusNode: () => null,
  announceActionStatus: noop,
};

function noop() {}

const QUICK_TABLE_MAX_RETRIES = 2;
const QUICK_TABLE_DIRECTORY_TIMEOUT_MS = 5000;
let quickTableFlow = false;
let quickTableRetryCount = 0;
let quickTableRequestId = 0;
let quickTableDirectoryTimer = null;
let activeRoomEntryAttempt = null;
let activeRoomEntryStatusNode = null;
let pendingJoinRoomCode = "";
// Solo "Play vs computer" auto-start. soloEntryIntent marks the entry playVsComputer is about to
// make; soloAutoStart then tracks that one table (settled = bots staged, fired = start emitted).
let soloEntryIntent = false;
let soloEntry = false;
let soloAutoStart = null;

export function reconcileParlorEntrySnapshot(snapshot) {
  if (!state.roomEntryPending) return false;
  if (state.suppressRoomUpdates) return false;
  const ack = roomEntryAckFromSnapshot(snapshot, state.clientId);
  if (!ack) return false;
  if (!entryAckMatchesPendingRoom(ack)) return false;
  activeRoomEntryAttempt?.cancel();
  activeRoomEntryAttempt = null;
  applyParlorEntryAck(ack);
  return true;
}

// A stale snapshot from the room just left still lists this clientId, so a
// fallback ack must prove it belongs to the room being entered: a code entry
// matches its room code, and a codeless entry (public or directory join) only
// accepts a codeless public snapshot, never a leaked private one.
function entryAckMatchesPendingRoom(ack) {
  const entryCode = String(state.roomCode || "").trim().toUpperCase();
  const ackCode = String(ack.roomCode || "").trim().toUpperCase();
  if (entryCode || ackCode) return entryCode === ackCode;
  return ack.visibility === "public" && state.roomVisibility === "public";
}

export function configureLobbyUi(hooks) {
  host = { ...host, ...hooks };
}

// A signed-in player's chosen face lives on the account, so every browser they sign in on shows it.
function syncAppearanceToAccount(choice) {
  if (!state.account) return;
  saveFaceToAccount(accountAppearancePayload(choice)).then((result) => {
    if (result.success === false && !result.skipped) console.warn("Could not save your face to the account:", result.error);
  });
}
function setActiveAppearance(choice) {
  state.appearance = choice;
  state.tableAppearanceOverride = null;
  saveActiveDesignId(choice);
  syncLocalAppearance();
  applyProfileToHomeUI();
  renderAccountPanel();
  renderProfileLibrary();
  syncAppearanceToAccount(choice);
}

function setTableAppearanceOverride(choice) {
  state.tableAppearanceOverride = choice === state.appearance ? null : choice;
  syncLocalAppearance();
  host.renderPlayers();
  renderSetup();
  renderLobbyRail();
  syncServerAppearance();
}

function clearTableAppearanceOverride() {
  state.tableAppearanceOverride = null;
  syncLocalAppearance();
  host.renderPlayers();
  renderSetup();
  renderLobbyRail();
  syncServerAppearance();
}

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
  const label = id === "rulesProfile" ? "Starting Preset" : id.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
  return `<select class="setting-select" data-setting="${id}" aria-label="${esc(label)}">
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

function lobbySetupNotice(locked, hostLocked) {
  if (locked) {
    return `<div class="settings-rule lobby-lock-note">
          <strong style="color:var(--gold-300)">FINISH SETUP TO CONTINUE</strong><br>
          Your active design is ready. Press "Enter Parlor" on the left to seat the table, or change it there for this table only.
        </div>`;
  }
  if (hostLocked) {
    return `<div class="settings-rule lobby-lock-note"><strong style="color:var(--gold-300)">HOST CONTROLS THIS TABLE</strong><br>The room host owns settings and starts the round. You can review the rules while you wait.</div>`;
  }
  return "";
}

function botBrainControl(settings) {
  const exhausted = state.botProviderStatus?.state === "quota-exhausted";
  const selected = String(settings.botBrain || "ai").toLowerCase() === "no-ai" ? "no-ai" : "ai";
  const aiLabel = exhausted ? "AI COMPUTER · CREDITS EXHAUSTED" : "AI COMPUTER";
  const aiDisabled = exhausted ? "disabled" : "";
  const status = exhausted ? '<span class="setting-status setting-status-error" data-bot-provider-copy>AI CREDITS EXHAUSTED</span>' : "";
  const help = exhausted ? "AI COMPUTER is unavailable. Select NO-AI COMPUTER to use the offline house brain." : "AI COMPUTER uses the provider and falls back automatically when unavailable.";
  return `<span class="setting-control-stack"><select class="setting-select${exhausted ? " is-error" : ""}" data-setting="botBrain" aria-describedby="bot-brain-help"><option value="ai" ${selected === "ai" ? "selected" : ""} ${aiDisabled}>${aiLabel}</option><option value="no-ai" ${selected === "no-ai" ? "selected" : ""}>NO-AI COMPUTER</option></select><span id="bot-brain-help" class="sr-only">${help}</span>${status}</span>`;
}

function renderLobbyRail() {
  // the settings rail owns the right column for both "setup" (choosing
  // appearance) and "lobby" (configuring rules); the in-game Holdings
  // rail should only ever appear once a round is actually live.
  const preGame = state.phase === "setup" || state.phase === "lobby";
  $("#right-rail-game").classList.toggle("is-hidden", preGame);
  $("#right-rail-lobby").classList.toggle("is-hidden", !preGame);
  if (!preGame) return;
  return renderLobbyRailContent(
    state.settings,
    state.phase === "setup",
    state.phase === "lobby" && !state.players[0]?.isHost,
  );
}

function lobbyTableRules(s) {
  return lobbySection("Table Rules", [
    settingRow("Starting Preset", "Choose a starting point, then customize every rule below.", sel("rulesProfile", s.rulesProfile || "standard", [["standard", "STANDARD"], ["advanced", "ADVANCED"]])),
    settingRow("Board Variant", "Standard: 40 spaces. Metro: 52 spaces, up to 6 players.", sel("boardVariant", s.boardVariant || "standard-40", [["standard-40", "STANDARD · 40"], ["metro-52", "METRO · 52 / 6 SEATS"]])),
    settingRowNum("Max Players", "Seats at the table.", stepper("maxPlayers", s.maxPlayers, 2, s.boardVariant === "metro-52" ? 6 : 4)),
    settingRowNum("Computer players", "Add computer players to fill empty seats.", stepper("bots", s.bots, 0, Math.max(0, s.maxPlayers - 1))),
    settingRow("Computer Brain", "AI when available, offline otherwise.", botBrainControl(s)),
    settingRow("Computer Difficulty", "How hard computer players think.", sel("botDifficulty", s.botDifficulty, [["house","HOUSE"],["table","TABLE"],["expert","EXPERT"]])),
    settingRowNum("Starting Cash", "Bank hands this to each player at start.", sel("startingCash", s.startingCash, [["500","$500"],["1000","$1,000"],["1500","$1,500"],["2000","$2,000"],["2500","$2,500"],["3000","$3,000"]])),
    settingRow("Vacation Pool", "Taxes fill free parking. First to land claims it.", tog("vacationPool", s.vacationPool)),
    settingRow("Double GO", "Landing exactly on GO pays $400 instead of $200.", tog("doubleGo", s.doubleGo)),
  ]);
}

function lobbyEconomy(s) {
  return lobbySection("Economy", [
    settingRow("Trading", "Players may propose trades.", tog("trading", s.trading)),
    settingRow("Auction", "Unowned deeds go to auction if buyer passes.", tog("auction", s.auction)),
    settingRow("No Rent In Jail", "Owner in jail can't collect rent that turn.", tog("noRentInJail", s.noRentInJail)),
  ]);
}

// Optional systems start off. They always show as their own section below the core rules.
function lobbyAdvancedSystems(s) {
  const rows = [
  settingRow("Player Finance", "Player loans, temporary rent shares, and purchase funding.", tog("playerFinance", s.playerFinance)),
  settingRow("Bank Loans", "Emergency credit with collateral and a hard maturity.", tog("bankLoans", s.bankLoans)),
  settingRow("Loan Severity", "Premium applied to emergency bank credit.", sel("bankLoanSeverity", s.bankLoanSeverity, [["fair","FAIR"],["predatory","PREDATORY"],["extreme","EXTREME"]])),
  settingRow("Casino Access", "Virtual-money European roulette. No cash-out or loan-funded bets.", tog("casino", s.casino)),
  settingRow("Airport Flights", "Fly airport to airport. Airport owners set the departure and arrival fees.", tog("flights", s.flights)),
  settingRow("Bank Accounts", "Buy a tier in the wallet. Higher tiers rebate fees on market orders and flights.", tog("bankAccountUpgrades", s.bankAccountUpgrades)),
  settingRow("Item Rewards", "Surprise and Treasure can award bonds and keepsakes. Manage them in Wallet & Items.", tog("itemRewards", s.itemRewards)),
  settingRow("Market Access", "Fictional indexes with visible prices and a small trading fee.", tog("market", s.market)),
  settingRow("Market Complexity", "Unlock margin, shorting, or derivatives in staged order.", sel("marketComplexity", s.marketComplexity || "basic", [["basic", "BASIC"], ["margin", "MARGIN"], ["shorting", "SHORTING"], ["derivatives", "DERIVATIVES"]])),
  settingRow("Global Events", "Rare, escalating headlines. Timing and severity scale with the round.", tog("globalEvents", Boolean(s.globalEvents))),
  ];
  return lobbySection("Advanced Systems", rows);
}

function lobbySectionsMarkup(s, locked, hostLocked) {
  return [
    lobbySetupNotice(locked, hostLocked),
    lobbyTableRules(s),
    lobbyEconomy(s),
    lobbyAdvancedSystems(s),
  ].join("");
}

function applyLobbyLockState(locked, hostLocked) {
  const startBtn = $("#lobby-start-btn");
  startBtn.disabled = locked || hostLocked;
  startBtn.querySelector(".cta-text").textContent = locked ? "Finish Setup First" : hostLocked ? "Host Starts Round" : "Start Round";
  $("#lobby-settings-body").querySelectorAll("[data-setting], [data-step]").forEach((control) => {
    control.disabled = locked || hostLocked;
    if (control.disabled) control.setAttribute("aria-disabled", "true");
  });
}

function renderLobbyRailContent(s, locked, hostLocked) {
  $("#lobby-settings-body").innerHTML = lobbySectionsMarkup(s, locked, hostLocked);
  applyLobbyLockState(locked, hostLocked);
}

// Removes one computer seat through the same server setting the Bots stepper uses.
export function removeComputerPlayer() {
  if ((Number(state.settings.bots) || 0) <= 0) return;
  state.settings.bots = Math.max(0, (Number(state.settings.bots) || 0) - 1);
  host.updateServerSetting("bots", state.settings.bots);
  renderLobbyRail();
}

// Adds one computer seat through the same server setting the Bots stepper uses.
export function addComputerPlayer() {
  const [, max] = stepperLimits("bots");
  if ((Number(state.settings.bots) || 0) >= max) return;
  state.settings.bots = clamp((Number(state.settings.bots) || 0) + 1, 0, max);
  host.updateServerSetting("bots", state.settings.bots);
  renderLobbyRail();
}

function syncServerAppearance() {
  const statusNode = host.captureActionStatusNode(document.activeElement);
  const meta = getAppearanceMeta(activeAppearance());
  host.emitServer("set-player-appearance", {
    nickname: state.alias.trim() || meta.baseName,
    color: meta.color,
    avatarGrid: meta.avatarGrid || null,
  }, (response) => {
    if (response?.success === false) {
      host.announceActionStatus(response.error || "Appearance could not be updated.", statusNode);
    }
  });
}

function entryRoomVisibility(requestedCode) {
  if (state.pendingRoomMeta?.visibility) return state.pendingRoomMeta.visibility;
  return requestedCode ? "private" : "public";
}

function resetTableForEntry(requestedCode, requestId = "") {
  state.suppressRoomUpdates = false;
  state.roomEntryPending = true;
  state.roomEntryRequestId = requestId;
  state.roomPlayerId = null;
  state.hostId = null;
  state.roomCode = requestedCode;
  state.roomVisibility = entryRoomVisibility(requestedCode);
  state.boardVariant = "standard-40";
  state.ruleset = null;
  setBoardVariant("standard-40");
  host.rebuildBoard?.();
  state.phase = appearanceStepSkipped() ? "lobby" : "setup";
  state.tableAppearanceOverride = null;
  state.setupTab = typeof state.appearance === "string" ? "custom" : "preset";
  // Start setup and lobby from a clean board. Otherwise a finished game's deeds,
  // houses and tokens stay visible behind the overlay after going home and rejoining.
  // Show only server-acknowledged seats. buildPlayers adds demo CPU seats for the
  // home preview, so keep just the human until startGame creates bots.
  state.players = buildPlayers(activeAppearance(), state.alias).slice(0, 1);
  state.owners = {};
  state.houses = {};
  state.pool = 0;
  state.turnIndex = 0;
  state.dice = [3, 5];
  state.rolling = false;
  state.busy = false;
  state.pendingAction = null;
  state.turnStage = "roll";
  state.highlight = null;
  state.selectedTile = null;
  state.tradeWith = null;
  state.profileDraft = null;
  state.botStatus = null;
  state.economySnapshotStatus = "unknown";
  state.globalEventVotePending = false;
  state.pendingBuyTile = null;
  state.auction = null;
  state.mortgaged = {};
  state.offers = [];
  state.deedDetail = null;
  stopAuctionTimer();
  host.clearSave();
  closeAllSurfaces();
  state.log = ["ACTIVE DESIGN READY. ENTER THE PARLOR."];
  host.showView("game");
  host.renderAll();
  focusSurface("#setup-wrap", "#setup-start-btn");
  requestAnimationFrame(() => placePieces());
}

function clearQuickTableDirectoryTimer() {
  clearTimeout(quickTableDirectoryTimer);
  quickTableDirectoryTimer = null;
}

function quickTableFallbackCreate() {
  clearQuickTableDirectoryTimer();
  state.quickJoin = true;
  state.pendingRoomMeta = {
    roomName: "QUICK TABLE",
    visibility: "public",
    boardVariant: "standard-40"
  };
  state.pendingRoomSettings = { vacationPool: false, trading: true, auction: true };
  parlorNotice("QUICK TABLE", "NO OPEN TABLES. HOSTING A NEW PUBLIC TABLE WITH CLASSIC RULES.");
  enterParlor(undefined, { viaQuickTable: true });
}

function quickTableDirectoryAck(response, requestId) {
  if (!quickTableFlow || requestId !== quickTableRequestId) return;
  clearQuickTableDirectoryTimer();
  if (response?.success === false) {
    quickTableFallbackCreate();
    return;
  }
  const candidate = chooseQuickTableRoom(response?.rooms)[0];
  if (candidate) {
    parlorNotice("QUICK TABLE", "OPEN TABLE FOUND. JOINING NOW.");
    enterParlor({ roomId: candidate.roomId }, { viaQuickTable: true });
    return;
  }
  quickTableFallbackCreate();
}

function requestQuickTableDirectory() {
  const requestId = ++quickTableRequestId;
  clearQuickTableDirectoryTimer();
  quickTableDirectoryTimer = setTimeout(() => {
    quickTableDirectoryAck({ success: false, error: "Directory request timed out." }, requestId);
  }, QUICK_TABLE_DIRECTORY_TIMEOUT_MS);
  host.emitServer("list-rooms", {}, response => quickTableDirectoryAck(response, requestId));
}

function quickTableJoinCanRetry(response) {
  if (!quickTableFlow || quickTableRetryCount >= QUICK_TABLE_MAX_RETRIES) return false;
  return ["Room is full.", "Room not found.", "Game is already in progress."]
    .includes(String(response?.error || ""));
}

function retryQuickTableJoin(response) {
  quickTableRetryCount += 1;
  state.roomEntryPending = false;
  state.roomEntryRequestId = "";
  state.roomPlayerId = null;
  state.hostId = null;
  state.phase = "home";
  state.pendingRoomMeta = null;
  state.pendingRoomSettings = null;
  state.quickJoin = true;
  clearQuickTableDirectoryTimer();
  host.showView("home");
  host.renderAll();
  parlorNotice("QUICK TABLE", `${response.error} Looking for another open table…`, "warning");
  requestQuickTableDirectory();
}

function parlorEntryPayload({ event, requestedCode, meta, requestedRoomId = "", requestId = "" }) {
  return {
    roomCode: requestedCode || undefined,
    roomId: requestedRoomId || undefined,
    nickname: state.alias.trim() || meta.baseName,
    color: meta.color,
    avatarGrid: meta.avatarGrid || null,
    ...(event === "create-room" && requestId ? { requestId } : {}),
    ...parlorPendingRoomMeta(event),
  };
}

function parlorPendingRoomMeta(event) {
  if (event !== "create-room") return {};
  return state.pendingRoomMeta || {};
}

function rejectParlorEntry(response) {
  host.announceActionStatus(response.error || "Room could not be entered.", activeRoomEntryStatusNode);
  const modal = $("#rooms-modal");
  const joinPanel = $("#rooms-panel-join");
  const joinOpen = Boolean(modal && !modal.classList.contains("is-hidden") && joinPanel && !joinPanel.classList.contains("is-hidden"));
  // Surface the server's reason next to the join form and return focus to the
  // code field. When the entry closed the modal (resetTableForEntry runs
  // closeAllSurfaces), the still-open branch below reopens it with the
  // code the user typed.
  if (joinOpen) {
    const joinError = $("#join-form-error");
    if (joinError) joinError.textContent = response?.error || "ROOM NOT FOUND.";
    const codeInput = $("#room-join");
    if (codeInput) {
      codeInput.setAttribute("aria-invalid", "true");
      codeInput.focus({ preventScroll: true });
    }
  }
  activeRoomEntryStatusNode = null;
  state.roomEntryPending = false;
  state.roomEntryRequestId = "";
  state.roomPlayerId = null;
  state.hostId = null;
  state.phase = "home";
  state.pendingRoomMeta = null;
  state.pendingRoomSettings = null;
  state.quickJoin = false;
  quickTableFlow = false;
  quickTableRetryCount = 0;
  soloEntry = false;
  soloAutoStart = null;
  clearQuickTableDirectoryTimer();
  activeRoomEntryAttempt?.cancel();
  activeRoomEntryAttempt = null;
  host.showView("home");
  host.renderAll();
  const reopenJoinCode = pendingJoinRoomCode;
  pendingJoinRoomCode = "";
  setJoinSubmitPending(false);
  if (!joinOpen && reopenJoinCode) {
    // A join holds the requested code until the entry settles: a failure puts
    // the join panel back instead of dropping the user on the home view with
    // the code and name lost. Quick-table joins carry no code, so they keep
    // their own notice-and-retry path.
    host.openRoomsModal?.("join");
    const joinError = $("#join-form-error");
    if (joinError) joinError.textContent = response?.error || "ROOM NOT FOUND.";
    const codeInput = $("#room-join");
    if (codeInput) {
      codeInput.value = reopenJoinCode;
      codeInput.setAttribute("aria-invalid", "true");
    }
  }
}

function applyParlorEntryAck(response) {
  quickTableFlow = false;
  quickTableRetryCount = 0;
  clearQuickTableDirectoryTimer();
  pendingJoinRoomCode = "";
  setJoinSubmitPending(false);
  state.roomEntryPending = false;
  state.roomEntryRequestId = "";
  applyCreatedEntryIdentity(response);
  applyEntryVisibility(response);
  state.phase = appearanceStepSkipped() ? "lobby" : "setup";
  host.renderAll();
  renderTopNav();
  renderSetup();
  renderLobbyRail();
  syncServerAppearance();
  const solo = soloEntry;
  soloEntry = false;
  soloAutoStart = solo ? { roomCode: state.roomCode, settled: false, fired: false } : null;
  applyPendingRoomSettings(solo ? onSoloSettingsSettled : null);
  state.pendingRoomMeta = null;
  if (state.phase === "lobby") requestAnimationFrame(() => placePieces());
}

// Sends the staged table settings; onSettled(ok) runs once every one has been acknowledged.
function applyPendingRoomSettings(onSettled = null) {
  if (!state.pendingRoomSettings) return;
  const entries = Object.entries(state.pendingRoomSettings);
  state.pendingRoomSettings = null;
  let waiting = entries.length;
  let allAccepted = true;
  const acknowledge = (result) => {
    if (result?.success === false) allAccepted = false;
    waiting -= 1;
    if (waiting === 0) onSettled?.(allAccepted);
  };
  entries.forEach(([key, value]) => host.updateServerSetting(key, value, acknowledge));
}

function onSoloSettingsSettled(accepted) {
  if (!soloAutoStart || soloAutoStart.roomCode !== state.roomCode) return;
  if (!accepted) {
    soloAutoStart = null;
    parlorNotice("COMPUTER TABLE", "The computer seat could not be staged. Check the table settings, then start the round.", "warning");
    return;
  }
  soloAutoStart.settled = true;
  trySoloAutoStart();
}

// Starts the round through the lobby button's start-game event, once, for the solo table this
// client just created. It waits out the appearance picker (phase "setup") and gives up if another
// human has taken a seat; a refusal leaves the lobby and its Start Round button in place.
function trySoloAutoStart() {
  const auto = soloAutoStart;
  if (!auto || !auto.settled || auto.fired) return;
  if (state.phase !== "lobby" || state.roomCode !== auto.roomCode) return;
  if (state.players.some((player, index) => index > 0 && !player.bot)) {
    soloAutoStart = null;
    return;
  }
  if (!(Number(state.settings.bots) > 0)) {
    soloAutoStart = null;
    return;
  }
  auto.fired = true;
  host.startRound((response) => {
    if (soloAutoStart !== auto) return;
    soloAutoStart = null;
    if (response?.success === false) {
      parlorNotice("COMPUTER TABLE", `${response.error || "The round did not start."} Press Start Round when you are ready.`, "warning");
    }
  });
}

function onParlorEntryResponse(response, event) {
  if (response?.success === false) {
    if (event === "join-room" && quickTableJoinCanRetry(response)) {
      retryQuickTableJoin(response);
      return;
    }
    rejectParlorEntry(response);
    return;
  }
  applyParlorEntryAck(response);
}

// Solo entry: a table with one computer player. The host still starts the round.
// The table is private (defaults in the CTA tooltip), so it generates its own
// six-character invite code: public solo tables let strangers wander in.
function playVsComputer() {
  if (!requireGuestAlias()) return;
  if (quickTableFlow || state.roomEntryPending) return;
  state.quickJoin = false;
  state.pendingRoomMeta = { roomName: "COMPUTER TABLE", visibility: "private", roomCode: generateRoomInviteCode(), boardVariant: "standard-40" };
  state.pendingRoomSettings = { vacationPool: false, trading: true, auction: true, bots: 1 };
  soloEntryIntent = true;
  try {
    enterParlor();
  } finally {
    soloEntryIntent = false;
  }
}

function generateRoomInviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
}

export function enterParlor(code, options = {}) {
  if (!requireGuestAlias()) return;
  // A quick-table run drives its own enter calls via retryQuickTableJoin; any
  // other entry started mid-flow would hijack the seat, so only the flow's own
  // continuation may pass the guard.
  if (state.roomEntryPending || (quickTableFlow && !options.viaQuickTable)) return;
  // Every other entry path (create, join, rooms list, quick table) clears the solo marker.
  soloEntry = soloEntryIntent;
  soloAutoStart = null;
  activeRoomEntryStatusNode = host.captureActionStatusNode(document.activeElement);
  const { requestedCode, requestedRoomId } = normalizeEntryDescriptor(code);
  const meta = getAppearanceMeta(activeAppearance());
  const event = entryEvent(requestedCode, requestedRoomId);
  const requestId = entryRequestId(event);
  pendingJoinRoomCode = event === "join-room" && requestedCode ? requestedCode : "";
  setJoinSubmitPending(event === "join-room");
  resetTableForEntry(requestedCode, requestId);
  const payload = parlorEntryPayload({ event, requestedCode, meta, requestedRoomId, requestId });
  activeRoomEntryAttempt?.cancel();
  activeRoomEntryAttempt = sendRoomEntryWithRetries({
    emit: host.emitServer,
    event,
    payload,
    onResponse(response) {
      activeRoomEntryAttempt = null;
      onParlorEntryResponse(response, event);
    },
    onTimeout() {
      activeRoomEntryAttempt = null;
      const timeoutResponse = { success: false, error: "Room entry timed out. Try again." };
      // One slow ack must not abort a quick table that still has retries: it
      // goes back to the directory like any recoverable join error.
      if (quickTableFlow && quickTableRetryCount < QUICK_TABLE_MAX_RETRIES) {
        retryQuickTableJoin(timeoutResponse);
        return;
      }
      rejectParlorEntry(timeoutResponse);
    },
  });
}

// Visual clamp for the join form's own submit: roomEntryPending already
// blocks a second entry, the button must also say so while an ack is owed.
function setJoinSubmitPending(pending) {
  const submit = $("#join-room-submit");
  if (!submit) return;
  submit.disabled = pending;
  const label = submit.querySelector(".cta-text");
  if (label) label.textContent = pending ? "CONNECTING…" : "JOIN ROOM";
}

function enterLobby() {
  // called from the setup overlay "Enter Parlor" button
  if (!requireGuestAlias()) return;
  if (state.roomEntryPending) return;
  // Confirming a look saves it as the active design, so later tables skip this step.
  if (!hasSavedActiveDesign(state.profiles)) saveActiveDesignId(state.appearance);
  syncServerAppearance();
    state.phase = "lobby";
    host.renderAll();
    requestAnimationFrame(() => placePieces());
    trySoloAutoStart();
}

export function goHome() {
  // Release the seat on the server so the room can GC and peers stop
  // counting a home-screen player as online.
  if (state.phase !== "home") host.emitServer("leave-room", {}, () => {});
  stopAuctionTimer();
  state.busy = false;
  state.rolling = false;
  state.pendingAction = null;
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
  state.botStatus = null;
  state.economySnapshotStatus = "unknown";
  state.globalEventVotePending = false;
  // Home must not keep the previous room's transcript or activity
  // log. Rejoining a room re-seeds both from the server's next snapshot, so
  // emptying here never leaves stale content behind.
  state.messages = [];
  state.log = [];
  state.phase = "home";
  soloEntry = false;
  soloAutoStart = null;
  state.roomEntryPending = false;
  state.roomEntryRequestId = "";
  activeRoomEntryAttempt?.cancel();
  activeRoomEntryAttempt = null;
  state.roomPlayerId = null;
  state.hostId = null;
  state.roomVisibility = "private";
  state.suppressRoomUpdates = true;
  closeAllSurfaces();
  $("#log-drawer").classList.remove("is-open");
  host.closeRoomsModal();
  $("#right-rail-game").classList.remove("is-hidden");
  $("#right-rail-lobby").classList.add("is-hidden");
  host.showView("home");
}

// One door back to the homescreen. goHome() releases the room
// seat; a raw showView("home") from a page/rail handler would leave the
// seat (and the room's stale transcript) behind when the user is mid-room.
export function leaveRoomForHome() {
  if (state.phase === "playing") {
    host.openConfirmModal({
      title: "Leave active round?",
      message: "Leaving now releases your seat and forfeits this round. Your current assets will stay on the table.",
      confirmLabel: "LEAVE ROUND",
      onConfirm: () => goHome(),
    });
    return;
  }
  // Lobby seats are live too: a misclick must not silently release the room.
  if (inRoomSession()) {
    host.openConfirmModal({
      title: "Leave this room?",
      message: "Leaving releases your seat; the room may be garbage-collected without you.",
      confirmLabel: "LEAVE ROOM",
      onConfirm: () => goHome(),
    });
    return;
  }
  host.showView("home");
}

function entryEvent(requestedCode, requestedRoomId) {
  return requestedCode || requestedRoomId ? "join-room" : "create-room";
}

function entryRequestId(event) {
  return event === "create-room" ? String(host.createRequestId?.("create-room") || "") : "";
}

function normalizeEntryDescriptor(code) {
  const descriptor = code && typeof code === "object" ? code : { roomCode: code };
  return {
    requestedCode: String(descriptor.roomCode || "").trim().toUpperCase(),
    requestedRoomId: String(descriptor.roomId || "").trim().slice(0, 120),
  };
}

function applyCreatedEntryIdentity(response) {
  if (!response?.created) return;
  if (response.hostId) state.hostId = response.hostId;
  if (response.playerId) state.roomPlayerId = response.playerId;
}

function applyEntryVisibility(response) {
  if (Object.prototype.hasOwnProperty.call(response || {}, "roomCode")) state.roomCode = response.roomCode || "";
  if (response?.visibility) state.roomVisibility = response.visibility === "public" ? "public" : "private";
}

function inRoomSession() {
  return ["setup", "lobby", "playing"].includes(state.phase);
}

function onLobbySettingsClick(e) {
  const togBtn = e.target.closest("[data-setting]");
  if (togBtn?.classList.contains("tog")) {
    onToggleSetting(togBtn);
    return;
  }
  const stepBtn = e.target.closest("[data-step]");
  if (isStepperEnabled(stepBtn)) onStepperSetting(stepBtn);
}

function onToggleSetting(togBtn) {
  if (togBtn.disabled) return;
  const key = togBtn.dataset.setting;
  state.settings[key] = !state.settings[key];
  host.updateServerSetting(key, state.settings[key]);
  renderLobbyRail();
}

function onStepperSetting(stepBtn) {
  const key = stepBtn.dataset.step;
  const dir = Number(stepBtn.dataset.dir);
  const [mn, mx] = stepperLimits(key);
  state.settings[key] = clamp((Number(state.settings[key]) || 0) + dir, mn, mx);
  if (key === "maxPlayers") clampBotsToSeats();
  host.updateServerSetting(key, state.settings[key]);
  renderLobbyRail();
}

const applySettingField = (e) => {
  const sel = e.target.closest("[data-setting]");
  if (!isSettingField(sel) || sel.disabled) return;
  const key = sel.dataset.setting;
  const setting = normalizeSettingValue({
    key,
    value: sel.value,
    checked: sel.checked,
    inputType: sel.matches("input[type=checkbox]") ? "checkbox" : "value",
  });
  if (!setting.valid) return;
  state.settings[key] = setting.value;
  host.updateServerSetting(key, state.settings[key]);
  renderLobbyRail();
};

// Joining a table skips the appearance step once a design is saved. The lobby seat card
// then carries the same choice and reopens the chooser on request.
function appearanceStepSkipped() {
  return hasSavedActiveDesign(state.profiles);
}

export function bindLobbyUi() {
  $("#setup-tabs")?.addEventListener("click", (e) => {
    const tabBtn = e.target.closest("[data-su-tab]");
    if (!tabBtn) return;
    state.setupTab = tabBtn.dataset.suTab;
    renderSetup();
  });
  $("#setup-reset-btn")?.addEventListener("click", () => {
    clearTableAppearanceOverride();
    focusSurface("#setup-wrap", "#setup-start-btn");
  });
  $("#setup-make-active-btn")?.addEventListener("click", () => {
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
    focusSurface("#setup-wrap", "#setup-start-btn");
  });
  $("#setup-grid").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-app]");
    if (!btn) return;
    if (btn.disabled) return;
    const raw = btn.dataset.app;
    // preset appearance = "0".."3"; custom profile ids look like "pf_xxxx"
    const choice = /^\d+$/.test(raw) ? Number(raw) : raw;
    setTableAppearanceOverride(choice);
  });
  $("#setup-start-btn").addEventListener("click", enterLobby);
  $("#setup-close")?.addEventListener("click", () => host.goHome());
  $("#setup-wrap .setup-scrim")?.addEventListener("click", () => host.goHome());

  // Quick Table prefers an existing open public room and hosts a new public
  // Standard-40 room only when no compatible seat is available. The join is
  // checked by the authoritative server, with two bounded retries for rooms
  // that fill between list-rooms and join-room.
  $("#play-vs-computer-btn")?.addEventListener("click", playVsComputer);
  $("#quick-table-btn")?.addEventListener("click", () => {
    if (!requireGuestAlias()) return;
    if (quickTableFlow || state.roomEntryPending) return;
    quickTableFlow = true;
    quickTableRetryCount = 0;
    state.quickJoin = true;
    state.settings.vacationPool = false;
    state.settings.trading = true;
    state.settings.auction = true;
    requestQuickTableDirectory();
  });

  // lobby settings interactions
  $("#lobby-settings-body").addEventListener("click", onLobbySettingsClick);
  $("#lobby-settings-body").addEventListener("change", applySettingField);
}

export {
  renderSetup,
  renderLobbyRail,
  setActiveAppearance,
  sendRoomEntryWithRetries,
  roomEntryAckFromSnapshot,
  chooseQuickTableRoom,
  normalizeSettingValue,
};
