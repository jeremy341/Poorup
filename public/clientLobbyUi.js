// LOBBY UI: the setup-overlay appearance chooser, the lobby settings rail and
// parlor navigation. emitServer, updateServerSetting, showView, renderAll, say,
// renderChat, clearSave, renderPlayers and closeRoomsModal are injected by the entry module.
import { $, esc, clamp } from "./clientDom.js";
import {
  state,
  activeAppearance,
  syncLocalAppearance,
  buildPlayers,
  getAppearanceMeta,
  getProfileById,
} from "./clientState.js";
import {
  APPEARANCES,
  MAX_PROFILES,
  profileDesignName,
  saveActiveDesignId,
  hasSavedActiveDesign,
} from "./clientSanitize.js";
import { avatarHTML } from "./clientSprites.js";
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

let host = {
  emitServer: noop,
  updateServerSetting: noop,
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
const ROOM_ENTRY_ACK_TIMEOUT_MS = 4000;
const ROOM_ENTRY_ACK_RETRIES = 2;
let quickTableFlow = false;
let quickTableRetryCount = 0;
let quickTableRequestId = 0;
let quickTableDirectoryTimer = null;
let activeRoomEntryAttempt = null;
let activeRoomEntryStatusNode = null;

export function sendRoomEntryWithRetries({
  emit,
  event,
  payload,
  onResponse,
  onTimeout,
  timeoutMs = ROOM_ENTRY_ACK_TIMEOUT_MS,
  maxRetries = ROOM_ENTRY_ACK_RETRIES,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let active = true;
  let retries = 0;
  let timer = null;

  const stopTimer = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };
  const finish = (response) => {
    if (!active) return;
    active = false;
    stopTimer();
    onResponse(response);
  };
  const send = () => {
    timer = schedule(() => {
      if (!active) return;
      timer = null;
      if (retries < maxRetries) {
        retries += 1;
        send();
        return;
      }
      active = false;
      onTimeout();
    }, timeoutMs);
    emit(event, payload, finish);
  };

  send();
  return {
    cancel() {
      if (!active) return;
      active = false;
      stopTimer();
    },
  };
}

export function roomEntryAckFromSnapshot(snapshot, clientId) {
  const room = snapshot?.room;
  const players = snapshotPlayers(snapshot);
  const player = players.find(candidate => candidate?.clientId === clientId);
  if (!room) return null;
  if (!player) return null;
  return {
    success: true,
    created: true,
    roomCode: roomCodeFromSnapshot(room),
    visibility: visibilityFromSnapshot(room),
    hostId: firstValue(room.hostId),
    playerId: firstValue(player.id, player.roomPlayerId),
    bots: players.filter(candidate => candidate?.isBot).length,
  };
}

function firstValue(...values) {
  return values.find(Boolean) || null;
}

function roomCodeFromSnapshot(room) {
  return Object.prototype.hasOwnProperty.call(room, "roomCode") ? room.roomCode : null;
}

function visibilityFromSnapshot(room) {
  return room.visibility === "public" ? "public" : "private";
}

export function reconcileParlorEntrySnapshot(snapshot) {
  if (!state.roomEntryPending) return false;
  const ack = roomEntryAckFromSnapshot(snapshot, state.clientId);
  if (!ack) return false;
  activeRoomEntryAttempt?.cancel();
  activeRoomEntryAttempt = null;
  applyParlorEntryAck(ack);
  return true;
}

/**
 * Pick open public tables so Quick Table fills an existing lobby first. This is
 * only a preference: join-room still checks every join on the server.
 */
export function chooseQuickTableRoom(rooms = []) {
  return (Array.isArray(rooms) ? rooms : [])
    .filter(isOpenQuickTableRoom)
    .sort((a, b) => {
      const openA = Number(a.cap) - Number(a.seats);
      const openB = Number(b.cap) - Number(b.seats);
      // Fill the table with the fewest free seats first, then use the stable
      // public id as a tie-breaker so two clients make the same choice.
      return openA - openB || String(a.roomId).localeCompare(String(b.roomId));
    });
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

function renderSetup() {
  const wrap = $("#setup-wrap");
  wrap.classList.toggle("is-hidden", state.phase !== "setup");
  if (state.phase !== "setup") return;

  const entryButton = $("#su-start");
  if (entryButton) {
    entryButton.disabled = Boolean(state.roomEntryPending);
    const label = entryButton.querySelector(".cta-text");
    if (label) label.textContent = state.roomEntryPending ? "Connecting…" : "Enter Parlor";
  }

  // Server is authoritative for identity: if the table auto-assigned a
  // different colour than the local design, the picker must show the seat
  // colour as the active row, not the (rejected) design choice.
  const choice = setupAppearanceChoice();
  const meta = getAppearanceMeta(choice);
  paintSetupIdentity(choice, meta);
  paintSetupTabs();
  paintSetupGrid(choice);
}

function setupSeatColor() {
  const seat = state.players.find((p) => p.clientId === state.clientId);
  return String(seat?.color || "").toLowerCase();
}

function setupAppearanceChoice() {
  const seatColor = setupSeatColor();
  // Identity first: a custom design is its own identity and must never
  // collapse onto a color-matching preset. When the local design already
  // explains the seat color, it IS the choice.
  const local = activeAppearance();
  const localColor = String(getAppearanceMeta(local).color || "").toLowerCase();
  if (localColor && localColor === seatColor) return local;
  // Server-authoritative fallback: the table assigned a color the local
  // design does not explain, so the seat color shows as the active row.
  const seatPreset = APPEARANCES.findIndex((a) => String(a.color).toLowerCase() === seatColor);
  if (seatPreset >= 0) return seatPreset;
  return local;
}

// Taken-ness is identity (color plus face), mirroring faceSignature in
// server/appearanceApi.js: same color with a different face is a different
// icon, so only an exact duplicate greys a preset out.
function setupFaceSignature(avatarGrid) {
  if (!Array.isArray(avatarGrid)) return "generic";
  const inked = avatarGrid.some((row) => Array.isArray(row) && row.some((cell) => Boolean(cell)));
  if (!inked) return "generic";
  return JSON.stringify(avatarGrid, (key, value) => (typeof value === "string" ? value.toLowerCase() : value));
}

function setupIdentityKey(color, avatarGrid) {
  return `${String(color || "").toLowerCase()}|${setupFaceSignature(avatarGrid)}`;
}

function setupTakenIdentities() {
  const seated = state.players
    .filter((p) => p.clientId !== state.clientId)
    .filter((p) => p.online !== false)
    .filter((p) => !p.bankrupt);
  return new Set(seated.map((p) => setupIdentityKey(p.color, p.avatarGrid)));
}

function selectedDesignName(choice, meta) {
  if (typeof choice !== "string") return meta.label;
  const selectedProfile = getProfileById(choice);
  if (!selectedProfile) return meta.label;
  return profileDesignName(selectedProfile);
}

function activeDesignName() {
  if (typeof state.appearance !== "string") return getAppearanceMeta(state.appearance).label;
  const activeProfile = getProfileById(state.appearance);
  if (!activeProfile) return getAppearanceMeta(state.appearance).label;
  return profileDesignName(activeProfile);
}

function tableAppearanceIsDifferent() {
  const override = state.tableAppearanceOverride;
  if (override == null) return false;
  return override !== state.appearance;
}

function paintSetupIdentity(choice, meta) {
  // The active design is the default. The chooser is opt-in, so joining a table
  // never asks the player to make the same identity decision twice.
  const selectedName = selectedDesignName(choice, meta);
  const sourceLabel = state.tableAppearanceOverride == null ? "ACTIVE DESIGN" : "THIS TABLE ONLY";
  const activeName = activeDesignName();
  const activeIsDifferent = tableAppearanceIsDifferent();
  const activeCard = $("#su-active-card");
  if (activeCard) {
    activeCard.innerHTML = `<div class="su-active-avatar">${avatarHTML({ color: meta.color, avatarGrid: meta.avatarGrid }, 4, 0)}</div><div class="su-active-copy"><span class="t-micro ${activeIsDifferent ? "g400" : "green"}">${sourceLabel}</span><strong class="t-label f14 su-active-name" style="color:${meta.textColor}">${esc(selectedName)}</strong><span class="t-micro ink-3">${activeIsDifferent ? `ACTIVE DESIGN · ${esc(activeName)}` : "READY TO ENTER THE PARLOR"}</span></div>`;
  }
  toggleSetupOverrideButtons(!activeIsDifferent);
  $("#su-chooser")?.classList.remove("is-hidden");
}

function toggleSetupOverrideButtons(hidden) {
  $("#su-active-actions")?.classList.toggle("is-hidden", hidden);
  $("#su-reset-btn")?.classList.toggle("is-hidden", hidden);
  $("#su-make-active-btn")?.classList.toggle("is-hidden", hidden);
}

function paintSetupTabs() {
  document.querySelectorAll(".su-tab").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.suTab === state.setupTab);
    btn.setAttribute("aria-selected", String(btn.dataset.suTab === state.setupTab));
  });
  $("#su-custom-count").textContent = `${state.profiles.length}/${MAX_PROFILES}`;
  $("#su-grid")?.setAttribute("aria-labelledby", `su-tab-${state.setupTab}`);
}

