/* ============================================================
   LOBBY UI: the setup-overlay appearance chooser, the lobby
   settings rail and the parlor navigation (enter a room, go home).
   emitServer, updateServerSetting, showView, renderAll, say,
   renderChat, clearSave, renderPlayers and closeRoomsModal are
   injected by the entry module.
   ============================================================ */
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
  loadRulesetPreset,
} from "./clientSanitize.js";
import { avatarHTML } from "./clientSprites.js";
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
import { stopTurnCountdown } from "./clientHudRender.js";

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
  createRequestId: () => "",
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
  const players = Array.isArray(snapshot?.game?.players)
    ? snapshot.game.players
    : Array.isArray(room?.players) ? room.players : [];
  const player = players.find(candidate => candidate?.clientId === clientId);
  if (!room || !player) return null;
  return {
    success: true,
    created: true,
    roomCode: Object.prototype.hasOwnProperty.call(room, "roomCode") ? room.roomCode : null,
    visibility: room.visibility === "public" ? "public" : "private",
    hostId: room.hostId || null,
    playerId: player.id || player.roomPlayerId || null,
    bots: players.filter(candidate => candidate?.isBot).length,
  };
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
 * Pick open public tables deterministically so Quick Table can fill an
 * existing lobby before creating another one. The server remains
 * authoritative: this is only a preference list and every join is still
 * checked atomically by join-room.
 */