function paintSetupGrid(choice) {
  if (state.setupTab === "custom") {
    $("#su-grid").innerHTML = customDesignsHTML(choice);
    return;
  }
  $("#su-grid").innerHTML = presetDesignsHTML(choice);
}

function customDesignsHTML(choice) {
  if (!state.profiles.length) {
    return `<p class="su-empty-custom">No custom designs yet. Create one from the home screen, then pick it here.</p>`;
  }
  return state.profiles
    .map((p, i) => customDesignCardHTML(p, choice === p.id, i))
    .join("");
}

function customStatusText(active, id) {
  if (active) return tableOrActiveDesign();
  if (id === state.appearance) return "ACTIVE DESIGN";
  return "AVAILABLE";
}

function presetStatusText(active, taken, index) {
  if (active) return tableOrActiveDesign();
  if (taken) return "TAKEN";
  if (state.appearance === index) return "ACTIVE DESIGN";
  return "AVAILABLE";
}

function tableOrActiveDesign() {
  if (tableAppearanceIsDifferent()) return "THIS TABLE";
  return "ACTIVE DESIGN";
}

function customDesignCardHTML(p, active, i) {
  const status = customStatusText(active, p.id);
  return `<button type="button" class="su-opt su-opt-profile${active ? " is-active" : ""}" data-app="${esc(p.id)}">
              <div class="su-av">${avatarHTML(p, 5, i)}</div>
              <div>
              <div class="t-label f13" style="color:${p.color}">${esc(profileDesignName(p))}</div>
                <div class="t-micro ink-3 su-state">${status}</div>
              </div>
            </button>`;
}