export function chooseQuickTableRoom(rooms = []) {
  return (Array.isArray(rooms) ? rooms : [])
    .filter(room => room?.visibility === "public"
      && room?.state === "open"
      && room?.roomId
      && Number.isFinite(Number(room.seats))
      && Number.isFinite(Number(room.cap))
      && Number(room.seats) < Number(room.cap))
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
  // The active design is the default. The chooser is deliberately opt-in so
  // joining a table never asks the player to make the same identity decision twice.
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
  return `<button type="button" class="su-opt su-opt-profile${active ? " is-active" : ""}" data-app="${p.id}">
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
  const isHost = Boolean(p.isHost) || Boolean(p.serverId && p.serverId === state.hostId);
  // deterministic per-player "ready" flag instead of Math.random(), so the
  // dot doesn't flicker on every unrelated re-render (typing, toggling, etc.)
  const ready = isYou || !!p.online;
  return `<div class="lobby-player-row${isYou ? " lobby-player-you" : ""}">
    <div class="lobby-av">${avatarHTML(p, 3, seed)}</div>
      <div class="lobby-player-info">
        <div class="t-label lobby-player-name" style="color:${p.textColor}">${p.bot ? '<img class="lobby-brain-icon" src="/assets/bot-brain.svg" alt="">' : ''}${esc(p.name)}${isHost ? '<span class="lobby-host-badge t-micro g400">HOST</span>' : ''}</div>
        <div class="lobby-player-sub">${isYou ? "you" : p.bot ? `cpu · ${(p.personality || "survivor").toUpperCase()} · ${(p.botBrain || "auto").toUpperCase()}` : "player"} · $${p.cash.toLocaleString()}</div>
    </div>
    <span class="lobby-ready-dot" style="background:${ready ? "#35a653" : "#3a382a"};box-shadow:${ready ? "0 0 5px rgb(53 166 83/60%)" : "none"}"></span>
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

function lobbyRulesSnapshot(settings) {
  const preset = String(settings.rulesetPreset || state.ruleset?.preset || "classic").toUpperCase();
  const board = String(settings.boardVariant || state.boardVariant || "standard-40").toUpperCase();
  const overrides = Array.isArray(settings.rulesetOverrides) ? settings.rulesetOverrides.length : 0;
  const overrideCopy = overrides ? ` · ${overrides} override${overrides === 1 ? "" : "s"}` : "";
  const players = `${settings.maxPlayers} players · $${Number(settings.startingCash).toLocaleString()} start`;
  return `<div class="settings-rule">
      <strong style="color:var(--gold-300)">Active rules snapshot</strong><br>
      ${preset} · ${board}${overrideCopy}<br>
      ${players} · ${toggleCopy(settings.vacationPool, "pool on", "no pool")} ·
      ${toggleCopy(settings.trading, "trading on", "no trades")} ·
      ${toggleCopy(settings.auction, "auction on", "no auction")} ·
      ${bankLoanCopy(settings)} ·
      ${toggleCopy(settings.globalEvents, "global events on", "global events off")} ·
      ${toggleCopy(settings.casino, "casino on", "casino off")} ·
      ${toggleCopy(settings.market, "market on", "market off")} ·
      ${botCopy(settings)} ·
      ${settings.turnTimer ? settings.turnTimer + "s timer" : "no timer"} ·
      ${settings.bankruptMode === "elim" ? "eliminate busted" : "debt deals"}
    </div>`;
}

function toggleCopy(enabled, on, off) {
  return enabled ? on : off;
}

function bankLoanCopy(settings) {
  return settings.bankLoans ? `${String(settings.bankLoanSeverity).toLowerCase()} bank loans` : "bank loans off";
}

function botCopy(settings) {
  if (!settings.bots) return "no bots";
  return `bot ${String(settings.botBrain || "auto").toLowerCase()} · ${String(settings.botPersonality || "survivor").toLowerCase()} · ${String(settings.botDifficulty || "table").toLowerCase()}`;
}

function renderLobbyRail() {
  // the settings rail owns the right column for both "setup" (choosing
  // appearance) and "lobby" (configuring rules) — the in-game Holdings
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
    settingRow("Ruleset Preset", "Classic is the clean baseline; After Hours enables Poorup systems by default.", sel("rulesetPreset", s.rulesetPreset || "classic", [["classic", "CLASSIC"], ["after-hours", "AFTER HOURS"], ["custom", "CUSTOM"]])),
    s.rulesetPreset === "custom"
      ? settingRow("Ruleset Base", "Custom starts from this preset before explicit overrides are applied.", sel("rulesetBase", s.rulesetBase || "classic", [["classic", "CLASSIC"], ["after-hours", "AFTER HOURS"]]))
      : "",
    settingRow("Board Variant", "Board size changes capacity and spaces, never the Classic 40 layout.", sel("boardVariant", s.boardVariant || "standard-40", [["standard-40", "STANDARD 40 · 2–4"], ["metro-52", "METRO 52 · 2–6"]])),
    settingRow("Custom Overrides", "Host-only changes are recorded on the active preset.", `<span class="ruleset-override-control"><span class="t-label f11 g400" id="ruleset-override-count">${Array.isArray(s.rulesetOverrides) ? s.rulesetOverrides.length : 0} OVERRIDES</span><button class="btn-dark ruleset-reset-btn" type="button" data-reset-ruleset ${(!Array.isArray(s.rulesetOverrides) || !s.rulesetOverrides.length) ? "disabled" : ""}><span class="t-label f11">RESET TO PRESET</span></button></span>`),
    settingRowNum("Max Players", "Seats at the table.", stepper("maxPlayers", s.maxPlayers, 2, s.boardVariant === "metro-52" ? 6 : 4)),
    settingRowNum("Bots", "Reserve CPU seats for Solo Dev Mode.", stepper("bots", s.bots, 0, Math.max(0, s.maxPlayers - 1))),
    settingRow("Bot Personality", "Choose the table instinct used by every CPU seat.", sel("botPersonality", s.botPersonality, [["survivor","SURVIVOR"],["builder","BUILDER"],["shark","SHARK"],["speculator","SPECULATOR"],["diplomat","DIPLOMAT"],["chaos","CHAOS"]])),
    settingRow("Bot Brain", "AI is preferred; the house brain takes over when credits or service are unavailable.", sel("botBrain", s.botBrain, [["auto","AUTO · AI → NO-AI"],["ai","AI · FALLBACK ON"],["no-ai","NO-AI · OFFLINE"]])),
    settingRow("Bot Difficulty", "Change search depth and reserve tolerance, never the legal rules.", sel("botDifficulty", s.botDifficulty, [["house","HOUSE"],["table","TABLE"],["expert","EXPERT"]])),
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
    settingRow("Bankruptcy", "How to handle a bust player.", sel("bankruptMode", s.bankruptMode, [["elim","ELIMINATE"],["debt","DEBT DEAL"]])),
    settingRow("Bank Loans", "Emergency credit with collateral and a hard maturity.", tog("bankLoans", s.bankLoans)),
    settingRow("Loan Severity", "Premium applied to emergency bank credit.", sel("bankLoanSeverity", s.bankLoanSeverity, [["fair","FAIR"],["predatory","PREDATORY"],["extreme","EXTREME"]])),
    settingRow("Casino Access", "Virtual-money European roulette. No cash-out or loan-funded bets.", tog("casino", s.casino)),
    settingRow("Market Access", "Fictional indexes with visible prices and a small trading fee.", tog("market", s.market)),
    settingRow("Market Complexity", "Unlock margin, shorting, or derivatives in staged order.", sel("marketComplexity", s.marketComplexity || "basic", [["basic", "BASIC"], ["margin", "MARGIN"], ["shorting", "SHORTING"], ["derivatives", "DERIVATIVES"]])),
  ]);
}