function presetDesignsHTML(choice) {
  const taken = setupTakenIdentities();
  return APPEARANCES.map((a, i) => presetDesignCardHTML(a, i, choice, taken)).join("");
}

function presetDesignCardHTML(a, i, choice, takenIdentities) {
  const active = choice === i;
  const taken = !active && takenIdentities.has(setupIdentityKey(a.color, null));
  const status = presetStatusText(active, taken, i);
  return `<button type="button" class="su-opt${active ? " is-active" : ""}${taken ? " is-taken" : ""}" data-app="${i}"${taken ? " disabled aria-disabled=\"true\" title=\"This icon is taken at the table\"" : ""}>
      <div class="su-av">${avatarHTML(a, 5, i)}</div>
      <div>
        <div class="t-label f13" style="color:${taken ? "var(--text-muted)" : a.textColor}">${a.label}</div>
        <div class="t-micro ink-3 su-state">${status}</div>
      </div>
    </button>`;
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
    settingRow("Board Variant", "Standard is the classic 40-space board. Metro adds 12 spaces and supports up to six seats.", sel("boardVariant", s.boardVariant || "standard-40", [["standard-40", "STANDARD · 40"], ["metro-52", "METRO · 52 / 6 SEATS"]])),
    settingRowNum("Max Players", "Seats at the table.", stepper("maxPlayers", s.maxPlayers, 2, s.boardVariant === "metro-52" ? 6 : 4)),
    settingRowNum("Computer players", "Add computer players to fill empty seats.", stepper("bots", s.bots, 0, Math.max(0, s.maxPlayers - 1))),
    settingRow("Computer Brain", "Choose AI or the offline house brain. AI falls back automatically when credits or service are unavailable.", botBrainControl(s)),
    settingRow("Computer Difficulty", "Change search depth and reserve tolerance, never the legal rules.", sel("botDifficulty", s.botDifficulty, [["house","HOUSE"],["table","TABLE"],["expert","EXPERT"]])),
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

// Optional systems start off. They sit behind one collapsed block that opens itself when any of them is on,
// so a casual host sees the core rules first.
const ADVANCED_SYSTEM_KEYS = ["playerFinance", "bankLoans", "casino", "flights", "bankAccountUpgrades", "itemRewards", "market", "globalEvents"];

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
  const anyOn = ADVANCED_SYSTEM_KEYS.some(key => Boolean(s[key]));
  return `<details class="lobby-advanced"${anyOn ? " open" : ""}>
    <summary class="t-label">ADVANCED SYSTEMS · ${anyOn ? "SOME ON" : "ALL OFF"}</summary>
    ${lobbySection("Optional Systems", rows)}
  </details>`;
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
  renderLobbyStartHint(s, locked, hostLocked);
  applyLobbyLockState(locked, hostLocked);
}

// The start block explains a blocked start and offers the fix on the same spot.
function renderLobbyStartHint(s, locked, hostLocked) {
  const hint = $("#lobby-start-hint");
  if (!hint) return;
  const needsSeat = !locked && !hostLocked && (state.players?.length || 0) < 2;
  hint.hidden = !needsSeat;
  if (!needsSeat) {
    hint.innerHTML = "";
    return;
  }
  const [, max] = stepperLimits("bots");
  const full = (Number(s.bots) || 0) >= max;
  hint.innerHTML = `<p class="t-body ink-2">At least two players are required.</p>
    ${full
      ? '<p class="t-micro ink-3">Raise Max Players in Table Rules to seat more computer players.</p>'
      : '<button class="btn-dark lobby-add-computer" type="button" data-add-computer>Add computer player</button>'}`;
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
  focusSurface("#setup-wrap", "#su-start");
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
  enterParlor();
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
    enterParlor({ roomId: candidate.roomId });
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
  clearQuickTableDirectoryTimer();
  activeRoomEntryAttempt?.cancel();
  activeRoomEntryAttempt = null;
  host.showView("home");
  host.renderAll();
}

function applyParlorEntryAck(response) {
  quickTableFlow = false;
  quickTableRetryCount = 0;
  clearQuickTableDirectoryTimer();
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
  applyPendingRoomSettings();
  state.pendingRoomMeta = null;
  if (state.phase === "lobby") requestAnimationFrame(() => placePieces());
}