function lobbyOptionalSections(s) {
  return [
    lobbySection("Global Events", [settingRow("Global Events", "Rare, escalating headlines. Timing and severity scale with the round.", tog("globalEvents", Boolean(s.globalEvents)))]),
    lobbySection("Building", [settingRowNum("House Limit", "Total houses in the bank.", sel("houseLimit", s.houseLimit, [["10","10 HOUSES"],["20","20 HOUSES"],["32","32 HOUSES"]])), settingRowNum("Hotel Limit", "Total hotels in the bank.", sel("hotelLimit", s.hotelLimit, [["6","6 HOTELS"],["12","12 HOTELS"]]))]),
    lobbySection("Turn Timer", [settingRow("Timer Per Turn", "Seconds allowed per move (0 = off).", sel("turnTimer", s.turnTimer, [["0","OFF"],["30","30 SEC"],["60","60 SEC"],["120","2 MIN"]]))]),
  ];
}

function lobbySectionsMarkup(s, locked, hostLocked, previewPlayers) {
  return [
    lobbySetupNotice(locked, hostLocked),
    lobbySection("Players At Table", previewPlayers.map((p, i) => lobbyPlayerRowHTML(p, i))),
    lobbyTableRules(s),
    lobbyEconomy(s),
    ...lobbyOptionalSections(s),
    lobbyRulesSnapshot(s),
  ].join("");
}

function applyLobbyLockState(locked, hostLocked) {
  const startBtn = $("#lobby-start-btn");
  startBtn.disabled = locked || hostLocked;
  startBtn.querySelector(".cta-text").textContent = locked ? "Finish Setup First" : hostLocked ? "Host Starts Round" : "Start Round";
  $("#lobby-settings-body").querySelectorAll("[data-setting], [data-step]").forEach((control) => {
    control.disabled = locked || hostLocked;
    if (locked || hostLocked) control.setAttribute("aria-disabled", "true");
  });
}

function renderLobbyRailContent(s, locked, hostLocked) {
  const seated = locked ? [buildPreviewSelf()] : state.players.slice(0, s.maxPlayers);
  $("#lobby-settings-body").innerHTML = lobbySectionsMarkup(s, locked, hostLocked, seated);
  applyLobbyLockState(locked, hostLocked);
}

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