function applyPendingRoomSettings() {
  if (!state.pendingRoomSettings) return;
  Object.entries(state.pendingRoomSettings).forEach(([key, value]) => host.updateServerSetting(key, value));
  state.pendingRoomSettings = null;
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
export function playVsComputer() {
  if (!requireGuestAlias()) return;
  if (quickTableFlow || state.roomEntryPending) return;
  state.quickJoin = false;
  state.pendingRoomMeta = { roomName: "COMPUTER TABLE", visibility: "public", boardVariant: "standard-40" };
  state.pendingRoomSettings = { vacationPool: false, trading: true, auction: true, bots: 1 };
  enterParlor();
}

export function enterParlor(code) {
  if (!requireGuestAlias()) return;
  if (state.roomEntryPending) return;
  activeRoomEntryStatusNode = host.captureActionStatusNode(document.activeElement);
  const { requestedCode, requestedRoomId } = normalizeEntryDescriptor(code);
  const meta = getAppearanceMeta(activeAppearance());
  const event = entryEvent(requestedCode, requestedRoomId);
  const requestId = entryRequestId(event);
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
      rejectParlorEntry({ success: false, error: "Room entry timed out. Try again." });
    },
  });
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
    return;
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

function isOpenQuickTableRoom(room) {
  const seats = Number(room?.seats);
  const cap = Number(room?.cap);
  const surface = `${room?.visibility || ""}:${room?.state || ""}`;
  const capacity = `${Number.isFinite(seats)}:${Number.isFinite(cap)}:${seats < cap}`;
  return surface === "public:open" && Boolean(room?.roomId) && capacity === "true:true:true";
}

function snapshotPlayers(snapshot) {
  const gamePlayers = snapshot?.game?.players;
  if (Array.isArray(gamePlayers)) return gamePlayers;
  return Array.isArray(snapshot?.room?.players) ? snapshot.room.players : [];
}

function inRoomSession() {
  return ["setup", "lobby", "playing"].includes(state.phase);
}

function onLobbySettingsClick(e) {
  if (e.target.closest("[data-add-computer]")) {
    addComputerPlayer();
    return;
  }
  const togBtn = e.target.closest("[data-setting]");
  if (togBtn?.classList.contains("tog")) {
    onToggleSetting(togBtn);
    return;
  }
  const stepBtn = e.target.closest("[data-step]");
  if (isStepperEnabled(stepBtn)) onStepperSetting(stepBtn);
}

function isStepperEnabled(stepBtn) {
  if (!stepBtn) return false;
  return !stepBtn.disabled;
}

function onToggleSetting(togBtn) {
  if (togBtn.disabled) return;
  const key = togBtn.dataset.setting;
  state.settings[key] = !state.settings[key];
  host.updateServerSetting(key, state.settings[key]);
  renderLobbyRail();
}

function stepperLimits(key) {
  if (key === "maxPlayers") return [2, state.settings.boardVariant === "metro-52" ? 6 : 4];
  if (key === "bots") return [0, Math.max(0, Number(state.settings.maxPlayers) - 1)];
  return [0, 999];
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

function clampBotsToSeats() {
  state.settings.bots = clamp(Number(state.settings.bots) || 0, 0, Math.max(0, state.settings.maxPlayers - 1));
}

const NUMERIC_SETTING_KEYS = ["startingCash"];

function numericSettingValue(value) {
  if (typeof value !== "string" || value.trim() === "") return { valid: false };
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return { valid: false };
  return { valid: true, value: Math.floor(parsed) };
}

export function normalizeSettingValue({ key, value, checked, inputType } = {}) {
  if (key === "houseLimit" || key === "hotelLimit") return { valid: false };
  if (NUMERIC_SETTING_KEYS.includes(key)) return numericSettingValue(value);
  return { valid: true, value: inputType === "checkbox" ? checked : value };
}

function isSettingField(el) {
  if (!el) return false;
  if (el.tagName === "SELECT") return true;
  return el.matches("input[data-setting]");
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
  $("#lobby-start-hint")?.addEventListener("click", onLobbySettingsClick);
  $("#lobby-settings-body").addEventListener("change", applySettingField);
}

export { renderSetup, renderLobbyRail, setActiveAppearance };