function syncServerAppearance() {
  const meta = getAppearanceMeta(activeAppearance());
  host.emitServer("set-player-appearance", {
    nickname: state.alias.trim() || meta.baseName,
    color: meta.color,
    avatarGrid: meta.avatarGrid || null,
  }, (response) => {
    if (response?.success === false) {
      // Audit #24: the rejection also has to reach players stuck on the home
      // screen, where the chat transcript is invisible.
      parlorNotice("APPEARANCE", response.error || "Appearance could not be updated.");
      host.say(response.error || "Appearance could not be updated.");
      host.renderChat();
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
  state.phase = "setup";
  state.tableAppearanceOverride = null;
  state.setupTab = typeof state.appearance === "string" ? "custom" : "preset";
  // always start the setup/lobby screens from a clean board — otherwise a
  // finished game's deed ownership, houses and token positions would still
  // be visible behind the setup overlay after going home and rejoining.
  // The setup/lobby view must represent only seats acknowledged by the
  // server. The local buildPlayers helper includes demo CPU seats for the
  // home preview, so keep just the human placeholder until startGame creates
  // any configured bots authoritatively.
  state.players = buildPlayers(activeAppearance(), state.alias).slice(0, 1);
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
  state.botStatus = null;
  state.pendingBuyTile = null;
  state.auction = null;
  state.mortgaged = {};
  state.offers = [];
  state.deedDetail = null;
  stopAuctionTimer();
  host.clearSave();
  closeAllSurfaces();
  state.log = ["ACTIVE DESIGN READY — ENTER THE PARLOR."];
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
  const preset = loadRulesetPreset();
  state.quickJoin = true;
  state.pendingRoomMeta = {
    roomName: "QUICK TABLE",
    visibility: "public",
    rulesetPreset: preset,
    boardVariant: "standard-40"
  };
  state.pendingRoomSettings = { vacationPool: true, trading: true, auction: false };
  parlorNotice("QUICK TABLE", "NO OPEN TABLES — HOSTING A NEW PUBLIC TABLE.");
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
    parlorNotice("QUICK TABLE", "OPEN TABLE FOUND — JOINING NOW.");
    enterParlor({ roomId: candidate.roomId });
    return;
  }
  quickTableFallbackCreate();
}

function requestQuickTableDirectory() {
  const requestId = ++quickTableRequestId;
  clearQuickTableDirectoryTimer();
  parlorNotice("QUICK TABLE", "LOOKING FOR AN OPEN PUBLIC TABLE…");
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
  parlorNotice("QUICK TABLE", `${response.error} Looking for another open table…`);
  requestQuickTableDirectory();
}

function parlorEntryPayload(event, requestedCode, meta, requestedRoomId = "", requestId = "") {
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
  // Surface the rejection on the visible toast stack before bouncing
  // home — say() alone lands in the hidden chat panel (A1/A3).
  parlorNotice("TABLE NOTICE", response.error || "Room could not be entered.");
  host.say(response.error || "Room could not be entered.");
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
  if (response?.created && response.hostId) state.hostId = response.hostId;
  if (response?.created && response.playerId) state.roomPlayerId = response.playerId;
  if (Object.prototype.hasOwnProperty.call(response || {}, "roomCode")) state.roomCode = response.roomCode || "";
  if (response?.visibility) state.roomVisibility = response.visibility === "public" ? "public" : "private";
  state.phase = "setup";
  host.renderAll();
  renderTopNav();
  syncServerAppearance();
  applyPendingRoomSettings();
  state.pendingRoomMeta = null;
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

export function enterParlor(code) {
  if (!requireGuestAlias()) return;
  if (state.roomEntryPending) return;
  const descriptor = code && typeof code === "object" ? code : { roomCode: code };
  const requestedCode = String(descriptor.roomCode || "").trim().toUpperCase();
  const requestedRoomId = String(descriptor.roomId || "").trim().slice(0, 120);
  const meta = getAppearanceMeta(activeAppearance());
  const event = requestedCode || requestedRoomId ? "join-room" : "create-room";
  const requestId = event === "create-room" ? String(host.createRequestId?.("create-room") || "") : "";
  resetTableForEntry(requestedCode, requestId);
  const payload = parlorEntryPayload(event, requestedCode, meta, requestedRoomId, requestId);
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
  syncServerAppearance();
    state.phase = "lobby";
    host.renderAll();
    requestAnimationFrame(() => placePieces());
    return;
}

export function goHome() {
  // Release the seat on the server so the room can GC and peers stop
  // counting a home-screen player as online (A4-F3: ghost seats).
  if (state.phase !== "home") host.emitServer("leave-room", {}, () => {});
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
  state.botStatus = null;
  // Audit #16: home must not keep the previous room's transcript or activity
  // log. Rejoining a room re-seeds both from the server's next snapshot, so
  // emptying here never leaves stale content behind.
  state.messages = [];
  state.log = [];
  stopTurnCountdown();
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
  // reset right rail visibility to game mode
  $("#right-rail-game").classList.remove("is-hidden");
  $("#right-rail-lobby").classList.add("is-hidden");
  host.showView("home");
}

// Audit 7.5: one door back to the homescreen. goHome() releases the room
// seat; a raw showView("home") from a page/rail handler used to leave the
// seat (and the room's stale transcript) behind when the user was mid-room.
export function leaveRoomForHome() {
  if (inRoomSession()) goHome();
  else host.showView("home");
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
  const reset = e.target.closest("[data-reset-ruleset]");
  if (reset && !reset.disabled) resetRuleset();
}

function resetRuleset() {
  const base = state.settings.rulesetBase || (state.settings.rulesetPreset === "after-hours" ? "after-hours" : "classic");
  state.settings.rulesetOverrides = [];
  host.updateServerSetting("rulesetBase", base);
  host.updateServerSetting("rulesetOverrides", []);
  renderLobbyRail();
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

const NUMERIC_SETTING_KEYS = ["startingCash", "houseLimit", "hotelLimit", "turnTimer"];

function applyNumericSettingField(key, value) {
  if (value.trim() === "") return false;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return false;
  if (parsed < 0) return false;
  state.settings[key] = Math.floor(parsed);
  return true;
}

function isSettingField(el) {
  if (!el) return false;
  if (el.tagName === "SELECT") return true;
  return el.matches("input[data-setting]");
}

const applySettingField = (e) => {
  const sel = e.target.closest("[data-setting]");
  if (!isSettingField(sel)) return;
  const key = sel.dataset.setting;
  if (NUMERIC_SETTING_KEYS.includes(key)) {
    if (!applyNumericSettingField(key, sel.value)) return;
  } else {
    state.settings[key] = sel.matches("input[type=checkbox]") ? sel.checked : sel.value;
  }
  host.updateServerSetting(key, state.settings[key]);
  renderLobbyRail();
};

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
  // deliberately raced against the authoritative server, with two bounded
  // retries for rooms that fill between list-rooms and join-room.
  $("#quick-table-btn")?.addEventListener("click", () => {
    if (!requireGuestAlias()) return;
    if (quickTableFlow || state.roomEntryPending) return;
    quickTableFlow = true;
    quickTableRetryCount = 0;
    state.quickJoin = true;
    state.settings.vacationPool = true;
    state.settings.trading = true;
    state.settings.auction = false;
    requestQuickTableDirectory();
  });

  // lobby settings interactions
  $("#lobby-settings-body").addEventListener("click", onLobbySettingsClick);
  $("#lobby-settings-body").addEventListener("change", applySettingField);
}

export { renderSetup, renderLobbyRail, setActiveAppearance };
